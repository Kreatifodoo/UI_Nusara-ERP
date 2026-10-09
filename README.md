# Nusara ERP

ERP modular untuk bisnis Indonesia: pembelian, persediaan, manufaktur, CRM, POS, penjualan, dan akuntansi.

> **Status: prototipe desain.** Repo ini baru berisi prototipe UI statis. Belum ada backend, autentikasi, atau data nyata. Semua angka di dashboard dan isi form adalah data contoh.

## Arah teknis

| Lapisan | Keputusan | Catatan |
|---|---|---|
| Backend | **Odoo** dengan modul custom `nusara_*` + modul OCA | Versi dan edisi (Community/Enterprise) diputuskan di [docs/DECISIONS.md](docs/DECISIONS.md) |
| UI sekarang | HTML statis (React + Babel dari CDN) | Berfungsi sebagai spesifikasi UX, bukan kode produksi |
| UI produksi | Web client Odoo dengan tema `nusara_theme` (jalur A), frontend headless via JSON-2 hanya untuk kasus khusus (jalur B) | Diputuskan di akhir Fase 2 |

Peta lengkap menu Nusara ke modul Odoo ada di [docs/MODULE_MAP.md](docs/MODULE_MAP.md).

## Menjalankan prototipe

Butuh koneksi internet (Tailwind, React, Babel, dan Font Awesome dimuat dari CDN).

```bash
python3 -m http.server 8080
```

Lalu buka http://localhost:8080. Menjalankan lewat server HTTP lebih aman daripada membuka `index.html` langsung (`file://`), karena form dimuat lewat `<iframe>` dan sebagian browser membatasi akses file lokal.

Demo online: https://kreatifodoo.github.io/UI_Nusara-ERP/

## Struktur

```
index.html                    # shell SPA: sidebar, menuData, formMapping
Business_Form_Template.html   # template tunggal untuk semua form
generate_forms.py             # membuat 23 form di forms/ dari template + data
forms/master/                 # 13 form master data
forms/transaction/            # 10 form transaksi
nusara_erp_system.html        # versi lama index.html (duplikat, akan dihapus)
addons/nusara_base/           # modul Odoo pertama (fondasi + test)
oca.lock                      # repo OCA 19.0 yang dipakai, dikunci ke commit
docker/, docker-compose.yml   # image Odoo 19 + OCA dan lingkungan lokal
config/odoo.conf              # konfigurasi Odoo
deploy/                       # compose dan skrip update untuk server
.github/workflows/            # CI (lint + test) dan CD (image + deploy)
docs/                         # peta modul, keputusan, dan CI/CD
```

## Menjalankan Odoo secara lokal

Butuh Docker Desktop.

```bash
cp .env.example .env   # lalu isi DB_PASSWORD dan ADMIN_PASSWD
docker compose up --build
```

Buka http://localhost:8069, buat database (tanpa data demo), lalu pasang modul **Nusara Base**. Detail CI/CD dan penyiapan server ada di [docs/CICD.md](docs/CICD.md).

Untuk mengubah form: edit data di `generate_forms.py`, lalu jalankan `python3 generate_forms.py`. Jangan edit file di `forms/` langsung, karena akan tertimpa.

## Peta jalan

0. Fondasi dan keputusan (repo, edisi/versi Odoo, kebutuhan Indonesia)
1. Lingkungan Odoo (Docker) dan CI
2. Konsolidasi prototipe UI, lalu pilih jalur A atau B
3. Irisan vertikal pertama: Purchase Request → RFQ → PO → Goods Receipt → Vendor Bill → Payment
4. Order-to-Cash, Inventory lanjutan, Manufaktur, Laporan akuntansi, CRM, POS
5. Pengerasan enterprise: keamanan, approval, audit trail, backup, uji beban
