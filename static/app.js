const form = document.querySelector('#form');
const fileInput = document.querySelector('#file');
const dropzone = document.querySelector('#dropzone');
const message = document.querySelector('#message');
const result = document.querySelector('#result');
const results = document.querySelector('#results');
const submit = document.querySelector('#submit');
const downloadAll = document.querySelector('#download-all');
let successfulFiles = [];
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
function updateMode() {
  const convert = document.querySelector('input[name="mode"]:checked').value === 'convert';
  document.querySelector('#target-row').hidden = convert;
  document.querySelector('#compression-warning').hidden = convert;
  document.querySelector('#target').required = !convert;
  document.querySelector('#target').disabled = convert;
  const format = document.querySelector('#format');
  format.options[0].disabled = convert;
  format.querySelector('option[value="PDF"]').disabled = !convert;
  format.value = convert ? 'JPEG' : 'original';
  document.querySelector('#format-hint').textContent = convert ? 'PDF ke gambar menghasilkan ZIP per halaman' : 'Pilih format asli untuk memproses PDF';
  document.querySelector('#button-label').textContent = convert ? 'Convert sekarang' : 'Kompres sekarang';
}
modeInputs.forEach(input => input.addEventListener('change', updateMode));
const formatSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
function showFile() {
  const files = fileInput.files;
  document.querySelector('#file-title').textContent = files.length === 1 ? files[0].name : files.length ? `${files.length} file dipilih` : 'Pilih file atau tarik ke sini';
  document.querySelector('#file-hint').textContent = files.length ? `${formatSize([...files].reduce((sum, file) => sum + file.size, 0))} total · Klik untuk mengganti file` : 'JPG, PNG, WebP, atau PDF · Maks. 50 MB per file';
  result.hidden = true; message.hidden = true;
}
fileInput.addEventListener('change', showFile);
for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.add('drag'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', e => { if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; showFile(); } });
function addResult(file, data, error) {
  const row = document.createElement('div'); row.className = 'result-item';
  const title = document.createElement('strong'); title.className = 'result-name'; title.textContent = file.name; row.append(title);
  const note = document.createElement('p');
  if (error) { note.textContent = error; note.className = 'result-error'; row.append(note); results.append(row); return; }
  const status = data.status === 'converted' ? 'Konversi selesai.' : data.status === 'unreachable' ? 'Target belum tercapai; ini hasil terkecil yang tersedia.' : data.status === 'already_small' ? 'File sudah di bawah target; file asli tersedia untuk diunduh.' : 'Target tercapai.';
  note.textContent = `${status} ${formatSize(data.originalSize)} → ${formatSize(data.resultSize)}${data.rasterized ? ' PDF diubah menjadi gambar; teks tidak lagi dapat dipilih.' : ''}`; row.append(note);
  const link = document.createElement('a'); link.className = 'download'; link.href = data.downloadUrl;
  const stem = file.name.replace(/\.[^.]+$/, '') || 'file';
  const extension = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf', 'application/zip': '.zip'}[data.mime] || '';
  link.download = `${stem}-${data.status === 'converted' ? 'converted' : 'compressed'}${extension}`; successfulFiles.push({url: data.downloadUrl, name: link.download}); link.textContent = 'Unduh file ↓'; row.append(link); results.append(row);
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  const files = [...fileInput.files]; if (!files.length) return;
  if (files.length > 100) { message.textContent = 'Pilih maksimal 100 file sekaligus.'; message.hidden = false; return; }
  message.hidden = true; result.hidden = true; results.replaceChildren(); successfulFiles = []; downloadAll.hidden = true;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const unit = document.querySelector('#unit').value;
  const target = Math.round(Number(document.querySelector('#target').value) * (unit === 'MB' ? 1024 * 1024 : 1024));
  if (mode === 'compress' && (!Number.isFinite(target) || target < 1 || target > 50 * 1024 * 1024)) { message.textContent = 'Target harus lebih dari 0 dan maksimal 50 MB.'; message.hidden = false; return; }
  document.querySelectorAll('.nav-item').forEach(button => { button.disabled = true; });
  submit.disabled = true; fileInput.disabled = true; document.querySelector('#target').disabled = true; document.querySelector('#unit').disabled = true; document.querySelector('#format').disabled = true;
  for (const [index, file] of files.entries()) {
    document.querySelector('#button-label').textContent = `Memproses ${index + 1} dari ${files.length}…`;
    if (file.size > 50 * 1024 * 1024) { addResult(file, null, 'Ukuran file maksimal 50 MB.'); continue; }
    try {
      const response = await window.localFetch('/compress', {method: 'POST', headers: {'Content-Type': 'application/octet-stream', 'X-Target-Bytes': String(target), 'X-Output-Format': document.querySelector('#format').value, 'X-Mode': mode}, body: file});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Terjadi kesalahan.');
      addResult(file, data);
    } catch (error) { addResult(file, null, error.message || 'Koneksi bermasalah. Silakan coba lagi.'); }
  }
  document.querySelectorAll('.nav-item').forEach(button => { button.disabled = false; });
  document.querySelector('#result h3').textContent = mode === 'convert' ? 'Hasil convert' : 'Hasil kompresi';
  document.querySelector('#reset').textContent = mode === 'convert' ? 'Convert file lain' : 'Kompres file lain';
  downloadAll.hidden = successfulFiles.length < 2; result.hidden = false; submit.disabled = false; fileInput.disabled = false; document.querySelector('#target').disabled = false; document.querySelector('#unit').disabled = false; document.querySelector('#format').disabled = false; document.querySelector('#target').disabled = mode === 'convert'; document.querySelector('#button-label').textContent = mode === 'convert' ? 'Convert sekarang' : 'Kompres sekarang';
});
document.querySelector('#reset').addEventListener('click', () => { const mode = document.querySelector('input[name="mode"]:checked').value; form.reset(); document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true; updateMode(); showFile(); fileInput.focus(); });

