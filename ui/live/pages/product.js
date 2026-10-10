// Product Master (product.template). Form mengikuti form produk Odoo 19: tipe, pelacakan stok, harga,
// kategori, pajak, kebijakan kontrol tagihan, deskripsi, dan tabel vendor (harga vendor). Harga vendor
// di tabel itu adalah yang dipakai otomatis oleh RFQ.
import {
  INPUT, app, call, cell, changedValues, chatterHtml, checkboxField, esc, fieldBlock, fieldValue, filterSelect, guarded, loadMessages, money,
  pageHeader, readOne, referenceCategories, referenceSelection, referenceTaxes, referenceUoms, rowLink, searchBox, searchRead,
  selectOptions, statTiles, table, toast, button,
} from "../common.js";

const FILTERS = [["purchase", "Dapat dibeli"], ["sale", "Dapat dijual"], ["all", "Semua produk"], ["archived", "Diarsipkan"]];
const FIELDS = [
  "name", "type", "is_storable", "sale_ok", "purchase_ok", "purchase_request", "uom_id", "default_code", "barcode", "categ_id", "list_price",
  "standard_price", "taxes_id", "supplier_taxes_id", "purchase_method", "description_purchase", "description_sale",
];
const TEXT_KEYS = ["name", "default_code", "barcode", "description_purchase", "description_sale"];
const ID_KEYS = ["uom_id", "categ_id"];
const TYPE_LABELS = { consu: "Barang", service: "Jasa", combo: "Combo" };
const POLICY_LABELS = { purchase: "Berdasarkan kuantitas yang dipesan", receive: "Berdasarkan kuantitas yang diterima" };

let form = null; // { id, values, initial }
let last = { sub: "", query: new URLSearchParams() };

export const leave = () => {
  form = null;
};
const reload = () => render(last.sub, last.query);

const sorted = (ids) => [...ids].sort((a, b) => a - b);
/** Hasil default_get untuk many2many berupa perintah [[6, 0, ids]]. */
const idsFromCommands = (commands) => sorted((commands ?? []).flatMap((c) => (Array.isArray(c) && c[0] === 6 ? c[2] : [])));

const normalize = (record) => {
  const values = {};
  for (const key of TEXT_KEYS) values[key] = record[key] || "";
  for (const key of ID_KEYS) values[key] = Array.isArray(record[key]) ? record[key][0] : record[key] || null;
  for (const key of ["is_storable", "sale_ok", "purchase_ok", "purchase_request"]) values[key] = Boolean(record[key]);
  values.type = record.type || "consu";
  values.purchase_method = record.purchase_method || "receive";
  values.list_price = record.list_price ?? 0;
  values.standard_price = record.standard_price ?? 0;
  values.taxes_id = sorted(record.taxes_id ?? []);
  values.supplier_taxes_id = sorted(record.supplier_taxes_id ?? []);
  return values;
};

/** Nilai untuk Odoo: teks/relasi kosong menjadi false; pajak menjadi perintah "ganti seluruhnya". */
const toOdoo = (key, value) => {
  if (key === "taxes_id" || key === "supplier_taxes_id") return [[6, 0, value]];
  if (ID_KEYS.includes(key)) return value || false;
  if (TEXT_KEYS.includes(key)) return value === "" ? false : value;
  return value;
};

export async function render(sub, query) {
  last = { sub, query };
  if (sub === "") return renderList(query);
  return renderForm(sub === "new" ? null : Number(sub));
}

