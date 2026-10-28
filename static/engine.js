import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, degrees } from 'pdf-lib';
import JSZip from 'jszip';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const sources = new Map(), outputs = new Map();
const mimeFormats = {JPEG:'image/jpeg', PNG:'image/png', WEBP:'image/webp', PDF:'application/pdf'};
const pngBytes = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(blob => blob && blob.type === type ? resolve(blob) : reject(new Error('Format ini tidak didukung browser.')), type, quality));
const dataURL = canvas => canvas.toDataURL('image/png').split(',')[1];
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
const done = (blob, status) => { const url = URL.createObjectURL(blob); outputs.set(url, blob); return {downloadUrl:url,resultSize:blob.size,mime:blob.type,status}; };
async function loadPDF(bytes) {
  try { return await pdfjs.getDocument({data: bytes.slice()}).promise; }
  catch { throw new Error('PDF rusak atau dilindungi kata sandi.'); }
}
async function imageCanvas(file, scale=1, white=false) {
  const bitmap = await createImageBitmap(file, {imageOrientation:'from-image'});
  if (bitmap.width * bitmap.height > 40_000_000) { bitmap.close(); throw new Error('Resolusi gambar melebihi 40 megapiksel.'); }
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width*scale)); canvas.height = Math.max(1, Math.round(bitmap.height*scale));
  const ctx = canvas.getContext('2d'); if (white) { ctx.fillStyle='white'; ctx.fillRect(0,0,canvas.width,canvas.height); } ctx.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close(); return canvas;
}
async function pdfCanvas(pdf, index, scale=1) {
  const page = await pdf.getPage(index+1); const base=page.getViewport({scale:1});
  scale = Math.min(scale, Math.sqrt(10_000_000 / (base.width * base.height)));
  const viewport=page.getViewport({scale}); const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.ceil(viewport.width)); canvas.height=Math.max(1,Math.ceil(viewport.height));
  await page.render({canvasContext:canvas.getContext('2d'),viewport,canvas}).promise; return canvas;
}
async function renderPdf(file, quality, scale) {
  const source = await loadPDF(new Uint8Array(await file.arrayBuffer()));
  if (source.numPages > 50) throw new Error('Kompresi PDF dibatasi 50 halaman di browser.');
  const out = await PDFDocument.create();
  for (let i=0;i<source.numPages;i++) {
    const sourcePage = await source.getPage(i+1); const original = sourcePage.getViewport({scale:1});
    const canvas = await pdfCanvas(source,i,scale); const jpeg=await pngBytes(canvas,'image/jpeg',quality); const img=await out.embedJpg(await jpeg.arrayBuffer());
    const page=out.addPage([original.width,original.height]); page.drawImage(img,{x:0,y:0,width:original.width,height:original.height}); canvas.width=canvas.height=1;
  }
  await source.cleanup(); return new Blob([await out.save()],{type:'application/pdf'});
}
async function compressImage(file, format, target) {
  let best = format === 'original' ? file : null;
  const type = format === 'original' ? file.type : mimeFormats[format];
  if (!['image/jpeg','image/png','image/webp'].includes(type)) throw new Error('Gunakan JPG, PNG, atau WebP yang valid.');
  if (best && best.size <= target) { const canvas = await imageCanvas(file); canvas.width=canvas.height=1; return done(best,'already_small'); }
  for (const scale of [1,.85,.7,.55,.4,.3,.2,.1]) {
    const canvas=await imageCanvas(file,scale,type==='image/jpeg');
    let selected=null;
    if(type==='image/png') { const candidate=await pngBytes(canvas,type); if(!best || candidate.size<best.size) best=candidate; if(candidate.size<=target) selected=candidate; }
    else { let low=0.15, high=0.95; for(let i=0;i<7;i++) { const q=(low+high)/2; const candidate=await pngBytes(canvas,type,q); if(!best || candidate.size<best.size) best=candidate; if(candidate.size<=target){ selected=candidate;low=q; } else high=q; } }
    canvas.width=canvas.height=1; if(selected) return done(selected,'success');
  }
  return done(best,'unreachable');
}
async function compressPDF(file,target) {
  if(file.size<=target) { const pdf=await loadPDF(new Uint8Array(await file.arrayBuffer())); await pdf.cleanup(); return done(file,'already_small'); }
  let best=file;
  for (const [scale,quality] of [[1.5,.85],[1.2,.65],[1,.5],[.8,.4],[.6,.3],[.4,.2]]) {
    const candidate=await renderPdf(file,quality,scale); if(candidate.size<best.size) best=candidate;
    if(candidate.size<=target) return {...done(candidate,'success'), rasterized:true};
  }
  return {...done(best,'unreachable'), rasterized:best!==file};
}
async function convert(file,format,isPdf) {
  if(isPdf) {
    if(format==='PDF') { const pdf=await loadPDF(new Uint8Array(await file.arrayBuffer())); await pdf.cleanup(); return done(file,'converted'); }
    const pdf=await loadPDF(new Uint8Array(await file.arrayBuffer())); if(pdf.numPages>50) throw new Error('Konversi PDF dibatasi 50 halaman.');
    const zip=new JSZip(); for(let i=0;i<pdf.numPages;i++){const canvas=await pdfCanvas(pdf,i,2); const blob=await pngBytes(canvas,mimeFormats[format],.95); zip.file(`halaman-${String(i+1).padStart(3,'0')}.${format==='JPEG'?'jpg':format.toLowerCase()}`,await blob.arrayBuffer()); canvas.width=canvas.height=1;} await pdf.cleanup();
    return done(await zip.generateAsync({type:'blob',mimeType:'application/zip'}),'converted');
  }
  if(file.type===mimeFormats[format]) { const canvas=await imageCanvas(file); canvas.width=canvas.height=1; return done(file,'converted'); }
  const canvas=await imageCanvas(file,1,format==='JPEG'||format==='PDF');
  if(format==='PDF'){ const pdf=await PDFDocument.create(); const png=await pngBytes(canvas,'image/png'); const image=await pdf.embedPng(await png.arrayBuffer()); const p=pdf.addPage([canvas.width,canvas.height]); p.drawImage(image,{x:0,y:0,width:canvas.width,height:canvas.height}); return done(new Blob([await pdf.save()],{type:'application/pdf'}),'converted'); }
  const blob=await pngBytes(canvas,mimeFormats[format],.95); return done(blob,'converted');
}
async function sourceFile(file) {
  const bytes=new Uint8Array(await file.arrayBuffer()); const isPdf=new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'; let pages=[];
  if(isPdf) {const pdf=await loadPDF(bytes); if(pdf.numPages>100) throw new Error('PDF harus memiliki 1–100 halaman.'); for(let i=0;i<pdf.numPages;i++){const page=await pdf.getPage(i+1);const v=page.getViewport({scale:1}); const canvas=await pdfCanvas(pdf,i,Math.min(.4,220/Math.max(v.width,v.height))); pages.push(dataURL(canvas));} await pdf.cleanup();}
  else {if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Gunakan PDF, JPG, PNG, atau WebP.'); const canvas=await imageCanvas(file); const small=document.createElement('canvas'); const scale=Math.min(1,220/Math.max(canvas.width,canvas.height));small.width=Math.max(1,Math.round(canvas.width*scale));small.height=Math.max(1,Math.round(canvas.height*scale));small.getContext('2d').drawImage(canvas,0,0,small.width,small.height);pages.push(dataURL(small));}
  const id=crypto.randomUUID(); sources.set(id,{bytes, file, isPdf}); return {source:id,pages,kind:isPdf?'pdf':'image'};
}
async function savePdf(pages) {
  if(!pages.length || pages.length>100) throw new Error('PDF harus memiliki 1–100 halaman.'); const out=await PDFDocument.create(); const cache=new Map();
  for(const item of pages) { const source=sources.get(item.source); if(!source) throw new Error('File sumber tidak ditemukan. Unggah ulang file.');
    if(source.isPdf){let doc=cache.get(item.source);if(!doc){try{doc=await PDFDocument.load(source.bytes);}catch{throw new Error('PDF tidak dapat diedit atau dilindungi kata sandi.');} cache.set(item.source,doc);} const [page]=await out.copyPages(doc,[item.page]); page.setRotation(degrees((page.getRotation().angle+item.rotation)%360));out.addPage(page);}
    else {const canvas=await imageCanvas(source.file); const png=await pngBytes(canvas,'image/png'); const image=await out.embedPng(await png.arrayBuffer()); const page=out.addPage([canvas.width,canvas.height]);page.drawImage(image,{x:0,y:0,width:canvas.width,height:canvas.height}); page.setRotation(degrees(item.rotation));}
  }
  const blob=new Blob([await out.save()],{type:'application/pdf'}); return {...done(blob,'success'),size:blob.size};
}
window.localFetch=async function(path,options={}) {
  try {
    if(path==='/compress') {const file=options.body; const h=options.headers; const bytes=new Uint8Array(await file.slice(0,5).arrayBuffer()); const isPdf=new TextDecoder().decode(bytes)==='%PDF-'; const format=h['X-Output-Format']; let data;
      if(h['X-Mode']==='convert') data=await convert(file,format,isPdf); else if(isPdf){if(format!=='original') throw new Error('Pilih format asli untuk kompres PDF.');data=await compressPDF(file,Number(h['X-Target-Bytes']));} else data=await compressImage(file,format,Number(h['X-Target-Bytes']));
      return json({...data,originalSize:file.size}); }
    if(path==='/pdf/source') return json(await sourceFile(options.body));
    if(path==='/pdf/save') return json(await savePdf(JSON.parse(options.body)));
    if(path==='/bundle') {const entries=JSON.parse(options.body),zip=new JSZip(),used=new Set();for(const item of entries){const blob=outputs.get(item.url);if(!blob) throw new Error('File tidak ditemukan.'); let name=item.name, n=2; const dot=name.lastIndexOf('.'),stem=dot<0?name:name.slice(0,dot),ext=dot<0?'':name.slice(dot);while(used.has(name.toLowerCase()))name=`${stem}-${n++}${ext}`;used.add(name.toLowerCase());zip.file(name,await blob.arrayBuffer());} return new Response(await zip.generateAsync({type:'blob',mimeType:'application/zip'}));}
    throw new Error('Operasi tidak dikenali.');
  } catch(error){return json({error:error.message || 'File tidak dapat diproses.'},400);}
};
