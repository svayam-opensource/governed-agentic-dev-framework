# SPDX-License-Identifier: MIT
# NO PAID MODULE = TODAY (PRJ-121 intent 02, A1 / A19 hermetic half).
#
# An organization without @svayam/gov-check runs gov exactly as before: nothing is written under evidence/, and the
# only trace is ONE calm doctor line — and only when the organization said it wants evidence.
scenario "51 · no gov-check — gov runs as today; evidence off is one quiet line"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
mkdir -p "$HOME/.gov"
printf 'acme\t%s\n' "$REMOTE" > "$HOME/.gov/workspaces"
printf 'acme\n' > "$HOME/.gov/active"
# Nowhere for the loader to find a module: no GOV_CHECK_PATH, an empty install location.
unset GOV_CHECK_PATH
export GOV_CHECK_HOME="$WORLD/gov-check-none"

info "an org that never asked for evidence: doctor says it is off, calmly"
out="$(cd "$REMOTE" && gov doctor 2>&1)"
printf '%s\n' "$out" > "$WORLD/doctor-off.out"
grep -E "evidence" "$WORLD/doctor-off.out" | grep -qE "off" \
  && pass "the evidence row says off" || { fail "the evidence row says off"; cat "$WORLD/doctor-off.out"; }
grep -E "evidence" "$WORLD/doctor-off.out" | grep -qiE "subscription \(https" \
  && fail "no subscription notice for an org that did not ask" || pass "no subscription notice for an org that did not ask"

info "an org that wants evidence but has no module: exactly one quiet notice on the doctor surface"
printf '\nevidence: enabled\n' >> "$REMOTE/policies/governance.yaml"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm "want evidence" )
out="$(cd "$REMOTE" && gov doctor 2>&1)"
printf '%s\n' "$out" > "$WORLD/doctor-on.out"
n="$(grep -c "Signed evidence is off" "$WORLD/doctor-on.out" || true)"
[ "$n" = "1" ] && pass "one notice (got $n)" || { fail "one notice (got $n)"; cat "$WORLD/doctor-on.out"; }

info "nothing was written as evidence, anywhere"
if find "$REMOTE" "$HOME" -path '*/node_modules' -prune -o -type d -name evidence -print 2>/dev/null | grep -q .; then
  fail "no evidence/ directory exists"
else
  pass "no evidence/ directory exists"
fi
