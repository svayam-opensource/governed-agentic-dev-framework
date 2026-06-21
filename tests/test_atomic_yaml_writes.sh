#!/usr/bin/env bash
# Regression test for #60 — lock + atomic writes for registry.yaml/project.yaml.
# Guards:
#   1) atomic_write replaces content atomically, leaving no temp file behind;
#   2) concurrent yaml_set never corrupts or truncates the file;
#   3) concurrent yaml_set of distinct keys loses no update — when flock is
#      available (the helper documents a graceful no-lock degrade without it).
TEST_NAME="atomic_yaml_writes"
source "$(dirname "$0")/lib.sh"
source "$REPO_ROOT/scripts/lib.sh"
set +e   # scripts/lib.sh enables -e; the assertion harness manages its own errors

tmp="$(mktemp -d)"

# ── 1) atomic_write: exact content + no temp file left behind ─────────────────
f="$tmp/a.txt"
printf 'before\n' > "$f"
printf 'after-1\nafter-2\n' | atomic_write "$f"
assert_eq "after-1
after-2" "$(cat "$f")" "atomic_write replaces content exactly"
leftover="$(ls "$tmp"/a.txt.* 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "0" "$leftover" "atomic_write leaves no temp file behind"

# ── 2) concurrency: file is never corrupted/truncated ─────────────────────────
y="$tmp/reg.yaml"
printf 'base: keep\n' > "$y"
N=24
for i in $(seq 1 "$N"); do ( yaml_set "$y" "k$i" "v$i" ) & done
wait
if python3 -c "import yaml; yaml.safe_load(open('$y'))" 2>/dev/null; then
  t_pass "file remains valid YAML after $N concurrent writers"
else
  t_fail "file corrupted/truncated by concurrent writers"
fi
assert_eq "keep" "$(yaml_get "$y" base)" "pre-existing key survives the write storm"
noleft="$(ls "$y".* 2>/dev/null | grep -v '\.lock$' | wc -l | tr -d ' ')"
assert_eq "0" "$noleft" "no temp write files left after concurrency"

# ── 3) no lost update across distinct keys (requires flock) ───────────────────
if command -v flock >/dev/null 2>&1; then
  missing=0
  for i in $(seq 1 "$N"); do
    [[ "$(yaml_get "$y" "k$i")" == "v$i" ]] || missing=$((missing+1))
  done
  assert_eq "0" "$missing" "all $N concurrent distinct-key writes survived (no lost update)"
else
  t_skip "no-lost-update assertion — flock absent; helper degrades to no-lock by design"
fi

rm -rf "$tmp"
