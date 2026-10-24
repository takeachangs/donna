#!/usr/bin/env bash
# Re-mirror docs.boson.ai + tutorial into this folder. Run from anywhere.
set -e; cd "$(dirname "$0")"
curl -sf https://docs.boson.ai/llms.txt -o llms.txt
grep -oE 'https://docs\.boson\.ai/[^)]+\.md' llms.txt | sort -u | while read -r u; do
  p="${u#https://docs.boson.ai/}"; mkdir -p "$(dirname "$p")"; curl -sf "$u" -o "$p" || echo "FAIL $u"; done
curl -sf https://docs.boson.ai/openapi.json -o openapi.json
mkdir -p tutorial; b=https://raw.githubusercontent.com/boson-ai/Higgs-Realtime-Tutorial/main
curl -sf $b/README.md -o tutorial/README.md
for i in 0 1 2 3 4 5 6 7; do curl -sf $b/docs/part-$i.md -o tutorial/part-$i.md || echo "FAIL part-$i"; done
echo "synced $(find . -name '*.md' | wc -l | tr -d ' ') md files; INDEX.md 'All pages' section may need regenerating if llms.txt changed"
