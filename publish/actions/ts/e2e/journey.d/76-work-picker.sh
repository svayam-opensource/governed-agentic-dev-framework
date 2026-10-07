# SPDX-License-Identifier: MIT
# FINDING YOUR PROJECT IN AN ORG WITH FORTY-TWO BOARDS (PRJ-121, work-project-picker-design.md).
#
# The design came out of a walk on an org with 100+ boards: one undifferentiated list, newest board first, paged
# with `m` — and a write-access call per un-seeded board to build it. "Since the number of projects may be
# large, and GitHub may throttle on a large number of requests, would it make sense to add a search?"
#
# So this scenario is about what the screen offers and what it costs GitHub, in a pty, with a `gh` that logs
# every call:
#
#   · the projects on this machine are listed FIRST, and reaching them makes NO `gh project list` at all;
#   · `g` and `s` are two different lists — assigned, then boards nobody has started;
#   · past thirty entries the prompt asks for a pattern instead of a page;
#   · `/text` filters, `/` clears, a miss keeps the level open, and `0` goes up one level, not home.
#
# Nothing is picked: the keys ARE the subject, and launching an agent in a pty would end the conversation.
scenario "76 · the work picker: on this machine first, yours vs could-start, /text, and search past 30"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"

mkdir -p "$HOME/.gov"
printf 'acme\t%s\n' "$REMOTE" > "$HOME/.gov/workspaces"
printf 'acme\n' > "$HOME/.gov/active"

# FORTY-TWO BOARDS, of which two are seeded and assigned to me — the shape the design was written for.
# One of them is named so a search has something to find that a board NUMBER could not.
BOARDS="7:Alpha;9:Infra;5:Billing rework"
for n in $(seq 10 48); do BOARDS="$BOARDS;$n:Project $n"; done
export GH_STUB_LOGIN=acme GH_STUB_BOARDS="$BOARDS" GH_STUB_ANCHORS="7,9"

# Two of them already opened on this machine — the list that costs nothing. `touch` afterwards, because
# writing the harness into the folder is what set its mtime in the first place.
WORK_ROOT="$HOME/.gov/acme/projects"
fake_joined_project "$WORK_ROOT/PRJ-7-alpha" "acme-gov"
fake_joined_project "$WORK_ROOT/PRJ-9-infra" "acme-gov"
# The branch each row shows, read from HEAD — no `git` process, because the local list must cost nothing.
# (`fake_joined_project` clones the governance repo; a real join leaves the project branch in HEAD.)
printf 'ref: refs/heads/BRNCH-7-alpha\n' > "$WORK_ROOT/PRJ-7-alpha/acme-gov/.git/HEAD"
printf 'ref: refs/heads/BRNCH-9-infra\n' > "$WORK_ROOT/PRJ-9-infra/acme-gov/.git/HEAD"
touch -t 202601010000 "$WORK_ROOT/PRJ-9-infra"

info "the projects already here are offered without asking GitHub anything"
: > "$GH_STUB_LOG"
drive "$(conv <<'C'
~ 90
> On this machine
< 0
C
)" env GOV_YES=1 gov work
saw "the local list leads" "On this machine — projects you have already opened (no GitHub call)"
saw "the one used most recently is first" " 1) PRJ-7-alpha"
saw "and the other is second" " 2) PRJ-9-infra"
saw "each row says which branch it is on" "BRNCH-7-alpha"
gh_never "NO board list was fetched to show it — the design's 0-call path" "project list"
gh_never "and no write-access probe either" "viewerCanUpdate"
saw "the two GitHub lists are offered as keys, not fetched" "g) yours on GitHub"
saw "…and so is the one below them" "s) you could start"

info "g and s are two lists, never one — and 0 walks back up the levels"
: > "$GH_STUB_LOG"
drive "$(conv <<'C'
~ 120
> On this machine
< g
> Yours on GitHub
< s
> You could start
< 0
> Yours on GitHub
< 0
> On this machine
< 0
C
)" env GOV_YES=1 gov work
saw "the assigned list names itself" "Yours on GitHub — the boards you are assigned on"
saw "and holds the two boards whose anchor names me" " 1) PRJ-9-infra"
never_re "no un-seeded board is mixed into it" "PRJ-4[0-8].*not started"
saw "could-start is its own level" "You could start — open boards nobody has seeded yet"
gh_ran "the board list was fetched (twice-per-flow is the budget, not per page)" "project list"
[ "$(grep -c 'project list' "$GH_STUB_LOG")" -eq 1 ] \
  && pass "exactly once for the whole flow, across three levels" \
  || { fail "gh project list ran $(grep -c 'project list' "$GH_STUB_LOG") times"; dump; }

info "past thirty entries the prompt asks for a pattern, and paging is offered second"
: > "$GH_STUB_LOG"
drive "$(conv <<'C'
~ 120
> On this machine
< s
> Type part of a name to search
< /billing
> match 'billing'
< /zzznothing
> nothing matches 'zzznothing'
< /
> Type part of a name to search
< 0
> On this machine
< 0
C
)" env GOV_YES=1 gov work
says "it counts them and asks for a pattern" "boards nobody has started yet. Type part of a name to search (/), or m to page through them."
never_re "and lists no rows at that size" "^ +[0-9]+\\) PRJ-4[0-8]"
saw "m is still offered" "m) more"
saw "a search finds the board by its TITLE, not just its number" "billing"
saw "one match is shown, not opened" "press 1 to open it"
saw "a miss says so and keeps the level open" "nothing matches 'zzznothing'"
saw "a bare / brings everything back" "Type part of a name to search"

info "searching before paging is what saves the calls: only matches are access-checked"
[ "$(grep -c 'viewerCanUpdate' "$GH_STUB_LOG")" -le 2 ] \
  && pass "at most the one matching board was probed — not the 40 unstarted ones" \
  || { fail "$(grep -c 'viewerCanUpdate' "$GH_STUB_LOG") write-access probes for one search"; dump; }

info "m pages through them, in FULL pages — 11, then 1, then 7 is the defect this replaces"
: > "$GH_STUB_LOG"
# Forty boards nobody has started (48 down to 10, plus 5), so the pages are 48–34, 33–19, then 18–10 and 5.
# Each page is named by the board it STARTS with, which is the only way to tell a full page from a lucky one.
drive "$(conv <<'C'
~ 180
> On this machine
< s
> Type part of a name to search
< m
> PRJ-48-project-48
< m
> PRJ-33-project-33
< m
> PRJ-5-billing-rework
< 0
> On this machine
< 0
C
)" env GOV_YES=1 gov work
[ "$(grep -cE '^ +15\) PRJ-' "$PLAIN")" -ge 2 ] \
  && pass "the first two pages were FULL — fifteen rows each, the preference's default" \
  || { fail "a page was short: $(grep -cE '^ +15\) PRJ-' "$PLAIN") page(s) reached row 15"; dump; }
saw "and the last page is the remainder, not another fifteen" " 10) PRJ-5-billing-rework"
never "no page was shown twice" "16) PRJ-"
