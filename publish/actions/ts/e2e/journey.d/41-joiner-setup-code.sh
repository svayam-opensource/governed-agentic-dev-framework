# SPDX-License-Identifier: MIT
# SCENARIO 41 — a JOINER who came from gov web's Install page, with a one-time SET-UP CODE (#391).
#
# The installer hands GOV_SETUP_CODE / GOV_SETUP_ISSUER to gov in the environment. First-run keeps them in
# ~/.gov/setup-state.json and, once the governance repository is in place and the workspace folders exist, sends the
# code — before the closing offer, which may hand the terminal to an agent for a whole session.
#
# HERMETIC: the issuer is OFF the allow-list (https://*.svayamtech.com), so gov refuses to send before any network,
# and says so in one line. That proves the wiring — the milestone is reached, the trail is complete, the code is never
# printed — without a request leaving the machine. The redeem call itself is unit-tested against a stubbed fetch.
scenario "41 · joiner with a gov web set-up code — trail recorded, code never shown, issuer allow-listed"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
approve_agents "$REMOTE" "ibm-bob" "claude-code"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm agents )

SC_CODE="GS-journey-0000-do-not-print"
export GOV_SETUP_CODE="$SC_CODE" GOV_SETUP_ISSUER="https://collector.example.com"
drive "$(conv <<C
> Select \\(A/B/C\\)
< B
> Q1 - What is the Github Organization ID
< acme
> Q2 - What is the name of your org
< acme-gov
~ 120
> start work now
< n
C
)" gov
unset GOV_SETUP_CODE GOV_SETUP_ISSUER

saw "it joins" "Joining acme."
saw "the set-up step is reached once the repository is in place — and an issuer off the allow-list is refused" "not a Svayam address"
never "the set-up code is never printed" "$SC_CODE"
SC_FILE="$HOME/.gov/setup-state.json"
exists "the trail is kept in ~/.gov/setup-state.json" "$SC_FILE"
grep -q '"id": "governance-repo",[[:space:]]*"status": "done"' <(tr -d '\n' < "$SC_FILE" | sed 's/  */ /g') \
  && pass "governance-repo is recorded done" || { fail "governance-repo is recorded done"; cat "$SC_FILE"; }
grep -q '"id": "machine-env",[[:space:]]*"status": "done"' <(tr -d '\n' < "$SC_FILE" | sed 's/  */ /g') \
  && pass "machine-env is recorded done — the workspace folders were made" || { fail "machine-env is recorded done"; cat "$SC_FILE"; }
exists "the work root exists" "$HOME/.gov/acme/projects"
grep -q "$SC_CODE" "$SC_FILE" && fail "an unsendable code was kept" || pass "the unsendable code is not kept"

info "doctor shows the trail, never the code"
out="$(gov doctor 2>&1 || true)"
case "$out" in *"set-up: client-installed done"*) pass "doctor has the set-up row" ;; *) fail "doctor has the set-up row"; printf '%s\n' "$out" | tail -5 ;; esac
case "$out" in *"$SC_CODE"*) fail "doctor printed the code" ;; *) pass "doctor never prints the code" ;; esac
