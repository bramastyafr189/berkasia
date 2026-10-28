const pdfStart = document.querySelector('#pdf-start');
const pdfSource = document.querySelector('#pdf-source');
const pdfMessage = document.querySelector('#pdf-message');
const pageGrid = document.querySelector('#page-grid');
const pdfEditor = document.querySelector('#pdf-editor');
const pdfDialog = document.querySelector('#page-dialog');
let pdfPages = [];
let sourceAction = null;
let incoming = null;
let dragged = null;
let editorGeneration = 0;
const pdfLoading = document.querySelector('#pdf-loading');
function setPdfLoading(busy) { pdfLoading.hidden = !busy; pdfStart.disabled = busy; pdfSource.disabled = busy; document.querySelector('#add-pages').disabled = busy; document.querySelector('#save-pdf').disabled = busy || pdfPages.length === 0; pageGrid.inert = busy; }
function pdfError(text) { pdfMessage.textContent = text; pdfMessage.hidden = !text; }
function changedPdf() { const download = document.querySelector('#pdf-download'); window.releaseOutput(download.href); download.removeAttribute('href'); download.hidden = true; pdfError(''); }
async function loadPdfSource(file) {
  if (!file || file.size > 50 * 1024 * 1024) throw new Error('Ukuran file maksimal 50 MB.');
  const response = await window.localFetch('/pdf/source', {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:file});
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'File tidak dapat dibaca.');
  return {kind: data.kind, pages: data.pages.map((thumbnail, page) => ({source:data.source, page, rotation:0, thumbnail, label:file.name}))};
}
function renderPdfPages(focusIndex = null, focusAction = null) {
  pageGrid.replaceChildren();
  document.querySelector('#page-count').textContent = `${pdfPages.length} halaman`;
  pdfPages.forEach((item, index) => {
    const card = document.createElement('div'); card.className = 'page-card'; card.draggable = true;
    card.addEventListener('dragstart', e => { dragged = index; e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { dragged = null; card.classList.remove('dragging'); });
    card.addEventListener('dragover', e => e.preventDefault());
    card.addEventListener('drop', e => { e.preventDefault(); if (dragged === null || dragged === index) return; const [page] = pdfPages.splice(dragged, 1); pdfPages.splice(index, 0, page); dragged = null; changedPdf(); renderPdfPages(); });
    const preview = document.createElement('div'); preview.className = 'page-preview';
    const image = document.createElement('img'); image.src = `data:image/png;base64,${item.thumbnail}`; image.alt = `Pratinjau halaman ${index+1}`; image.style.transform = `rotate(${item.rotation}deg)`; preview.append(image);
    const title = document.createElement('div'); title.className = 'page-info'; title.textContent = `Halaman ${index + 1}`; title.title = `${item.label}, halaman sumber ${item.page + 1}`;
    const controls = document.createElement('div'); controls.className = 'page-actions';
    function button(label, title, fn, disabled = false) { const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.title = title; el.dataset.action = title; el.setAttribute('aria-label', `${title} halaman ${index + 1}`); el.disabled = disabled; el.addEventListener('click', fn); controls.append(el); }
    button('←', 'Pindah ke kiri', () => { [pdfPages[index-1],pdfPages[index]] = [pdfPages[index],pdfPages[index-1]]; changedPdf(); renderPdfPages(index - 1, 'Pindah ke kiri'); }, index === 0);
    button('→', 'Pindah ke kanan', () => { [pdfPages[index+1],pdfPages[index]] = [pdfPages[index],pdfPages[index+1]]; changedPdf(); renderPdfPages(index + 1, 'Pindah ke kanan'); }, index === pdfPages.length-1);
    button('↻', 'Putar', () => { item.rotation = (item.rotation+90)%360; image.style.transform = `rotate(${item.rotation}deg)`; changedPdf(); });
    button('⧉', 'Duplikat', () => { if(pdfPages.length >= 100) return pdfError('Maksimal 100 halaman.'); pdfPages.splice(index+1,0,{...item}); changedPdf(); renderPdfPages(index+1, 'Duplikat'); });
    button('Ganti', 'Ganti', () => { sourceAction = {type:'replace', index}; pdfSource.value=''; pdfSource.click(); });
    button('Hapus', 'Hapus', () => { pdfPages.splice(index,1); changedPdf(); renderPdfPages(Math.min(index, pdfPages.length - 1), 'Hapus'); });
    card.append(preview,title,controls); pageGrid.append(card);
  });
  document.querySelector('#save-pdf').disabled = pdfPages.length === 0;
  window.animateEntrance(pageGrid);
  if (focusIndex !== null && focusIndex >= 0) { const card = pageGrid.children[focusIndex]; const controls = [...card.querySelectorAll('button:not(:disabled)')]; (controls.find(control => control.dataset.action === focusAction) || controls[0])?.focus(); }
}
pdfStart.addEventListener('change', async () => {
  if (!pdfStart.files.length) return;
  const generation = editorGeneration; setPdfLoading(true);
  try { pdfError(''); const pages = await loadPdfSource(pdfStart.files[0]); if (generation !== editorGeneration) return; if (pages.kind !== 'pdf') throw new Error('Pilih PDF untuk memulai.'); pdfPages = pages.pages; pdfEditor.hidden = false; document.querySelector('.pdf-upload').hidden = true; changedPdf(); renderPdfPages(); window.animateEntrance(pdfEditor); }
  catch (error) { if (generation === editorGeneration) { pdfError(error.message); pdfStart.value = ''; } }
  finally { if (generation === editorGeneration) setPdfLoading(false); }
});
document.querySelector('#add-pages').addEventListener('click', () => { sourceAction = {type:'add'}; pdfSource.value = ''; pdfSource.click(); });
pdfSource.addEventListener('change', async () => {
  if (!pdfSource.files.length) return;
  const generation = editorGeneration; setPdfLoading(true);
  try {
    pdfError(''); const loaded = await loadPdfSource(pdfSource.files[0]); if (generation !== editorGeneration) return; incoming = loaded.pages;
    const container = document.querySelector('#source-pages'); container.replaceChildren();
    document.querySelector('#dialog-note').textContent = sourceAction.type === 'replace' ? 'Pilih satu halaman sebagai pengganti.' : 'Pilih halaman yang ingin ditambahkan di akhir dokumen.';
    incoming.forEach((page, index) => { const label = document.createElement('label'); label.className = 'source-choice'; const input = document.createElement('input'); input.type = sourceAction.type === 'replace' ? 'radio' : 'checkbox'; input.name = 'source-page'; input.value = index; if (incoming.length === 1) input.checked = true; const img = document.createElement('img'); img.src = `data:image/png;base64,${page.thumbnail}`; img.alt = `Halaman sumber ${index+1}`; const text = document.createElement('span'); text.textContent = `Halaman ${index+1}`; label.append(img,input,text); container.append(label); });
    pdfDialog.showModal(); window.animateEntrance(pdfDialog);
  } catch (error) { if (generation === editorGeneration) pdfError(error.message); }
  finally { if (generation === editorGeneration) setPdfLoading(false); }
});
document.querySelector('#confirm-pages').addEventListener('click', event => {
  const selected = [...document.querySelectorAll('#source-pages input:checked')].map(input => incoming[Number(input.value)]);
  if (!selected.length) { event.preventDefault(); document.querySelector('#dialog-note').textContent = 'Pilih setidaknya satu halaman.'; return; }
  if (sourceAction.type === 'replace') pdfPages.splice(sourceAction.index,1,selected[0]);
  else { if (pdfPages.length + selected.length > 100) { event.preventDefault(); document.querySelector('#dialog-note').textContent = 'Maksimal 100 halaman dalam satu PDF.'; return; } pdfPages.push(...selected); }
  changedPdf(); renderPdfPages();
});
document.querySelector('#save-pdf').addEventListener('click', async () => {
  const button = document.querySelector('#save-pdf'); button.disabled = true; button.textContent = 'Menyimpan…'; pdfError('');
  pageGrid.inert = true; document.querySelector('#add-pages').disabled = true; document.querySelector('#pdf-reset').disabled = true;
  try {
    const response = await window.localFetch('/pdf/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pdfPages.map(({source,page,rotation}) => ({source,page,rotation})))});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'PDF tidak dapat disimpan.');
    const download = document.querySelector('#pdf-download'); window.releaseOutput(download.href); download.href = data.downloadUrl; download.hidden = false; window.animateEntrance(download);
  } catch (error) { pdfError(error.message); }
  finally { button.disabled = false; pageGrid.inert = false; document.querySelector('#add-pages').disabled = false; document.querySelector('#pdf-reset').disabled = false; button.innerHTML = 'Simpan PDF <span>↓</span>'; }
});
document.querySelector('#pdf-reset').addEventListener('click', () => { editorGeneration++; setPdfLoading(false); pdfPages = []; incoming = null; window.releaseSources(); pdfStart.value = ''; pdfEditor.hidden = true; document.querySelector('.pdf-upload').hidden = false; changedPdf(); });
