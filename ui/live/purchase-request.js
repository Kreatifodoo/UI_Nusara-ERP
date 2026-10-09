// UI Nusara untuk Purchase Request yang bertransaksi langsung ke Odoo (JSON-2).
// Struktur form mengikuti form Odoo/OCA `purchase.request`: tombol header menurut status dan hak
// manager, bilah status, tombol statistik, kolom barang, total estimasi, dan chatter.
import { OdooError, auth, call, readOne, searchRead } from "./odoo.js";

const app = document.querySelector("#app");
const sessionBox = document.querySelector("#session");
const toastBox = document.querySelector("#toast");

/* Warna lencana mengikuti dekorasi tampilan Odoo: success, muted, warning, danger, info. */
const TONE = {
  success: "bg-emerald-100 text-emerald-800",
  muted: "bg-slate-100 text-slate-600",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-rose-100 text-rose-800",
  info: "bg-sky-100 text-sky-800",
};
const PR_STATES = {
  draft: ["Draft", "muted"],
  to_approve: ["Menunggu Persetujuan", "warning"],
  approved: ["Disetujui", "success"],
  in_progress: ["Dalam Proses", "success"],
  done: ["Selesai", "success"],
  rejected: ["Ditolak", "danger"],
};
const PR_FLOW = ["draft", "to_approve", "approved", "in_progress", "done"]; // urutan statusbar Odoo
const PURCHASE_STATES = {
  draft: ["RFQ", "muted"],
  sent: ["RFQ Terkirim", "info"],
  "to approve": ["Menunggu Persetujuan", "warning"],
  to_approve: ["Menunggu Persetujuan", "warning"],
  purchase: ["Purchase Order", "info"],
  done: ["Terkunci", "success"],
  cancel: ["Dibatalkan", "danger"],
  cancelled: ["Dibatalkan", "danger"],
};

/* Tombol header Odoo: [aksi, label, metode Odoo, status yang menampilkan, khusus manager, menonjol]. */
const HEADER_BUTTONS = [
  ["reset", "Reset ke Draft", "button_draft", ["to_approve", "approved", "rejected", "in_progress", "done"], true, false],
  ["request", "Ajukan Persetujuan", "button_to_approve", ["draft"], false, true],
  ["approve", "Setujui", "button_approved", ["to_approve"], true, true],
  ["progress", "Tandai Dalam Proses", "button_in_progress", ["approved"], true, false],
  ["rfq", "Buat RFQ", null, ["approved", "in_progress"], false, false],
  ["done", "Selesai", "button_done", ["approved", "in_progress"], true, true],
  ["reject", "Tolak", "button_rejected", ["to_approve", "approved", "in_progress"], true, false],
];
const ACTION_DONE = {
  request: "Purchase Request diajukan.",
  approve: "Purchase Request disetujui.",
  progress: "Ditandai dalam proses.",
  done: "Purchase Request selesai.",
  reject: "Purchase Request ditolak.",
  reset: "Dikembalikan ke draft.",
};

const ctx = { user: null, company: null, isManager: false, multiCompany: false, users: null, pickingTypes: null };
let form = null; // keadaan form yang sedang diedit (baru atau draft)
let vendorChoice = null; // pemasok yang dipilih dari kotak saran (untuk Buat RFQ)

