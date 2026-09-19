# Panduan Pengguna CookieLens

Bahasa: Indonesia · Versi: 0.4.1 · Antarmuka ekstensi mengikuti bahasa browser (EN/ID).

## 1. Instalasi

1. Buka Chrome/Edge/Brave → alamat `chrome://extensions`.
2. Aktifkan **Developer mode** (saklar kanan atas).
3. Klik **Load unpacked** → pilih **folder ini** (yang berisi `manifest.json`).
4. Ikon CookieLens muncul di toolbar (klik ikon 🧩/pin agar selalu tampil).

Untuk Firefox (mode pengembangan): `about:debugging` → **This Firefox** →
**Load Temporary Add-on** → pilih `manifest.firefox.json` di folder ini.

## 2. Izin saat pertama kali

- Ekstensi **tidak memaksa izin situs** saat dipasang. Saat pertama kali dibuka di sebuah situs,
  muncul layar "Permission needed":
  - **Allow this site** — memberi izin hanya untuk situs tersebut (disarankan).
  - **Allow all sites** — memberi izin untuk semua situs sekaligus.
- Izin bisa dicabut kapan pun dari `chrome://extensions` → CookieLens → Details →
  **Site access**.
- Halaman `chrome://`, Web Store, `about:`, dsb. adalah **restricted page** — cookie di sana
  tidak bisa (dan memang tidak boleh) diedit.

## 3. Popup — daftar cookie

| Bagian | Cara pakai |
|---|---|
| Daftar | Semua cookie situs aktif, terurut nama. Klik nama = salin nama; klik nilai = salin nilai. |
| Pencarian | Filter live mencocokkan **nama, domain, dan value**. |
| Sorting | Dropdown Name/Domain/Expiration + tombol ↑/↓ untuk arah. Preferensi tersimpan. |
| Ikon per baris | 📌 pin (naik ke urutan atas) · 🔒 protect (kebal delete-all) · ⧉ salin JSON · ✎ edit · ✕ hapus. |
| Hapus | ✕ menghapus satu cookie, muncul toast **Undo** 5 detik. |
| Chip | HttpOnly / Secure / Session = flag cookie tersebut. |
| Menu ⋯ | "Show advanced", "Open side panel", "Options". |

### Tambah / edit cookie

- **+ Add** → isi Name + Value (form sederhana), atau **Show advanced** untuk field lengkap:
  Domain, Path, Expiration (tombol cepat +1 jam / +1 hari / +1 minggu), SameSite
  (no_restriction / lax / strict), Host-only, Session, Secure, Http-Only.
- Mode sederhana saat **edit** hanya mengubah Name/Value — expiry/Secure/HttpOnly yang lama tidak
  direset, jadi sesi login Anda tidak putus tak sengaja.
- **Delete All** (merah) = hapus semua cookie situs aktif. Dua langkah: tombol berubah
  "Confirm delete all" selama 3 detik. Cookie **protected** 🔒 tidak ikut terhapus.

### Multi-select & undo

- Centang beberapa baris → search bar berganti jadi **bulk bar**: jumlah terpilih, Select
  all/none, Export JSON (hanya terpilih), Delete, Cancel.
- Bulk delete juga menawarkan Undo 5 detik. Undo hanya hidup selama popup terbuka (snapshot di
  memori).

## 4. Export & Import

### Export (dari popup, untuk situs aktif)

Tombol **Export** memakai format bawaan dari Options; tombol ▾ membuka menu:
- **Copy**: JSON, Netscape, Header String, cURL (bash), cURL (CMD) → ke clipboard.
- **Download file**: JSON (.json) atau Netscape (.txt).

### Import

**Import** → tempel data (JSON / Netscape / Header String — format dideteksi otomatis) atau
**Choose file…** → **Import**. Cookie ditulis lewat mode **merge** (cookie bernama sama
ditimpa). Toast menampilkan jumlah berhasil/gagal dan format yang terdeteksi.

## 5. Profiles (profil cookie)

1. **Profiles** di footer → beri nama → **Save**. Centang **Bind to \<host\>** agar profil
   terikat domain itu (lepas centang = profil global).
