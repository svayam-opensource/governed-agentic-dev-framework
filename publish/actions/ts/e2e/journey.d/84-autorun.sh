# SPDX-License-Identifier: MIT
# THE LIFECYCLE ENGINE (PRJ-121 intent 03, D4; spec §3; rulings Q7, Q10–Q12, Q16).
#
# `gov autorun` advances every item whose gate a person passed by exactly one stage, then stops and says who each
# item waits on. Here, against a fake GitHub WITH A MEMORY (stub/gh-db.mjs: pulls, reviews, issues, the board) and
# a fake headless agent (stub/headless-agent, standing in for `claude -p`), with real git against a local remote:
#
#   01-alpha  intent approved             → the agent drafts spec.md; gov commits it, pushes, opens a change request
#   02-beta   intent approved             → the agent fails: that item is reported, the rest continue
#   03-gamma  plan approved, 2 tasks      → the plan's task issues, assigned to the approver, citing the plan's CR
#   04-delta  plan drafted, CR open       → waits at G3 — and no task issue is created for it
#   app#42    a board issue in no intent  → an intent drafted from it (gov intent's path)
#
# Then: a second run changes nothing; a C01 refusal by the agent halts the run and commits nothing for its item;
# nothing ever merges or closes (the fake GitHub's log says so).
scenario "84 · gov autorun: one stage per item, idempotent, C01 halts, never merges or closes"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
approve_agents "$REMOTE" claude-code
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm "approve claude-code" )
mkdir -p "$HOME/.gov"
printf 'acme\t%s\n' "$REMOTE" > "$HOME/.gov/workspaces"
printf 'acme\n' > "$HOME/.gov/active"
export GH_STUB_LOGIN=acme GH_STUB_BOARDS="7:Alpha" GH_STUB_ANCHORS="7"

WORK_ROOT="$HOME/.gov/acme/projects"
fake_joined_project "$WORK_ROOT/PRJ-7-alpha" "acme-gov"
WS="$WORK_ROOT/PRJ-7-alpha/acme-gov"
PB="BRNCH-7-alpha"
D="projects/PRJ-7-alpha/intents"

# ── the fake agent: `claude`, headless; drafts the artifact its brief names — and fails for intent 02 ─────────
cp "$HERE/stub/headless-agent" "$WORLD/bin/claude"; chmod +x "$WORLD/bin/claude"
export FAKE_AGENT_LOG="$WORLD/fake-agent.log" FAKE_AGENT_PROMPT_FILE="$WORLD/fake-agent.prompt"
FAKE_AGENT_RUN="$(cat <<'SH'
case "$FAKE_AGENT_PROMPT" in *"intents/02-"*) echo "boom: the agent's tests failed" >&2; exit 4;; esac
f="$(printf '%s\n' "$FAKE_AGENT_PROMPT" | sed -n 's/^Artifact: //p' | head -1)"
mkdir -p "$(dirname "$f")"
printf '# Draft\n\n**Status: APPROVED by the-agent 2026-10-13 (nope)**\n\nDrafted by the fake agent.\n' > "$f"
SH
)"
export FAKE_AGENT_RUN

# ── the fake GitHub: what people already approved, and the board ─────────────────────────────────────────────
export GH_STUB_DB="$WORLD/ghdb" GH_STUB_DB_TOOL="$HERE/stub/gh-db.mjs"
mkdir -p "$GH_STUB_DB"
pr() { printf '{"repo":"acme/acme-gov","number":%s,"state":"%s","merged":%s,"draft":false,"title":"t","head":"%s","base":"%s"}' "$1" "$2" "$3" "$4" "$PB"; }
cat > "$GH_STUB_DB/prs.json" <<JSON
[ $(pr 5 closed true "$PB.INTENT-01-intent"), $(pr 6 closed true "$PB.INTENT-02-intent"),
  $(pr 7 closed true "$PB.INTENT-03-intent"), $(pr 8 closed true "$PB.INTENT-03-spec"), $(pr 9 closed true "$PB.INTENT-03-plan"),
  $(pr 10 closed true "$PB.INTENT-04-intent"), $(pr 11 closed true "$PB.INTENT-04-spec"), $(pr 12 open false "$PB.INTENT-04-plan") ]
