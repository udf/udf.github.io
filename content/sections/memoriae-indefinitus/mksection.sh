#!/usr/bin/env bash
set -o noclobber

date "+%Y-%m-%d" -d "$1" || exit 1

filename="$1.md"
cat > "$filename" << EOF
---
fnheader: datefmt
---

EOF

$VISUAL $filename &!