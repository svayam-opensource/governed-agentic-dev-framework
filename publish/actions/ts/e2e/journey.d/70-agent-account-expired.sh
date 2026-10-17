# SPDX-License-Identifier: MIT
# AN AGENT WHOSE ACCOUNT STOPS IT, AND THE OTHER APPROVED AGENTS (F24, Policy Owner 2026-10-08).
#
# svm-geneva approved IBM Bob, OpenAI Codex and Claude Code. Bob exited with
#
#     Error: Your Free trial has expired. You have reached the end of your free trial period. Upgrade your plan to continue.
#
# and gov called it a first-run step — "accepting a licence, or signing in" — and offered to open Bob again: a loop
# nobody on that machine could leave. gov must say plainly that this is between the person and IBM, and offer the
# list again without Bob, so the person carries on with another agent.
scenario "70 · an expired trial is said plainly, and another approved agent is offered (F24)"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
approve_agents "$REMOTE" "ibm-bob" "claude-code"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm agents )

give_agent bob
give_agent claude
export AGENT_DOUBLE_TRIAL_EXPIRED=bob

export GH_STUB_LOGIN=acme GH_STUB_BOARDS="9:Infra"
fake_joined_project "$HOME/.gov/acme/projects/PRJ-9-infra" "acme-gov"

drive "$(conv <<C
> Select \\(A/B/C\\)
< B
> Q1 - What is the Github Organization ID
< acme
> Q2 - What is the name of your org
< acme-gov
~ 180
> start work now
< n
C
)" gov

: > "$AGENT_DOUBLE_LOG"
drive "$(conv <<'C'
~ 240
> Proceed\? \(y/N\)
< y
# Both approved agents are installed; Enter takes the org default, IBM Bob.
> Choose \[1/2\]
<
# Bob's trial has expired. The list comes back with Claude Code alone.
> Choose \[1\]
< 1
~ 120
> $
C
)" gov work --project=infra

info "every approved agent is listed, installed or not"
saw_re "the picker names the project and lists Bob" "1\) IBM Bob +installed"
saw_re "and Claude Code" "2\) Claude Code +installed"

info "the account failure is said for what it is"
says "plainly, naming whose matter it is" "IBM Bob cannot run: its account's free trial has expired — that is between you and IBM, gov cannot fix it."
never "it is not called a first-run step" "accepting a"
never "and Bob is not offered again" "Open ibm-bob here"

info "and the person carries on with another approved agent"
runs grep -q '^cmd=claude$' "$AGENT_DOUBLE_LOG" \
  && pass "Claude Code was launched after Bob's account stopped it" \
  || fail "no other agent was launched after the account failure"
