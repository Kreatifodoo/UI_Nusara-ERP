// Vendor Master (res.partner sebagai pemasok). Struktur form mengikuti form kontak Odoo 19: jenis
// (individu/perusahaan), alamat, NPWP dan PKP (lokalisasi Indonesia), kontak, pengaturan pembelian,
// tombol statistik Pembelian dan Tagihan Vendor, serta arsip.
import {
  INPUT, app, call, cell, changedValues, chatterHtml, checkboxField, ctx, esc, fieldBlock, fieldValue, filterSelect, guarded, loadMessages,
  pageHeader, readOne, referenceCountries, referenceCurrencies, referenceSelection, referenceTerms, referenceUsers, rowLink,
  referenceFiscalPositions, referencePayableAccounts, searchBox, searchRead, selectOptions, statTiles, table, toast, button,
} from "../common.js";

const FILTERS = [["vendor", "Pemasok"], ["all", "Semua kontak"], ["company", "Perusahaan"], ["archived", "Diarsipkan"]];
const FIELDS = [
  "name", "is_company", "email", "phone", "website", "street", "street2", "city", "state_id", "zip", "country_id", "vat", "l10n_id_pkp",
  "l10n_id_kode_transaksi", "function", "ref", "buyer_id", "property_supplier_payment_term_id", "property_purchase_currency_id",
  "property_account_payable_id", "property_account_position_id",
];
const TEXT_KEYS = ["name", "email", "phone", "website", "street", "street2", "city", "zip", "vat", "function", "ref"];
const ID_KEYS = [
  "state_id", "country_id", "buyer_id", "property_supplier_payment_term_id", "property_purchase_currency_id", "property_account_payable_id",
  "property_account_position_id",
];

let form = null; // { id, values, initial }
const stateCache = new Map();
let last = { sub: "", query: new URLSearchParams() };

export const leave = () => {
  form = null;
};
const reload = () => render(last.sub, last.query);

const normalize = (record) => {
  const values = {};
  for (const key of TEXT_KEYS) values[key] = record[key] || "";
  for (const key of ID_KEYS) values[key] = record[key]?.[0] ?? null;
  values.is_company = Boolean(record.is_company);
  values.l10n_id_pkp = Boolean(record.l10n_id_pkp);
  values.l10n_id_kode_transaksi = record.l10n_id_kode_transaksi || "";
  return values;
};

/** Nilai untuk Odoo: kosong menjadi false agar field benar-benar dikosongkan. */
const toOdoo = (key, value) => {
  if (ID_KEYS.includes(key)) return value || false;
  if (TEXT_KEYS.includes(key) || key === "l10n_id_kode_transaksi") return value === "" ? false : value;
  return value;
};

export async function render(sub, query) {
  last = { sub, query };
  if (sub === "") return renderList(query);
  return renderForm(sub === "new" ? null : Number(sub));
}

async function renderList(query) {
  app.innerHTML = '<p class="text-sm text-gray-500">Memuat...</p>';
  const filter = query.get("state") || "vendor";
  const text = query.get("q") ?? "";
  const domain = [];
  if (filter === "vendor") domain.push(["supplier_rank", ">", 0]);
  else if (filter === "company") domain.push(["is_company", "=", true]);
  else if (filter === "archived") domain.push(["active", "=", false]);
  if (text) domain.push("|", "|", ["name", "ilike", text], ["email", "ilike", text], ["vat", "ilike", text]);
  const rows = await searchRead("res.partner", domain, ["name", "is_company", "email", "phone", "city", "vat"], {
    order: "name", limit: 100, context: { active_test: filter !== "archived" },
  });
  const body = rows
    .map((r) =>
      rowLink(`#/vendor/${r.id}`, [
        cell(r.name, { strong: true }),
        cell(r.is_company ? "Perusahaan" : "Individu"),
        cell(r.email || "-"),
        cell(r.phone || "-"),
        cell(r.city || "-"),
        cell(r.vat || "-"),
      ]),
    )
    .join("");
  app.innerHTML =
    pageHeader(
      "Vendor Master",
      `${searchBox(text, "Cari nama, email, NPWP")}${filterSelect(FILTERS, filter)}
       <button data-action="refresh" class="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50" aria-label="Muat ulang"><i class="fas fa-rotate"></i></button>
       <a href="#/vendor/new" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"><i class="fas fa-plus mr-2"></i>Vendor Baru</a>`,
    ) +
    table(
      [{ label: "Nama" }, { label: "Jenis" }, { label: "Email" }, { label: "Telepon" }, { label: "Kota" }, { label: "NPWP" }],
      body,
      filter === "vendor" ? "Belum ada pemasok. Buat dengan tombol Vendor Baru." : "Tidak ada kontak yang cocok.",
    );
}