async function renderList(query) {
  app.innerHTML = '<p class="text-sm text-gray-500">Memuat...</p>';
  const filter = query.get("state") || "purchase";
  const text = query.get("q") ?? "";
  const domain = [];
  if (filter === "purchase") domain.push(["purchase_ok", "=", true]);
  else if (filter === "sale") domain.push(["sale_ok", "=", true]);
  else if (filter === "archived") domain.push(["active", "=", false]);
  if (text) domain.push("|", "|", ["name", "ilike", text], ["default_code", "ilike", text], ["barcode", "ilike", text]);
  const rows = await searchRead("product.template", domain, ["name", "default_code", "categ_id", "type", "is_storable", "list_price", "standard_price", "qty_available", "uom_id"], {
    order: "name", limit: 100, context: { active_test: filter !== "archived" },
  });
  const body = rows
    .map((r) =>
      rowLink(`#/product/${r.id}`, [
        cell(r.default_code || "-"),
        cell(r.name, { strong: true }),
        cell(r.categ_id?.[1] ?? "-"),
        cell(TYPE_LABELS[r.type] ?? r.type),
        cell(money(r.list_price), { right: true }),
        cell(money(r.standard_price), { right: true }),
        cell(r.is_storable ? `${r.qty_available} ${r.uom_id?.[1] ?? ""}` : "-", { right: true }),
      ]),
    )
    .join("");
  app.innerHTML =
    pageHeader(
      "Product Master",
      `${searchBox(text, "Cari nama, kode, barcode")}${filterSelect(FILTERS, filter)}
       <button data-action="refresh" class="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50" aria-label="Muat ulang"><i class="fas fa-rotate"></i></button>
       <a href="#/product/new" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"><i class="fas fa-plus mr-2"></i>Produk Baru</a>`,
    ) +
    table(
      [{ label: "Kode" }, { label: "Nama" }, { label: "Kategori" }, { label: "Tipe" }, { label: "Harga Jual", right: true }, { label: "Biaya", right: true }, { label: "Stok", right: true }],
      body,
      "Tidak ada produk yang cocok. Buat dengan tombol Produk Baru.",
    );
}

function taxChecklist(key, taxes, selected) {
  if (!taxes.length) return '<div class="py-2 text-sm text-gray-400">Belum ada pajak. Jalankan setup Indonesia lebih dulu.</div>';
  return `<div class="mt-1 border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">${taxes
    .map(
      (t) => `<label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" data-tax="${key}" value="${t.id}" ${selected.includes(t.id) ? "checked" : ""} class="rounded border-gray-300 text-indigo-600"> ${esc(t.display_name)}</label>`,
    )
    .join("")}</div>`;
}

function vendorsTable(sellers, productId) {
  const rows = sellers
    .map((s) =>
      rowLink(`#/pricelist/${s.id}`, [
        cell(s.partner_id?.[1] ?? "", { strong: true }),
        cell(s.product_code || "-"),
        cell(s.min_qty, { right: true }),
        cell(money(s.price, s.currency_id?.[1]), { right: true }),
        cell(s.discount ? `${s.discount}%` : "-", { right: true }),
        cell(`${s.delay} hari`, { right: true }),
      ]),
    )
    .join("");
  return `<section class="mt-6">
    <div class="flex items-center justify-between mb-2"><h2 class="text-lg font-semibold text-gray-900">Vendor</h2>
      <a href="#/pricelist/new?product=${productId}" class="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50"><i class="fas fa-plus mr-2"></i>Tambah Harga Vendor</a></div>
    ${table([{ label: "Pemasok" }, { label: "Kode Pemasok" }, { label: "Jml Min", right: true }, { label: "Harga", right: true }, { label: "Diskon", right: true }, { label: "Lead Time", right: true }], rows, "Belum ada vendor. Tambahkan harga vendor agar RFQ terisi otomatis.")}</section>`;
}

