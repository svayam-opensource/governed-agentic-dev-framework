# SPDX-License-Identifier: MIT
# The joiner's checklist must describe the joiner (#197's finalStatus fix).
scenario "45 · the closing checklist follows the path actually walked"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"

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

saw "step 8 is the joiner's" "Bring in your organization's governance repository (joiners)"
never "not the founder's five sub-steps" "Create the governance repository at"
never "and not the agent-approval step, which is not theirs to make" "Choose which AI agents this organization allows"
