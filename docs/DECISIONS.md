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

## D8. Penyesuaian atas modul OCA dan setup Indonesia di `nusara_base`
- **Status**: Diputuskan (2026-10-09), ditemukan lewat test alur Procure-to-Pay
- **Wizard PR ke RFQ**: wizard OCA `purchase.request.line.make.purchase.order` (cabang 19.0) memaksa `price_unit = 0.0` pada baris PO, sehingga harga dari daftar harga vendor tidak terbawa. `nusara_base` membuang kunci itu agar Odoo menghitungnya dari `product.supplierinfo`. Dicakup oleh test `test_procure_to_pay`. Tinjau lagi bila OCA memperbaikinya di hulu.
- **Setup Indonesia**: `res.company.nusara_setup_indonesia()` (negara ID, IDR, COA `l10n_id`, price list bawaan ke IDR) sengaja eksplisit, bukan hook instalasi, karena memuat COA baru menghapus COA lama. Menolak berjalan bila perusahaan sudah punya transaksi akuntansi. Price list yang sudah punya aturan harga tidak diubah.
- **`--without-demo`**: di Odoo 19 opsi ini boolean; gunakan `true`, bukan `all`.

## D9. UI Nusara terhubung ke Odoo lewat JSON-2 (uji kelayakan Purchase Request)
- **Status**: Terbukti layak untuk alur Procure-to-Pay penuh (2026-10-10). Keputusan jalur A atau B tetap di akhir Fase 2.
- **Cara kerja**: halaman statis di `ui/live/` memanggil `POST /json/2/<model>/<metode>` pada alamat yang sama; nginx (`ui/nginx.conf.template`) hanya meneruskan `/json/2/`. Autentikasi bearer memakai API key pengguna sendiri. Rute JSON-2 Odoo 19 memakai `auth='bearer'` dan `save_session=False`, jadi tidak ada sesi cookie, dan CORS tidak aktif, sehingga proxy satu alamat diperlukan.
- **Form mengikuti Odoo**: tombol header, status yang menampilkannya, hak manager (`res.users.has_group`), `is_editable` (field hanya bisa diedit saat draft), tombol statistik, kolom barang, default tanggal baris, dan chatter diambil dari definisi view Odoo/OCA, bukan dari tebakan. Untuk form lain, urutkan kerja: baca view XML dan `fields_get` modelnya, lalu petakan.
- **Temuan saat uji**: tanggal baris wajib diisi (Odoo mengisinya otomatis di UI); label dan perilaku diselaraskan. API key tidak boleh ditaruh di berkas JavaScript; versi produksi perlu layar login dan penyimpanan kunci yang aman, atau BFF.
- **Cakupan**: Purchase Request, RFQ/PO, penerimaan barang (backorder), tagihan vendor (dialog pembayaran), dan pembayaran, di dalam kerangka sidebar prototipe (`ui/live/menu.js` menyalin struktur `menuData`; menu yang belum punya halaman menampilkan model Odoo tujuannya, bukan data palsu).
- **Belum**: edit di status selain draft, Return penerimaan, Send RFQ lewat email, pembagian hak per peran, tampilan ponsel yang teruji, dan menu lainnya. Memakai Tailwind dari CDN hanya untuk uji kelayakan. Header prototipe memuat lonceng notifikasi dan avatar dari layanan luar; keduanya tidak dibawa karena datanya palsu dan avatar luar mengirim nama pengguna ke pihak ketiga.

## D10. Harga manual baris PO dan teknik "kirim yang berubah saja"
- **Status**: Diputuskan (2026-10-10), ditemukan lewat uji UI
- **Temuan**: di Odoo 19, baris PO yang dibuat dengan `price_unit` eksplisit punya `technical_price_unit` yang sama dengan `price_unit`. Odoo menganggapnya "bukan manual" dan **menghitung ulang harganya dari daftar harga pemasok setiap kali header ditulis** (bahkan `partner_id` yang sama), sehingga harga manual hilang. Harga manual hanya bertahan bila baris dibuat tanpa harga (otomatis) lalu harganya ditulis **terpisah** pada baris itu.
- **Konsekuensi**: `ui/live/pages/po.js` hanya mengirim field header dan baris yang berubah, dan menulis harga manual sebagai langkah kedua. Prinsip "kirim yang berubah saja" juga dipakai di form tagihan (menulis ulang `invoice_date` dapat menghitung ulang jatuh tempo). Dijaga oleh `scripts/check_p2p_api.py`.