async function renderForm(id) {
  app.innerHTML = '<p class="text-sm text-gray-500">Memuat...</p>';
  const [uoms, categories, saleTaxes, purchaseTaxes, typeOptions, policyOptions] = await Promise.all([
    referenceUoms(), referenceCategories(), referenceTaxes("sale"), referenceTaxes("purchase"),
    referenceSelection("product.template", "type"), referenceSelection("product.template", "purchase_method"),
  ]);
  let product = null;
  let sellers = [];
  if (id) {
    product = await readOne("product.template", id, [...FIELDS, "active", "qty_available", "purchased_product_qty", "seller_ids"]);
    if (!product) {
      app.innerHTML = '<p class="text-sm text-rose-600">Produk tidak ditemukan.</p>';
      return;
    }
    sellers = product.seller_ids.length
      ? await searchRead("product.supplierinfo", [["id", "in", product.seller_ids]], ["partner_id", "product_code", "min_qty", "price", "discount", "currency_id", "delay"], { order: "min_qty, price" })
      : [];
  }
  if (!form || form.id !== (product?.id ?? null)) {
    let values;
    if (product) values = normalize(product);
    else {
      const defaults = await call("product.template", "default_get", {
        fields: ["type", "uom_id", "taxes_id", "supplier_taxes_id", "sale_ok", "purchase_ok", "purchase_method"],
      });
      values = normalize({ ...defaults, taxes_id: idsFromCommands(defaults.taxes_id), supplier_taxes_id: idsFromCommands(defaults.supplier_taxes_id), purchase_ok: true, sale_ok: true });
    }
    form = { id: product?.id ?? null, values, initial: product ? { ...values } : null, taxesTouched: new Set() };
  }
  const v = form.values;
  const input = (key, extra = "") => `<input data-value="${key}" value="${esc(v[key])}" ${extra} class="${INPUT}">`;
  const number = (key) => `<input type="number" min="0" step="any" data-value="${key}" data-kind="number" value="${esc(v[key])}" class="${INPUT}">`;
  const types = typeOptions.filter(([k]) => k !== "combo" || v.type === "combo");
  const title = product ? esc(product.name) : "Produk Baru";

  app.innerHTML = `
    <div class="text-sm text-gray-500 mb-2"><a href="#/product" class="hover:text-indigo-600">Product Master</a> / ${title}</div>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      ${product ? button("toggle-active", product.active ? "Arsipkan" : "Aktifkan Kembali", product.active ? "danger" : "primary", { id: product.id }) : ""}
    </div>
    ${product ? `<div class="flex flex-wrap gap-2 mb-4">${statTiles([
      { count: product.seller_ids.length, label: "Vendor", icon: "fa-truck", href: `#/pricelist?product=${product.id}` },
      { count: product.is_storable ? product.qty_available : 0, label: "Stok Tersedia", icon: "fa-boxes" },
      { count: product.purchased_product_qty, label: "Dibeli", icon: "fa-shopping-cart" },
    ])}</div>` : ""}
    <div class="mb-3"><h1 class="text-2xl font-bold text-gray-900">${title}</h1>
      ${product && !product.active ? '<span class="mt-1 inline-block px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Diarsipkan</span>' : ""}</div>

    <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 grid md:grid-cols-2 gap-x-8 gap-y-4">
      ${fieldBlock("Nama Produk", input("name"))}
      ${fieldBlock("Tipe Produk", `<select data-value="type" class="${INPUT}">${types.map(([k, label]) => `<option value="${esc(k)}" ${k === v.type ? "selected" : ""}>${esc(TYPE_LABELS[k] ?? label)}</option>`).join("")}</select>`)}
      <div class="flex flex-wrap items-end gap-x-6 gap-y-2">
        ${checkboxField("purchase_ok", "Dapat dibeli", v.purchase_ok)}
        ${checkboxField("sale_ok", "Dapat dijual", v.sale_ok)}
        ${v.type === "consu" ? checkboxField("is_storable", "Lacak stok", v.is_storable) : ""}
        ${checkboxField("purchase_request", "Dapat diminta lewat Purchase Request", v.purchase_request)}
      </div>
      ${fieldBlock("Satuan", `<select data-value="uom_id" data-kind="id" class="${INPUT}">${selectOptions(uoms, v.uom_id)}</select>`)}
      ${fieldBlock("Kode Internal", input("default_code"))}
      ${fieldBlock("Barcode", input("barcode"))}
      ${fieldBlock("Kategori Produk", `<select data-value="categ_id" data-kind="id" class="${INPUT}">${selectOptions(categories, v.categ_id, "-")}</select>`)}
      <div class="md:col-span-2 border-t border-gray-100 pt-4 text-sm font-semibold text-gray-700">Harga dan Pajak</div>
      ${fieldBlock("Harga Jual", number("list_price"))}
      ${fieldBlock("Biaya", number("standard_price"))}
      ${fieldBlock("Pajak Penjualan", taxChecklist("taxes_id", saleTaxes, v.taxes_id))}
      ${fieldBlock("Pajak Pembelian", taxChecklist("supplier_taxes_id", purchaseTaxes, v.supplier_taxes_id))}
      ${v.purchase_ok
        ? `<div class="md:col-span-2 border-t border-gray-100 pt-4 text-sm font-semibold text-gray-700">Pembelian</div>
           ${fieldBlock("Kebijakan Kontrol Tagihan", `<select data-value="purchase_method" class="${INPUT}">${policyOptions.map(([k]) => `<option value="${esc(k)}" ${k === v.purchase_method ? "selected" : ""}>${esc(POLICY_LABELS[k] ?? k)}</option>`).join("")}</select>`)}
           <div class="md:col-span-2">${fieldBlock("Deskripsi Pembelian", `<textarea data-value="description_purchase" rows="2" class="${INPUT}">${esc(v.description_purchase)}</textarea>`)}</div>`
        : ""}
      ${v.sale_ok ? `<div class="md:col-span-2">${fieldBlock("Deskripsi Penjualan", `<textarea data-value="description_sale" rows="2" class="${INPUT}">${esc(v.description_sale)}</textarea>`)}</div>` : ""}
    </section>
    <div class="flex gap-2 mt-4">
      <button data-action="save" data-id="${product?.id ?? ""}" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Simpan</button>
      <a href="#/product" data-action="discard" class="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Buang</a>
    </div>
    ${product ? vendorsTable(sellers, product.id) : '<p class="mt-6 text-sm text-gray-500">Simpan produk terlebih dahulu untuk menambahkan harga vendor.</p>'}
    ${product ? chatterHtml("product.template", product.id) : ""}`;
  if (product) loadMessages("product.template", product.id);
}

