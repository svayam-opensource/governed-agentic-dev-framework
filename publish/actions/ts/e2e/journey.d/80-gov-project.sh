# SPDX-License-Identifier: MIT
# A BOARD IS NEVER BORN WITHOUT OWNERS (gadf#182, PRJ-121 plan 03 L06).
#
# Creating the board and its anchor issue was done by hand in the GitHub UI, so the one moment governance most
# needs to bite was the one moment gov was not there. `gov project` does both, through the ports, and this walks
# what a person sees and what gov asks GitHub, with a `gh` that logs every call:
#
#   · a pre-seed condition that fails (a repo nobody can read) creates NOTHING — no `project create`;
#   · the happy path: board → anchor in the governance repo, labelled anchor, assigned to me → on the board →
#     an issue in the --repo, on the board;
#   · a failure after the board exists is a report of what exists and a non-zero exit, never silence;
#   · --seed hands the new board's URL to `gov seed`.
#
# What this tier cannot show: a SEEDED workspace at the end of --seed. The stub answers no board-items query, so
# `gov seed` stops at its own board gate; the hand-off is asserted, the seed itself is seed's own scenarios'.
scenario "80 · gov project: pre-seed checks, board + labelled anchor, a partial result reported, --seed hands off"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
mkdir -p "$HOME/.gov"
printf 'acme\t%s\n' "$REMOTE" > "$HOME/.gov/workspaces"
printf 'acme\n' > "$HOME/.gov/active"
export GH_STUB_LOGIN=alice GH_STUB_REPOS="acme/acme-gov,acme/invoice-api" GH_STUB_BOARD_N=12

info "pre-seed: a --repo nobody can read → refused, with the fix, and nothing created"
: > "$GH_STUB_LOG"
( cd "$REMOTE" && gov project "Invoice API" --repo acme/no-such-repo >"$WORLD/p-pre.out" 2>&1 ); code=$?
[ "$code" -ne 0 ] && pass "the exit is non-zero" || fail "the exit is non-zero"
grep -qF "nothing was created" "$WORLD/p-pre.out" && pass "it says nothing was created" || { fail "it says nothing was created"; cat "$WORLD/p-pre.out"; }
grep -qF "✗ repositories:" "$WORLD/p-pre.out" && grep -qF "acme/no-such-repo" "$WORLD/p-pre.out" \
  && pass "it names the rule and the repo to fix" || fail "it names the rule and the repo to fix"
gh_never "no board was created" "project create"
gh_never "and no issue" "issue create"

info "the happy path: board, anchor (label anchor, assigned to me, on the board), and the repo taking part"
: > "$GH_STUB_LOG"
( cd "$REMOTE" && gov project "Invoice API" --repo acme/invoice-api >"$WORLD/p-ok.out" 2>&1 ); code=$?
[ "$code" -eq 0 ] && pass "exit 0" || { fail "exit 0 (got $code)"; cat "$WORLD/p-ok.out"; }
gh_ran "the board was created under the org, with the name given" "project create --owner acme --title Invoice API"
gh_ran "the anchor was created in the governance repo" "issue create --repo acme/acme-gov --title Invoice API: project scope & anchor"
gh_ran "labelled anchor" "--label anchor"
gh_ran "assigned to the invoker" "--assignee alice"
gh_ran "and put on the new board" "project item-add 12 --owner acme"
gh_ran "the --repo got its issue, so seed gives it a project branch" "issue create --repo acme/invoice-api"
grep -qF "https://github.com/orgs/alice/projects/12" "$WORLD/p-ok.out" && pass "the report names the board" || { fail "the report names the board"; cat "$WORLD/p-ok.out"; }
grep -qF "gov seed https://github.com/orgs/alice/projects/12" "$WORLD/p-ok.out" && pass "and the next command" || fail "and the next command"

info "a failure after the board exists is reported — what exists, non-zero — never silent"
: > "$GH_STUB_LOG"
( cd "$REMOTE" && GH_STUB_ISSUE_FAIL=acme/acme-gov gov project "Invoice API" >"$WORLD/p-part.out" 2>&1 ); code=$?
[ "$code" -ne 0 ] && pass "the exit is non-zero" || fail "the exit is non-zero"
grep -qF "What exists now" "$WORLD/p-part.out" && grep -qF "projects/12" "$WORLD/p-part.out" \
  && pass "the report lists the board that exists" || { fail "the report lists the board that exists"; cat "$WORLD/p-part.out"; }
grep -qF "not created: the anchor issue" "$WORLD/p-part.out" && pass "and says what was not created" || fail "and says what was not created"
grep -qF "second board" "$WORLD/p-part.out" && pass "and warns that re-running would make a second board" || fail "and warns that re-running would make a second board"

info "--seed hands the new board to gov seed"
: > "$GH_STUB_LOG"
( cd "$REMOTE" && gov project "Invoice API" --seed >"$WORLD/p-seed.out" 2>&1 )
grep -qF "Handing to gov seed https://github.com/orgs/alice/projects/12" "$WORLD/p-seed.out" \
  && pass "it says it hands to gov seed, with the board's URL" || { fail "it says it hands to gov seed, with the board's URL"; cat "$WORLD/p-seed.out"; }
# What seed asks GitHub first is the board — proof that seed, not gov project, is now running.
grep -qF "api graphql" "$GH_STUB_LOG" && [ "$(grep -c "api graphql" "$GH_STUB_LOG")" -ge 2 ] \
  && pass "and gov seed ran: it read the board" || { fail "and gov seed ran: it read the board"; cat "$WORLD/p-seed.out"; }
