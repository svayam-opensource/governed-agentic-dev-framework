# SPDX-License-Identifier: MIT
# NO PAID MODULE = TODAY (PRJ-121 intent 02, A1 / A19 hermetic half).
#
# An organization without @svayam/gov-check runs gov exactly as before: nothing is written under evidence/, and the
# only trace is ONE calm doctor line. The subscription decides (D6, 2026-10-13): there is no governance.yaml switch.
scenario "51 · no gov-check — gov runs as today; evidence off is one quiet line"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
mkdir -p "$HOME/.gov"
printf 'acme\t%s\n' "$REMOTE" > "$HOME/.gov/workspaces"
printf 'acme\n' > "$HOME/.gov/active"
# Nowhere for the loader to find a module: no GOV_CHECK_PATH, an empty install location.
unset GOV_CHECK_PATH
export GOV_CHECK_HOME="$WORLD/gov-check-none"

info "an unsubscribed org: doctor gives exactly one quiet notice, with no governance key (D6)"
out="$(cd "$REMOTE" && gov doctor 2>&1)"
printf '%s\n' "$out" > "$WORLD/doctor-off.out"
n="$(grep -c "Signed evidence is off" "$WORLD/doctor-off.out" || true)"
[ "$n" = "1" ] && pass "one notice (got $n)" || { fail "one notice (got $n)"; cat "$WORLD/doctor-off.out"; }

info "an old \`evidence:\` key changes nothing — gov does not read it (D6)"
printf '\nevidence: off\n' >> "$REMOTE/policies/governance.yaml"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm "old evidence key" )
out="$(cd "$REMOTE" && gov doctor 2>&1)"
printf '%s\n' "$out" > "$WORLD/doctor-key.out"
n="$(grep -c "Signed evidence is off" "$WORLD/doctor-key.out" || true)"
[ "$n" = "1" ] && pass "still one notice (got $n)" || { fail "still one notice (got $n)"; cat "$WORLD/doctor-key.out"; }

info "nothing was written as evidence, anywhere"
if find "$REMOTE" "$HOME" -path '*/node_modules' -prune -o -type d -name evidence -print 2>/dev/null | grep -q .; then
  fail "no evidence/ directory exists"
else
  pass "no evidence/ directory exists"
fi
