# SPDX-License-Identifier: MIT
# SCENARIO 3 — the founding adopter, choosing IBM Bob as the organization's default.
#
# The path that has never once completed on a container: every walk so far pivoted to
# JOINER because the org used for testing was already governed (#197 doing its job). So the
# agent-approval question, the starter project and the adopter's closing offer have only
# ever been exercised by unit tests that inject the whole world.
scenario "30 · adopter founds an org, IBM Bob as the default"

export GH_STUB_LOGIN="acme"          # the org we adopt for, and the board owner
export GH_STUB_GOVERNED=""           # nobody has adopted for it yet

# The vendor installer, doubled at `curl` — the command gov runs is unchanged.
cat > "$WORLD/bin/curl" <<EOF
#!/usr/bin/env bash
case "\$*" in
  *bob.ibm.com/download/bobshell.sh*)
    printf 'cp %s %s/bin/bob && chmod +x %s/bin/bob\n' "$HERE/stub/agent-double" "$WORLD" "$WORLD" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$WORLD/bin/curl"

drive "$(conv <<'C'
> Select \(A/B/C\)
< A
# NINE QUESTIONS, ALL BEFORE ANYTHING IS CREATED (#215). Names first, identifiers
# second, and the repository is created only after Q9 — so this block is the whole
# interview, uninterrupted, and the `creating acme/acme-gov` line comes after it.
~ 240
> Q1 - What is full legal name
< Acme Incorporated
# Q2 defaults to the legal name just given, so Enter is the honest answer here.
> Q2 - What is short name
<
> Q3 - What is the Github Organization ID
< acme
# The #197 probe runs here, the instant the org is known — before any question that
# only a creator could answer.
~ 240
> Q4 - What would you like the name of your new governance repo
< acme-gov
> Q5 - What would you like the identifier
< ACME
> Q6 - Default branch to be used for production
<
> Q7 - Default branch to be used for development
<
# ANSWERED, not defaulted: the container may have no git user.email, and an empty
# default against an email rule is a question that cannot be answered by pressing
# Enter — which in a pty driver is a hang, not a failure.
> Q8 - What is policy owner email
< adopter@acme.test
> Q9 - What should be the policy effective date
<
~ 240
# Q10 — THE AGENT POLICY, NOW INSIDE THE INTERVIEW AND BEFORE THE CLONE. It used to be asked
# after the repository existed, which put the one genuine policy decision in adoption on the
# far side of the irreversible step. One agent at a time now: the old shape was a
# space-separated list, where a typo silently changed the organization's default.
> default for your organization
< 8
# Additions, one number each, until a blank finishes. Blank straight away is the single-agent
# org — a default by definition, and the case a joiner is never asked to choose in.
> add any other AI agent
<
# And it is read back before it becomes a rule.
> happy with your AI agent selection
< y
> Create it\? \[y/N\]
< y
~ 240
> review your governance policies now
< n
C
)" gov

info "#215 — every question precedes the work, and the work is reported back"
saw "the interview opens with a header that says what is about to happen" "Adopting Governance Framework for your organization"
# ORDER, not merely presence: a human's own words for their organization come before
# the identifier a machine needs. Asserted by position, because both lines exist
# either way and only the order is the change.
q1="$(grep -n 'Q1 - What is full legal name' "$PLAIN" | head -1 | cut -d: -f1)"
q3="$(grep -n 'Q3 - What is the Github Organization ID' "$PLAIN" | head -1 | cut -d: -f1)"
create="$(grep -n 'creating acme/acme-gov' "$PLAIN" | head -1 | cut -d: -f1)"
q9="$(grep -n 'happy with your AI agent selection' "$PLAIN" | head -1 | cut -d: -f1)"
[ -n "$q1" ] && [ -n "$q3" ] && [ "$q1" -lt "$q3" ] \
  && pass "the legal NAME is asked before the GitHub identifier" \
  || fail "the legal NAME is asked before the GitHub identifier"
# The whole point of #215: nothing irreversible happens until the last answer is in.
[ -n "$q9" ] && [ -n "$create" ] && [ "$q9" -lt "$create" ] \
  && pass "nothing is created until the LAST question (Q10's confirmation) is answered" \
  || fail "nothing is created until the LAST question (Q10's confirmation) is answered"
saw "and the closing block names the repository it made" "A new governance repo is created for your organization at"
saw "with the local path, which is what the adopter needs next" "/.gov/acme/gov_repo"
never "the mid-flow echoes are gone — they are in the closing block now" "(from origin)"

info "#196 — the agent policy is asked one agent at a time, and read back"
saw "the default is its own question" "default for your organization"
saw "additions are offered one at a time" "add any other AI agent to the allowed list"
saw "the selection is read back before it becomes a rule" "You have selected"
saw "naming the default explicitly" "'IBM Bob' (default)"
saw "and it says where the answer can be changed" "llm-governance.md"
never "the old space-separated shape is gone" "separated by spaces"

info "founding"
saw "it creates the repository from the framework template" "creating acme/acme-gov"
gh_ran "and does so through gh, with --template" "repo create acme/acme-gov --template"
exists "the workspace lands where every tool looks" "$HOME/.gov/acme/gov_repo/org-config.yaml"

info "#196 — the org decides which agents it allows, during adoption"
says "the question is asked" "Which AI agents may be used in this organization"
saw_re "and the answer is written to the policy, not remembered" "approved_agents|IBM Bob"
runs grep -q "ibm-bob" "$HOME/.gov/acme/gov_repo/knowledge/policies/llm-governance.md" \
  && pass "ibm-bob is in llm-governance.md — the approved list is a file, not a memory" \
  || fail "ibm-bob was not written to llm-governance.md"

# ONE WRITER, AND NO FALSE ALARM ABOUT IT.
#
# A walk on 2026-09-12 ended a SUCCESSFUL adoption with "✗ Could not write llm-governance.md —
# approve them later with `gov agent approve <id>`". Nothing had failed. The list is recorded
# inside `createWorkspace`, before its own commit (#196); a second writer then re-rendered an
# identical block, and `withApprovedAgents` returns null when nothing would change — which the
# caller read as a write failure. The assertion above could not catch it, because the file WAS
# correct; only the message was wrong. A false alarm on the one governance decision in adoption
# is worse than silence: the adopter's next move is to repair something that is not broken.
never "no false alarm about writing the policy" "Could not write llm-governance.md"
saw   "and the recording is reported once, by the writer that can commit it" \
      "approved agent(s) in knowledge/policies/llm-governance.md"

info "#193 — no placeholder survives into the adopter's own policies"
never "<ORG_NAME> is resolved" "<ORG_NAME>"
never "and so is <GITHUB_ORG>" "<GITHUB_ORG>"

info "#186 — the closing screen is the founder's, and it is the truth"
saw "the ADOPTER's next steps" "Install complete — for ADOPTERS"
never "not the joiner's" "Install complete — for JOINERS"
saw_re "#203 — and it offers the review rather than printing three steps to retype" "review your governance policies now"
