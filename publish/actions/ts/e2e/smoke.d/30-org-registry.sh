# The CLI-local multi-home registry (add/use/list).
gov org add adopter-org "$WS" >/dev/null 2>&1 && gov org use adopter-org >/dev/null 2>&1 \
  && pass "gov org add/use" || fail "org add/use failed"
has "$(gov org list 2>&1)" "adopter-org" "gov org list shows the workspace"
