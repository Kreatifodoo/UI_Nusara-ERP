// Tagihan Vendor (account.move, in_invoice). Struktur form mengikuti view Odoo: tombol Confirm, Pay,
// Cancel, Reset to Draft; bilah status draft/posted; status pembayaran; total, sisa tagihan; dan dialog
// "Register Payment" yang memakai wizard account.payment.register.
import {
  INPUT, actionBar, app, badge, call, cell, chatterHtml, closeLookup, closeModal, dateText, esc, fieldBlock, filterSelect, guarded,
  loadMessages, money, openModal, pageHeader, readOne, readonlyValue, rowLink, searchRead, statTiles, statusbar, table, toast, today,
} from "../common.js";

const STATES = {
  draft: ["Draft", "muted"],
  posted: ["Terposting", "success"],
  cancel: ["Dibatalkan", "danger"],
};
const FLOW = ["draft", "posted"];
const PAYMENT_STATES = {
  not_paid: ["Belum Dibayar", "warning"],
  in_payment: ["Dalam Pembayaran", "info"],
  paid: ["Dibayar", "success"],
  partial: ["Dibayar Sebagian", "warning"],
  reversed: ["Dibalik", "muted"],
  invoicing_legacy: ["Sistem Lama", "muted"],
};

/* Syarat tampil tombol mengikuti view_move_form Odoo. */
const BUTTONS = [
  { action: "post", label: "Konfirmasi", method: "action_post", kind: "primary", show: (b) => b.state === "draft" },
  { action: "pay", label: "Bayar", method: null, kind: "primary", show: (b) => b.state === "posted" && ["not_paid", "partial", "in_payment"].includes(b.payment_state) },
  { action: "cancel", label: "Batalkan", method: "button_cancel", kind: "danger", show: (b) => b.state === "draft" },
  { action: "reset", label: "Kembalikan ke Draft", method: "button_draft", show: (b) => b.show_reset_to_draft_button },
];
const DONE_MESSAGE = { post: "Tagihan dikonfirmasi.", cancel: "Tagihan dibatalkan.", reset: "Tagihan dikembalikan ke draft." };

let form = null; // { id, ref, invoice_date, date, invoice_date_due }
let pay = null; // { id wizard, context, billId }
let last = { sub: "", query: new URLSearchParams() };

export const leave = () => {
  form = null;
  pay = null;
};
const reload = () => render(last.sub, last.query);

export async function render(sub, query) {
  last = { sub, query };
  if (sub === "") return renderList(query);
  return renderForm(Number(sub));
}

async function renderList(query) {
  app.innerHTML = '<p class="text-sm text-gray-500">Memuat...</p>';
  const filter = query.get("state") ?? "";
  const ids = (query.get("ids") ?? "").split(",").map(Number).filter(Boolean);
  const domain = [["move_type", "=", "in_invoice"]];
  if (filter === "unpaid") domain.push(["state", "=", "posted"], ["payment_state", "in", ["not_paid", "partial"]]);
  else if (filter === "paid") domain.push(["payment_state", "in", ["paid", "in_payment"]]);
  else if (filter) domain.push(["state", "=", filter]);
  if (ids.length) domain.push(["id", "in", ids]);
  const rows = await searchRead(
    "account.move",
    domain,
    ["name", "partner_id", "invoice_date", "invoice_date_due", "invoice_origin", "amount_total", "amount_residual", "currency_id", "state", "payment_state"],
    { order: "id desc", limit: 80 },
  );
  const options = [["", "Semua"], ["draft", "Draft"], ["posted", "Terposting"], ["unpaid", "Belum dibayar"], ["paid", "Sudah dibayar"], ["cancel", "Dibatalkan"]];
  const body = rows
    .map((r) =>
      rowLink(`#/bill/${r.id}`, [
        cell(r.name || "Draft", { strong: true }),
        cell(r.partner_id?.[1] ?? ""),
        cell(dateText(r.invoice_date)),
        cell(dateText(r.invoice_date_due)),
        cell(r.invoice_origin || "-"),
        cell(money(r.amount_total, r.currency_id?.[1]), { right: true }),
        cell(money(r.amount_residual, r.currency_id?.[1]), { right: true }),
        cell(badge(STATES, r.state), { raw: true }),
        cell(r.state === "posted" ? badge(PAYMENT_STATES, r.payment_state) : "", { raw: true }),
      ]),
    )
    .join("");
  app.innerHTML =
    pageHeader(
      "Tagihan Vendor",
      `${filterSelect(options, filter)}
       <button data-action="refresh" class="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50" aria-label="Muat ulang"><i class="fas fa-rotate"></i></button>`,
    ) +
    table(
      [{ label: "Nomor" }, { label: "Pemasok" }, { label: "Tanggal Tagihan" }, { label: "Jatuh Tempo" }, { label: "Dokumen Sumber" }, { label: "Total", right: true }, { label: "Sisa", right: true }, { label: "Status" }, { label: "Pembayaran" }],
      body,
      "Belum ada tagihan vendor. Buat dari Purchase Order dengan tombol Buat Tagihan.",
    );
}

