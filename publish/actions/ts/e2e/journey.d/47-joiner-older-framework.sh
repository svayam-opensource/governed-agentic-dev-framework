# SPDX-License-Identifier: MIT
# F15 (svm-geneva re-walk, 2026-10-07) — a JOINER whose organization's governance repo is on an OLDER framework layout
# than this gov: `governance/`, no policies/governance.yaml, no todo template. gov used to print reading-list paths
# that did not exist there and offer to start work, which failed at seed. Now it compares first, says so plainly,
# names who brings it forward, prints only paths that exist, and does not offer to start work.
scenario "47 · joiner, organization on an older framework"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
( cd "$REMOTE" \
  && git rm -rq framework policies/governance.yaml \
  && mkdir -p governance/policies && echo "# org policy (old layout)" > governance/policies/org-policy.md \
  && printf 'policy_owner_github: "@polly"\n' >> org-config.yaml \
  && git add -A && git -c user.email=e@x -c user.name=e commit -qm "the older governance/ layout" )

drive "$(conv <<C
> Select \\(A/B/C\\)
< B
> Q1 - What is the Github Organization ID
< acme
> Q2 - What is the name of your org
< acme-gov
~ 120
> Install complete
> brings it forward
C
)" gov

saw "it still joins — reading the policies needs nothing newer" "Joining acme."
saw "and says plainly that the organization's governance is older than this gov" "Your organization's governance is on an older framework than this gov"
saw "names who brings it forward, by handle, and the command" "Its Policy Owner (@polly) brings it forward:  gov upgrade --pr"
saw "and what changes for the joiner meanwhile" "What that means for you until it merges"
never "no reading-list path that is not in the repository" "framework-specification.md"
never "nor the joiner guide the old layout does not have" "path-joiner.md"
never "and no offer to start work that would fail at seed" "start work now"
never "never the seed failure itself" "todo-template.md is missing"