JSON
rv='[{"user":{"login":"po","type":"User"},"state":"APPROVED","submitted_at":"2026-10-01T00:00:00Z"}]'
printf '{"acme/acme-gov#5":%s,"acme/acme-gov#6":%s,"acme/acme-gov#7":%s,"acme/acme-gov#8":%s,"acme/acme-gov#9":%s,"acme/acme-gov#10":%s,"acme/acme-gov#11":%s}\n' \
  "$rv" "$rv" "$rv" "$rv" "$rv" "$rv" "$rv" > "$GH_STUB_DB/reviews.json"
cat > "$GH_STUB_DB/issues.json" <<'JSON'
[ { "url": "https://github.com/acme/app/issues/42", "repo": "acme/app", "title": "Pages are uneven", "body": "The picker pages unevenly.", "state": "OPEN", "labels": [], "assignees": ["acme"] } ]
JSON
printf '[{"url":"https://github.com/acme/app/issues/42","status":"Todo"}]\n' > "$GH_STUB_DB/board.json"

# ── the project branch: the lifecycle adopted, four intents at their stages (committed before the approvals) ───
mkdir -p "$WS/policies/active" "$WS/policies/reference/lifecycles"
cp "$CONTENT_DIR/policies/active/ai-sdlc-lifecycle.md" "$WS/policies/active/"
cp -R "$CONTENT_DIR/policies/reference/lifecycles/ai-sdlc" "$WS/policies/reference/lifecycles/"
ok_line() { printf '**Status: APPROVED by po 2026-10-01 (https://github.com/acme/acme-gov/pull/%s)**' "$1"; }
art() { mkdir -p "$(dirname "$WS/$1")"; printf '# %s\n\n%s\n\n**Project:** PRJ-7-alpha · **Tracking issue:** https://github.com/acme/acme-gov/issues/%s\n\n%s\n' "$2" "$3" "$4" "${5:-}" > "$WS/$1"; }
art "$D/01-alpha/intent.md" "Intent 01" "$(ok_line 5)" 1
art "$D/02-beta/intent.md"  "Intent 02" "$(ok_line 6)" 2
art "$D/03-gamma/intent.md" "Intent 03" "$(ok_line 7)" 3
art "$D/03-gamma/spec.md"   "Spec 03"   "$(ok_line 8)" 3
art "$D/03-gamma/plan.md"   "Plan 03"   "$(ok_line 9)" 3 "$(printf '## Tasks\n### T01 — Page the picker\n- **Repo:** acme/app\n### T02 — Document paging\n- **Repo:** acme-gov\n')"
art "$D/04-delta/intent.md" "Intent 04" "$(ok_line 10)" 4
art "$D/04-delta/spec.md"   "Spec 04"   "$(ok_line 11)" 4
( cd "$WS" && git add policies projects \
  && GIT_COMMITTER_DATE="2026-09-01T00:00:00Z" git -c user.email=e@x -c user.name=e commit -qm "adopt the lifecycle; intents 01-04" )

autorun() { : > "$GH_STUB_LOG"; out="$(cd "$WS" && gov autorun "$@" 2>&1)"; rc=$?; printf '%s\n' "$out" > "$PLAIN"; }
prs()     { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "$GH_STUB_DB/prs.json"; }
issues()  { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "$GH_STUB_DB/issues.json"; }
remote_branches() { git -C "$REMOTE" for-each-ref --format='%(refname:short)' refs/heads | sort | tr '\n' ' '; }
never_merged_or_closed() {
  gh_never "$1: nothing was merged" "/merge"
  gh_never "$1: no pull request was merged by gh" "pr merge"
  gh_never "$1: no issue was closed" "issue close"
  gh_never "$1: no board was closed" "project close"
  gh_never "$1: no pull request was closed or edited" "-X PATCH"
}

info "a dry run says what each item would do, and changes nothing"
before_prs="$(prs)"; before_issues="$(issues)"; before_branches="$(remote_branches)"
autorun --dry-run
[ "$rc" -eq 0 ] && pass "it exits 0" || { fail "it exits 0 (got $rc)"; dump; }
saw_re "01 would draft its spec" "01-alpha .*would draft-spec"
saw_re "app#42 would draft an intent" "app#42 .*would draft-intent"
[ "$(prs)" = "$before_prs" ] && [ "$(issues)" = "$before_issues" ] && pass "no change request, no issue" || fail "no change request, no issue"
[ "$(remote_branches)" = "$before_branches" ] && pass "no branch pushed" || fail "no branch pushed"

