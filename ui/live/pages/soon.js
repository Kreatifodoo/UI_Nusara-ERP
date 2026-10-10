// Halaman untuk menu yang belum terhubung ke Odoo. Sengaja jujur: tidak menampilkan data palsu seperti
// pada prototipe, melainkan menjelaskan statusnya dan menunjuk ke menu yang sudah bisa dipakai.
import { app, esc } from "../common.js";
import { LEAVES, findLeaf } from "../menu.js";

export async function render(sub) {
  const leaf = findLeaf(sub);
  if (!leaf) {
    app.innerHTML = '<p class="text-sm text-rose-600">Menu tidak ditemukan.</p>';
    return;
  }
  const connected = LEAVES.filter((l) => l.route)
    .map((l) => `<a href="#/${esc(l.route)}" class="inline-flex items-center px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2"></span>${esc(l.path.join(" › "))}</a>`)
    .join(" ");
  app.innerHTML = `
    <div class="text-sm text-gray-500 mb-2">${leaf.path.map(esc).join(" › ")}</div>
    <h1 class="text-2xl font-bold text-gray-900 mb-4">${esc(leaf.title)}</h1>
    <section class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center max-w-2xl">
      <div class="w-14 h-14 mx-auto rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4"><i class="fas fa-plug text-xl"></i></div>
      <h2 class="text-lg font-semibold text-gray-900">Halaman ini belum terhubung ke Odoo</h2>
      <p class="text-sm text-gray-600 mt-2">Desain menunya sudah ada di prototipe, tetapi belum ada halaman yang bertransaksi ke backend untuk menu ini.</p>
      ${leaf.odoo ? `<p class="text-sm text-gray-600 mt-3">Rencana sumber data di Odoo: <code class="px-1.5 py-0.5 bg-gray-100 rounded text-gray-800">${esc(leaf.odoo)}</code></p>` : ""}
    </section>
    <section class="mt-6 max-w-2xl">
      <div class="text-sm font-semibold text-gray-700 mb-2">Menu yang sudah terhubung ke Odoo</div>
      <div class="flex flex-wrap gap-2">${connected}</div>
    </section>`;
}
