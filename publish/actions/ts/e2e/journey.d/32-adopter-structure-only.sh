# SPDX-License-Identifier: MIT
# SCENARIO 32 — the founding adopter who does NOT use AI agents.
#
# THE ORGANIZATION THIS FRAMEWORK COULD NOT SERVE. An org may want gov purely to put structure
# into its development process — projects, tasks, branches, knowledge, review — and never run an
# agent. Until 2026-09-28 it could not say so: the approval step refused an empty answer ("an
# organization with no approved agent cannot run any"), so it had to approve a tool it would never
# use, and then found nine vendor files — CLAUDE.md, GEMINI.md, .cursor/, .clinerules/ … — in every
# project directory with no explanation.
#
# The principle the code now expresses: FIXED BEHAVIOUR MUST BE COMPLETE ON ITS OWN; AGENTIC
# BEHAVIOUR IS ADDITIVE. So this scenario walks the whole thing — the answer, the file it lands in,
# the closing screen, and then `gov work` — and asserts as much about what is ABSENT as about what
# is said. 30 is the same journey with an agent; the two differ only in one answer.
scenario "32 · adopter founds an org that uses NO AI agents (structure-only)"

export GH_STUB_LOGIN="acme"          # the org we adopt for, and the board owner
export GH_STUB_GOVERNED=""           # nobody has adopted for it yet

# NO `curl` DOUBLE, AND NO AGENT ON PATH — deliberately, because this run must never reach an
# installer. 30 needs one; if this scenario ever does, something offered an install it should not
# have, and the missing double is what makes that a failure rather than a silent success.

drive "$(conv <<'C'
> Select \(A/B/C\)
< A
~ 240
> Q1 - What is full legal name
< Fixed Process Ltd
> Q2 - What is short name
<
> Q3 - What is the Github Organization ID
< acme
~ 240
> Q4 - What would you like the name of your new governance repo
< acme-gov
> Q5 - What would you like the identifier
< ACME
> Q6 - Default branch to be used for production
<
> Q7 - Default branch to be used for development
<
# Q8–Q10 — BOTH ROLES BY GITHUB HANDLE, THEN AN OPTIONAL CONTACT (adoption walk #1, 2026-10-07).
# Answered, not defaulted: the defaults are the gh login (which the container may not have) and the
# git email — an empty default against a handle rule is a hang in a pty driver, not a failure.
> Q8 - Who is the Policy Owner
< adopter
> Q9 - Who is the Check Owner
< adopter
> Q10 - What contact email
< adopter@acme.test
# Q11 — THE GOVERNANCE POSTURE (W2-Q6): Enter is soft, the default, and asks nothing more.
> Q11 - What governance posture
<
~ 240
# Q12 — ANSWERED WITH THE WORD, not the number. The numbered option is asserted on the screen
# below; typing `none` is the answer someone gives who read the list rather than counting it, and
# it must work for the same reason `ibm-bob` does.
> default for your organization
< none
# Read back in the organization's own terms — and NOT asked "would you like to add any other AI
# agent?", which would suggest the answer had not taken.
> happy with this
< y
> Create it\? \[y/N\]
< y
~ 240
> review its policies now
< n
C
)" gov

info "Q12 offers 'none' as an ANSWER, not as a way past the question"
saw "the option is on the menu, numbered like the rest" "none — this organization does not use AI agents"
says "and it says what gov still does, which is everything else" "projects, tasks, branches, knowledge, review"
never "it is never presented as skipping the question" "skip this"
says "the decision is read back before it becomes a rule" "You have selected — NO AI agents for your organization"
never "and the additions question is not asked at all" "add any other AI agent to the allowed list"

info "the decision is written down, not remembered"
saw "gov says where it landed" "authorized_agents: none"
runs grep -q "^authorized_agents: none" "$HOME/.gov/acme/gov_repo/policies/governance.yaml" \
  && pass "policies/governance.yaml carries the decision as a scalar — an answer, not an empty block" \
  || fail "authorized_agents: none was not written to policies/governance.yaml"
