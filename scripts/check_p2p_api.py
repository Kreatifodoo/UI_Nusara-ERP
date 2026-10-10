#!/usr/bin/env python3
"""Uji regresi alur Procure-to-Pay lewat API JSON-2, dengan panggilan yang sama seperti UI Nusara.

Alur: Purchase Request -> RFQ (wizard) -> PO -> penerimaan sebagian + backorder -> penerimaan sisa ->
tagihan vendor -> bayar sebagian -> bayar sisa. Juga menjaga jebakan harga manual PO (lihat
docs/DECISIONS.md, D10).

Skrip ini MENULIS data (PR, PO, tagihan, pembayaran), jadi hanya jalankan pada database uji.
Butuh data contoh dari scripts/seed_demo.py dan API key milik pengguna uji.

    NUSARA_API_KEY=... python3 scripts/check_p2p_api.py --yes [--url http://127.0.0.1:8080]
"""

import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.request


class Api:
    def __init__(self, base, key):
        self.base, self.key = base.rstrip("/"), key

    def call(self, model, method, **params):
        request = urllib.request.Request(
            f"{self.base}/json/2/{model}/{method}",
            data=json.dumps(params).encode(),
            headers={"Content-Type": "application/json; charset=utf-8", "Authorization": f"bearer {self.key}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            body = error.read().decode()
            try:
                body = json.loads(body).get("message", body)
            except ValueError:
                pass
            raise RuntimeError(f"{model}.{method} -> HTTP {error.code}: {str(body)[:200]}") from None

    def read(self, model, record_id, fields):
        return self.call(model, "read", ids=[record_id], fields=fields)[0]

    def search(self, model, domain, fields, **extra):
        return self.call(model, "search_read", domain=domain, fields=fields, **extra)


failures = []


def check(condition, message):
    print(("  ok    " if condition else "  GAGAL ") + message)
    if not condition:
        failures.append(message)


def step(title):
    print(f"\n== {title}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=os.environ.get("NUSARA_URL", "http://127.0.0.1:8080"))
    parser.add_argument("--yes", action="store_true", help="konfirmasi bahwa database tujuan adalah database uji")
    args = parser.parse_args()
    key = os.environ.get("NUSARA_API_KEY", "")
    if not key or not args.yes:
        sys.exit("Isi NUSARA_API_KEY dan tambahkan --yes. Skrip ini menulis data; pakai database uji.")
    api = Api(args.url, key)

    product = (api.search("product.product", [["name", "=", "Bahan Baku Nusara"]], ["uom_id"], limit=1) or [None])[0]
    vendor = (api.search("res.partner", [["name", "=", "PT Pemasok Nusantara"]], ["id"], limit=1) or [None])[0]
    if not product or not vendor:
        sys.exit("Data contoh belum ada. Jalankan scripts/seed_demo.py dulu.")
    uom = product["uom_id"][0]

    step("Purchase Request -> RFQ lewat wizard")
    [request_id] = api.call("purchase.request", "create", vals_list=[{
        "description": "Uji regresi P2P",
        "line_ids": [[0, 0, {"product_id": product["id"], "product_uom_id": uom, "product_qty": 10.0, "name": "Bahan Baku Nusara"}]],
    }])
    api.call("purchase.request", "button_to_approve", ids=[request_id])
    api.call("purchase.request", "button_approved", ids=[request_id])
    check(api.read("purchase.request", request_id, ["state"])["state"] == "approved", "PR disetujui")
    line_ids = [r["id"] for r in api.search("purchase.request.line", [["request_id", "=", request_id]], ["id"])]
    context = {"active_model": "purchase.request.line", "active_ids": line_ids, "active_id": line_ids[0]}
    wizard = api.call("purchase.request.line.make.purchase.order", "create", vals_list=[{"supplier_id": vendor["id"]}], context=context)
    api.call("purchase.request.line.make.purchase.order", "make_purchase_order", ids=wizard, context=context)
    order_id = api.search("purchase.order", [["order_line.purchase_request_lines.request_id", "=", request_id]], ["id"])[0]["id"]
    order = api.read("purchase.order", order_id, ["state", "amount_untaxed", "amount_tax", "amount_total", "currency_id"])
    check(order["state"] == "draft", "RFQ berstatus draft")
    check(order["amount_untaxed"] == 1_000_000.0, f"harga vendor terbawa ke RFQ (10 x 100.000): {order['amount_untaxed']}")
    check(order["amount_tax"] > 0 and abs(order["amount_total"] - order["amount_untaxed"] - order["amount_tax"]) < 0.01, "PPN dihitung dan total konsisten")

    step("Harga manual PO tidak tertimpa saat header ditulis ulang (jebakan technical_price_unit)")
    manual_id = api.call("purchase.order", "create", vals_list=[{
        "partner_id": vendor["id"],
        "order_line": [[0, 0, {"product_id": product["id"], "name": "Harga manual", "product_qty": 2.0, "product_uom_id": uom}]],
    }])[0]
    manual_line = api.search("purchase.order.line", [["order_id", "=", manual_id]], ["id", "price_unit"])[0]
    check(manual_line["price_unit"] == 100_000.0, "harga otomatis dari daftar harga vendor")
    api.call("purchase.order.line", "write", ids=[manual_line["id"]], vals={"price_unit": 175_000.0})
    api.call("purchase.order", "write", ids=[manual_id], vals={"partner_id": vendor["id"]})
    after = api.read("purchase.order.line", manual_line["id"], ["price_unit"])
    check(after["price_unit"] == 175_000.0, "harga manual bertahan setelah header ditulis ulang")

    step("Konfirmasi PO dan penerimaan sebagian dengan backorder")
    api.call("purchase.order", "button_confirm", ids=[order_id])
    check(api.read("purchase.order", order_id, ["state"])["state"] == "purchase", "PO dikonfirmasi")
    picking = api.search("stock.picking", [["purchase_id", "=", order_id]], ["id", "state"])[0]
    check(picking["state"] == "assigned", "penerimaan otomatis berstatus Siap")
    move = api.search("stock.move", [["picking_id", "=", picking["id"]]], ["id"])[0]
    api.call("stock.move", "write", ids=[move["id"]], vals={"quantity": 4.0, "picked": True})
    action = api.call("stock.picking", "button_validate", ids=[picking["id"]])
    check(isinstance(action, dict) and action.get("res_model") == "stock.backorder.confirmation", "validasi sebagian meminta konfirmasi backorder")
    wizard = api.call("stock.backorder.confirmation", "create", vals_list=[{}], context=action["context"])
    api.call("stock.backorder.confirmation", "process", ids=wizard, context=action["context"])
    state = api.read("purchase.order", order_id, ["receipt_status", "invoice_status", "incoming_picking_count"])
    check(state["receipt_status"] == "partial" and state["incoming_picking_count"] == 2, "PO diterima sebagian, 2 penerimaan")
    check(state["invoice_status"] == "to invoice", "PO perlu ditagih setelah penerimaan")
    backorder = api.search("stock.picking", [["backorder_id", "=", picking["id"]]], ["id"])[0]
    backorder_move = api.search("stock.move", [["picking_id", "=", backorder["id"]]], ["id", "quantity"])[0]
    check(backorder_move["quantity"] == 6.0, "backorder berisi sisa 6")
    api.call("stock.move", "write", ids=[backorder_move["id"]], vals={"quantity": 6.0, "picked": True})
    check(api.call("stock.picking", "button_validate", ids=[backorder["id"]]) is True, "backorder divalidasi tanpa dialog")
    check(api.read("purchase.order", order_id, ["receipt_status"])["receipt_status"] == "full", "PO diterima penuh")

    step("Tagihan vendor")
    api.call("purchase.order", "action_create_invoice", ids=[order_id])
    bill_id = api.read("purchase.order", order_id, ["invoice_ids"])["invoice_ids"][-1]
    bill = api.read("account.move", bill_id, ["state", "move_type", "amount_total"])
    check(bill["state"] == "draft" and bill["move_type"] == "in_invoice", "tagihan vendor draft terbentuk")
    check(bill["amount_total"] == order["amount_total"], "total tagihan sama dengan total PO")
    try:
        api.call("account.move", "action_post", ids=[bill_id])
        check(False, "konfirmasi tanpa tanggal tagihan seharusnya ditolak")
    except RuntimeError as error:
        check("date is required" in str(error), "konfirmasi tanpa tanggal tagihan ditolak Odoo")
    api.call("account.move", "write", ids=[bill_id], vals={"invoice_date": datetime.date.today().isoformat(), "ref": "INV-REGRESI-001"})
    api.call("account.move", "action_post", ids=[bill_id])
    bill = api.read("account.move", bill_id, ["state", "payment_state", "amount_residual", "amount_total"])
    check(bill["state"] == "posted" and bill["payment_state"] == "not_paid", "tagihan terposting, belum dibayar")

    step("Pembayaran sebagian lalu pelunasan lewat wizard Register Payment")
    pay_context = {"active_model": "account.move", "active_ids": [bill_id]}

    def pay(amount):
        wizard_id = api.call("account.payment.register", "create", vals_list=[{}], context=pay_context)
        api.call("account.payment.register", "write", ids=wizard_id, vals={"amount": amount}, context=pay_context)
        return api.call("account.payment.register", "action_create_payments", ids=wizard_id, context=pay_context)

    pay(500_000.0)
    bill = api.read("account.move", bill_id, ["payment_state", "amount_residual"])
    check(bill["payment_state"] == "partial" and bill["amount_residual"] == bill_total(api, bill_id) - 500_000.0, "bayar sebagian: status partial, sisa berkurang")
    pay(bill["amount_residual"])
    bill = api.read("account.move", bill_id, ["payment_state", "amount_residual", "matched_payment_ids"])
    check(bill["payment_state"] == "paid" and bill["amount_residual"] == 0.0, "lunas: status paid, sisa 0")
    check(len(bill["matched_payment_ids"]) == 2, "dua pembayaran terkait tagihan")

    print("\n" + ("SEMUA LULUS" if not failures else f"{len(failures)} PEMERIKSAAN GAGAL"))
    sys.exit(1 if failures else 0)


def bill_total(api, bill_id):
    return api.read("account.move", bill_id, ["amount_total"])["amount_total"]


if __name__ == "__main__":
    main()
