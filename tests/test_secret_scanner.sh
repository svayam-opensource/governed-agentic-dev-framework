#!/usr/bin/env bash
# Regression test for #63 — secret/PII scanner (POL-143) blocks known patterns.
# Fixtures are written to a temp dir (not this repo), and credential shapes are
# assembled at runtime / from split string literals so this test file itself
# contains no scannable secret.
TEST_NAME="secret_scanner"
source "$(dirname "$0")/lib.sh"

SCANNER="$REPO_ROOT/scripts/validate/check_secrets.py"
if [[ ! -f "$SCANNER" ]]; then
  t_fail "scripts/validate/check_secrets.py missing"
else
  tmp="$(mktemp -d)"

  # 'ghp_' + 36 alnums — assembled at runtime (no literal token in this source).
  GH_TOK="ghp_$(python3 -c 'print("A"*36)')"
  # '-----BEGIN ... PRIVATE KEY-----' — split so "PRIVATE KEY" is not contiguous here.
  PK_HDR="-----BEGIN RSA PRIVATE ""KEY-----"

  # 1) a known token shape is flagged (exit 1)
  printf 'GITHUB_TOKEN=%s\n' "$GH_TOK" > "$tmp/leak.env"
  python3 "$SCANNER" "$tmp" >/dev/null 2>&1
  assert_exit_code 1 $? "scanner flags a GitHub-token fixture"

  # 2) inline allowlist pragma suppresses the finding (exit 0)
  printf 'GITHUB_TOKEN=%s  # %s\n' "$GH_TOK" "pragma: allowlist secret" > "$tmp/leak.env"
  python3 "$SCANNER" "$tmp" >/dev/null 2>&1
  assert_exit_code 0 $? "allowlist pragma suppresses the finding"

  # 3) a private-key block is flagged (exit 1)
  rm -f "$tmp/leak.env"
  printf '%s\nMIIxyz\n-----END RSA PRIVATE KEY-----\n' "$PK_HDR" > "$tmp/id_rsa"
  python3 "$SCANNER" "$tmp" >/dev/null 2>&1
  assert_exit_code 1 $? "scanner flags a private-key block"

  # 4) a clean tree passes (exit 0)
  rm -f "$tmp/id_rsa"
  printf 'hello: world\n' > "$tmp/ok.yaml"
  python3 "$SCANNER" "$tmp" >/dev/null 2>&1
  assert_exit_code 0 $? "clean tree passes"

  # 5) acceptance: the scanner is wired into validate/run.py
  if grep -q 'check_secrets' "$REPO_ROOT/scripts/validate/run.py"; then
    t_pass "check_secrets registered in validate/run.py"
  else
    t_fail "check_secrets NOT registered in validate/run.py"
  fi

  rm -rf "$tmp"
fi
