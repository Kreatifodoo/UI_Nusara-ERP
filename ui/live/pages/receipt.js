// Penerimaan Barang / Goods Receipt (stock.picking, tipe incoming). Struktur form mengikuti view Odoo:
// tombol Mark as Todo, Check Availability, Validate, Cancel; bilah status draft/assigned/done; operasi
// dengan jumlah diterima yang bisa diedit; wizard backorder saat jumlah kurang dari permintaan.
import {
  actionBar, app, badge, call, cell, chatterHtml, closeModal, dateTimeText, esc, fieldBlock, filterSelect, guarded, loadMessages,
  openModal, money, pageHeader, readOne, readonlyValue, rowLink, searchRead, statTiles, statusbar, table, toast, INPUT,
} from "../common.js";

const STATES = {
  draft: ["Draft", "muted"],
  waiting: ["Menunggu Operasi Lain", "warning"],
  confirmed: ["Menunggu", "warning"],
  assigned: ["Siap", "info"],
  done: ["Selesai", "success"],
  cancel: ["Dibatalkan", "danger"],
};
const FLOW = ["draft", "assigned", "done"]; // statusbar_visible untuk penerimaan

const BUTTONS = [
  { action: "todo", label: "Tandai To-Do", method: "action_confirm", kind: "primary", show: (p) => p.state === "draft" },
  { action: "assign", label: "Cek Ketersediaan", method: "action_assign", kind: "primary", show: (p) => p.show_check_availability },
  { action: "validate", label: "Validasi", method: null, kind: "primary", show: (p) => !["done", "cancel"].includes(p.state) },
  { action: "cancel", label: "Batalkan", method: "action_cancel", kind: "danger", show: (p) => ["assigned", "confirmed", "draft", "waiting"].includes(p.state) },
];
const DONE_MESSAGE = { todo: "Penerimaan ditandai to-do.", assign: "Ketersediaan diperiksa.", cancel: "Penerimaan dibatalkan." };

let edits = new Map(); // id move -> jumlah diterima yang sedang diedit
let moves = [];
let last = { sub: "", query: new URLSearchParams() };

export const leave = () => {
  edits = new Map();
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
  const po = Number(query.get("po")) || null;
  const domain = [["picking_type_code", "=", "incoming"]];
  if (filter) domain.push(["state", "=", filter]);
  if (ids.length) domain.push(["id", "in", ids]);
  if (po) domain.push(["purchase_id", "=", po]);
  const rows = await searchRead("stock.picking", domain, ["name", "partner_id", "scheduled_date", "origin", "state"], { order: "id desc", limit: 80 });
  const options = [["", "Semua status"], ...Object.entries(STATES).map(([k, v]) => [k, v[0]])];
  const body = rows
    .map((r) =>
      rowLink(`#/receipt/${r.id}`, [
        cell(r.name, { strong: true }),
        cell(r.partner_id?.[1] ?? ""),
        cell(dateTimeText(r.scheduled_date)),
        cell(r.origin || "-"),
        cell(badge(STATES, r.state), { raw: true }),
      ]),
    )
    .join("");
  app.innerHTML =
    pageHeader(
      "Penerimaan Barang",
      `${filterSelect(options, filter)}
       <button data-action="refresh" class="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50" aria-label="Muat ulang"><i class="fas fa-rotate"></i></button>`,
    ) +
    table(
      [{ label: "Referensi" }, { label: "Diterima dari" }, { label: "Tanggal Terjadwal" }, { label: "Dokumen Sumber" }, { label: "Status" }],
      body,
      "Belum ada penerimaan barang. Penerimaan terbentuk otomatis saat Purchase Order dikonfirmasi.",
    );
}