async function renderForm(id) {
  closeLookup();
  app.innerHTML = '<p class="text-sm text-gray-500">Memuat...</p>';
  const bill = await readOne("account.move", id, [
    "name", "state", "payment_state", "move_type", "partner_id", "ref", "invoice_date", "date", "invoice_date_due", "invoice_payment_term_id",
    "journal_id", "currency_id", "invoice_origin", "amount_untaxed", "amount_tax", "amount_total", "amount_residual", "matched_payment_ids",
    "show_reset_to_draft_button",
  ]);
  if (!bill) {
    app.innerHTML = '<p class="text-sm text-rose-600">Tagihan tidak ditemukan.</p>';
    return;
  }
  const lines = await searchRead(
    "account.move.line",
    [["move_id", "=", id], ["display_type", "=", "product"]],
    ["product_id", "name", "account_id", "quantity", "product_uom_id", "price_unit", "tax_ids", "price_subtotal"],
    { order: "sequence, id" },
  );
  const taxIds = [...new Set(lines.flatMap((l) => l.tax_ids))];
  const taxes = taxIds.length ? await searchRead("account.tax", [["id", "in", taxIds]], ["display_name"]) : [];
  const taxName = new Map(taxes.map((t) => [t.id, t.display_name]));
  const origins = (bill.invoice_origin ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const orders = origins.length ? await searchRead("purchase.order", [["name", "in", origins]], ["id"]) : [];

  const editable = bill.state === "draft";
  const currency = bill.currency_id?.[1];
  if (editable && form?.id !== id) {
    const values = { ref: bill.ref || "", invoice_date: bill.invoice_date || "", date: bill.date || "", invoice_date_due: bill.invoice_date_due || "" };
    form = { id, ...values, initial: { ...values } };
  }
  const dateInput = (key, label) => fieldBlock(label, `<input type="date" data-value="${key}" value="${esc(form[key])}" class="${INPUT}">`);
  const fields = editable
    ? `${fieldBlock("Pemasok", readonlyValue(bill.partner_id?.[1]))}
       ${fieldBlock("Referensi Tagihan", `<input data-value="ref" value="${esc(form.ref)}" class="${INPUT}">`)}
       ${dateInput("invoice_date", "Tanggal Tagihan")}
       ${dateInput("date", "Tanggal Akuntansi")}
       ${dateInput("invoice_date_due", "Jatuh Tempo")}
       ${fieldBlock("Jurnal", readonlyValue(bill.journal_id?.[1]))}`
    : `${fieldBlock("Pemasok", readonlyValue(bill.partner_id?.[1]))}
       ${fieldBlock("Referensi Tagihan", readonlyValue(bill.ref))}
       ${fieldBlock("Tanggal Tagihan", readonlyValue(bill.invoice_date ? dateText(bill.invoice_date) : ""))}
       ${fieldBlock("Tanggal Akuntansi", readonlyValue(dateText(bill.date)))}
       ${fieldBlock("Jatuh Tempo", readonlyValue(bill.invoice_date_due ? dateText(bill.invoice_date_due) : ""))}
       ${fieldBlock("Jurnal", readonlyValue(bill.journal_id?.[1]))}`;

  const rows = lines
    .map(
      (l) => `<tr>
        <td class="py-2 px-4 text-sm">${esc(l.product_id?.[1])}</td>
        <td class="py-2 px-4 text-sm">${esc(l.name)}</td>
        <td class="py-2 px-4 text-sm">${esc(l.account_id?.[1])}</td>
        <td class="py-2 px-4 text-sm text-right">${esc(l.quantity)}</td>
        <td class="py-2 px-4 text-sm">${esc(l.product_uom_id?.[1])}</td>
        <td class="py-2 px-4 text-sm text-right">${money(l.price_unit, currency)}</td>
        <td class="py-2 px-4 text-sm">${esc(l.tax_ids.map((t) => taxName.get(t)).filter(Boolean).join(", ") || "-")}</td>
        <td class="py-2 px-4 text-sm text-right">${money(l.price_subtotal, currency)}</td>
      </tr>`,
    )
    .join("");
  const saveBar = editable
    ? `<div class="flex gap-2 mt-4">
         <button data-action="save" data-id="${id}" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Simpan</button>
       </div>` : "";

  app.innerHTML = `
    <div class="text-sm text-gray-500 mb-2"><a href="#/bill" class="hover:text-indigo-600">Tagihan Vendor</a> / ${esc(bill.name || "Draft")}</div>
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
      <div class="flex flex-wrap gap-2">${actionBar(BUTTONS, bill)}</div>
      ${statusbar(FLOW, STATES, bill.state)}
    </div>
    <div class="flex flex-wrap gap-2 mb-4">${statTiles([
      { count: orders.length, label: `Purchase Order ${origins.join(", ")}`, icon: "fa-shopping-cart", href: orders.length === 1 ? `#/po/${orders[0].id}` : `#/po?ids=${orders.map((o) => o.id).join(",")}` },
      { count: bill.matched_payment_ids.length, label: "Pembayaran", icon: "fa-money-bill", href: `#/payment?ids=${bill.matched_payment_ids.join(",")}` },
    ])}</div>
    <div class="mb-3"><div class="text-sm text-gray-500">Tagihan Vendor</div>
      <h1 class="text-2xl font-bold text-gray-900">${esc(bill.name || "Draft")}</h1>
      ${bill.state === "posted" ? `<div class="mt-2">${badge(PAYMENT_STATES, bill.payment_state)}</div>` : ""}</div>
    <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 grid md:grid-cols-2 gap-x-8 gap-y-4">${fields}</section>
    <section class="bg-white rounded-xl shadow-sm border border-gray-200 mt-4 p-4 overflow-x-auto">
      <div class="text-sm font-semibold mb-3">Baris Tagihan</div>
      <table class="w-full text-left"><thead class="bg-gray-50"><tr>${["Produk", "Label", "Akun", "Jumlah", "Satuan", "Harga", "Pajak", "Subtotal"]
        .map((h, i) => `<th class="py-2 px-4 text-xs font-semibold text-gray-600 uppercase ${[3, 5, 7].includes(i) ? "text-right" : ""}">${h}</th>`).join("")}</tr></thead>
        <tbody class="divide-y divide-gray-100">${rows}</tbody></table>
      <div class="mt-4 ml-auto w-full max-w-xs text-sm space-y-1">
        <div class="flex justify-between"><span class="text-gray-500">Sebelum Pajak</span><span>${money(bill.amount_untaxed, currency)}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Pajak</span><span>${money(bill.amount_tax, currency)}</span></div>
        <div class="flex justify-between border-t border-gray-200 pt-1 font-semibold"><span>Total</span><span>${money(bill.amount_total, currency)}</span></div>
        ${bill.state === "posted" ? `<div class="flex justify-between"><span class="text-gray-500">Sisa Tagihan</span><span id="residual" class="font-semibold">${money(bill.amount_residual, currency)}</span></div>` : ""}
      </div>
      ${saveBar}
    </section>
    ${chatterHtml("account.move", id)}`;
  loadMessages("account.move", id);
}

/* ---------- Dialog Register Payment (wizard account.payment.register) ---------- */

const WIZARD_FIELDS = ["journal_id", "payment_method_line_id", "amount", "currency_id", "payment_date", "communication", "available_journal_ids", "available_payment_method_line_ids"];

async function paymentDialog() {
  const [w] = await call("account.payment.register", "read", { ids: [pay.id], fields: WIZARD_FIELDS, context: pay.context });
  const [journals, methods] = await Promise.all([
    searchRead("account.journal", [["id", "in", w.available_journal_ids]], ["display_name"]),
    searchRead("account.payment.method.line", [["id", "in", w.available_payment_method_line_ids]], ["display_name"]),
  ]);
  const options = (rows, selected) => rows.map((r) => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${esc(r.display_name)}</option>`).join("");
  openModal(
    "Daftarkan Pembayaran",
    `<form data-form="pay" class="space-y-4" id="pay-form">
       ${fieldBlock("Jurnal", `<select data-pay="journal_id" class="${INPUT}">${options(journals, w.journal_id?.[0])}</select>`)}
       ${fieldBlock("Metode Pembayaran", `<select data-pay="payment_method_line_id" class="${INPUT}">${options(methods, w.payment_method_line_id?.[0])}</select>`)}
       ${fieldBlock(`Jumlah (${w.currency_id?.[1] ?? ""})`, `<input type="number" min="0" step="any" data-pay="amount" value="${esc(w.amount)}" class="${INPUT} text-right">`)}
       ${fieldBlock("Tanggal Pembayaran", `<input type="date" data-pay="payment_date" value="${esc(w.payment_date || today())}" class="${INPUT}">`)}
       ${fieldBlock("Memo", `<input data-pay="communication" value="${esc(w.communication || "")}" class="${INPUT}">`)}
     </form>`,
    `<button data-action="modal-close" class="px-4 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">Batal</button>
     <button data-action="pay-confirm" class="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">Buat Pembayaran</button>`,
    () => {
      pay = null;
    },
  );
}

