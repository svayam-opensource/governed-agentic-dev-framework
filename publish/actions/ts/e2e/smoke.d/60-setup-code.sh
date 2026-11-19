# THE SET-UP CODE AND THE SET-UP TRAIL (#391), through the real binary.
#
# The installer hands gov web's one-time code over in the environment; whichever gov runs first keeps it in
# ~/.gov/setup-state.json (owner-only), `gov doctor` shows the trail without the code, and the code is sent only to
# https://*.svayamtech.com. Hermetic: the only issuers used here are refused by the allow-list before any network.
SC_CODE="GS-smoke-0000-do-not-print"

# A machine with nothing set up: the code is kept, the trail says what is pending.
SC_HOME="$WORK/setup-code-home"; mkdir -p "$SC_HOME"
out="$(HOME="$SC_HOME" GOV_SETUP_CODE="$SC_CODE" GOV_SETUP_ISSUER="https://iam.svayamtech.com" gov doctor 2>&1 || true)"
has "$out" "set-up: client-installed done" "gov doctor shows the set-up trail, step by step"
has "$out" "governance-repo pending" "…with the step still to do"
has "$out" "a set-up signal for gov web is pending" "…and that a set-up signal waits"
case "$out" in *"$SC_CODE"*) fail "gov doctor printed the set-up code" ;; *) pass "gov doctor never prints the set-up code" ;; esac
SC_FILE="$SC_HOME/.gov/setup-state.json"
[ -f "$SC_FILE" ] && pass "the trail is kept in ~/.gov/setup-state.json" || fail "no ~/.gov/setup-state.json"
SC_MODE="$(stat -c %a "$SC_FILE" 2>/dev/null || stat -f %Lp "$SC_FILE" 2>/dev/null)"
[ "$SC_MODE" = "600" ] && pass "…owner-only (0600)" || fail "setup-state.json mode is $SC_MODE, not 600"
grep -q "$SC_CODE" "$SC_FILE" && pass "…holding the code until it is redeemed" || fail "the code was not kept"

# A machine that IS set up (the smoke workspace, registered by 30-org-registry), with a code naming an issuer off the
# allow-list: nothing is sent, the code is dropped, and one line says what to do.
out="$(GOV_SETUP_CODE="$SC_CODE" GOV_SETUP_ISSUER="https://collector.example.com" gov log 2>&1 </dev/null || true)"
has "$out" "not a Svayam address" "an issuer off the allow-list is refused, in one line"
case "$out" in *"$SC_CODE"*) fail "the refusal printed the set-up code" ;; *) pass "…which never prints the code" ;; esac
grep -q "$SC_CODE" "$HOME/.gov/setup-state.json" 2>/dev/null && fail "an unsendable code was kept" || pass "…and the unsendable code is not kept"
has "$(gov doctor 2>&1 || true)" "machine-env done" "a set-up machine reads machine-env done"
