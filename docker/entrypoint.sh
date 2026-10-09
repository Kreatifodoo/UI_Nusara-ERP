#!/bin/sh
# Menyuntikkan kata sandi master Odoo (admin_passwd) dari variabel lingkungan ADMIN_PASSWD.
# Odoo 19 tidak punya opsi CLI untuk ini, dan odoo.conf tidak bisa membaca variabel lingkungan.
# Tanpa ini kata sandi master tetap "admin", yang melindungi backup/hapus database lewat XML-RPC.
set -eu

if [ -n "${ADMIN_PASSWD:-}" ]; then
    RC="${TMPDIR:-/tmp}/odoo.conf"
    cp /etc/odoo/odoo.conf "$RC"
    printf '\nadmin_passwd = %s\n' "$ADMIN_PASSWD" >> "$RC"
    chmod 600 "$RC"
    export ODOO_RC="$RC"
fi

exec /entrypoint.sh "$@"