function wizardValues() {
  const get = (key) => document.querySelector(`[data-pay="${key}"]`)?.value;
  return {
    journal_id: Number(get("journal_id")) || false,
    payment_method_line_id: Number(get("payment_method_line_id")) || false,
    amount: Number(get("amount")),
    payment_date: get("payment_date") || false,
    communication: get("communication") ?? "",
  };
}

async function openPay(button, billId) {
  const context = { active_model: "account.move", active_ids: [billId] };
  const ok = await guarded(button, async () => {
    const [wizardId] = await call("account.payment.register", "create", { vals_list: [{}], context });
    pay = { id: wizardId, context, billId };
    await paymentDialog();
    return true;
  });
  if (!ok) pay = null;
}

async function confirmPay(button) {
  const done = await guarded(button, async () => {
    const vals = wizardValues();
    if (!(vals.amount > 0)) throw new Error("Jumlah pembayaran harus lebih dari 0.");
    await call("account.payment.register", "write", { ids: [pay.id], vals, context: pay.context });
    return call("account.payment.register", "action_create_payments", { ids: [pay.id], context: pay.context });
  });
  if (done === undefined) return;
  const target = done?.res_id;
  closeModal();
  toast("Pembayaran dibuat.");
  if (target) location.hash = `#/payment/${target}`;
  else reload();
}