info "run 1: every item whose gate passed advances one stage; 02's agent fails and the rest continue"
autorun
[ "$rc" -eq 1 ] && pass "it exits 1 — one item failed" || { fail "it exits 1 — one item failed (got $rc)"; dump; }
saw_re "01-alpha: spec drafted, now waiting at G2" "01-alpha .*draft-spec done .*waiting on the project owner \\(spec approval\\)"
saw_re "02-beta: reported failed, with the agent's exit" "02-beta .*✗ failed: the agent exited 4"
saw_re "03-gamma: task issues created" "03-gamma .*create-task-issues done"
saw_re "04-delta: waiting on the plan's review" "04-delta .*✋ waiting on the project owner \\(plan approval\\) — review https://github.com/acme/acme-gov/pull/12"
saw_re "app#42: an intent drafted from it" "app#42 .*draft-intent done"
for item in 01-alpha 02-beta 03-gamma 04-delta app#42; do saw "the report lists $item" "$item"; done

S1="$PB.INTENT-01-spec"
spec="$(git -C "$REMOTE" show "$S1:$D/01-alpha/spec.md" 2>/dev/null)"
[ -n "$spec" ] && pass "spec.md is on the pushed sub-branch $S1" || fail "spec.md is on the pushed sub-branch $S1"
printf '%s\n' "$spec" | grep -qF "**Status:** DRAFT" && pass "…its Status is DRAFT, whatever the agent wrote" || fail "…its Status is DRAFT, whatever the agent wrote"
msg="$(git -C "$REMOTE" log -1 --format=%B "$S1" 2>/dev/null)"
printf '%s\n' "$msg" | grep -qE '^Gov-Autorun: ' && pass "…committed with Gov-Autorun:" || fail "…committed with Gov-Autorun:"
printf '%s\n' "$msg" | grep -qx 'Gov-Agent: claude-code' && pass "…and Gov-Agent: claude-code" || fail "…and Gov-Agent: claude-code"
gh_ran "a change request from the spec branch" "head=$S1"
gh_ran "…to the project branch" "base=$PB"
gh_ran "…tracing to the intent's tracking issue" "Traces to: https://github.com/acme/acme-gov/issues/1"
[ -s "$FAKE_AGENT_LOG" ] && pass "the agent ran headless (claude -p)" || fail "the agent ran headless (claude -p)"
grep -qF "Run the session-start protocol for PRJ-7-alpha" "$FAKE_AGENT_PROMPT_FILE" && pass "…its prompt is gov work's kickoff (the session-start protocol first)" || fail "…its prompt is gov work's kickoff (the session-start protocol first)"
grep -qF "gov-lifecycle-spec" "$FAKE_AGENT_PROMPT_FILE" && pass "…then the brief, naming the lifecycle step skill" || fail "…then the brief, naming the lifecycle step skill"
git -C "$REMOTE" rev-parse --verify --quiet "$PB.INTENT-02-spec" >/dev/null && fail "02's failed draft left no branch" || pass "02's failed draft left no branch"

