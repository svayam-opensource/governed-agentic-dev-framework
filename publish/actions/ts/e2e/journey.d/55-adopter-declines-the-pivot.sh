# SPDX-License-Identifier: MIT
# Declining must stop cleanly — not fall through to a create that preflight would refuse.
scenario "55 · adopter declines the pivot"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
export GH_STUB_GOVERNED="acme/acme-gov"

drive "$(conv <<'C'
> Select \(A/B/C\)
< A
# The two NAME questions now precede the org id (#215), so the probe fires one
# question later than it used to. That is the documented cost of asking a human for
# their organization's name before its GitHub identifier.
> Q1 - What is full legal name
< Acme Incorporated
> Q2 - What is short name
<
> Q3 - What is the Github Organization ID
< acme
> Join acme/acme-gov now
< n
C
)" gov

saw "nothing happened, and it says so" "Nothing created, and nothing changed"
saw "and names the way back in" "choose B"
gh_never "no repository was created" "repo create"
[ -e "$HOME/.gov" ] && fail "nothing should have been written to ~/.gov" || pass "nothing was written to ~/.gov"
