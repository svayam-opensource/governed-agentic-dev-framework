#!/usr/bin/env bash
# install.sh — install the `prj` CLI separately from workspace data
# (ADR-0001 Phase 4: un-vendor the tooling). After this, governance repos can
# carry pure data; the CLI lives once on your machine and finds the workspace.
#
# Usage:
#   ./install.sh                 # install to ~/.local  (bin + share)
#   PREFIX=/usr/local ./install.sh
#   ./install.sh --uninstall
#
# The installed `prj` is a thin wrapper that resolves the workspace (the
# governance repo) via $ADF_WORKSPACE, else the nearest ancestor directory
# containing org-config.yaml, then execs the real CLI under <prefix>/share/adf.
set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local}"
ADF_HOME="$PREFIX/share/adf"
BIN="$PREFIX/bin"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$BIN/prj"; rm -rf "$ADF_HOME"
  echo "Removed $BIN/prj and $ADF_HOME."
  exit 0
fi

[[ -f "$SRC/prj" && -d "$SRC/scripts" ]] \
  || { echo "install.sh: run from a workspace repo (needs ./prj and ./scripts)." >&2; exit 1; }

echo "Installing prj CLI → $ADF_HOME"
mkdir -p "$ADF_HOME" "$BIN"
cp "$SRC/prj" "$ADF_HOME/prj"
rm -rf "$ADF_HOME/scripts"
cp -R "$SRC/scripts" "$ADF_HOME/scripts"
chmod +x "$ADF_HOME/prj"
chmod +x "$ADF_HOME"/scripts/*.sh 2>/dev/null || true

# The on-PATH wrapper: discover the workspace, then exec the installed CLI.
cat > "$BIN/prj" <<WRAP
#!/usr/bin/env bash
# Installed prj wrapper (ADR-0001 Phase 4). Do not edit; re-run install.sh.
set -euo pipefail
ADF_HOME="$ADF_HOME"
if [[ -z "\${ADF_WORKSPACE:-}" ]]; then
  d="\$PWD"
  while [[ "\$d" != "/" ]]; do
    if [[ -f "\$d/org-config.yaml" ]]; then ADF_WORKSPACE="\$d"; break; fi
    d="\$(dirname "\$d")"
  done
fi
if [[ -z "\${ADF_WORKSPACE:-}" || ! -f "\${ADF_WORKSPACE:-}/org-config.yaml" ]]; then
  echo "prj: no workspace found here. cd into your governance repo, or set ADF_WORKSPACE." >&2
  exit 1
fi
export ADF_WORKSPACE
exec "\$ADF_HOME/prj" "\$@"
WRAP
chmod +x "$BIN/prj"

echo "Installed: $BIN/prj  (CLI under $ADF_HOME)"
case ":$PATH:" in
  *":$BIN:"*) : ;;
  *) echo "NOTE: $BIN is not on your PATH — add it (e.g. in ~/.zshrc):"
     echo "      export PATH=\"$BIN:\$PATH\"" ;;
esac
echo "Run 'prj' from inside a governance repo (any subdir), or set ADF_WORKSPACE."
