# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/);
penomoran memakai [Semantic Versioning](https://semver.org/lang/id/).

## [0.4.1] - 2026-09-20

### Added
- Opsi **"Buka lewat"** di pengaturan (Panel samping / Popup, default Panel) —
  klik ikon toolbar membuka panel via `sidePanel.setPanelBehavior`.

### Fixed
- Menu dropdown terpotong keluar panel: posisi kini dijepit ke viewport saat
  dibuka (`clampMenuToViewport`) + `max-height`/`max-width` pada `.menu`.
- Overflow horizontal button bar di side panel (flex-wrap, tombol ramping,
  `overflow-x: hidden`).
- Komentar JSDoc di `lib/i18n.js` memutus block comment (`*/` di dalam teks)
  sehingga file menjadi sintaks invalid.

### Changed
- Nama proyek: **Cookie Editor Pro** → **CookieLens** (manifest, locale,
  DevTools panel, gecko id, nama zip build, dokumentasi).

## [0.4.0] - 2026-09-19

### Added
- i18n lengkap **English + Bahasa Indonesia** (`_locales/`, 212 kunci) —
  mengikuti bahasa browser.
- **Backup otomatis harian** (`alarms`, retensi 5 hari) + Back up now /
  restore / unduh dari halaman Options.
- Theme icons SVG untuk Firefox (`action-light.svg`, `action-dark.svg`).
- Halaman About (versi, privasi, shortcuts, lisensi MIT).
- Zip Chrome & Firefox siap unggah store (via skrip build).
- Panduan pengguna dan checklist publikasi store.

## [0.3.0] - 2026-09-19

### Added
- **Cookie Profiles** — simpan set cookie situs, restore merge/replace,
  duplikat, rename inline, hapus.
- **Pin & Protect** per cookie (protected dikecualikan dari semua aksi hapus).
- **Multi-select + bulk delete** dengan toast **Undo** 5 detik (juga untuk
  delete tunggal & delete-all situs).
- **Keyboard shortcuts** — `Alt+Shift+C` side panel, `Alt+Shift+E` export JSON,
  `Alt+Shift+D` hapus cookie situs (tekan 2× untuk konfirmasi).
- **Context menu** klik-kanan: buka editor & export cookie situs.
- Offscreen document sebagai jembatan clipboard untuk service worker.

## [0.2.0] - 2026-09-19

### Added
- Export **cURL (bash & CMD)**; export/unduh sebagai **file**; import dari file.
- Halaman **Options**: tema manual, advanced default, animasi, posisi button
  bar, extra-info column, format export default, export & delete-all
  seluruh browser (type-to-confirm `DELETE`).
- **Side Panel** (Chrome) dan **panel DevTools** — satu basis kode UI dengan
  popup (deteksi konteks).
- Quick copy per cookie (nama / value / JSON), sorting (name/domain/expiration),
  extra-info column, split-button Export dengan format default.

## [0.1.0] - 2026-09-19

### Added
- MVP: daftar cookie real-time, search (nama/domain/value), add/edit/delete,
  delete-all dua langkah, import/export JSON–Netscape–Header String dengan
  auto-detect format, permission on-demand ("Situs ini" / "Semua situs"),
  badge jumlah cookie, toast, tema auto light/dark.
