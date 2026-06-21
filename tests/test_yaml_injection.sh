#!/usr/bin/env bash
# Regression test for #61 — YAML injection in yaml_set / yaml_quote.
# Exercises the two PoC vectors from the audit (findings C9, C10).
TEST_NAME="yaml_injection"
source "$(dirname "$0")/lib.sh"
source "$REPO_ROOT/scripts/lib.sh"
set +e   # scripts/lib.sh enables -e; the assertion harness manages its own errors

tmp="$(mktemp -d)"

# ── PoC 1 (C9): a malicious yaml_set VALUE must not rewrite another field ──────
# Without strenv, value `x" | .assigned_to = "attacker@evil.com` would be
# interpreted as a yq expression and rewrite assigned_to.
f="$tmp/p.yaml"
printf 'assigned_to: owner@good.com\nstatus: active\n' > "$f"
EVIL='x" | .assigned_to = "attacker@evil.com'
yaml_set "$f" cancellation_reason "$EVIL"
assert_eq "owner@good.com" "$(yaml_get "$f" assigned_to)" "injection value does NOT rewrite assigned_to"
assert_eq "active"         "$(yaml_get "$f" status)"      "injection value does NOT touch status"
assert_eq "$EVIL"          "$(yaml_get "$f" cancellation_reason)" "malicious value stored literally"
if python3 -c "import yaml; yaml.safe_load(open('$f'))" 2>/dev/null; then
  t_pass "file remains valid YAML after the injection attempt"
else
  t_fail "injection attempt corrupted the YAML"
fi

# ── PoC 2 (C10): yaml_quote must escape a trailing backslash ──────────────────
# Load the REAL yaml_quote out of seed.sh (not a copy) and exercise it. A title
# ending in '\' would, unescaped, escape the closing quote and swallow the next
# field.
eval "$(sed -n '/^yaml_quote()/,/^}/p' "$REPO_ROOT/scripts/seed.sh")"
if ! declare -F yaml_quote >/dev/null; then
  t_fail "could not load yaml_quote from seed.sh"
else
  title='Bad Title\'
  q="$(yaml_quote "$title")"
  g="$tmp/q.yaml"
  printf 'title: %s\nassigned_to: owner@good.com\n' "$q" > "$g"
  if python3 -c "import yaml; yaml.safe_load(open('$g'))" 2>/dev/null; then
    t_pass "trailing-backslash title produces valid YAML"
  else
    t_fail "trailing-backslash title broke YAML parsing"
  fi
  assert_eq "$title"         "$(yaml_get "$g" title)"       "trailing backslash round-trips"
  assert_eq "owner@good.com" "$(yaml_get "$g" assigned_to)" "trailing backslash does not swallow the next field"
fi

rm -rf "$tmp"
