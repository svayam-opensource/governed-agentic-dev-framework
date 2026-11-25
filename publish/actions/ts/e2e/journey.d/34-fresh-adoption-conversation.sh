# SPDX-License-Identifier: MIT
# SCENARIO 34 — THE TIMED JOURNEY'S CONVERSATION, kept honest hermetically (Q62 A / Q64 A).
#
# e2e/fresh-adoption-journey.sh drives the real first-run interview against an unadopted sandbox org with the
# answers in e2e/fresh-adoption.conv, and times it. That job needs a secret and a sandbox; this scenario drives the
# SAME FILE against the stub gh on every PR, so a reworded prompt breaks here — in minutes, with a transcript — and
# not as a mystery timeout in the timed live run.
scenario "34 · the fresh-adoption conversation (the timed live journey's answers)"

export GH_STUB_LOGIN="acme" GH_STUB_GOVERNED="" GH_STUB_REPOS="acme/gov_repo"
# The organization's display name on GitHub — setup's default for its names since F158 (they are no longer asked).
export GH_STUB_ORG_NAME="Fresh Adoption E2E"

# Filled exactly as fresh-adoption-journey.sh fills it, with the stub's org.
sed -e "s|@ORG@|acme|" -e "s|@SLUG@|FRESH|" "$HERE/fresh-adoption.conv" >"$WORLD/fresh.conv"
grep -v "^#" "$WORLD/fresh.conv" | grep -q "@[A-Z_]*@" && fail "a placeholder in fresh-adoption.conv is not filled by the drivers" \
  || pass "every placeholder in fresh-adoption.conv is filled"
drive "$WORLD/fresh.conv" gov && pass "the whole conversation is answered, to the closing offer" \
  || { fail "the conversation stalled — fresh-adoption.conv no longer matches the interview"; sed 's/^/    /' "$WORLD/drive.err"; dump; }

G="$HOME/.gov/fresh/gov_repo"
never "the org is adopted, not joined" "is already governed"
gh_ran "the governance repository is created from the template" "repo create acme/gov_repo --template"
runs grep -qE '^governance_posture: "?soft"?' "$G/policies/governance.yaml" && pass "soft posture, the default" || fail "governance.yaml does not record soft"
runs grep -q "^authorized_agents: none" "$G/policies/governance.yaml" && pass "no AI agents — no installer, no sign-in in the timed path" \
  || fail "authorized_agents: none was not recorded"
in_setup="$(git -C "$G" show --name-only --format= HEAD)"
grep -qxF .github/workflows/approver-check.yml <<<"$in_setup" && pass "the setup commit carries the approval check the timed run waits for" \
  || fail "the setup commit does not carry .github/workflows/approver-check.yml"
gh_ran "setup makes the practice board, without a question" "project create --owner acme --title Make the policy ours"
gh_ran "with its anchor labelled practice" "--label anchor --label practice"
gh_ran "and the task the timed run scripts" "issue create --repo acme/gov_repo --title Put our name on the policy"
# The live journey reads the two edits out of the task text with these exact shapes.
gh_ran "the task says what title: becomes, in the shape the live run parses" '- `title:` becomes `"Fresh Adoption E2E Development and Operations Policy"`'
gh_ran "and what approved_by: becomes" '- `approved_by:` becomes `"Policy Owner"`'
saw "the adopter is told the practice project exists" "Your practice project"
saw "every value used is printed before anything is created, the defaults marked (F158)" "(default · org-config.yaml)"
saw "the organization's name came from GitHub" "Fresh Adoption E2E"