async function statesFor(countryId) {
  if (!countryId) return [];
  if (!stateCache.has(countryId)) {
    stateCache.set(countryId, await searchRead("res.country.state", [["country_id", "=", countryId]], ["display_name"], { order: "name", limit: 200 }));
  }
  return stateCache.get(countryId);
}

function field(key, label, _kind, inputHtml) {
  return fieldBlock(label, inputHtml ?? `<input data-value="${key}" value="${esc(form.values[key])}" class="${INPUT}">`);
}

async function renderForm(id) {
  app.innerHTML = '<p class="text-sm text-gray-500">Memuat...</p>';
  const [countries, currencies, terms, users, kodeOptions, payables, positions] = await Promise.all([
    referenceCountries(), referenceCurrencies(), referenceTerms(), referenceUsers(), referenceSelection("res.partner", "l10n_id_kode_transaksi"),
    referencePayableAccounts(), referenceFiscalPositions(),
  ]);
  let partner = null;
  if (id) {
    partner = await readOne("res.partner", id, [...FIELDS, "active", "supplier_invoice_count", "purchase_order_count"]);
    if (!partner) {
      app.innerHTML = '<p class="text-sm text-rose-600">Kontak tidak ditemukan.</p>';
      return;
    }
  }
  if (!form || form.id !== (partner?.id ?? null)) {
    const indonesia = countries.find((c) => c.code === "ID");
    const values = partner
      ? normalize(partner)
      : { ...normalize({}), is_company: true, country_id: indonesia?.id ?? null, buyer_id: ctx.user.id };
    form = { id: partner?.id ?? null, values, initial: partner ? { ...values } : null };
  }
  const v = form.values;
  const states = await statesFor(v.country_id);
  const showPkp = !v.country_id || countries.find((c) => c.id === v.country_id)?.code === "ID";
  const title = partner ? esc(partner.name) : "Vendor Baru";

  app.innerHTML = `
    <div class="text-sm text-gray-500 mb-2"><a href="#/vendor" class="hover:text-indigo-600">Vendor Master</a> / ${title}</div>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      ${partner ? button("toggle-active", partner.active ? "Arsipkan" : "Aktifkan Kembali", partner.active ? "danger" : "primary", { id: partner.id }) : ""}
    </div>
    ${partner ? `<div class="flex flex-wrap gap-2 mb-4">${statTiles([
      { count: partner.purchase_order_count, label: "Pembelian", icon: "fa-shopping-cart", href: `#/po?partner=${partner.id}` },
      { count: partner.supplier_invoice_count, label: "Tagihan Vendor", icon: "fa-file-invoice", href: `#/bill?partner=${partner.id}` },
    ])}</div>` : ""}
    <div class="mb-3"><h1 class="text-2xl font-bold text-gray-900">${title}</h1>
      ${partner && !partner.active ? '<span class="mt-1 inline-block px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Diarsipkan</span>' : ""}</div>

    <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 grid md:grid-cols-2 gap-x-8 gap-y-4">
      ${field("is_company", "Jenis", "bool", `<select data-value="is_company" data-kind="bool" class="${INPUT}"><option value="true" ${v.is_company ? "selected" : ""}>Perusahaan</option><option value="false" ${v.is_company ? "" : "selected"}>Individu</option></select>`)}
      ${field("name", v.is_company ? "Nama Perusahaan" : "Nama")}
      ${field("email", "Email")}
      ${field("phone", "Telepon")}
      ${field("website", "Situs Web")}
      ${v.is_company ? "" : field("function", "Jabatan")}
      <div class="md:col-span-2 border-t border-gray-100 pt-4 text-sm font-semibold text-gray-700">Alamat</div>
      ${field("street", "Jalan")}
      ${field("street2", "Jalan 2")}
      ${field("city", "Kota")}
      ${field("state_id", "Provinsi", "id", `<select data-value="state_id" data-kind="id" id="state-select" class="${INPUT}">${selectOptions(states, v.state_id, "-")}</select>`)}
      ${field("zip", "Kode Pos")}
      ${field("country_id", "Negara", "id", `<select data-value="country_id" data-kind="id" class="${INPUT}">${selectOptions(countries, v.country_id, "-")}</select>`)}
      <div class="md:col-span-2 border-t border-gray-100 pt-4 text-sm font-semibold text-gray-700">Perpajakan</div>
      ${field("vat", "NPWP (16 digit)", "", `<input data-value="vat" value="${esc(v.vat)}" placeholder="1234567890123456" inputmode="numeric" class="${INPUT}">`)}
      ${showPkp ? `<div class="flex flex-col justify-end gap-2">${checkboxField("l10n_id_pkp", "Pengusaha Kena Pajak (PKP)", v.l10n_id_pkp)}</div>` : ""}
      ${showPkp && v.l10n_id_pkp
        ? field("l10n_id_kode_transaksi", "Kode Transaksi Faktur Pajak", "", `<select data-value="l10n_id_kode_transaksi" class="${INPUT}"><option value="">-</option>${kodeOptions.map(([k, label]) => `<option value="${esc(k)}" ${k === v.l10n_id_kode_transaksi ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`)
        : ""}
      <div class="md:col-span-2 border-t border-gray-100 pt-4 text-sm font-semibold text-gray-700">Pembelian</div>
      ${field("buyer_id", "Pembeli", "id", `<select data-value="buyer_id" data-kind="id" class="${INPUT}">${selectOptions(users, v.buyer_id, "-")}</select>`)}
      ${field("property_supplier_payment_term_id", "Syarat Pembayaran Vendor", "id", `<select data-value="property_supplier_payment_term_id" data-kind="id" class="${INPUT}">${selectOptions(terms, v.property_supplier_payment_term_id, "-")}</select>`)}
      ${field("property_purchase_currency_id", "Mata Uang Pemasok", "id", `<select data-value="property_purchase_currency_id" data-kind="id" class="${INPUT}">${selectOptions(currencies, v.property_purchase_currency_id, "-")}</select>`)}
      ${field("ref", "Referensi")}
      <div class="md:col-span-2 border-t border-gray-100 pt-4 text-sm font-semibold text-gray-700">Akuntansi</div>
      ${field("property_account_payable_id", "Akun Hutang", "id", `<select data-value="property_account_payable_id" data-kind="id" class="${INPUT}">${selectOptions(payables, v.property_account_payable_id, "Bawaan perusahaan")}</select>`)}
      ${field("property_account_position_id", "Posisi Fiskal", "id", `<select data-value="property_account_position_id" data-kind="id" class="${INPUT}">${selectOptions(positions, v.property_account_position_id, "-")}</select>`)}
    </section>
    <div class="flex gap-2 mt-4">
      <button data-action="save" data-id="${partner?.id ?? ""}" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Simpan</button>
      <a href="#/vendor" data-action="discard" class="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Buang</a>
    </div>
    ${partner ? chatterHtml("res.partner", partner.id) : ""}`;
  if (partner) loadMessages("res.partner", partner.id);
}

async function persist() {
  const v = form.values;
  if (!String(v.name).trim()) throw new Error("Nama wajib diisi.");
  if (!form.id) {
    const vals = Object.fromEntries(
      Object.entries(v).filter(([, value]) => value !== "" && value !== null && value !== false).map(([k, value]) => [k, toOdoo(k, value)]),
    );
    const [newId] = await call("res.partner", "create", { vals_list: [{ ...vals, is_company: v.is_company, supplier_rank: 1 }] });
    return newId;
  }
  const changed = changedValues(v, form.initial, Object.keys(v));
  const vals = Object.fromEntries(Object.entries(changed).map(([k, value]) => [k, toOdoo(k, value)]));
  if (Object.keys(vals).length) await call("res.partner", "write", { ids: [form.id], vals });
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
      toast(wasNew ? "Vendor dibuat." : "Perubahan disimpan.");
      if (wasNew) location.hash = `#/vendor/${saved}`;
      else reload();
    }
  } else if (action === "toggle-active") {
    const archived = el.textContent.trim() === "Arsipkan";
    if (archived && !window.confirm("Arsipkan kontak ini? Kontak tidak muncul lagi di pilihan, tetapi dokumen lama tetap utuh.")) return;
    const ok = await guarded(el, () => call("res.partner", archived ? "action_archive" : "action_unarchive", { ids: [id] }));
    if (ok !== undefined) {
      form = null;
      toast(archived ? "Kontak diarsipkan." : "Kontak diaktifkan kembali.");
      reload();
    }
  }
}

export function onInput(event, el) {
  if (!el.dataset.value || !form) return;
  form.values[el.dataset.value] = fieldValue(el);
}

export async function onChange(event, el) {
  if (!el.dataset.value || !form) return;
  const key = el.dataset.value;
  form.values[key] = fieldValue(el);
  // Perubahan yang mengubah tata letak: negara (provinsi), jenis, dan PKP.
  if (key === "country_id") form.values.state_id = null;
  if (["country_id", "is_company", "l10n_id_pkp"].includes(key)) {
    if (key === "l10n_id_pkp" && !form.values.l10n_id_pkp) form.values.l10n_id_kode_transaksi = "";
    await reload();
  }
}
