#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# HERMETIC adopter smoke — NO token, org, network, or Docker. Stubs `gh` and runs
# the REAL gov binary over the local adopter surface. DROP-IN like `npm test`:
# the runner builds the hermetic environment + helpers, then sources every
# e2e/smoke.d/*.sh in sorted order. Add a new condition = drop a new
# e2e/smoke.d/NN-name.sh file — no runner edit. Fragments share the shell, so
# they use the helpers (step/pass/fail/has) + context ($WS/$WORK/$CONTENT_DIR)
# and build the adopter state in order (10-… before 20-…).
set -uo pipefail   # NOT -e: fragments TALLY failures, they don't abort the run.
HERE="$(cd "$(dirname "$0")" && pwd)"
TS_DIR="$(cd "$HERE/.." && pwd)"
CONTENT_DIR="$(cd "$TS_DIR/../../content" && pwd)"
PASS=0; FAIL=0
step(){ printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
pass(){ printf '  \033[32m✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
fail(){ printf '  \033[31m✗ %s\033[0m\n' "$*"; FAIL=$((FAIL+1)); }
has(){ echo "$1" | grep -qF "$2" && pass "$3" || { echo "     got: $1"; fail "$3 — missing: $2"; }; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"; mkdir -p "$BIN"
[ -f "$TS_DIR/lib/esm/cli/bin.js" ] || ( cd "$TS_DIR" && npm run build >/dev/null 2>&1 )
printf '#!/usr/bin/env bash\nexec node "%s/lib/esm/cli/bin.js" "$@"\n' "$TS_DIR" > "$BIN/gov"
cat > "$BIN/gh" <<'GH'
#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "gh version 2.99.0 (stub-gh hermetic)"; exit 0; }
case "$*" in
  "api user --jq .login") echo "adopter-bot";;
  "api user"*) echo '{"login":"adopter-bot"}';;
  "auth status"*) echo "stub authenticated as adopter-bot";;
  *) : ;;
esac
exit 0
GH
chmod +x "$BIN/gov" "$BIN/gh"
export PATH="$BIN:$PATH"
export XDG_CONFIG_HOME="$WORK/config"   # isolate the registry from the real machine
WS="$WORK/adopter-gov"                  # fragments build this up (10-… creates, 20-… setup, …)
export WORK BIN WS CONTENT_DIR TS_DIR

shopt -s nullglob
for f in "$HERE"/smoke.d/*.sh; do
  step "$(basename "$f" .sh)"
  # shellcheck disable=SC1090
  source "$f"
done
shopt -u nullglob

printf '\n\033[1m═══ adopter-smoke (hermetic): %d passed, %d failed ═══\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
