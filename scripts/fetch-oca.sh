#!/bin/sh
# Mengambil modul OCA sesuai oca.lock (commit terkunci) ke folder tujuan.
# Pemakaian: scripts/fetch-oca.sh [oca.lock] [folder-tujuan]
set -eu

LOCK="${1:-oca.lock}"
DEST="${2:-oca}"

mkdir -p "$DEST"

grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$LOCK" | while read -r repo sha; do
    dir="$DEST/$repo"
    if [ ! -d "$dir/.git" ]; then
        git init -q "$dir" </dev/null
        git -C "$dir" remote add origin "https://github.com/OCA/$repo.git" </dev/null
    fi
    if [ "$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null || true)" = "$sha" ]; then
        echo "ok      $repo @ $sha"
        continue
    fi
    git -C "$dir" fetch -q --depth 1 origin "$sha" </dev/null
    git -C "$dir" checkout -q --detach FETCH_HEAD </dev/null
    echo "fetched $repo @ $sha"
done