node -e '
  const is = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const t = is.filter((i) => /gov-plan-task \{"project":"PRJ-7-alpha","intent":"03"/.test(i.body));
  const four = is.filter((i) => /"intent":"04"/.test(i.body));
  const ok = t.length === 2 && t.every((i) => i.assignees.join() === "po" && i.body.includes("https://github.com/acme/acme-gov/pull/9") && i.labels.includes("gov-intent:03"));
  process.exit(ok && four.length === 0 ? 0 : 1);' "$GH_STUB_DB/issues.json" \
  && pass "03's two task issues: assigned to the approver (po), citing the plan's change request, labelled gov-intent:03 — and none for 04, whose plan is not approved" \
  || { fail "03's two task issues: assigned to the approver (po), citing the plan's change request, labelled gov-intent:03 — and none for 04, whose plan is not approved"; cat "$GH_STUB_DB/issues.json"; }
grep -qF '"repo": "acme/app"' "$GH_STUB_DB/issues.json" && pass "…each in the repository its task names" || fail "…each in the repository its task names"

gh_ran "the intent from app#42 has its tracking issue" "issue create --repo acme/acme-gov --title Intent 05: Pages are uneven"
gh_ran "…and its change request, from the intent sub-branch" "head=$PB.INTENT-05-intent"
git -C "$REMOTE" log -1 --format=%B "$PB.INTENT-05-intent" 2>/dev/null | grep -qE '^Gov-Autorun: ' \
  && pass "…committed with Gov-Autorun:" || fail "…committed with Gov-Autorun:"
[ "$(git -C "$WS" rev-parse --abbrev-ref HEAD)" = "$PB" ] && pass "the workspace is back on the project branch" || fail "the workspace is back on the project branch"

rec="$(git -C "$REMOTE" ls-tree --name-only "$PB" "projects/PRJ-7-alpha/autorun/" 2>/dev/null)"
[ -n "$rec" ] && pass "the run record is committed on the project branch and pushed" || fail "the run record is committed on the project branch and pushed"
git -C "$REMOTE" show "$PB:projects/PRJ-7-alpha/knowledge/decisions.md" 2>/dev/null | grep -qE "autorun .*: 3 advanced, 1 failed" \
  && pass "…with its line in the project's decisions.md" || fail "…with its line in the project's decisions.md"
git -C "$REMOTE" show "$PB:$(printf '%s' "$rec" | head -1)" 2>/dev/null | grep -qF "04-delta" && pass "…listing every item" || fail "…listing every item"
saw "the report says where the record is" "recorded: projects/PRJ-7-alpha/autorun/"
never_merged_or_closed "run 1"

info "run 2, nothing approved since: nothing changes"
before_prs="$(prs)"; before_issues="$(issues)"
before_intent_branches="$(remote_branches | tr ' ' '\n' | grep INTENT | tr '\n' ' ')"
autorun
saw_re "01-alpha waits on its spec's review" "01-alpha .*✋ waiting on the project owner \\(spec approval\\)"
saw_re "03-gamma: its task issues exist — building a task is not wired into autorun yet" "03-gamma .*✗ failed: building a task is not wired into autorun yet"
[ "$(prs)" = "$before_prs" ] && pass "no change request opened" || fail "no change request opened ($before_prs → $(prs))"
[ "$(issues)" = "$before_issues" ] && pass "no issue created" || fail "no issue created ($before_issues → $(issues))"
[ "$(remote_branches | tr ' ' '\n' | grep INTENT | tr '\n' ' ')" = "$before_intent_branches" ] && pass "no sub-branch pushed" || fail "no sub-branch pushed"
never_merged_or_closed "run 2"

info "a C01 refusal halts the whole run: nothing is committed for the item, the exit is non-zero"
# A person approves 01's spec (its change request merged with their review); the project branch has it.
node -e '
  const fs = require("fs"), db = process.argv[1];
  const prs = JSON.parse(fs.readFileSync(db + "/prs.json", "utf8"));
  const p = prs.find((x) => x.head === process.argv[2]); p.state = "closed"; p.merged = true;
  fs.writeFileSync(db + "/prs.json", JSON.stringify(prs));
  const rv = JSON.parse(fs.readFileSync(db + "/reviews.json", "utf8"));
  rv["acme/acme-gov#" + p.number] = [{ user: { login: "po", type: "User" }, state: "APPROVED", submitted_at: "2026-10-02T00:00:00Z" }];
  fs.writeFileSync(db + "/reviews.json", JSON.stringify(rv));' "$GH_STUB_DB" "$S1"
( cd "$WS" && git fetch -q origin && git merge -q --no-edit "origin/$S1" )
before_prs="$(prs)"
FAKE_AGENT_C01=GOV-FRM-086 FAKE_AGENT_EXIT=1 autorun
[ "$rc" -ne 0 ] && pass "it exits non-zero" || fail "it exits non-zero"
saw_re "the report says HALT, naming the rule" "HALT.*GOV-FRM-086"
saw_re "the next item is not started" "02-beta .*not started — the run halted"
git -C "$REMOTE" rev-parse --verify --quiet "$PB.INTENT-01-plan" >/dev/null && fail "no plan branch was pushed for 01" || pass "no plan branch was pushed for 01"
[ "$(prs)" = "$before_prs" ] && pass "no change request opened" || fail "no change request opened"
never_merged_or_closed "the halted run"
n_records="$(git -C "$REMOTE" ls-tree --name-only "$PB" "projects/PRJ-7-alpha/autorun/" 2>/dev/null | wc -l | tr -d ' ')"
[ "$n_records" -eq 3 ] && pass "each of the three runs has its own record (none overwrote another)" || fail "each of the three runs has its own record (got $n_records)"
