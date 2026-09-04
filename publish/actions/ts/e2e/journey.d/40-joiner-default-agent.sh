# SPDX-License-Identifier: MIT
# SCENARIO 4 — a JOINER on a machine with nothing installed.
#
# The org has already decided everything; this person has to be carried from a bare shell
# to a working session without being asked to decide anything the org already settled.
# It is also the path an ADOPTER lands on when #197 finds their org already governed, so
# it has to end as finished as the adopter's does.
scenario "40 · joiner, org default agent, nothing installed"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
approve_agents "$REMOTE" "ibm-bob" "claude-code"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm agents )

drive "$(conv <<'C'
> Select \(A/B/C\)
< B
> Governance repo \(clone URL\)
C
)" gov     # the URL is answered below, once the scenario knows the path
info "first run: the role question is reached"
saw_re "the role question is asked FIRST — before anything only one role can answer" 'Select \(A/B/C\)'
saw "A is the adopter" "I am an ADOPTER"
saw "B is the joiner" "I am a JOINER"

# Now the same run, answered through.
new_world
REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
approve_agents "$REMOTE" "ibm-bob" "claude-code"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm agents )

drive "$(conv <<C
> Select \\(A/B/C\\)
< B
> Governance repo \\(clone URL\\)
< https://github.test/acme/acme-gov.git
~ 120
> Active org
> start work now
< n
C
)" gov

saw "it joins, and says whose org it is" "Joining acme."
saw_re "placed where every other tool looks, not where the shell happened to be" "Registered acme .*\.gov/acme/gov_repo"
exists "the workspace is really there (#209 discipline: prove, do not announce)" "$HOME/.gov/acme/gov_repo/org-config.yaml"
saw "the JOINER's closing screen, not the founder's" "Install complete — for JOINERS"
never "and not a list of things they must not do" "Install complete — for ADOPTERS"
saw_re "#203 — it OFFERS the work rather than printing three steps to retype" "start work now"