2. Kapan pun di situs target, buka Profiles lalu:
   - **Merge** — profil ditimpa/ditambah di atas cookie sekarang.
   - **Replace** — cookie situs dihapus dulu (yang protected tetap aman; ada Undo), lalu profil
     diisi.
3. Ikon lain: ⧉ duplikat, ✎ ganti nama (inline), ✕ hapus.
   Kasus pakai: ganti akun demo/test, sesi staging vs produksi.

## 6. Side Panel & DevTools

- **Side Panel**: menu ⋯ → **Open side panel** (atau tekan `Alt+Shift+C`). UI sama persis dengan
  popup dan tetap terbuka saat Anda berpindah fokus.
- **DevTools panel**: buka DevTools (F12) → tab **CookieLens**. Panel membaca tab yang
  sedang di-inspect, bukan "tab aktif" lain.

## 7. Pintasan keyboard

| Pintasan | Aksi |
|---|---|
| `Alt+Shift+C` | Buka side panel |
| `Alt+Shift+E` | Salin cookie situs ini sebagai JSON ke clipboard |
| `Alt+Shift+D` | Hapus semua cookie situs ini — **tekan dua kali** dalam 2,5 detik untuk konfirmasi (badge "!" adalah tanda armed) |

Ubah pintasan di `chrome://extensions/shortcuts`.

Klik kanan halaman juga tersedia: **CookieLens** → *Open Cookie Editor* /
*Export this site's cookies as JSON*.

## 8. Halaman Options

Buka dari menu ⋯ → Options (atau `chrome://extensions` → Details → Extension options).

- **General**: buka lewat Panel samping / Popup, tema (Auto/Light/Dark), advanced mode bawaan,
  animasi, posisi baris tombol popup (bawah/atas), kolom info kedua tiap baris
  (value/domain/path/expiry/SameSite).
- **Export**: format bawaan tombol Export, atau "Ask every time".
- **Data (danger zone)**: lihat §9.
- **Profiles**: daftar semua profil (unduh JSON / hapus; restore tetap dari popup).
- **About**: versi, privasi, daftar pintasan, lisensi MIT.

## 9. Backup & restore

- **Pencadangan harian otomatis** (aktif bawaan): sekali sehari, seluruh cookie semua cookie
  store disimpan sebagai satu snapshot di penyimpanan lokal ekstensi. **Lima hari terakhir yang
  disimpan**; snapshot hari yang sama ditimpa (bukan menumpuk).
- **Back up now**: buat snapshot seketika.
- Tiap baris cadangan:
  - **Download JSON** — unduh `cookie-backup-<tanggal>.json`.
  - **Restore** — cookie cadangan **di-merge** kembali ke browser (cookie bernama sama pada
    domain/path sama ditimpa; cookie lain tidak disentuh). Restore BUKAN replace: ia tidak
    menghapus cookie yang tidak ada di cadangan.
  - **Delete** — hapus snapshot tanggal itu.
- Cadangan murni lokal (`storage.local`) — tidak ada data yang keluar dari browser.

## 10. FAQ

**Kenapa badge di ikon kosong?**
Badge menampilkan jumlah cookie situs aktif. Kosong = belum ada izin host untuk situs itu (buka
popup → Allow this site), atau situsnya memang tidak punya cookie, atau bukan halaman http/https.

**Kenapa muncul "Restricted page"?**
Halaman internal browser (`chrome://`, Web Store, `about:`, `edge://`, dll.) dilarang browser
diedit cookie-nya — ekstensi apa pun tidak bisa menyentuhnya.

**Kenapa cookie hilang setelah Delete All / restore Replace?**
Itu memang efeknya: Delete All menghapus seluruh cookie situs (kecuali yang protected 🔒), dan
restore **Replace** menghapus cookie situs dulu sebelum mengisi profil. Gunakan tombol **Undo**
dalam 5 detik, atau pulihkan dari cadangan (§9). Login yang hilang tinggal login ulang — hanya
cookie situs itu yang tersentuh, bukan browser Anda.

**Apakah data saya dikirim ke mana pun?**
Tidak. Tidak ada telemetry, analitik, atau request jaringan; semua (termasuk cadangan) ada di
`storage.local` browser.

**Bahasa antarmuka?**
Mengikuti bahasa browser (Inggris atau Indonesia). Tidak ada pemilih bahasa manual di dalam
ekstensi.