async function persist() {
  const v = form.values;
  if (!String(v.name).trim()) throw new Error("Nama produk wajib diisi.");
  for (const key of ["list_price", "standard_price"]) if (v[key] === "") v[key] = 0;
  if (!(Number(v.list_price) >= 0)) throw new Error("Harga jual tidak boleh negatif.");
  if (!(Number(v.standard_price) >= 0)) throw new Error("Biaya tidak boleh negatif.");
  if (v.type !== "consu") v.is_storable = false;
  if (!form.id) {
    const vals = {};
    for (const key of Object.keys(v)) {
      if ((key === "taxes_id" || key === "supplier_taxes_id") && !form.taxesTouched.has(key)) continue; // pajak bawaan perusahaan
      if (!v.purchase_ok && ["purchase_method", "description_purchase"].includes(key)) continue;
      if (!v.sale_ok && key === "description_sale") continue;
      if (v[key] === "" || v[key] === null) continue;
      vals[key] = toOdoo(key, v[key]);
    }
    const [newId] = await call("product.template", "create", { vals_list: [vals] });
    return newId;
  }
  const changed = changedValues(v, form.initial, Object.keys(v));
  const vals = Object.fromEntries(Object.entries(changed).map(([k, value]) => [k, toOdoo(k, value)]));
  if (Object.keys(vals).length) await call("product.template", "write", { ids: [form.id], vals });
  return form.id;
}

export async function onClick(event, el) {
  const { action } = el.dataset;
  const id = Number(el.dataset.id) || null;
  if (action === "refresh") reload();
  else if (action === "discard") form = null;
  else if (action === "save") {
    const saved = await guarded(el, persist);
    if (saved) {
      const wasNew = !form.id;
      form = null;
      toast(wasNew ? "Produk dibuat." : "Perubahan disimpan.");
      if (wasNew) location.hash = `#/product/${saved}`;
      else reload();
    }
  } else if (action === "toggle-active") {
    const archived = el.textContent.trim() === "Arsipkan";
    if (archived && !window.confirm("Arsipkan produk ini? Produk tidak muncul lagi di pilihan, tetapi dokumen lama tetap utuh.")) return;
    const ok = await guarded(el, () => call("product.template", archived ? "action_archive" : "action_unarchive", { ids: [id] }));
    if (ok !== undefined) {
      form = null;
      toast(archived ? "Produk diarsipkan." : "Produk diaktifkan kembali.");
      reload();
    }
  }
}

export function onInput(event, el) {
  if (!el.dataset.value || !form) return;
  form.values[el.dataset.value] = fieldValue(el);
}

export async function onChange(event, el) {
  if (!form) return;
  if (el.dataset.tax) {
    const key = el.dataset.tax;
    const picked = [...document.querySelectorAll(`[data-tax="${key}"]:checked`)].map((box) => Number(box.value));
    form.values[key] = sorted(picked);
    form.taxesTouched.add(key);
    return;
  }
  if (!el.dataset.value) return;
  const key = el.dataset.value;
  form.values[key] = fieldValue(el);
  // Perubahan yang mengubah tata letak: tipe, dapat dibeli, dapat dijual.
  if (["type", "purchase_ok", "sale_ok"].includes(key)) {
    if (key === "type" && form.values.type !== "consu") form.values.is_storable = false;
    await reload();
  }
}
