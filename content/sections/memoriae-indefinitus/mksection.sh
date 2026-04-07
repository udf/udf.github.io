#!/usr/bin/env bash
set -o noclobber

if [ -z "$1" ]; then
  date_str=$(date "+%Y-%m-%d")
else
  date_str=$(date "+%Y-%m-%d" -d "$1") || exit 1
fi

filename="$date_str.md"
cat > "$filename" << EOF
---
---

EOF

$VISUAL $filename &!