async function renderForm(id) {
  app.innerHTML = '<p class="text-sm text-gray-500">Memuat...</p>';
  const pk = await readOne("stock.picking", id, [
    "name", "state", "partner_id", "picking_type_id", "location_id", "location_dest_id", "scheduled_date", "date_deadline", "date_done",
    "origin", "backorder_id", "purchase_id", "show_check_availability", "return_count",
  ]);
  if (!pk) {
    app.innerHTML = '<p class="text-sm text-rose-600">Penerimaan tidak ditemukan.</p>';
    return;
  }
  moves = await searchRead(
    "stock.move",
    [["picking_id", "=", id]],
    ["product_id", "description_picking", "product_uom_qty", "quantity", "product_uom", "picked", "state", "value"],
    { order: "id" },
  );
  edits = new Map();
  const editable = !["done", "cancel"].includes(pk.state);
  const valued = pk.state === "done" && moves.some((m) => m.value);

  const rows = moves
    .map(
      (m) => `<tr class="align-top">
        <td class="py-2 px-4 text-sm">${esc(m.product_id?.[1])}</td>
        <td class="py-2 px-4 text-sm">${esc(m.description_picking || "")}</td>
        <td class="py-2 px-4 text-sm text-right">${esc(m.product_uom_qty)}</td>
        <td class="py-2 px-4 text-sm text-right w-36">${editable
          ? `<input type="number" min="0" step="any" data-move="${m.id}" value="${esc(m.quantity)}" class="${INPUT} text-right" aria-label="Jumlah diterima untuk ${esc(m.product_id?.[1])}">`
          : esc(m.quantity)}</td>
        <td class="py-2 px-4 text-sm">${esc(m.product_uom?.[1])}</td>
        ${valued ? `<td class="py-2 px-4 text-sm text-right">${money(m.value)}</td>` : ""}
      </tr>`,
    )
    .join("");

  app.innerHTML = `
    <div class="text-sm text-gray-500 mb-2"><a href="#/receipt" class="hover:text-indigo-600">Penerimaan Barang</a> / ${esc(pk.name)}</div>
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
      <div class="flex flex-wrap gap-2">${actionBar(BUTTONS, pk)}</div>
      ${statusbar(FLOW, STATES, pk.state)}
    </div>
    <div class="flex flex-wrap gap-2 mb-4">${statTiles([
      { count: pk.purchase_id ? 1 : 0, label: `Purchase Order ${pk.purchase_id?.[1] ?? ""}`, icon: "fa-shopping-cart", href: `#/po/${pk.purchase_id?.[0]}` },
      { count: pk.backorder_id ? 1 : 0, label: `Backorder dari ${pk.backorder_id?.[1] ?? ""}`, icon: "fa-rotate-left", href: `#/receipt/${pk.backorder_id?.[0]}` },
      { count: pk.return_count, label: "Retur", icon: "fa-rotate-left" },
    ])}</div>
    <h1 class="text-2xl font-bold text-gray-900 mb-3">${esc(pk.name)}</h1>
    <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 grid md:grid-cols-2 gap-x-8 gap-y-4">
      ${fieldBlock("Diterima dari", readonlyValue(pk.partner_id?.[1]))}
      ${fieldBlock("Tipe Operasi", readonlyValue(pk.picking_type_id?.[1]))}
      ${fieldBlock("Lokasi Asal", readonlyValue(pk.location_id?.[1]))}
      ${fieldBlock("Lokasi Tujuan", readonlyValue(pk.location_dest_id?.[1]))}
      ${fieldBlock("Tanggal Terjadwal", readonlyValue(pk.scheduled_date ? dateTimeText(pk.scheduled_date) : ""))}
      ${fieldBlock(pk.state === "done" ? "Tanggal Efektif" : "Batas Waktu", readonlyValue(pk.state === "done" ? dateTimeText(pk.date_done) : pk.date_deadline ? dateTimeText(pk.date_deadline) : ""))}
      ${fieldBlock("Dokumen Sumber", readonlyValue(pk.origin))}
    </section>
    <section class="bg-white rounded-xl shadow-sm border border-gray-200 mt-4 overflow-x-auto">
      <div class="px-4 py-3 border-b border-gray-200 text-sm font-semibold">Operasi</div>
      <table class="w-full text-left"><thead class="bg-gray-50"><tr>${[...["Produk", "Deskripsi", "Permintaan", "Jumlah Diterima", "Satuan"], ...(valued ? ["Nilai Persediaan"] : [])]
        .map((h, i) => `<th class="py-2 px-4 text-xs font-semibold text-gray-600 uppercase ${i === 2 || i === 3 || i === 5 ? "text-right" : ""}">${h}</th>`).join("")}</tr></thead>
        <tbody class="divide-y divide-gray-100">${rows}</tbody></table>
    </section>
    ${valued
      ? `<p class="mt-3 text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-4 py-3">Nilai persediaan sudah tercatat pada pergerakan stok. Odoo tidak membuat jurnal saat barang diterima; jurnal persediaan atau biaya tercipta saat tagihan vendor diposting${pk.purchase_id ? ` (<a href="#/po/${pk.purchase_id[0]}" class="underline">${esc(pk.purchase_id[1])}</a>)` : ""}.</p>`
      : ""}
    ${chatterHtml("stock.picking", pk.id)}`;
  loadMessages("stock.picking", pk.id);
}

/* ---------- Validasi dan backorder ---------- */

function askBackorder() {
  return new Promise((resolve) => {
    openModal(
      "Buat Backorder?",
      '<p class="text-sm text-gray-700">Jumlah yang diterima kurang dari yang diminta. Buat backorder untuk sisanya, atau tutup tanpa backorder?</p>',
      `<button data-action="backorder-none" class="px-4 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">Tanpa Backorder</button>
       <button data-action="backorder-yes" class="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">Buat Backorder</button>
       <button data-action="modal-close" class="px-4 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">Batal</button>`,
      () => resolve(null),
    );
    pendingBackorder = (choice) => {
      resolve(choice);
      closeModal(); // onClose memanggil resolve(null) yang diabaikan karena sudah terselesaikan
    };
  });
}
let pendingBackorder = null;

async function validate(button, id) {
  const ok = await guarded(button, async () => {
    for (const m of moves) {
      const qty = Number(edits.get(m.id) ?? m.quantity);
      if (!(qty >= 0)) throw new Error("Jumlah diterima tidak boleh negatif.");
      if (qty !== m.quantity || (qty > 0) !== m.picked) {
        await call("stock.move", "write", { ids: [m.id], vals: { quantity: qty, picked: qty > 0 } });
      }
    }
    const result = await call("stock.picking", "button_validate", { ids: [id] });
    if (result === true || result === false || result == null) return true;
    if (result.res_model === "stock.backorder.confirmation") {
      const choice = await askBackorder();
      if (!choice) return false;
      const context = result.context ?? {};
      const wizard = await call("stock.backorder.confirmation", "create", { vals_list: [{}], context });
      await call("stock.backorder.confirmation", choice === "backorder" ? "process" : "process_cancel_backorder", { ids: wizard, context });
      return true;
    }
    throw new Error(`Odoo meminta langkah tambahan ("${result.name ?? result.res_model}") yang belum didukung UI ini. Selesaikan di Odoo.`);
  });
  if (ok) {
    toast("Penerimaan divalidasi.");
    reload();
  }
}

export async function onClick(event, el) {
  const { action } = el.dataset;
  const id = Number(el.dataset.id) || null;
  const def = BUTTONS.find((b) => b.action === action);

  if (action === "refresh") reload();
  else if (action === "validate") await validate(el, id);
  else if (action === "backorder-yes") pendingBackorder?.("backorder");
  else if (action === "backorder-none") pendingBackorder?.("none");
  else if (action === "cancel" && !window.confirm("Batalkan penerimaan ini?")) {
    /* dibatalkan pengguna */
  } else if (def?.method) {
    const ok = await guarded(el, () => call("stock.picking", def.method, { ids: [id] }));
    if (ok !== undefined) {
      toast(DONE_MESSAGE[action]);
      reload();
    }
  }
}

export function onInput(event, el) {
  if (el.dataset.move) edits.set(Number(el.dataset.move), el.value);
}
