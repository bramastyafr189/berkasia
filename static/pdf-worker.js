import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, degrees } from 'pdf-lib';
import JSZip from 'jszip';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const sources = new Map();
const types = { JPEG: 'image/jpeg', PNG: 'image/png', WEBP: 'image/webp' };
const report = (id, progress) => self.postMessage({ id, progress });
async function loadPDF(bytes) {
  try { return await pdfjs.getDocument({ data: bytes.slice() }).promise; }
  catch { throw new Error('PDF rusak atau dilindungi kata sandi.'); }
}
async function imageCanvas(file, maxSize) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('Resolusi gambar melebihi 40 megapiksel.');
    const scale = maxSize ? Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height)) : 1;
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { bitmap.close(); }
}
async function pdfCanvas(page, scale) {
  const base = page.getViewport({ scale: 1 });
  scale = Math.min(scale, Math.sqrt(10_000_000 / (base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
  return canvas;
}
async function encode(canvas, type, quality) {
  const blob = await canvas.convertToBlob({ type, quality });
  if (blob.type !== type) throw new Error('Format ini tidak didukung browser.');
  return blob;
}
async function thumbnail(canvas) {
  const bytes = new Uint8Array(await (await encode(canvas, 'image/png')).arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
async function renderPdf(file, quality, scale, id, attempt, attempts) {
  const pdf = await loadPDF(new Uint8Array(await file.arrayBuffer()));
  try {
    if (pdf.numPages > 50) throw new Error('Kompresi PDF dibatasi 50 halaman di browser.');
    const output = await PDFDocument.create();
    for (let i = 0; i < pdf.numPages; i++) {
      report(id, (attempt + i / pdf.numPages) / attempts);
      const page = await pdf.getPage(i + 1), original = page.getViewport({ scale: 1 });
      const canvas = await pdfCanvas(page, scale);
      const jpeg = await encode(canvas, 'image/jpeg', quality);
      const image = await output.embedJpg(await jpeg.arrayBuffer());
      output.addPage([original.width, original.height]).drawImage(image, { x: 0, y: 0, width: original.width, height: original.height });
      canvas.width = canvas.height = 1;
    }
    return new Blob([await output.save()], { type: 'application/pdf' });
  } finally { await pdf.cleanup(); }
}
async function compress(file, target, method, id) {
  if (method !== 'raster') {
    const bytes = await file.arrayBuffer();
    const validation = await loadPDF(new Uint8Array(bytes)); await validation.cleanup();
    let candidate;
    try { const pdf = await PDFDocument.load(bytes); candidate = new Blob([await pdf.save({ useObjectStreams: true })], { type: 'application/pdf' }); }
    catch { throw new Error('PDF tidak dapat diproses tanpa mengubah teks.'); }
    report(id, 1);
    const blob = candidate.size < file.size ? candidate : file;
    return { blob, status: file.size <= target ? 'already_small' : blob.size <= target ? 'success' : 'unreachable' };
  }
  if (file.size <= target) { const pdf = await loadPDF(new Uint8Array(await file.arrayBuffer())); await pdf.cleanup(); return { blob: file, status: 'already_small' }; }
  let best = file;
  const attempts = [[1.5,.85],[1.2,.65],[1,.5],[.8,.4],[.6,.3],[.4,.2]];
  for (let i = 0; i < attempts.length; i++) {
    const [scale, quality] = attempts[i], candidate = await renderPdf(file, quality, scale, id, i, attempts.length);
    if (candidate.size < best.size) best = candidate;
    if (candidate.size <= target) return { blob: candidate, status: 'success', rasterized: true };
  }
  return { blob: best, status: 'unreachable', rasterized: best !== file };
}
async function convert(file, format, isPdf, id) {
  if (!isPdf) {
    const canvas = await imageCanvas(file);
    const output = await PDFDocument.create();
    // Flatten transparency onto white, as in the original conversion flow.
    const white = new OffscreenCanvas(canvas.width, canvas.height), ctx = white.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, white.width, white.height); ctx.drawImage(canvas, 0, 0);
    const image = await output.embedPng(await (await encode(white, 'image/png')).arrayBuffer());
    output.addPage([white.width, white.height]).drawImage(image, { x: 0, y: 0, width: white.width, height: white.height });
    return { blob: new Blob([await output.save()], { type: 'application/pdf' }), status: 'converted' };
  }
  const pdf = await loadPDF(new Uint8Array(await file.arrayBuffer()));
  try {
    if (format === 'PDF') return { blob: file, status: 'converted' };
    if (pdf.numPages > 50) throw new Error('Konversi PDF dibatasi 50 halaman.');
    const zip = new JSZip();
    for (let i = 0; i < pdf.numPages; i++) {
      report(id, i / pdf.numPages);
      const canvas = await pdfCanvas(await pdf.getPage(i + 1), 2);
      const blob = await encode(canvas, types[format], .95);
      zip.file(`halaman-${String(i + 1).padStart(3, '0')}.${format === 'JPEG' ? 'jpg' : format.toLowerCase()}`, await blob.arrayBuffer());
      canvas.width = canvas.height = 1;
    }
    return { blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' }), status: 'converted' };
  } finally { await pdf.cleanup(); }
}
async function sourceFile(file, id) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
  const pages = [];
  if (isPdf) {
    const pdf = await loadPDF(bytes);
    try {
      if (pdf.numPages > 100) throw new Error('PDF harus memiliki 1–100 halaman.');
      for (let i = 0; i < pdf.numPages; i++) {
        report(id, i / pdf.numPages);
        const page = await pdf.getPage(i + 1), v = page.getViewport({ scale: 1 });
        pages.push(await thumbnail(await pdfCanvas(page, Math.min(.4, 220 / Math.max(v.width, v.height)))));
      }
    } finally { await pdf.cleanup(); }
  } else {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Gunakan PDF, JPG, PNG, atau WebP.');
    pages.push(await thumbnail(await imageCanvas(file, 220)));
  }
  const source = crypto.randomUUID(); sources.set(source, { bytes, file, isPdf });
  return { source, pages, kind: isPdf ? 'pdf' : 'image' };
}
async function savePdf(pages, id) {
  if (!pages.length || pages.length > 100) throw new Error('PDF harus memiliki 1–100 halaman.');
  const output = await PDFDocument.create(), cache = new Map();
  for (let i = 0; i < pages.length; i++) {
    report(id, i / pages.length);
    const item = pages[i], source = sources.get(item.source);
    if (!source) throw new Error('File sumber tidak ditemukan. Unggah ulang file.');
    if (source.isPdf) {
      let pdf = cache.get(item.source);
      if (!pdf) { try { pdf = await PDFDocument.load(source.bytes); } catch { throw new Error('PDF tidak dapat diedit atau dilindungi kata sandi.'); } cache.set(item.source, pdf); }
      const [page] = await output.copyPages(pdf, [item.page]);
      page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360)); output.addPage(page);
    } else {
      const canvas = await imageCanvas(source.file), image = await output.embedPng(await (await encode(canvas, 'image/png')).arrayBuffer());
      const page = output.addPage([canvas.width, canvas.height]);
      page.drawImage(image, { x: 0, y: 0, width: canvas.width, height: canvas.height }); page.setRotation(degrees(item.rotation));
    }
  }
  return { blob: new Blob([await output.save()], { type: 'application/pdf' }), status: 'success' };
}
self.onmessage = async ({data}) => {
  const { id, action, payload } = data;
  try {
    let result;
    if (action === 'compress') result = await compress(payload.file, payload.target, payload.method, id);
    else if (action === 'convert') result = await convert(payload.file, payload.format, payload.isPdf, id);
    else if (action === 'source') result = await sourceFile(payload.file, id);
    else if (action === 'save') result = await savePdf(payload.pages, id);
    else throw new Error('Operasi tidak dikenali.');
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof DOMException ? 'File tidak dapat diproses. Pastikan format file didukung dan file tidak rusak.' : (error.message || 'File tidak dapat diproses.') });
  }
};
