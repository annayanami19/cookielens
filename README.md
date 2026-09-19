# CookieLens 🍪

**v0.4.1**

Editor & pengelola cookie untuk Chrome / Edge / Brave — lihat, buat, ubah, hapus,
ekspor, dan impor cookie dalam satu panel yang rapi. **100% offline: tanpa iklan,
tanpa telemetry, tanpa remote code.**

## ✨ Fitur

- **CRUD cookie real-time** — daftar cookie situs aktif dengan live update, pencarian
  (nama/domain/value), dan advanced mode (domain, path, expiration, SameSite, Secure,
  Http-Only, Host-Only, Session)
- **Pin & Protect** — sematkan cookie penting; cookie yang diprotect kebal semua aksi hapus
- **Bulk delete + Undo** — hapus massal dengan kesempatan membatalkan 5 detik
- **Import / Export** — JSON, Netscape, Header String, cURL (bash & CMD); format terdeteksi
  otomatis; bisa ke clipboard atau file
- **Cookie Profiles** — simpan set cookie situs sebagai profil, restore merge/replace kapan pun
- **Backup otomatis harian** — snapshot seluruh cookie browser, disimpan 5 hari terakhir,
  bisa di-restore dari pengaturan
- **Popup, Side Panel & panel DevTools** — satu UI untuk tiga tempat
- **Dwi-bahasa** — antarmuka English + Bahasa Indonesia (mengikuti bahasa browser)

## 📦 Instalasi

1. Buka Chrome/Edge/Brave → alamat `chrome://extensions`
2. Aktifkan **Developer mode** (saklar kanan atas)
3. Klik **Load unpacked** → pilih **folder ini** (yang berisi `manifest.json`)
4. Ikon CookieLens 🍪 muncul di toolbar — klik ikon 🧩 lalu **Pin** agar selalu tampil

## 🚀 Mulai cepat

1. Buka situs apa pun → klik ikon CookieLens
2. Saat pertama kali: pilih **Allow this site** (izin hanya untuk situs itu)
3. Kelola cookie dari daftar: klik nama/nilai untuk menyalin, ✎ edit, 📌 pin, 🔒 protect
4. Mau panel yang tetap terbuka? Menu **⋯ → Open side panel**

Pintasan: `Alt+Shift+C` side panel · `Alt+Shift+E` export JSON · `Alt+Shift+D` hapus
cookie situs (tekan 2× untuk konfirmasi).

## 📚 Dokumen di folder ini

| File | Isi |
|---|---|
| [`PANDUAN.md`](PANDUAN.md) | Panduan pengguna lengkap (instalasi, semua fitur, FAQ) |
| [`CHANGELOG.md`](CHANGELOG.md) | Riwayat versi & perubahan |
| [`LICENSE`](LICENSE) | Lisensi MIT |

## 🔒 Privasi

Tidak ada analytics, tidak ada request jaringan, tidak ada remote code. Semua data —
termasuk cadangan — tersimpan lokal di browser Anda.

## 📄 Lisensi

Dirilis di bawah [MIT License](LICENSE).
