# SPDX-License-Identifier: MIT
# The ADOPTER whose organization already has a governance repo (#197).
#
# They answered truthfully with what they knew; gov looked and found otherwise. What must
# NOT happen is what used to: two more questions collected and thrown away, then a refusal
# and a shell command that could not produce a working machine.
scenario "50 · adopter, org already governed → the pivot"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
export GH_STUB_GOVERNED="acme/acme-gov"

drive "$(conv <<'C'
> Select \(A/B/C\)
< A
> Which organization
< acme
~ 120
> Join acme/acme-gov now
< Y
> Active org
> start work now
< n
C
)" gov

saw "it says so, and names the repository" "acme is already governed"
saw "which makes the claim checkable" "acme/acme-gov"
says "and explains why a second one is not offered" "would fork its policy"
never "#197 — never a shell command that lands the clone where gov does not look" "git clone"
never "and the questions only a CREATOR could answer are never reached" "Name for the governance repository"
saw "it joins instead" "Joining acme."
exists "and the workspace is where every other tool expects it" "$HOME/.gov/acme/gov_repo/org-config.yaml"
saw "the run ends as a JOINER, because that is what happened" "Install complete — for JOINERS"
gh_never "nothing was created in the org" "repo create"