/* ---------- Pembantu ---------- */

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n, currency = "IDR") =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 0 }).format(n ?? 0);
const dateText = (d) => (d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const dateTimeText = (d) => {
  if (!d) return "";
  const date = new Date(String(d).includes("T") ? d : `${String(d).replace(" ", "T")}Z`);
  return date.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const plain = (html) => new DOMParser().parseFromString(html || "", "text/html").body.textContent.trim();
const today = () => new Date().toISOString().slice(0, 10);
const badge = (map, key) => {
  const [label, tone] = map[key] ?? [key, "muted"];
  return `<span class="px-2 py-1 rounded-full text-xs font-medium ${TONE[tone]}">${esc(label)}</span>`;
};
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
const readonlyValue = (v) => `<div class="py-2 text-sm font-medium text-gray-900">${v ? esc(v) : '<span class="text-gray-400">-</span>'}</div>`;

function toast(message, kind = "ok") {
  const el = document.createElement("div");
  el.className = `${kind === "error" ? "bg-rose-600" : "bg-emerald-600"} text-white text-sm rounded-lg shadow-lg px-4 py-3`;
  el.textContent = message;
  toastBox.append(el);
  setTimeout(() => el.remove(), kind === "error" ? 8000 : 3500);
}

async function guarded(button, task) {
  if (button) button.disabled = true;
  try {
    return await task();
  } catch (error) {
    if (error instanceof OdooError && error.status === 401) {
      auth.clear();
      ctx.user = null;
      toast(error.message, "error");
      route();
      return undefined;
    }
    toast(error.message || "Terjadi kesalahan.", "error");
    return undefined;
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

/* ---------- Sesi ---------- */

async function loadSession() {
  const { uid } = await call("res.users", "context_get");
  const user = await readOne("res.users", uid, ["name", "company_id"]);
  const company = await readOne("res.company", user.company_id[0], ["name", "currency_id"]);
  const [isManager, companyCount] = await Promise.all([
    call("res.users", "has_group", { ids: [uid], group_ext_id: "purchase_request.group_purchase_request_manager" }),
    call("res.company", "search_count", { domain: [] }),
  ]);
  Object.assign(ctx, { user, company, isManager: Boolean(isManager), multiCompany: companyCount > 1, users: null, pickingTypes: null });
}

function renderSession() {
  if (!ctx.user) {
    sessionBox.innerHTML = '<span class="text-slate-400">Belum terhubung</span>';
    return;
  }
  sessionBox.innerHTML = `<i class="fas fa-circle text-emerald-400 text-[8px] mr-2"></i>${esc(ctx.user.name)} · ${esc(ctx.company.name)}
    <button data-action="disconnect" class="ml-3 text-xs text-slate-400 hover:text-white underline">Putus</button>`;
}

function renderConnect() {
  app.innerHTML = `
    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-6 max-w-xl mx-auto mt-8">
      <h1 class="text-xl font-bold text-gray-900">Hubungkan ke Odoo</h1>
      <p class="text-sm text-gray-600 mt-2">Halaman ini bertransaksi langsung ke Odoo memakai API key milik Anda sendiri.</p>
      <ol class="text-sm text-gray-600 mt-4 list-decimal ml-5 space-y-1">
        <li>Di Odoo, klik nama Anda di pojok kanan atas, lalu <b>Preferences</b>.</li>
        <li>Buka tab <b>Account Security</b>, klik <b>New API Key</b>, beri nama bebas.</li>
        <li>Salin key yang tampil (hanya muncul sekali), lalu tempel di bawah.</li>
      </ol>
      <form data-form="connect" class="mt-5 space-y-3">
        <label class="block text-sm font-medium text-gray-700" for="apikey">API key</label>
        <input id="apikey" type="password" autocomplete="off" required class="${input}">
        <button class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Hubungkan</button>
        <p class="text-xs text-gray-500">Key disimpan hanya selama tab ini terbuka dan hilang saat tab ditutup.</p>
      </form>
    </section>`;
}

/* ---------- Daftar (kolom mengikuti list view Odoo) ---------- */

async function renderList() {
  app.innerHTML = '<p class="text-sm text-gray-500">Memuat...</p>';
  const filter = new URLSearchParams(location.hash.split("?")[1] ?? "").get("state") ?? "";
  const rows = await searchRead(
    "purchase.request",
    filter ? [["state", "=", filter]] : [],
    ["name", "date_start", "requested_by", "origin", "estimated_cost", "currency_id", "state"],
    { order: "id desc", limit: 80 },
  );
  const options = [["", "Semua status"], ...Object.entries(PR_STATES).map(([k, v]) => [k, v[0]])]
    .map(([k, label]) => `<option value="${esc(k)}" ${k === filter ? "selected" : ""}>${esc(label)}</option>`)
    .join("");
  const body = rows.length
    ? rows
        .map(
          (r) => `<tr class="hover:bg-gray-50 cursor-pointer ${r.state === "rejected" ? "text-gray-400" : ""}" data-action="open" data-id="${r.id}">
            <td class="py-3 px-4 text-sm font-medium ${r.state === "rejected" ? "" : "text-indigo-700"}">${esc(r.name)}</td>
            <td class="py-3 px-4 text-sm">${dateText(r.date_start)}</td>
            <td class="py-3 px-4 text-sm">${esc(r.requested_by?.[1])}</td>
            <td class="py-3 px-4 text-sm">${esc(r.origin || "-")}</td>
            <td class="py-3 px-4 text-sm text-right">${money(r.estimated_cost, r.currency_id?.[1])}</td>
            <td class="py-3 px-4 text-sm">${badge(PR_STATES, r.state)}</td>
          </tr>`,
        )
        .join("")
    : '<tr><td colspan="6" class="py-10 text-center text-sm text-gray-500">Belum ada Purchase Request.</td></tr>';
  app.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-3">
      <h1 class="text-2xl font-bold text-gray-900">Purchase Request</h1>
      <div class="flex gap-2">
        <select data-change="filter" class="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">${options}</select>
        <button data-action="refresh" class="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50" aria-label="Muat ulang"><i class="fas fa-rotate"></i></button>
        <button data-action="new" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"><i class="fas fa-plus mr-2"></i>Buat Baru</button>
      </div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
      <table class="w-full text-left">
        <thead class="bg-gray-50 border-b border-gray-200"><tr>
          ${["Nomor", "Tanggal Mulai", "Diminta oleh", "Dokumen Sumber", "Estimasi Biaya", "Status"]
            .map((h, i) => `<th class="py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider ${i === 4 ? "text-right" : ""}">${h}</th>`)
            .join("")}
        </tr></thead>
        <tbody class="divide-y divide-gray-200">${body}</tbody>
      </table>
    </div>`;
}

/* ---------- Form (baru dan draft: dapat diedit; status lain: baca saja, seperti is_editable di Odoo) ---------- */

async function referenceData() {
  if (!ctx.users) {
    [ctx.users, ctx.pickingTypes] = await Promise.all([
      searchRead("res.users", [["share", "=", false]], ["display_name"], { order: "name", limit: 100 }),
      searchRead("stock.picking.type", [["code", "=", "incoming"]], ["display_name"], { limit: 50 }),
    ]);
  }
}

const emptyLine = () => ({
  id: null, text: "", product_id: null, productText: "", name: "", product_qty: 1,
  product_uom_id: null, uom_label: "", date_required: today(), estimated_cost: 0,
});

function selectOptions(rows, selected, blank) {
  return (blank ? [`<option value="">${esc(blank)}</option>`] : [])
    .concat(rows.map((r) => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${esc(r.display_name)}</option>`))
    .join("");
}

function linesTable() {
  const rows = form.lines
    .map(
      (l, i) => `<tr class="align-top">
        <td class="py-2 pr-2 min-w-48"><input data-lookup="product" autocomplete="off" role="combobox" aria-autocomplete="list" data-line="${i}" data-field="text" value="${esc(l.text)}" placeholder="Cari atau pilih produk..." class="${input}"></td>
        <td class="py-2 px-2 min-w-40"><input data-line="${i}" data-field="name" value="${esc(l.name)}" class="${input}"></td>
        <td class="py-2 px-2 w-24"><input type="number" min="0" step="any" data-line="${i}" data-field="product_qty" value="${esc(l.product_qty)}" class="${input} text-right"></td>
        <td class="py-2 px-2 w-24 text-sm text-gray-600">${esc(l.uom_label || "-")}</td>
        <td class="py-2 px-2 w-40"><input type="date" data-line="${i}" data-field="date_required" value="${esc(l.date_required)}" class="${input}"></td>
        <td class="py-2 px-2 w-36"><input type="number" min="0" step="any" data-line="${i}" data-field="estimated_cost" value="${esc(l.estimated_cost)}" class="${input} text-right"></td>
        <td class="py-2 pl-2 w-10 text-center"><button type="button" data-action="remove-line" data-line="${i}" class="text-gray-400 hover:text-rose-600 mt-2" aria-label="Hapus baris"><i class="fas fa-trash-alt"></i></button></td>
      </tr>`,
    )
    .join("");
  return `<table class="w-full text-left">
      <thead><tr>${["Produk", "Deskripsi", "Jumlah", "Satuan", "Tanggal Diminta", "Estimasi Biaya", ""]
        .map((h, i) => `<th class="pb-2 px-2 text-xs font-semibold text-gray-600 uppercase ${i === 2 || i === 5 ? "text-right" : ""}">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody></table>
    <button type="button" data-action="add-line" class="mt-2 text-sm text-indigo-600 font-medium hover:text-indigo-800"><i class="fas fa-plus mr-1"></i>Tambah baris</button>`;
}

function readonlyLinesTable(lines, currency) {
  const rows = lines
    .map(
      (l) => `<tr class="${l.cancelled ? "text-gray-400" : ""}">
        <td class="py-2 px-4 text-sm">${esc(l.product_id?.[1])}</td>
        <td class="py-2 px-4 text-sm">${esc(l.name)}</td>
        <td class="py-2 px-4 text-sm text-right">${esc(l.product_qty)}</td>
        <td class="py-2 px-4 text-sm">${esc(l.product_uom_id?.[1])}</td>
        <td class="py-2 px-4 text-sm">${dateText(l.date_required)}</td>
        <td class="py-2 px-4 text-sm text-right">${money(l.estimated_cost, currency)}</td>
        <td class="py-2 px-4 text-sm text-right">${esc(l.purchased_qty)}</td>
        <td class="py-2 px-4 text-sm">${l.purchase_state ? badge(PURCHASE_STATES, l.purchase_state) : ""}</td>
      </tr>`,
    )
    .join("");
  return `<table class="w-full text-left">
      <thead class="bg-gray-50"><tr>${["Produk", "Deskripsi", "Jumlah", "Satuan", "Tanggal Diminta", "Estimasi Biaya", "Dipesan", "Status Pembelian"]
        .map((h, i) => `<th class="py-2 px-4 text-xs font-semibold text-gray-600 uppercase ${[2, 5, 6].includes(i) ? "text-right" : ""}">${h}</th>`).join("")}</tr></thead>
      <tbody class="divide-y divide-gray-100">${rows}</tbody></table>`;
}

function statusbar(state) {
  const steps = state === "rejected" ? [...PR_FLOW, "rejected"] : PR_FLOW;
  const at = PR_FLOW.indexOf(state);
  return steps
    .map((s, i) => {
      const current = s === state;
      const passed = at > i;
      const cls = current ? (s === "rejected" ? "bg-rose-600 text-white" : "bg-indigo-600 text-white")
        : passed ? "bg-indigo-100 text-indigo-800" : "bg-gray-100 text-gray-500";
      return `<span class="px-3 py-1.5 text-xs font-semibold ${cls} ${i === 0 ? "rounded-l-lg" : ""} ${i === steps.length - 1 ? "rounded-r-lg" : ""}">${esc(PR_STATES[s][0])}</span>`;
    })
    .join("");
}

function headerButtons(pr) {
  return HEADER_BUTTONS.filter(([, , , states, managerOnly]) => states.includes(pr.state) && (!managerOnly || ctx.isManager))
    .map(([action, label, , , , primary]) => {
      const cls = primary ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50";
      return `<button data-action="${action}" data-id="${pr.id}" class="px-4 py-2 rounded-lg text-sm font-medium ${cls}">${esc(label)}</button>`;
    })
    .join("");
}

function statButtons(pr) {
  const tiles = [
    [pr.line_count, "Baris", "fa-list", "section-lines"],
    [pr.purchase_count, "Purchase Order", "fa-shopping-cart", "section-rfq"],
    [pr.move_count, "Penerimaan", "fa-truck", null],
  ].filter(([count]) => count > 0);
  return tiles
    .map(([count, label, icon, target]) => `<${target ? "a" : "div"} ${target ? `href="#${target}" data-action="scroll" data-target="${target}"` : ""}
        class="flex items-center gap-3 border border-gray-200 bg-white rounded-lg px-4 py-2 ${target ? "hover:bg-gray-50" : ""}">
        <i class="fas ${icon} text-gray-400"></i><div><div class="text-base font-semibold leading-none">${esc(count)}</div><div class="text-xs text-gray-500">${esc(label)}</div></div>
      </${target ? "a" : "div"}>`)
    .join("");
}

function fieldBlock(label, content) {
  return `<div><div class="text-xs font-medium text-gray-500 uppercase tracking-wide">${esc(label)}</div>${content}</div>`;
}

async function renderForm(id) {
  vendorChoice = null;
  closeLookup();
  app.innerHTML = '<p class="text-sm text-gray-500">Memuat...</p>';
  await referenceData();
  let pr = null;
  let lines = [];
  let rfqs = [];
  if (id) {
    pr = await readOne("purchase.request", id, [
      "name", "state", "requested_by", "assigned_to", "origin", "description", "date_start", "picking_type_id", "company_id",
      "is_editable", "line_count", "purchase_count", "move_count", "estimated_cost", "currency_id",
    ]);
    if (!pr) {
      app.innerHTML = '<p class="text-sm text-rose-600">Purchase Request tidak ditemukan.</p>';
      return;
    }
    [lines, rfqs] = await Promise.all([
      searchRead("purchase.request.line", [["request_id", "=", id]],
        ["product_id", "name", "product_qty", "product_uom_id", "date_required", "estimated_cost", "purchased_qty", "purchase_state", "cancelled"], { order: "id" }),
      searchRead("purchase.order", [["order_line.purchase_request_lines.request_id", "=", id]],
        ["name", "partner_id", "state", "amount_untaxed", "amount_tax", "amount_total", "currency_id"]),
    ]);
  }
  const editable = !pr || pr.is_editable;
  const currency = pr?.currency_id?.[1] ?? ctx.company.currency_id?.[1] ?? "IDR";

  if (editable && (!form || form.id !== (pr?.id ?? null))) {
    form = pr
      ? {
          id: pr.id,
          values: {
            requested_by: pr.requested_by?.[0] ?? null, assigned_to: pr.assigned_to?.[0] ?? null, origin: pr.origin || "",
            description: pr.description || "", date_start: pr.date_start || "", picking_type_id: pr.picking_type_id?.[0] ?? null,
          },
          lines: lines.map((l) => ({
            id: l.id, text: l.product_id?.[1] ?? "", productText: l.product_id?.[1] ?? "", product_id: l.product_id?.[0] ?? null,
            name: l.name || "", product_qty: l.product_qty, product_uom_id: l.product_uom_id?.[0] ?? null,
            uom_label: l.product_uom_id?.[1] ?? "", date_required: l.date_required || "", estimated_cost: l.estimated_cost,
          })),
          removed: [],
        }
      : {
          id: null,
          values: {
            requested_by: ctx.user.id, assigned_to: null, origin: "", description: "", date_start: today(),
            picking_type_id: ctx.pickingTypes[0]?.id ?? null,
          },
          lines: [emptyLine()],
          removed: [],
        };
  }

  const v = form?.values;
  const title = pr ? esc(pr.name) : "Baru";
  const fields = editable
    ? `${fieldBlock("Diminta oleh", `<select data-value="requested_by" class="${input}">${selectOptions(ctx.users, v.requested_by)}</select>`)}
       ${fieldBlock("Penyetuju", `<select data-value="assigned_to" class="${input}">${selectOptions(ctx.users, v.assigned_to, "-")}</select>`)}
       ${fieldBlock("Dokumen Sumber", `<input data-value="origin" value="${esc(v.origin)}" class="${input}">`)}
       ${fieldBlock("Deskripsi", `<input data-value="description" value="${esc(v.description)}" class="${input}">`)}
       ${fieldBlock("Tanggal Mulai", `<input type="date" data-value="date_start" value="${esc(v.date_start)}" class="${input}">`)}
       ${fieldBlock("Tipe Penerimaan", `<select data-value="picking_type_id" class="${input}">${selectOptions(ctx.pickingTypes, v.picking_type_id)}</select>`)}`
    : `${fieldBlock("Diminta oleh", readonlyValue(pr.requested_by?.[1]))}
       ${fieldBlock("Penyetuju", readonlyValue(pr.assigned_to?.[1]))}
       ${fieldBlock("Dokumen Sumber", readonlyValue(pr.origin))}
       ${fieldBlock("Deskripsi", readonlyValue(pr.description))}
       ${fieldBlock("Tanggal Mulai", readonlyValue(dateText(pr.date_start) === "-" ? "" : dateText(pr.date_start)))}
       ${fieldBlock("Tipe Penerimaan", readonlyValue(pr.picking_type_id?.[1]))}`;
  const company = ctx.multiCompany && pr ? fieldBlock("Perusahaan", readonlyValue(pr.company_id?.[1])) : "";

  const rfqRows = rfqs
    .map(
      (o) => `<tr>
        <td class="py-2 px-4 text-sm font-medium">${esc(o.name)}</td>
        <td class="py-2 px-4 text-sm">${esc(o.partner_id?.[1])}</td>
        <td class="py-2 px-4 text-sm text-right">${money(o.amount_untaxed, o.currency_id?.[1])}</td>
        <td class="py-2 px-4 text-sm text-right">${money(o.amount_tax, o.currency_id?.[1])}</td>
        <td class="py-2 px-4 text-sm text-right font-semibold">${money(o.amount_total, o.currency_id?.[1])}</td>
        <td class="py-2 px-4 text-sm">${badge(PURCHASE_STATES, o.state)}</td>
        <td class="py-2 px-4 text-sm text-right">${["draft", "sent"].includes(o.state)
          ? `<button data-action="confirm-po" data-id="${o.id}" class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700">Konfirmasi PO</button>` : ""}</td>
      </tr>`,
    )
    .join("");
  const rfqPanel = `
    <div id="rfq-create" class="${pr && ["approved", "in_progress"].includes(pr.state) ? "" : "hidden"} mt-4 flex flex-col sm:flex-row gap-2 sm:items-end">
      <div class="flex-1">
        <label class="block text-sm font-medium text-gray-700 mb-1" for="vendor">Pemasok</label>
        <input id="vendor" data-lookup="vendor" autocomplete="off" role="combobox" aria-autocomplete="list" placeholder="Cari atau pilih pemasok..." class="${input}">
      </div>
      <button data-action="make-rfq" data-id="${pr?.id ?? ""}" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Buat RFQ</button>
    </div>`;

  const total = editable
    ? form.lines.reduce((sum, l) => sum + Number(l.estimated_cost || 0), 0)
    : pr.estimated_cost;
  const saveBar = editable
    ? `<div class="flex gap-2 mt-4">
         <button data-action="save" data-id="${pr?.id ?? ""}" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Simpan</button>
         <a href="#/" data-action="discard" class="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Buang</a>
       </div>` : "";

  app.innerHTML = `
    <div class="text-sm text-gray-500 mb-2"><a href="#/" class="hover:text-indigo-600">Purchase Request</a> / ${title}</div>
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
      <div class="flex flex-wrap gap-2">${pr ? headerButtons(pr) : ""}</div>
      <div class="inline-flex">${statusbar(pr?.state ?? "draft")}</div>
    </div>
    ${pr ? `<div class="flex flex-wrap gap-2 mb-4">${statButtons(pr)}</div>` : ""}
    <h1 class="text-2xl font-bold text-gray-900 mb-3">${title}</h1>
    <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 grid md:grid-cols-2 gap-x-8 gap-y-4">${fields}${company}</section>
    <section id="section-lines" class="bg-white rounded-xl shadow-sm border border-gray-200 mt-4 p-4 overflow-x-auto">
      <div class="text-sm font-semibold mb-3">Barang yang diminta</div>
      <div id="lines-box">${editable ? linesTable() : readonlyLinesTable(lines, currency)}</div>
      <div class="flex justify-end mt-3 text-sm"><span class="text-gray-500 mr-3">Estimasi Biaya</span><span id="total" class="font-semibold">${money(total, currency)}</span></div>
      ${saveBar}
    </section>
    ${pr ? `<section id="section-rfq" class="bg-white rounded-xl shadow-sm border border-gray-200 mt-4 p-4 overflow-x-auto">
      <div class="text-sm font-semibold">RFQ / Purchase Order</div>
      ${rfqs.length ? `<table class="w-full text-left mt-2"><thead class="bg-gray-50"><tr>${["Nomor", "Pemasok", "Sebelum pajak", "Pajak", "Total", "Status", ""]
        .map((h, i) => `<th class="py-2 px-4 text-xs font-semibold text-gray-600 uppercase ${i >= 2 && i <= 4 ? "text-right" : ""}">${h}</th>`).join("")}</tr></thead>
        <tbody class="divide-y divide-gray-100">${rfqRows}</tbody></table>` : '<p class="text-sm text-gray-500 mt-2">Belum ada RFQ.</p>'}
      ${rfqPanel}
    </section>
    <section id="chatter" class="bg-white rounded-xl shadow-sm border border-gray-200 mt-4 p-4">
      <div class="text-sm font-semibold mb-3">Catatan dan riwayat</div>
      <form data-form="note" data-id="${pr.id}" class="flex gap-2 mb-4">
        <input name="note" placeholder="Tambah catatan internal..." class="${input}" required>
        <button class="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 whitespace-nowrap">Catat</button>
      </form>
      <div id="messages" class="space-y-3 text-sm text-gray-500">Memuat...</div>
    </section>` : ""}`;
  if (pr) loadMessages(pr.id);
}

async function loadMessages(id) {
  const box = document.querySelector("#messages");
  if (!box) return;
  try {
    const rows = await searchRead(
      "mail.message",
      [["model", "=", "purchase.request"], ["res_id", "=", id], ["message_type", "in", ["comment", "notification"]]],
      ["author_id", "date", "body", "message_type"],
      { order: "id desc", limit: 30 },
    );
    box.innerHTML = rows.length
      ? rows.map((m) => {
          const text = plain(m.body);
          return `<div class="border-l-2 ${m.message_type === "comment" ? "border-indigo-300" : "border-gray-200"} pl-3">
            <div class="text-xs text-gray-500">${esc(m.author_id?.[1] ?? "Sistem")} · ${esc(dateTimeText(m.date))}</div>
            <div class="text-gray-800">${text ? esc(text) : '<span class="text-gray-400">Perubahan data tercatat</span>'}</div></div>`;
        }).join("")
      : "Belum ada catatan.";
  } catch {
    box.textContent = "Riwayat tidak dapat dimuat.";
  }
}

/* ---------- Simpan, aksi, RFQ ---------- */

function resolveLine(l) {
  const text = l.text.trim();
  if (!text) return null;
  if (l.product_id && text === l.productText) return l;
  throw new Error(`Produk "${text}" belum dipilih dari daftar. Klik produk pada kotak saran.`);
}

function lineValues(l) {
  const qty = Number(l.product_qty);
  if (!(qty > 0)) throw new Error(`Jumlah untuk "${l.text}" harus lebih dari 0.`);
  return {
    product_id: l.product_id, name: l.name, product_qty: qty, product_uom_id: l.product_uom_id,
    ...(l.date_required ? { date_required: l.date_required } : {}), estimated_cost: Number(l.estimated_cost || 0),
  };
}

async function persist() {
  const resolved = form.lines.map(resolveLine).filter(Boolean);
  if (!resolved.length) throw new Error("Tambahkan minimal satu barang.");
  const v = form.values;
  const header = {
    requested_by: Number(v.requested_by) || false, assigned_to: Number(v.assigned_to) || false, origin: v.origin,
    description: v.description, date_start: v.date_start || false, picking_type_id: Number(v.picking_type_id) || false,
  };
  if (!form.id) {
    const [id] = await call("purchase.request", "create", {
      vals_list: [{ ...header, line_ids: resolved.map((l) => [0, 0, lineValues(l)]) }],
    });
    return id;
  }
  const commands = [
    ...resolved.map((l) => (l.id ? [1, l.id, lineValues(l)] : [0, 0, lineValues(l)])),
    ...form.removed.map((lineId) => [2, lineId, 0]),
  ];
  await call("purchase.request", "write", { ids: [form.id], vals: { ...header, line_ids: commands } });
  return form.id;
}

async function makeRfq(button, id) {
  const vendor = vendorChoice;
  if (!vendor || vendor.display_name !== document.querySelector('[data-lookup="vendor"]')?.value) {
    toast("Pilih pemasok dari kotak saran.", "error");
    return;
  }
  const lines = await searchRead("purchase.request.line", [["request_id", "=", id], ["cancelled", "=", false]], ["id"]);
  const ids = lines.map((l) => l.id);
  const context = { active_model: "purchase.request.line", active_ids: ids, active_id: ids[0] };
  const done = await guarded(button, async () => {
    const wizard = await call("purchase.request.line.make.purchase.order", "create", { vals_list: [{ supplier_id: vendor.id }], context });
    await call("purchase.request.line.make.purchase.order", "make_purchase_order", { ids: wizard, context });
    return true;
  });
  if (done) {
    toast("RFQ dibuat.");
    route();
  }
}

/* ---------- Event ---------- */

/* ---------- Kotak saran (autocomplete) ----------
 * Pengganti <datalist>, yang popup-nya tidak tampil di semua browser (mis. browser tertanam).
 * Satu menu berposisi fixed agar tidak terpotong tabel yang dapat digulir. Terbuka saat field
 * difokuskan, difilter saat mengetik, dan dapat dipilih dengan klik atau keyboard.
 */
const menu = document.createElement("div");
menu.id = "lookup-menu";
menu.setAttribute("role", "listbox");
menu.className = "hidden fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-auto text-sm";
document.body.append(menu);

const LOOKUPS = {
  product: {
    search: (q) =>
      searchRead(
        "product.product",
        [["purchase_ok", "=", true], ...(q ? ["|", ["name", "ilike", q], ["default_code", "ilike", q]] : [])],
        ["display_name", "uom_id", "description_purchase"],
        { limit: 10, order: "name" },
      ),
    sub: (r) => r.uom_id?.[1] ?? "",
  },
  vendor: {
    search: (q) => searchRead("res.partner", q ? [["name", "ilike", q]] : [], ["display_name"], { limit: 10, order: "name" }),
    sub: () => "",
  },
};
let lookup = null; // { input, kind, items, active, seq, loading }
let lookupTimer;

function closeLookup() {
  lookup = null;
  menu.classList.add("hidden");
}

function paintMenu() {
  if (!lookup) return;
  menu.innerHTML = lookup.items.length
    ? lookup.items
        .map(
          (it, i) => `<div role="option" data-lookup-item="${i}" class="px-3 py-2 cursor-pointer flex justify-between gap-4 hover:bg-indigo-50 ${i === lookup.active ? "bg-indigo-50" : ""}">
            <span>${esc(it.display_name)}</span><span class="text-gray-400 text-xs">${esc(LOOKUPS[lookup.kind].sub(it))}</span></div>`,
        )
        .join("")
    : `<div class="px-3 py-2 text-gray-500">${lookup.loading ? "Mencari..." : "Tidak ada hasil"}</div>`;
  const box = lookup.input.getBoundingClientRect();
  Object.assign(menu.style, { left: `${box.left}px`, top: `${box.bottom + 4}px`, minWidth: `${Math.max(box.width, 280)}px` });
  menu.classList.remove("hidden");
}

/** Produk atau pemasok yang sudah dipilih: tampilkan daftar penuh saat difokuskan, bukan hanya dirinya. */
function isChosen(input) {
  if (input.dataset.lookup === "vendor") return vendorChoice?.display_name === input.value;
  const line = form?.lines[Number(input.dataset.line)];
  return Boolean(line?.product_id) && line.productText === input.value;
}

function runLookup(input, delay = 0) {
  if (!lookup || lookup.input !== input) {
    lookup = { input, kind: input.dataset.lookup, items: [], active: -1, seq: 0, loading: true };
  }
  const current = lookup;
  const mine = ++current.seq;
  current.loading = true;
  paintMenu();
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(async () => {
    try {
      const items = await LOOKUPS[current.kind].search(isChosen(input) ? "" : input.value.trim());
      if (lookup !== current || current.seq !== mine) return; // jawaban usang
      current.items = items;
      current.active = items.length ? 0 : -1;
    } catch (error) {
      if (lookup !== current) return;
      current.items = [];
      toast(error.message, "error");
    }
    current.loading = false;
    paintMenu();
  }, delay);
}

function chooseItem(index) {
  const item = lookup?.items[index];
  if (!item) return;
  const { input, kind } = lookup;
  closeLookup();
  if (kind === "vendor") {
    vendorChoice = item;
    input.value = item.display_name;
    return;
  }
  // Memilih produk: isi satuan dan deskripsi seperti onchange di Odoo.
  const i = Number(input.dataset.line);
  const line = form.lines[i];
  line.text = item.display_name;
  line.productText = item.display_name;
  line.product_id = item.id;
  line.product_uom_id = item.uom_id[0];
  line.uom_label = item.uom_id[1];
  if (!line.name || line.name === line.lastAutoName) line.name = item.description_purchase || item.display_name;
  line.lastAutoName = line.name;
  document.querySelector("#lines-box").innerHTML = linesTable();
  document.querySelector(`[data-line="${i}"][data-field="product_qty"]`)?.focus();
}

menu.addEventListener("mousedown", (event) => {
  event.preventDefault(); // jaga fokus tetap di field sampai pilihan diproses
  const item = event.target.closest("[data-lookup-item]");
  if (item) chooseItem(Number(item.dataset.lookupItem));
});
window.addEventListener("resize", closeLookup);
window.addEventListener("scroll", (event) => {
  if (!menu.contains(event.target)) closeLookup();
}, true);

app.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const id = Number(el.dataset.id) || null;
  const button = HEADER_BUTTONS.find(([a]) => a === action);

  if (action === "open") location.hash = `#/pr/${id}`;
  else if (action === "new") {
    form = null;
    location.hash = "#/new";
  } else if (action === "refresh") route();
  else if (action === "discard") form = null;
  else if (action === "scroll") {
    event.preventDefault();
    document.getElementById(el.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action === "add-line") {
    form.lines.push(emptyLine());
    document.querySelector("#lines-box").innerHTML = linesTable();
  } else if (action === "remove-line") {
    const [removed] = form.lines.splice(Number(el.dataset.line), 1);
    if (removed?.id) form.removed.push(removed.id);
    if (!form.lines.length) form.lines.push(emptyLine());
    document.querySelector("#lines-box").innerHTML = linesTable();
  } else if (action === "save") {
    const saved = await guarded(el, persist);
    if (saved) {
      const wasNew = !form.id;
      form = null;
      toast(wasNew ? "Purchase Request dibuat." : "Perubahan disimpan.");
      if (wasNew) location.hash = `#/pr/${saved}`;
      else route();
    }
  } else if (action === "confirm-po") {
    const ok = await guarded(el, () => call("purchase.order", "button_confirm", { ids: [id] }));
    if (ok !== undefined) {
      toast("Purchase Order dikonfirmasi.");
      route();
    }
  } else if (action === "make-rfq" || action === "rfq") {
    if (action === "rfq") document.querySelector("#rfq-create")?.scrollIntoView({ behavior: "smooth", block: "center" });
    else await makeRfq(el, id);
  } else if (action === "reject" && !window.confirm("Tolak Purchase Request ini?")) {
    /* dibatalkan pengguna */
  } else if (button?.[2]) {
    const ok = await guarded(el, async () => {
      if (form?.id === id) await persist(); // simpan perubahan draft sebelum mengubah status, seperti autosave Odoo
      return call("purchase.request", button[2], { ids: [id] });
    });
    if (ok !== undefined) {
      form = null;
      toast(ACTION_DONE[action]);
      route();
    }
  }
});

app.addEventListener("input", (event) => {
  const el = event.target;
  if (el.dataset.value) form.values[el.dataset.value] = el.value;
  else if (el.dataset.line !== undefined) {
    const line = form.lines[Number(el.dataset.line)];
    line[el.dataset.field] = el.value;
    if (el.dataset.field === "text") runLookup(el, 250);
    if (el.dataset.field === "estimated_cost") {
      const totalBox = document.querySelector("#total");
      if (totalBox) totalBox.textContent = money(form.lines.reduce((s, l) => s + Number(l.estimated_cost || 0), 0), ctx.company.currency_id?.[1]);
    }
  } else if (el.dataset.lookup === "vendor") {
    vendorChoice = null;
    runLookup(el, 250);
  }
});

app.addEventListener("focusin", (event) => {
  if (event.target.dataset?.lookup) runLookup(event.target);
});

app.addEventListener("focusout", (event) => {
  if (!event.target.dataset?.lookup) return;
  setTimeout(() => {
    if (lookup && document.activeElement !== lookup.input) closeLookup();
  }, 120);
});

app.addEventListener("keydown", (event) => {
  const el = event.target;
  if (!el.dataset?.lookup) return;
  if (!lookup || lookup.input !== el) {
    if (event.key === "ArrowDown") runLookup(el);
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const count = lookup.items.length;
    if (count) {
      lookup.active = (lookup.active + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
      paintMenu();
      menu.children[lookup.active]?.scrollIntoView({ block: "nearest" });
    }
  } else if (event.key === "Enter") {
    event.preventDefault(); // jangan mengirim form; Enter memilih saran yang aktif
    chooseItem(lookup.active);
  } else if (event.key === "Escape") {
    closeLookup();
  }
});

app.addEventListener("change", (event) => {
  const el = event.target;
  if (el.dataset.change === "filter") {
    location.hash = el.value ? `#/?state=${el.value}` : "#/";
  }
});

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = event.target.dataset.form;
  const button = event.target.querySelector("button");
  if (kind === "connect") {
    const key = document.querySelector("#apikey").value.trim();
    if (!key) return;
    auth.set(key);
    await guarded(button, loadSession);
    if (!ctx.user) auth.clear();
    route();
  } else if (kind === "note") {
    const id = Number(event.target.dataset.id);
    const field = event.target.elements.note;
    const ok = await guarded(button, () =>
      call("purchase.request", "message_post", { ids: [id], body: field.value, message_type: "comment", subtype_xmlid: "mail.mt_note" }),
    );
    if (ok !== undefined) {
      field.value = "";
      loadMessages(id);
    }
  }
});

sessionBox.addEventListener("click", (event) => {
  if (event.target.dataset.action === "disconnect") {
    auth.clear();
    ctx.user = null;
    form = null;
    route();
  }
});

/* ---------- Router ---------- */

async function route() {
  if (!auth.key) {
    ctx.user = null;
    renderSession();
    renderConnect();
    return;
  }
  if (!ctx.user) {
    try {
      await loadSession();
    } catch (error) {
      auth.clear();
      renderSession();
      renderConnect();
      toast(error.message, "error");
      return;
    }
  }
  renderSession();
  const path = location.hash.replace(/^#/, "").split("?")[0] || "/";
  try {
    if (path === "/new") await renderForm(null);
    else if (path.startsWith("/pr/")) await renderForm(Number(path.slice(4)));
    else await renderList();
  } catch (error) {
    if (error instanceof OdooError && error.status === 401) {
      auth.clear();
      ctx.user = null;
      renderSession();
      renderConnect();
    }
    toast(error.message, "error");
  }
}

window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#/pr/") && !location.hash.startsWith("#/new")) form = null;
  route();
});
route();
