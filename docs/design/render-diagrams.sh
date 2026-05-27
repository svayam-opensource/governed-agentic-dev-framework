#!/usr/bin/env bash
# Re-render the Mermaid sources in option-2-sequence-diagrams.md to
# diagrams/<use-case-id>.png. Run after editing any diagram's Mermaid source.
#
# Requires: npx (Node). Downloads @mermaid-js/mermaid-cli + a headless Chromium
# on first run. The diagrams render in document order; the IDS array below maps
# that order to file names — keep it in sync if you add/remove/reorder use cases.
set -euo pipefail
cd "$(dirname "$0")"

DOC="option-2-sequence-diagrams.md"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf '{ "args": ["--no-sandbox"] }\n' > "$TMP/pptr.json"

# Diagram IDs in the order they appear in the document.
IDS=(
  gov.init.1 gov.init.2
  gov.mgmt.1 gov.mgmt.2 gov.mgmt.3 gov.mgmt.4 gov.mgmt.5 gov.mgmt.6
  gov.dev.1 gov.dev.2 gov.dev.3 gov.dev.4 gov.dev.5 gov.dev.6
  gov.dev.7 gov.dev.8 gov.dev.9 gov.dev.10 gov.dev.11
  multi-user-parallel
)

echo "Rendering Mermaid blocks from $DOC ..."
npx -y @mermaid-js/mermaid-cli -i "$DOC" -o "$TMP/out.md" -e png -b white -p "$TMP/pptr.json"

i=1
for id in "${IDS[@]}"; do
  src="$TMP/out-$i.png"
  [ -f "$src" ] || { echo "ERROR: expected $src not produced (block count mismatch?)"; exit 1; }
  cp "$src" "diagrams/$id.png"
  i=$((i+1))
done

echo "Rendered ${#IDS[@]} diagrams to diagrams/"
echo "Note: topology.svg is hand-authored, not regenerated here."
