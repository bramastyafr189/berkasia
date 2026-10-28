#!/usr/bin/env python3
import io
import base64
import json
import os
import secrets
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import fitz
from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent
MAX_UPLOAD = 50 * 1024 * 1024
MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
RESULTS = {}
SOURCES = {}
LOCK = threading.Lock()
TTL = 3600


def image_candidate(data, fmt, quality, scale):
    with Image.open(io.BytesIO(data)) as original:
        im = ImageOps.exif_transpose(original)
        im.load()
        if scale < 1:
            im.thumbnail((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        if fmt == 'JPEG':
            if im.mode in ('RGBA', 'LA') or 'transparency' in im.info:
                rgba = im.convert('RGBA')
                background = Image.new('RGB', rgba.size, 'white')
                background.paste(rgba, mask=rgba.getchannel('A'))
                im = background
            elif im.mode not in ('RGB', 'L'):
                im = im.convert('RGB')
            im.save(out, 'JPEG', quality=quality, optimize=True, progressive=True)
        elif fmt == 'WEBP':
            im.save(out, 'WEBP', quality=quality, method=4)
        else:
            # Quantization keeps transparency where present and reduces PNG size.
            if im.mode not in ('RGB', 'RGBA'):
                im = im.convert('RGBA' if 'transparency' in im.info else 'RGB')
            im = im.quantize(colors=max(16, min(256, round(quality * 2.56))), method=Image.Quantize.FASTOCTREE if im.mode == 'RGBA' else Image.Quantize.MEDIANCUT)
            im.save(out, 'PNG', optimize=True)
        return out.getvalue()


def pdf_candidate(data, quality, scale):
    doc = fitz.open(stream=data, filetype='pdf')
    if doc.needs_pass:
        raise ValueError('PDF yang dilindungi kata sandi belum didukung.')
    seen = set()
    for page in doc:
        for item in page.get_images(full=True):
            xref, mask = item[0], item[1]
            if xref in seen or mask:
                continue
            seen.add(xref)
            try:
                extracted = doc.extract_image(xref)
                with Image.open(io.BytesIO(extracted['image'])) as source:
                    if source.width * source.height > MAX_PIXELS or source.mode in ('RGBA', 'LA') or 'transparency' in source.info:
                        continue
                    im = source.convert('RGB')
                    if scale < 1:
                        im.thumbnail((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.LANCZOS)
                    buf = io.BytesIO()
                    im.save(buf, 'JPEG', quality=quality, optimize=True)
                    replacement = buf.getvalue()
                    if len(replacement) < len(extracted['image']):
                        page.replace_image(xref, stream=replacement)
            except (ValueError, OSError, RuntimeError, KeyError):
                continue
    result = doc.tobytes(garbage=4, deflate=True, deflate_images=True, deflate_fonts=True)
    doc.close()
    return result


def convert_image(data, output_format):
    if output_format not in ('JPEG', 'PNG', 'WEBP', 'PDF'):
        raise ValueError('Pilih format hasil JPG, PNG, WebP, atau PDF.')
    formats = {'JPEG': ('.jpg', 'image/jpeg'), 'PNG': ('.png', 'image/png'), 'WEBP': ('.webp', 'image/webp'), 'PDF': ('.pdf', 'application/pdf')}
    if data.startswith(b'%PDF-'):
        with fitz.open(stream=data, filetype='pdf') as doc:
            if doc.needs_pass:
                raise ValueError('PDF yang dilindungi kata sandi belum didukung.')
            if output_format == 'PDF':
                return data, '.pdf', 'application/pdf', 'converted'
            if len(doc) > 50:
                raise ValueError('Konversi PDF ke gambar dibatasi 50 halaman.')
            buf = io.BytesIO()
            ext, _ = formats[output_format]
            with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                for number, page in enumerate(doc, 1):
                    # Limit rendering to 10 megapixels per page.
                    scale = min(2, (10_000_000 / max(1, page.rect.width * page.rect.height)) ** .5)
                    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
                    page_bytes = io.BytesIO()
                    options = {'quality': 95, 'subsampling': 0} if output_format == 'JPEG' else {'lossless': True} if output_format == 'WEBP' else {}
                    im.save(page_bytes, output_format, **options)
                    archive.writestr(f'halaman-{number:03d}{ext}', page_bytes.getvalue())
            return buf.getvalue(), '.zip', 'application/zip', 'converted'
    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.format not in ('JPEG', 'PNG', 'WEBP'):
                raise ValueError('Konversi mendukung file JPG, PNG, WebP, dan PDF.')
            if getattr(source, 'n_frames', 1) > 1:
                raise ValueError('Gambar animasi belum didukung.')
            if source.width * source.height > MAX_PIXELS:
                raise ValueError('Resolusi gambar melebihi batas 40 megapiksel.')
            if source.format == output_format:
                source.verify()
                result = data
            else:
                im = ImageOps.exif_transpose(source)
                im.load()
                if output_format in ('JPEG', 'PDF'):
                    if im.mode in ('RGBA', 'LA') or 'transparency' in im.info:
                        rgba = im.convert('RGBA')
                        im = Image.new('RGB', rgba.size, 'white')
                        im.paste(rgba, mask=rgba.getchannel('A'))
                    elif im.mode not in ('RGB', 'L'):
                        im = im.convert('RGB')
                elif im.mode not in ('RGB', 'RGBA', 'L', 'LA'):
                    im = im.convert('RGBA' if 'transparency' in im.info else 'RGB')
                buf = io.BytesIO()
                options = {'quality': 95, 'subsampling': 0} if output_format == 'JPEG' else {'lossless': True} if output_format == 'WEBP' else {}
                im.save(buf, output_format, **options)
                result = buf.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ValueError('Format file tidak didukung atau file rusak.')
    ext, mime = formats[output_format]
    return result, ext, mime, 'converted'


def compress(data, target, output_format="original"):
    if data.startswith(b'%PDF-'):
        kind, ext, mime = 'PDF', '.pdf', 'application/pdf'
        with fitz.open(stream=data, filetype='pdf') as doc:
            if doc.needs_pass:
                raise ValueError('PDF yang dilindungi kata sandi belum didukung.')
    else:
        try:
            with Image.open(io.BytesIO(data)) as im:
                kind = im.format
                if getattr(im, 'n_frames', 1) > 1:
                    raise ValueError('Gambar animasi belum didukung.')
                if im.width * im.height > MAX_PIXELS:
                    raise ValueError('Resolusi gambar melebihi batas 40 megapiksel.')
                im.verify()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            raise ValueError('Format file tidak didukung atau file rusak.')
        if kind not in ('JPEG', 'PNG', 'WEBP'):
            raise ValueError('Format file harus JPG, PNG, WebP, atau PDF.')
        ext, mime = {'JPEG': ('.jpg', 'image/jpeg'), 'PNG': ('.png', 'image/png'), 'WEBP': ('.webp', 'image/webp')}[kind]
    if output_format not in ('original', 'JPEG', 'PNG', 'WEBP'):
        raise ValueError('Format hasil tidak didukung.')
    if kind == 'PDF' and output_format != 'original':
        raise ValueError('Konversi format hanya tersedia untuk gambar. Pilih format asli untuk PDF.')
    converting = kind != 'PDF' and output_format not in ('original', kind)
    if converting:
        kind = output_format
        ext, mime = {'JPEG': ('.jpg', 'image/jpeg'), 'PNG': ('.png', 'image/png'), 'WEBP': ('.webp', 'image/webp')}[kind]
    if len(data) <= target and not converting:
        return data, ext, mime, 'already_small'
    best = None if converting else data
    # Prefer retaining dimensions; lower resolution only when necessary.
    for scale in (1, .85, .7, .55, .4, .3, .2, .1):
        lo, hi = 15, 90
        found = None
        while lo <= hi:
            q = (lo + hi) // 2
            candidate = pdf_candidate(data, q, scale) if kind == 'PDF' else image_candidate(data, kind, q, scale)
            if best is None or len(candidate) < len(best):
                best = candidate
            if len(candidate) <= target:
                found = candidate
                lo = q + 1
            else:
                hi = q - 1
        if found is not None:
            return found, ext, mime, 'success'
    return best, ext, mime, 'unreachable'


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/download/'):
            token = path.removeprefix('/download/')
            with LOCK:
                entry = RESULTS.get(token)
                if entry and entry[3] < time.time():
                    RESULTS.pop(token, None)
                    entry = None
            if not entry:
                return self.send_json(404, {'error': 'File sudah kedaluwarsa. Silakan kompres ulang.'})
            data, mime, name, _ = entry
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Disposition', 'attachment')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
            return
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/pdf.js': ('pdf.js', 'text/javascript; charset=utf-8')}
        if path not in files:
            return self.send_json(404, {'error': 'Halaman tidak ditemukan.'})
        name, mime = files[path]
        body = (ROOT / 'static' / name).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == '/pdf/source':
            return self.pdf_source()
        if self.path == '/pdf/save':
            return self.pdf_save()
        if self.path == '/bundle':
            return self.bundle()
        if self.path != '/compress':
            return self.send_json(404, {'error': 'Halaman tidak ditemukan.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > MAX_UPLOAD:
                raise ValueError('Ukuran file maksimal 50 MB.')
            mode = self.headers.get('X-Mode', 'compress')
            if mode not in ('compress', 'convert'):
                raise ValueError('Mode tidak valid.')
            target = float(self.headers.get('X-Target-Bytes', '0'))
            if mode == 'compress' and not 1 <= target <= MAX_UPLOAD:
                raise ValueError('Masukkan target ukuran yang valid, maksimal 50 MB.')
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError('Unggahan tidak lengkap.')
            output_format = self.headers.get('X-Output-Format', 'original')
            output, ext, mime, status = convert_image(data, output_format) if mode == 'convert' else compress(data, int(target), output_format)
            token = secrets.token_urlsafe(24)
            with LOCK:
                now = time.time()
                for key in list(RESULTS):
                    if RESULTS[key][3] < now:
                        del RESULTS[key]
                RESULTS[token] = (output, mime, 'file-compressed' + ext, now + TTL)
            self.send_json(200, {'status': status, 'originalSize': len(data), 'resultSize': len(output), 'targetSize': int(target), 'downloadUrl': '/download/' + token, 'mime': mime})
        except (ValueError, OverflowError) as exc:
            self.send_json(400, {'error': str(exc)})
        except Exception:
            self.send_json(400, {'error': 'File tidak dapat diproses. Pastikan file valid dan coba lagi.'})

    def pdf_source(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > MAX_UPLOAD:
                raise ValueError('Ukuran file maksimal 50 MB.')
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError('Unggahan tidak lengkap.')
            pages = []
            if data.startswith(b'%PDF-'):
                with fitz.open(stream=data, filetype='pdf') as doc:
                    if doc.needs_pass:
                        raise ValueError('PDF berkata sandi belum didukung.')
                    if not 1 <= len(doc) <= 100:
                        raise ValueError('PDF harus memiliki 1–100 halaman.')
                    for page in doc:
                        scale = min(0.4, 220 / max(page.rect.width, page.rect.height))
                        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                        pages.append(base64.b64encode(pix.tobytes('png')).decode('ascii'))
                kind = 'pdf'
            else:
                with Image.open(io.BytesIO(data)) as im:
                    if im.format not in ('JPEG', 'PNG', 'WEBP') or getattr(im, 'n_frames', 1) > 1:
                        raise ValueError('Gunakan PDF, JPG, PNG, atau WebP tanpa animasi.')
                    if im.width * im.height > MAX_PIXELS:
                        raise ValueError('Resolusi gambar melebihi 40 megapiksel.')
                    im = ImageOps.exif_transpose(im)
                    im.thumbnail((220, 220))
                    buf = io.BytesIO()
                    im.save(buf, 'PNG')
                    pages.append(base64.b64encode(buf.getvalue()).decode('ascii'))
                kind = 'image'
            token = secrets.token_urlsafe(24)
            with LOCK:
                SOURCES[token] = (data, kind, time.time() + TTL)
            self.send_json(200, {'source': token, 'pages': pages, 'kind': kind})
        except ValueError as exc:
            self.send_json(400, {'error': str(exc)})
        except Exception:
            self.send_json(400, {'error': 'File tidak dapat dibaca. Pastikan file valid.'})

    def pdf_save(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > 100_000:
                raise ValueError('Daftar halaman tidak valid.')
            pages = json.loads(self.rfile.read(size))
            if not isinstance(pages, list) or not 1 <= len(pages) <= 100:
                raise ValueError('PDF harus memiliki 1–100 halaman.')
            with LOCK:
                sources = {item['source']: SOURCES.get(item['source']) for item in pages}
            if any(not source or source[2] < time.time() for source in sources.values()):
                raise ValueError('File sumber kedaluwarsa. Unggah ulang file.')
            result = fitz.open()
            try:
                for item in pages:
                    data, kind, _ = sources[item['source']]
                    number, rotation = item['page'], item['rotation']
                    if not isinstance(number, int) or isinstance(number, bool) or rotation not in (0, 90, 180, 270):
                        raise ValueError('Pengaturan halaman tidak valid.')
                    if kind == 'pdf':
                        with fitz.open(stream=data, filetype='pdf') as source:
                            if number < 0 or number >= len(source):
                                raise ValueError('Halaman tidak ditemukan.')
                            result.insert_pdf(source, from_page=number, to_page=number, links=True, annots=True)
                    else:
                        if number != 0:
                            raise ValueError('Halaman tidak ditemukan.')
                        with Image.open(io.BytesIO(data)) as original:
                            im = ImageOps.exif_transpose(original).convert('RGBA')
                            image_buf = io.BytesIO()
                            im.save(image_buf, 'PNG')
                            page = result.new_page(width=im.width, height=im.height)
                            page.insert_image(page.rect, stream=image_buf.getvalue())
                    page = result[-1]
                    page.set_rotation((page.rotation + rotation) % 360)
                output = result.tobytes(garbage=3, deflate=True)
            finally:
                result.close()
            token = secrets.token_urlsafe(24)
            with LOCK:
                RESULTS[token] = (output, 'application/pdf', 'hasil.pdf', time.time() + TTL)
            self.send_json(200, {'downloadUrl': '/download/' + token, 'size': len(output)})
        except ValueError as exc:
            self.send_json(400, {'error': str(exc)})
        except Exception:
            self.send_json(400, {'error': 'PDF tidak dapat dibuat. Periksa file dan coba lagi.'})

    def bundle(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > 100_000:
                raise ValueError('Daftar file tidak valid.')
            entries = json.loads(self.rfile.read(size))
            if not isinstance(entries, list) or not 1 <= len(entries) <= 100:
                raise ValueError('Maksimal 100 file dalam satu ZIP.')
            output = io.BytesIO()
            used = set()
            with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                with LOCK:
                    for item in entries:
                        token = item['url'].removeprefix('/download/')
                        entry = RESULTS.get(token)
                        if not entry or entry[3] < time.time():
                            raise ValueError('Ada file yang kedaluwarsa. Silakan kompres ulang.')
                        name = str(item['name']).replace('\\', '/').split('/')[-1].replace('\x00', '')[:180] or 'file'
                        stem, ext = os.path.splitext(name)
                        unique = name
                        counter = 2
                        while unique.casefold() in used:
                            unique = f'{stem}-{counter}{ext}'
                            counter += 1
                        used.add(unique.casefold())
                        archive.writestr(unique, entry[0])
            body = output.getvalue()
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Disposition', 'attachment; filename="berkasia-hasil.zip"')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            self.send_json(400, {'error': 'ZIP tidak dapat dibuat. Pastikan file belum kedaluwarsa dan coba lagi.'})


def clear_expired_results():
    while True:
        time.sleep(60)
        now = time.time()
        with LOCK:
            for key in list(RESULTS):
                if RESULTS[key][3] < now:
                    del RESULTS[key]
            for key in list(SOURCES):
                if SOURCES[key][2] < now:
                    del SOURCES[key]


if __name__ == '__main__':
    threading.Thread(target=clear_expired_results, daemon=True).start()
    port = int(os.environ.get('PORT', '8000'))
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'Buka http://127.0.0.1:{port}', flush=True)
    server.serve_forever()
