# Catatan Keputusan

Format: satu entri per keputusan. Status: **Diputuskan**, **Terbuka**, atau **Perlu verifikasi**.

## D1. Backend dibangun di atas Odoo
- **Status**: Diputuskan (2026-10-09)
- **Konteks**: Alternatifnya adalah memakai ulang backend Kompak (FastAPI) atau membangun dari nol. Prototipe Nusara sangat mirip Odoo (stage bar, RFQ, put-away rules, POS session).
- **Konsekuensi**: Logika bisnis ada di modul Odoo (Python). Satu database per tenant. Terikat pada siklus rilis dan lisensi Odoo.

## D2. Prototipe UI tetap HTML statis untuk sekarang
- **Status**: Diputuskan (2026-10-09)
- **Konteks**: Prototipe dipakai untuk menyepakati alur dan tampilan sebelum konfigurasi Odoo mahal dikerjakan.
- **Konsekuensi**: Prototipe adalah spesifikasi, bukan produk. Dibatasi waktu (lihat Fase 2). Tidak ada migrasi ke framework SPA sampai jalur UI diputuskan (D5).

## D3. Edisi Odoo: Community + OCA
- **Status**: Diputuskan (2026-10-09)
- **Konteks**: Community berlisensi LGPLv3 tanpa biaya per user. Fitur kelas Enterprise (asset, budget, laporan keuangan lengkap, approval, audit) dipenuhi dari modul OCA.
- **Konsekuensi**: Kualitas "enterprise" bergantung pada modul OCA, jadi ketersediaan modul di cabang versi yang dipakai harus dicek sebelum menjanjikan fitur.

## D4. Versi Odoo: 19.0
- **Status**: Diputuskan (2026-10-09)
- **Konteks**: Odoo 20 sudah ada (cabang `odoo/odoo` 20.0 dan image `odoo:20.0` tersedia, rilis sekitar 26 September 2026). Namun saat dicek 2026-10-09, cabang `20.0` hampir semua repo OCA masih **kosong** (tanpa modul): `purchase-workflow`, `server-tools`, `server-ux`, `account-financial-tools`, `account-financial-reporting`, dan lainnya. Hanya `mis-builder` (3 modul) dan `web` (1 modul) yang sudah ada. Cabang `19.0` terisi penuh.
- **Konsekuensi**: Mulai di 19.0. Versi Odoo dan cabang OCA dibuat sebagai satu variabel (`ODOO_VERSION`) di Docker dan CI, supaya pindah ke 20.0 nanti cukup mengganti satu nilai setelah OCA selesai migrasi. Cek ulang kesiapan 20.0 setiap kuartal.
- **Catatan**: XML-RPC/JSON-RPC deprecated sejak 19; gunakan JSON-2 untuk integrasi baru.

## D5. Jalur UI produksi
- **Status**: Terbuka (diputuskan di akhir Fase 2)
- **A (rekomendasi MVP)**: web client Odoo + modul `nusara_theme`.
- **B (selektif)**: frontend headless via JSON-2, hanya untuk portal atau layar kasir.

## D6. Kebutuhan Indonesia
- **Status**: Sebagian terverifikasi (2026-10-09)
- **Daftar**: PPN, e-Faktur/Coretax, COA mengikuti PSAK, multi-currency, bahasa id_ID, format NPWP/NIK.
- **Terverifikasi** pada image `odoo:19.0` (Community): modul `l10n_id` (LGPL-3), `l10n_id_efaktur_coretax` (LGPL-3, ekspor XML untuk Coretax, bergantung pada `l10n_id`), dan `l10n_id_pos` tersedia. Modul `l10n_id_efaktur` (e-Faktur lama) **tidak ada** di Community. `l10n_id` sudah terpasang di database lokal.
- **Belum**: data awal Indonesia belum diterapkan (perusahaan bawaan masih USD/US). Kesesuaian ekspor Coretax dengan ketentuan DJP terbaru perlu diuji dengan data nyata sebelum produksi.

## D7. Model hosting dan tenant
- **Status**: Terbuka
- **Opsi hosting**: self-host Docker (VPS) atau Odoo.sh.
- **Tenant**: Odoo memakai satu database per tenant lewat `dbfilter`/subdomain. Tentukan apakah Nusara dijual sebagai SaaS atau diinstal per klien.
