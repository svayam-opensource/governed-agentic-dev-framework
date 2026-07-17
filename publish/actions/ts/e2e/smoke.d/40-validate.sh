# The shipped content must pass `gov validate` (the gate close runs).
( cd "$WS" && git add -A && git commit -qm init >/dev/null 2>&1 )
if ( cd "$WS" && gov validate ) >"$WORK/val.log" 2>&1; then
  pass "gov validate passes on shipped content"
else tail -12 "$WORK/val.log"; fail "gov validate failed on shipped content"; fi
