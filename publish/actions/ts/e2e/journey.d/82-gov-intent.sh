# SPDX-License-Identifier: MIT
# DRAFTING AN INTENT FROM BOARD ISSUES (PRJ-121 intent 03, D3; rulings Q3, Q4).
#
# `gov intent <issue>…` is the first step of the lifecycle: from open board issues it creates the intent TRACKING
# issue (Q4b), drafts `projects/<PRJ>/intents/<NN-slug>/intent.md` (DRAFT) with the owner-interview questions the
# issues leave open, commits it on a sub-branch of the project branch, pushes, and opens a change request to the
# project branch that traces to the tracking issue. With no lifecycle adopted it says so and does nothing.
#
# The real binary, a `gh` that answers from fixtures (issue view, issue create, the pulls API) and real git against
# a local remote — so the branch, the commit and the file are checked where a reviewer would find them.
scenario "82 · gov intent: tracking issue, DRAFT intent.md on a sub-branch, a change request that traces to it"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
mkdir -p "$HOME/.gov"
printf 'acme\t%s\n' "$REMOTE" > "$HOME/.gov/workspaces"
printf 'acme\n' > "$HOME/.gov/active"
export GH_STUB_LOGIN=acme GH_STUB_BOARDS="7:Alpha" GH_STUB_ANCHORS="7"
export GH_STUB_ISSUE_BODY='The picker pages unevenly.\n\n## Acceptance criteria\nEvery page holds twenty rows.\n'

WORK_ROOT="$HOME/.gov/acme/projects"
fake_joined_project "$WORK_ROOT/PRJ-7-alpha" "acme-gov"
WS="$WORK_ROOT/PRJ-7-alpha/acme-gov"
I1="https://github.com/acme/app/issues/42"
I2="https://github.com/acme/app/issues/43"

info "no lifecycle adopted: gov intent says so and changes nothing"
: > "$GH_STUB_LOG"
out="$(cd "$WS" && gov intent "$I1" 2>&1)"; rc=$?
printf '%s\n' "$out" > "$PLAIN"
[ "$rc" -ne 0 ] && pass "it exits non-zero" || fail "it exits non-zero (got $rc)"
saw "it names the file that is missing" "policies/active/ai-sdlc-lifecycle.md is absent"
gh_never "no tracking issue was created" "issue create"
gh_never "no change request was opened" "/pulls"
[ ! -d "$WS/projects/PRJ-7-alpha/intents" ] && pass "no intent folder was written" || fail "no intent folder was written"
[ "$(git -C "$WS" rev-parse --abbrev-ref HEAD)" = "BRNCH-7-alpha" ] && pass "still on the project branch" || fail "still on the project branch"

info "the org adopts the starter lifecycle (as its policy change request would land it)"
mkdir -p "$WS/policies/active" "$WS/policies/reference/lifecycles"
cp "$CONTENT_DIR/policies/active/ai-sdlc-lifecycle.md" "$WS/policies/active/"
cp -R "$CONTENT_DIR/policies/reference/lifecycles/ai-sdlc" "$WS/policies/reference/lifecycles/"
( cd "$WS" && git add policies && git -c user.email=e@x -c user.name=e commit -qm "adopt the lifecycle" )

info "gov intent with two issues: one intent, tracked, drafted, proposed"
: > "$GH_STUB_LOG"
out="$(cd "$WS" && gov intent "$I1" "$I2" --slug picker-paging 2>&1)"; rc=$?
printf '%s\n' "$out" > "$PLAIN"
[ "$rc" -eq 0 ] && pass "it exits 0" || { fail "it exits 0 (got $rc)"; printf '%s\n' "$out" | sed 's/^/      /'; }
saw "it says what it drafted" "Intent 01-picker-paging drafted (DRAFT)"
gh_ran "it read the issues through the tracker" "issue view $I1"
gh_ran "the tracking issue was created in the governance repo, assigned to me" "issue create --repo acme/acme-gov --title Intent 01: Issue 42 needs doing"
gh_ran "…assigned to the invoker" "--assignee acme"
gh_ran "…and put on the project's board" "project item-add 7 --owner acme --url https://github.com/acme/acme-gov/issues/1"
gh_ran "…and labelled into the intent" "issue edit https://github.com/acme/acme-gov/issues/1 --add-label gov-intent:01"
gh_ran "the issues it was made from are labelled too" "issue edit $I2 --add-label gov-intent:01"
gh_ran "a change request was opened to the project branch" "base=BRNCH-7-alpha"
gh_ran "…from the intent sub-branch" "head=BRNCH-7-alpha.INTENT-01-intent"
gh_ran "…and its body traces to the tracking issue" "Traces to: https://github.com/acme/acme-gov/issues/1"
gh_ran "the tracking issue is told where the change request is" "issue comment https://github.com/acme/acme-gov/issues/1"
saw "the change request's link is printed" "https://github.com/acme/acme-gov/pull/12"

F="projects/PRJ-7-alpha/intents/01-picker-paging/intent.md"
pushed="$(git -C "$REMOTE" show "BRNCH-7-alpha.INTENT-01-intent:$F" 2>/dev/null)"
[ -n "$pushed" ] && pass "intent.md is on the pushed sub-branch, in the remote" || fail "intent.md is on the pushed sub-branch, in the remote"
printf '%s\n' "$pushed" | grep -qF "**Status:** DRAFT" && pass "its Status is DRAFT" || fail "its Status is DRAFT"
printf '%s\n' "$pushed" | grep -qF "[acme/app#43]($I2)" && pass "Board items lists the issues" || fail "Board items lists the issues"
printf '%s\n' "$pushed" | grep -qE "Q[0-9] — Outcome" && pass "the interview asks what the issues leave open" || fail "the interview asks what the issues leave open"
printf '%s\n' "$pushed" | grep -qE "Q[0-9] — Success measure" && fail "…and not what they answer (Acceptance criteria)" || pass "…and not what they answer (Acceptance criteria)"
printf '%s\n' "$pushed" | grep -qF "Recommendation:" && pass "each question carries a recommendation line" || fail "each question carries a recommendation line"
git -C "$REMOTE" log -1 --format=%B "BRNCH-7-alpha.INTENT-01-intent" | grep -qF "Traces to: https://github.com/acme/acme-gov/issues/1" \
  && pass "the commit traces to the tracking issue" || fail "the commit traces to the tracking issue"
[ "$(git -C "$WS" rev-parse --abbrev-ref HEAD)" = "BRNCH-7-alpha.INTENT-01-intent" ] \
  && pass "the workspace is left on the intent branch, for the interview" || fail "the workspace is left on the intent branch, for the interview"
