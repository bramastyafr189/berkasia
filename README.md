# Berkasia

Berkasia mengompres gambar dan PDF, mengubah format, dan menyusun halaman PDF. Pemrosesan file dilakukan di browser; file yang dipilih tidak dikirim ke server aplikasi. Aplikasi membutuhkan browser modern dan memori yang cukup. Font antarmuka dimuat dari Google Fonts jika tersedia.

## Menjalankan secara lokal

Persyaratan: Node.js versi yang didukung Vite dan npm.

```sh
npm ci
npm run dev
```

Buka alamat yang ditampilkan di terminal. Untuk menghasilkan dan memeriksa build produksi:

```sh
npm run build
npm run preview
```

Versi lama `app.py` masih disimpan sebagai referensi, tetapi bukan bagian dari build atau aplikasi browser ini.

## Deploy Cloudflare

Aplikasi dapat dihosting sebagai aset statis di Cloudflare Workers atau Pages tanpa server Python, Containers, atau R2. Hubungkan repositori melalui dashboard Cloudflare dan gunakan perintah build `npm run build`, direktori output `dist`, serta Node.js yang kompatibel dengan Vite. Konfigurasi `wrangler.jsonc` disediakan untuk Workers Static Assets. Deployment belum dilakukan atau diverifikasi di akun Cloudflare.

## Fitur dan batasan

Gunakan tombol **ID / EN** untuk memilih bahasa; pilihan disimpan di browser. Tersedia pratinjau gambar sebelum dan sesudah beserta dimensi dan perubahan ukuran. Kompresi gambar dan pemrosesan PDF memakai Web Worker jika browser mendukung Worker dan OffscreenCanvas. Progress ditampilkan saat memproses; **Batalkan** menghentikan worker untuk proses kompresi atau konversi. Pada browser yang tidak mendukungnya, aplikasi memakai jalur cadangan di thread utama dan pembatalan terjadi pada kesempatan berikutnya. Hasil yang sudah selesai tetap dapat diunduh.

- **Kompres:** unggah JPG, PNG, WebP, atau PDF dan pilih target per file dalam KB atau MB (1 KB = 1.024 byte). Format asli dipilih secara default; gambar dapat dikonversi sekaligus. Hasil mendekati target, tetapi target tidak dijamin. PNG mempertahankan warna tetapi bisa diperkecil dimensinya.
- **Kompresi PDF:** mode bawaan **Jaga teks** menyimpan ulang dokumen tanpa merender halaman menjadi gambar, tetapi tidak menjamin target atau mempertahankan semua fitur khusus PDF. Mode **Kompresi kuat** merender halaman menjadi gambar: teks yang dapat dipilih, tautan, formulir, dan tanda tangan dapat hilang. Menyimpan ulang PDF dapat membatalkan tanda tangan digital pada kedua mode. Simpan dan periksa file asli.
- **Konversi:** JPG, PNG, WebP, dan PDF; PDF ke gambar dikemas sebagai ZIP. JPG dan WebP menggunakan encoder browser dan dapat bersifat lossy. Transparansi menjadi putih saat dikonversi ke JPG atau PDF. Dukungan codec bergantung pada browser.
- **Kelola PDF:** susun ulang, putar, duplikasi, hapus, tambah, dan ganti halaman dengan gambar atau halaman PDF lain. Pengeditan dapat memengaruhi tautan, formulir, dan tanda tangan digital.
- **Banyak file:** unduh hasil satu per satu atau dalam ZIP. Hasil hanya tersedia selama halaman terbuka; unduh sebelum refresh atau menutupnya.
- Batas aplikasi: 50 MB per file, 100 file, 40 megapiksel per gambar, dan 100 halaman editor. Konversi PDF ke gambar dan kompresi kuat dibatasi 50 halaman. Kinerja dan batas efektif bergantung pada perangkat; file besar dapat gagal pada perangkat dengan memori terbatas. Gambar animasi tidak didukung sebagai animasi dan bisa menjadi gambar diam. PDF berkata sandi tidak didukung.

## Pengujian otomatis

```sh
npx playwright install chromium
npm test
```

Untuk menggunakan Chrome yang sudah terpasang, atur `BERKASIA_CHROME` ke path executable Chrome. Uji build melalui simulator Cloudflare lokal dengan `npm run build`, lalu `npx wrangler dev --local`; untuk menjalankan tes terhadap simulator, atur `BERKASIA_BASE_URL` ke alamatnya sebelum `npm test`. GitHub Actions menjalankan build dan tes pada setiap push atau pull request. Simulator lokal tidak menggantikan pengujian pada deployment Cloudflare sebenarnya atau perangkat fisik. Proses PDF pada thread utama tetap digunakan sebagai jalur cadangan untuk browser tanpa dukungan Worker atau OffscreenCanvas.
