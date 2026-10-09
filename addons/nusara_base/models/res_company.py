from odoo import _, models
from odoo.exceptions import UserError


class ResCompany(models.Model):
    _inherit = "res.company"

    def nusara_setup_indonesia(self):
        """Terapkan setup dasar Indonesia: negara, mata uang IDR, dan COA l10n_id.

        Dijalankan eksplisit (bukan otomatis saat instalasi modul) karena memuat COA
        baru menghapus COA lama. Karena itu ditolak untuk perusahaan yang sudah punya
        transaksi akuntansi. Aman dijalankan ulang pada perusahaan yang sudah beres.
        """
        country = self.env.ref("base.id")
        idr = self.env.ref("base.IDR")
        for company in self:
            if (
                company.chart_template == "id"
                and company.country_id == country
                and company.currency_id == idr
            ):
                continue
            if company._existing_accounting():
                raise UserError(
                    _(
                        "Perusahaan %s sudah punya transaksi akuntansi. Setup Indonesia "
                        "tidak dijalankan karena akan menghapus COA yang ada.",
                        company.name,
                    )
                )
            idr.sudo().active = True
            company.write({"country_id": country.id, "currency_id": idr.id})
            self.env["account.chart.template"].try_loading("id", company)
            # Price list bawaan (tanpa aturan harga) ikut mata uang perusahaan. Odoo tidak
            # mengubahnya sendiri bila fitur price list belum aktif. Yang sudah punya aturan
            # harga sengaja tidak disentuh.
            self.env["product.pricelist"].sudo().with_context(active_test=False).search(
                [
                    ("company_id", "=", company.id),
                    ("item_ids", "=", False),
                    ("currency_id", "!=", idr.id),
                ]
            ).write({"currency_id": idr.id})
        return True