/* ---------- Simpan dan aksi ---------- */

/* Hanya field yang berubah yang dikirim: menulis ulang tanggal tagihan yang sama dapat memicu Odoo
 * menghitung ulang jatuh tempo dari syarat pembayaran. */
async function persist() {
  const vals = {};
  for (const key of ["ref", "invoice_date", "date", "invoice_date_due"]) {
    if (form[key] !== form.initial[key]) vals[key] = form[key] || false;
  }
  if (Object.keys(vals).length) {
    await call("account.move", "write", { ids: [form.id], vals });
    Object.assign(form.initial, Object.fromEntries(Object.keys(vals).map((k) => [k, form[k]])));
  }
}

export async function onClick(event, el) {
  const { action } = el.dataset;
  const id = Number(el.dataset.id) || null;
  const def = BUTTONS.find((b) => b.action === action);

  if (action === "refresh") reload();
  else if (action === "save") {
    const ok = await guarded(el, async () => {
      await persist();
      return true;
    });
    if (ok) {
      form = null;
      toast("Perubahan disimpan.");
      reload();
    }
  } else if (action === "pay") await openPay(el, id);
  else if (action === "pay-confirm") await confirmPay(el);
  else if (action === "cancel" && !window.confirm("Batalkan tagihan ini?")) {
    /* dibatalkan pengguna */
  } else if (action === "reset" && !window.confirm("Kembalikan tagihan ke draft?")) {
    /* dibatalkan pengguna */
  } else if (def?.method) {
    const ok = await guarded(el, async () => {
      if (form?.id === id) await persist(); // simpan referensi dan tanggal sebelum konfirmasi
      return call("account.move", def.method, { ids: [id] });
    });
    if (ok !== undefined) {
      form = null;
      toast(DONE_MESSAGE[action]);
      reload();
    }
  }
}

export function onInput(event, el) {
  if (el.dataset.value && form) form[el.dataset.value] = el.value;
}

export async function onChange(event, el) {
  // Mengganti jurnal mengubah metode pembayaran yang tersedia: simpan isian ke wizard lalu muat ulang dialog.
  if (el.dataset.pay === "journal_id" && pay) {
    const { id, context } = pay;
    const vals = wizardValues();
    await guarded(null, async () => {
      await call("account.payment.register", "write", { ids: [id], vals: { journal_id: vals.journal_id, payment_date: vals.payment_date, communication: vals.communication }, context });
      await paymentDialog();
    });
  }
}

export async function onSubmit(event, formEl, kind) {
  if (kind === "pay") await confirmPay(null);
}
