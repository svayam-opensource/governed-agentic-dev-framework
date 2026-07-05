#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# HERMETIC adopter smoke — NO token, NO org, NO network, NO docker. Stubs `gh`
# and drives the REAL gov binary over the LOCAL adopter surface (meta flags ·
# setup · org registry · validate · doctor · --gov-home) against the shipped
# content. Runs on EVERY PR (npm run test:adopter:smoke); complements the gated
# live journey. The board/issue lifecycle stays in the in-process e2e + live e2e.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TS_DIR="$(cd "$HERE/.." && pwd)"
CONTENT_DIR="$(cd "$TS_DIR/../../content" && pwd)"
PASS=0; FAIL=0
ok(){ printf '  \033[32m✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
die(){ printf '  \033[31m✗ %s\033[0m\n' "$*"; FAIL=$((FAIL+1)); exit 1; }
has(){ echo "$1" | grep -qF "$2" && ok "$3" || { echo "     got: $1"; die "$3 — missing: $2"; }; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"; mkdir -p "$BIN"
[ -f "$TS_DIR/lib/esm/cli/bin.js" ] || ( cd "$TS_DIR" && npm run build >/dev/null 2>&1 )

# a `gov` shim → the real built binary; a hermetic stub `gh`
printf '#!/usr/bin/env bash\nexec node "%s/lib/esm/cli/bin.js" "$@"\n' "$TS_DIR" > "$BIN/gov"
cat > "$BIN/gh" <<'GH'
#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "gh version 2.99.0 (stub-gh hermetic)"; exit 0; }
case "$*" in
  "api user --jq .login") echo "adopter-bot";;
  "api user"*) echo '{"login":"adopter-bot"}';;
  "auth status"*) echo "stub authenticated as adopter-bot";;
  *) : ;;   # any other gh call → benign no-op (smoke avoids real board/issue ops)
esac
exit 0
GH
chmod +x "$BIN/gov" "$BIN/gh"
export PATH="$BIN:$PATH"
export XDG_CONFIG_HOME="$WORK/config"   # isolate the registry from the real machine

echo "▶ meta flags (no workspace needed)"
has "$(gov --version)" "gov " "gov --version works without a workspace"
has "$(gov -v)" "gov " "gov -v works"
has "$(gov --help)" "command reference" "gov --help works without a workspace"

echo "▶ workspace-from-template + gov setup (hermetic)"
WS="$WORK/adopter-gov"; mkdir -p "$WS"; cp -R "$CONTENT_DIR"/. "$WS"/
( cd "$WS" && git init -q && git config user.email a@b.c && git config user.name a \
  && git remote add origin https://github.com/adopter-org/adopter-gov.git )
cat > "$WS/org-config.yaml" <<YAML
org_name: "Adopter Org"
org_short_name: "Adopter"
org_slug: "adopter"
gov_workspace: "$WS"
YAML
( cd "$WS" && gov setup --non-interactive >/dev/null 2>&1 || true )
grep -q 'github_org: "adopter-org"' "$WS/org-config.yaml" && ok "gov setup derived github_org from origin" || die "setup did not configure org-config"

echo "▶ org registry + resolution"
gov org add adopter-org "$WS" >/dev/null && gov org use adopter-org >/dev/null && ok "gov org add/use" || die "org add/use failed"
has "$(gov org list 2>&1)" "adopter-org" "gov org list shows the workspace"

echo "▶ validate + doctor through the CLI (shipped content)"
( cd "$WS" && git add -A && git commit -qm init >/dev/null 2>&1 )
if ( cd "$WS" && gov validate ) >"$WORK/val.log" 2>&1; then ok "gov validate passes on shipped content"; else tail -12 "$WORK/val.log"; die "gov validate failed on shipped content"; fi
has "$(gov doctor --gov-home "$WS" 2>&1 || true)" "adopter-gov" "gov doctor --gov-home resolves the workspace"

echo "▶ --gov-home override from an unrelated cwd"
has "$(cd /tmp && gov doctor --gov-home "$WS" 2>&1 || true)" "resolved" "--gov-home overrides cwd resolution"

printf '\n\033[1m═══ adopter-smoke (hermetic): %d passed, %d failed ═══\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