downloadAll.addEventListener('click', async () => {
  downloadAll.disabled = true; downloadAll.textContent = 'Menyiapkan ZIP…';
  try {
    const response = await window.localFetch('/bundle', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(successfulFiles)});
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'ZIP tidak dapat dibuat.'); }
    const blob = await response.blob(); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'berkasia-hasil.zip'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { message.textContent = error.message; message.hidden = false; }
  finally { downloadAll.disabled = false; downloadAll.innerHTML = 'Unduh semua sebagai ZIP <span>↓</span>'; }
});

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
  const tool = button.dataset.tool;
  document.querySelectorAll('.nav-item').forEach(item => { item.classList.toggle('active', item === button); if (item === button) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
  document.querySelector('#file-workspace').hidden = tool === 'pdf';
  document.querySelector('#pdf-workspace').hidden = tool !== 'pdf';
  const benefits = {
    compress: [['◎', 'Kamu yang tentukan', 'Masukkan target ukuran sesuai kebutuhanmu.'], ['✳', 'Otomatis & praktis', 'Kami cari pengaturan kompresi untukmu.'], ['◇', 'Ringan dibagikan', 'File lebih siap dikirim atau diunggah.']],
    convert: [['◎', 'Pilih format tujuan', 'Ubah gambar atau PDF ke format yang kamu butuhkan.'], ['✳', 'Tanpa target ukuran', 'Konversi file tanpa mengatur ukuran hasil.'], ['◇', 'PDF ke gambar', 'Setiap halaman tersimpan sebagai gambar dalam ZIP.']],
    pdf: [['◎', 'Susun halaman', 'Seret atau gunakan panah untuk mengubah urutan.'], ['✳', 'Ubah isi dokumen', 'Tambah, ganti, putar, duplikasi, atau hapus halaman.'], ['◇', 'Simpan hasilnya', 'Unduh PDF setelah halaman tersusun sesuai keinginan.']]
  };
  document.querySelectorAll('.benefits > div').forEach((item, index) => {
    const [icon, title, description] = benefits[tool][index];
    item.querySelector('.benefit-icon').textContent = icon;
    item.querySelector('strong').textContent = title;
    item.querySelector('p').textContent = description;
  });
  document.querySelector('#intro-label').textContent = tool === 'pdf' ? 'HALAMAN RAPI, DOKUMEN SIAP' : tool === 'convert' ? 'UBAH FORMAT, TETAP PRAKTIS' : 'LEBIH KECIL, TETAP BERARTI';
  document.querySelector('.intro h1').innerHTML = tool === 'pdf' ? 'Halaman PDF?<br><span>Atur sesukamu.</span>' : tool === 'convert' ? 'Format berbeda?<br><span>Bikin sesuai.</span>' : 'File besar?<br><span>Bikin ringkas.</span>';
  document.querySelector('.intro p').textContent = tool === 'pdf' ? 'Susun dokumen dengan mudah, halaman demi halaman.' : tool === 'convert' ? 'Ubah format gambar dan PDF dalam beberapa langkah.' : 'Tentukan ukuran yang kamu mau, biar kami yang mengurus sisanya.';
  if (tool !== 'pdf') {
    document.querySelector(`input[name="mode"][value="${tool}"]`).checked = true;
    document.querySelector('#file-workspace h2').textContent = tool === 'convert' ? 'Convert file' : 'Kompres file';
    document.querySelector('#file-workspace .card-top p').textContent = tool === 'convert' ? 'Ubah format file sesuai kebutuhan.' : 'Gambar atau dokumen, semua jadi lebih ringan.';
    result.hidden = true; message.hidden = true; updateMode();
  }
}));