# THE DISTINCTION THE WHOLE CHANGE RESTS ON. An empty block is what the shipped template ships, so
# a fixture — or a writer — that spelled the decision that way would be recording "nobody has
# answered" while the adopter had just answered.
runs grep -qE '^authorized_agents:[[:space:]]*$' "$HOME/.gov/acme/gov_repo/policies/governance.yaml" \
  && fail "the decision was written as an EMPTY BLOCK, which reads as 'unanswered'" \
  || pass "and not as an empty block, which is the unanswered state"

info "nothing agent-shaped happens on this run"
never "no agent is offered for install" "Install which"
never "nor the framework's own catalogue as though it were theirs" "No AI agent is installed"
never "no sign-in question" "How would you like to sign"
never_re "and no credential is ever asked for" "Paste the [A-Z_]+"
saw_re "the agent step is TICKED — they answered it" "8b\. \[✓\] Choose which AI agents"

info "the closing screen is the founder's, and it does not promise an agent"
saw "the ADOPTER's next steps" "Install complete — for ADOPTERS"
saw "and the review is still offered — reading your own policies needs no agent" "review its policies now"
never_says "but not 'with gov and your agent'" "with gov and your agent"


# ── and then: work, in an organization with agents off ───────────────────────────────────────────
#
# The second half of the promise. Adoption recording the decision is worth nothing if the next
# command offers the catalogue anyway — which is exactly what happened, because an empty list read
# as "has not decided" and `approvedAgents([])` handed back the framework's own defaults.
new_world
REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
authorize_no_agents "$REMOTE"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm agents )

export GH_STUB_LOGIN=acme GH_STUB_BOARDS="9:Infra"
PROJECT="$HOME/.gov/acme/projects/PRJ-9-infra"
fake_joined_project "$PROJECT" "acme-gov"
# The workspace clone inside the project carries the org's decision, because that is where
# `ensureRootProtocol` reads it: one answer, wherever the mirror runs from — seed, work or sync.
authorize_no_agents "$PROJECT/acme-gov"

drive "$(conv <<C
> Select \\(A/B/C\\)
< B
> Q1 - What is the Github Organization ID
< acme
> Q2 - What is the name of your org
< acme-gov
~ 240
> start work now
< n
C
)" gov

info "a JOINER meets no agent question they cannot answer"
# THE SENTENCE THAT TELLS THEM IS NOT ASSERTED HERE, and the reason is worth recording: the join
# interview's `approvedAgentsIn` port — which reads the org's list from the governance repo BEFORE
# the clone — has no real implementation in `main.ts`. Nothing wires it, so Q3 never appears for
# anybody, with or without agents. The structure-only branch behind it is covered by unit test
# (test/setup/join-interview.test.ts); what this world can honestly assert is the absence.
never "they are not asked to pick from a list that does not exist" "Which would you like to use"
never "and nothing is installed for them on the way in" "Install which"
saw "the JOINER's closing screen still arrives" "Install complete — for JOINERS"

drive "$(conv <<'C'
~ 240
> Proceed\? \(y/N\)
< y
~ 240
> $
C
)" gov work --project=infra

info "gov work explains, instead of being a dead primary action"
saw "it says agents are off for this organization" "AI agents are OFF for this organization"
saw "and where that is recorded" "authorized_agents: none"
saw "and the one command that turns them on" "gov agent approve <id>"
saw "then it opens the project, which is what the fixed process is for" "Opening a shell in"
never "no install offer" "Install which"
never "nor the framework's catalogue proposed as the org's own" "No AI agent is installed"
never "and no agent is announced as starting" "Launching"

info "and NOT ONE of the nine harness files is mirrored into the project"
# The most visible half of the old behaviour: nine vendor instruction files for nine tools the
# organization had told gov it does not use. `harness_files` reads the list from the built module,
# so this cannot drift from what the mirror actually copies.
leaked=""
for rel in $(harness_files); do
  [ -e "$PROJECT/$rel" ] && leaked="$leaked $rel"
done
[ -z "$leaked" ] && pass "the project directory holds no agent instruction files" \
  || fail "harness files were mirrored into a structure-only project:$leaked"
# And the source is still there — nothing was deleted from the governance repo, which stays
# whole for the day the org turns agents on.
exists "while the rendered harness stays in the governance repo, ready for that day" \
  "$PROJECT/acme-gov/agent/harness/CLAUDE.md"
