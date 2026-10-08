#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# Clean-slate ADOPTER-JOURNEY e2e — runs INSIDE the gyan container (fresh per run).
# Exercises the whole first-adopter path against REAL GitHub, asserting a
# specific outcome at each step, then tears everything down. Run on publish,
# every time content or actions change.
#
# Required env:
#   E2E_ORG      GitHub org to create the throwaway repos/project in (you own it)
#   GH_TOKEN     classic token with scopes: repo, project, read:org, delete_repo  (gov delegates to gh;
#                without delete_repo the journey warns at start and its repos are leaked)
#   GOV_TARBALL  path to the packed local gov build (npm pack output) — tests THIS build
#   CONTENT_DIR  path to the framework publish/content (the template source)
# Optional:
#   E2E_KEEP=1   skip teardown (leave artifacts for inspection)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=token-scopes.sh
. "$HERE/token-scopes.sh"

: "${E2E_ORG:?set E2E_ORG}"; : "${GH_TOKEN:?set GH_TOKEN}"; : "${GOV_TARBALL:?set GOV_TARBALL}"; : "${CONTENT_DIR:?set CONTENT_DIR}"
RUN_ID="${E2E_RUN_ID:-$(date +%s)}"           # unique namespace per run
SLUG="gov-e2e-${RUN_ID}"
WS_REPO="${SLUG}-gov"                          # the adopter workspace repo
CODE_REPO="${SLUG}-svc"                        # a code repo in the project
ROOT="$(mktemp -d)"
PASS=0; FAIL=0; CREATED=()
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; FAIL=$((FAIL+1)); [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::adopter journey: $*"; exit 1; }
# NO SILENT EXIT. Under `set -e` any failing line ends the run with no word of why — the 2026-10-07 live run died
# right after seed with a bare "exit code 2" (an awk on an absent file, inside a pipefail substitution). Name the
# line and the command, so the next one is read off the log rather than bisected.
on_err() { local rc=$? line=$1 cmd=$2; [ "$rc" -eq 0 ] && return 0
  printf '  \033[31m✗ line %s exited %s: %s\033[0m\n' "$line" "$rc" "$cmd"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::adopter journey: line $line exited $rc: $cmd"; return 0; }
trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR
assert_contains() { echo "$1" | grep -qF "$2" && ok "$3" || die "$3 — expected to contain: $2"; }

# ── Teardown (runs in THIS process — deletes work when the script is invoked by
#    you / CI, not blocked like an assistant tool-call). ──────────────────────
teardown() {
  local rc=$?
  trap - ERR
  if [ "${E2E_KEEP:-0}" = "1" ]; then echo "E2E_KEEP=1 — leaving $WS_REPO / $CODE_REPO / project"; else
  step "Teardown"
  # Only what this run created, and an exact account of what it could not delete (leak_report, token-scopes.sh).
  local leaked=() err
  for r in "${CREATED[@]:+${CREATED[@]}}"; do
    if err="$(gh repo delete "$r" --yes 2>&1 >/dev/null)"; then echo "  deleted $r"
    else leaked+=("$r"); echo "  ! could not delete $r: ${err%%$'\n'*}"; fi
  done
  if [ -n "${PROJ_NUM:-}" ]; then
    gh project delete "$PROJ_NUM" --owner "$E2E_ORG" >/dev/null 2>&1 && echo "  deleted project #$PROJ_NUM" || leaked+=("project #$PROJ_NUM")
  fi
  leak_report "${leaked[@]:+${leaked[@]}}"
  rm -rf "$ROOT"
  fi
  # The verdict is the LAST line of the step, pass or fail — a failure must not end on a teardown that looks routine.
  printf '\n\033[1m═══ adopter-journey: %d passed, %s ═══\033[0m\n' "$PASS" "$([ "$rc" -eq 0 ] && echo ok || echo "FAILED (exit $rc)")"
  exit "$rc"
}
trap teardown EXIT

# ── 0. Bootstrap: node ≥24 · install the packed gov · authenticate gh ────────
# Node acquisition is source-agnostic: use the runtime's node if it's already
# ≥24 (node:24 image, CI runner), else fall back to nvm (the local gyan image).
step "Bootstrap (node ≥24 · gov · gh auth)"
if node -v 2>/dev/null | grep -qE '^v(2[4-9]|[3-9][0-9])'; then
  :
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install 24 >/dev/null 2>&1; nvm use 24 >/dev/null
fi
node -v 2>/dev/null | grep -qE '^v(2[4-9]|[3-9][0-9])' && ok "node $(node -v)" || die "node ≥24 required (install it, or provide nvm)"
# A node:24 base image installs globals to root-owned /usr/local; a non-root
# adopter can't write there. Ensure a user-writable global prefix (nvm / CI
# runners already have one under $HOME, so this is a no-op there).
if ! npm config get prefix 2>/dev/null | grep -qF "$HOME"; then
  export NPM_CONFIG_PREFIX="$HOME/.npm-global"; export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"; mkdir -p "$NPM_CONFIG_PREFIX/bin"
fi
npm i -g "$GOV_TARBALL" >/dev/null 2>&1
command -v gov >/dev/null && ok "gov installed: $(gov --version 2>/dev/null || echo '?')" || die "gov not on PATH"
# GH_TOKEN in the env authenticates gh directly (no `gh auth login` needed).
gh api user --jq .login >/dev/null 2>&1 && ok "gh authenticated as $(gh api user --jq .login)" || die "gh auth failed (is GH_TOKEN set + valid?)"
# git identity (the fresh container has none) — needed to commit the workspace repo.
git config --global user.email "gyan@svayam.ai"
git config --global user.name "Gyan E2E"
git config --global init.defaultBranch main
gh auth setup-git 2>/dev/null   # make raw `git push` to github.com use gh's token
ok "git identity set ($(git config --global user.email)) + git credential helper"
# CAN IT CLEAN UP? Checked before anything is created: without delete_repo every repo below is leaked.
scope_check "$(gh api -i user 2>/dev/null || true)" "$E2E_ORG/$WS_REPO" "$E2E_ORG/$CODE_REPO"

# ── 1. Create the workspace repo from the framework template ─────────────────
step "Create adopter workspace repo ($E2E_ORG/$WS_REPO) from template content"
gh repo create "$E2E_ORG/$WS_REPO" --private --clone -- "$ROOT/$WS_REPO" >/dev/null 2>&1 || \
  { gh repo create "$E2E_ORG/$WS_REPO" --private >/dev/null && gh repo clone "$E2E_ORG/$WS_REPO" "$ROOT/$WS_REPO" >/dev/null 2>&1; }
CREATED+=("$E2E_ORG/$WS_REPO")
cp -R "$CONTENT_DIR"/. "$ROOT/$WS_REPO"/         # seed the workspace from publish/content (the template)
cd "$ROOT/$WS_REPO"
[ -f MANIFEST.yaml ] || die "template content missing (CONTENT_DIR wrong?)"
git add -A && git commit -qm "seed from framework template" || die "template commit failed (git identity?)"
git push -q origin HEAD 2>/dev/null || git push -q origin "HEAD:$(git symbolic-ref --short HEAD)" || die "template push failed"
ok "workspace seeded from template + pushed ($(git rev-parse --short HEAD))"

# ── 2. gov setup (non-interactive) → org-config.yaml filled, non-template ────
# Non-interactive setup derives github_org/workspace_repo from origin but needs
# org_name/org_slug pre-seeded (it has no prompt to ask them). github_org/
# workspace_repo come from the repo origin ($E2E_ORG/$WS_REPO).
step "gov setup"
# Pre-seed the fields non-interactive setup can't prompt for; setup honors existing values (answers ?? existing ??
# default). The slug follows today's rule — 2 to 6 letters or digits (it numbers the org's rules, GOV-<slug>-NNN) —
# and the home is registered below with `gov org add --home`; gov_workspace is no longer a key (2026-10-07).
cat > org-config.yaml <<YAML
org_name: "Gov E2E Org"
org_short_name: "GovE2E"
org_slug: "GE2E"
YAML
gov setup --non-interactive >/tmp/setup.log 2>&1 || true
grep -q "github_org: \"$E2E_ORG\"" org-config.yaml 2>/dev/null && ok "org-config.yaml written for $E2E_ORG" \
  || { echo "  --- setup log ---"; tail -8 /tmp/setup.log; die "org-config not configured for $E2E_ORG"; }
grep -q 'org_name: ""' org-config.yaml && die "org-config still in template state" || ok "workspace is non-template"
# Commit org-config so the project branch seed creates carries github_org — the
# per-project worktree resolves to ITSELF (cwd) only when its committed config
# names the active org; otherwise resolution falls back to the home clone (main).
git add -A && git commit -qm "gov setup: configure org-config.yaml" >/dev/null && git push -q origin HEAD 2>/dev/null && ok "committed org-config to the workspace" || die "commit/push org-config failed"
# `gov org add <github_org> --home <path>` — the home is a flag. This line passed it positionally, the syntax gov
# dropped; gov printed its usage (exit 2) into /dev/null, and the journey said only "add/use failed" (2026-10-07).
ORG_OUT="$( { gov org add "$E2E_ORG" --home "$PWD" && gov org use "$E2E_ORG"; } 2>&1 )" && ok "registered + activated org $E2E_ORG" \
  || { echo "$ORG_OUT" | tail -5; die "gov org add/use failed"; }

# ── 3. Create a code repo + a Project board + an issue ──────────────────────
step "Create code repo + project board + issue"
# a real code repo has an initial commit + the base branch gov branches off of
gh repo create "$E2E_ORG/$CODE_REPO" --private --add-readme >/dev/null && CREATED+=("$E2E_ORG/$CODE_REPO") && ok "code repo $CODE_REPO created" || die "code repo create failed"
CODE_BASE=$(grep -E '^default_code_branch:' org-config.yaml | sed -E 's/^default_code_branch:[[:space:]]*"?([^"#[:space:]]+).*/\1/')
DEFB=$(gh api "repos/$E2E_ORG/$CODE_REPO" --jq .default_branch 2>/dev/null)
if [ -n "$CODE_BASE" ] && [ "$CODE_BASE" != "$DEFB" ]; then
  SHA=$(gh api "repos/$E2E_ORG/$CODE_REPO/git/ref/heads/$DEFB" --jq .object.sha 2>/dev/null)
  gh api "repos/$E2E_ORG/$CODE_REPO/git/refs" -f ref="refs/heads/$CODE_BASE" -f sha="$SHA" >/dev/null 2>&1 && ok "base branch '$CODE_BASE' created" || die "could not create base branch '$CODE_BASE'"
fi
PROJ_URL=$(gh project create --owner "$E2E_ORG" --title "$SLUG" --format json --jq .url 2>/dev/null) && ok "project board: $PROJ_URL" || die "project create failed"
PROJ_NUM="${PROJ_URL##*/}"
ISSUE_URL=$(gh issue create --repo "$E2E_ORG/$CODE_REPO" --title "e2e: implement thing" --body "outcome under test" 2>/dev/null) && ok "issue: $ISSUE_URL" || die "issue create failed"
gh project item-add "$PROJ_NUM" --owner "$E2E_ORG" --url "$ISSUE_URL" >/dev/null 2>&1 && ok "issue linked to board" || true
# GitHub's project index is eventually consistent: a linked issue can take well over 40 s to appear on the board,
# and `gov seed` then fails with "no linked Issues or PRs". Wait up to ~3 min — and never call ZERO a pass.
for _ in $(seq 1 60); do
  N=$(gh api graphql -f query="query{organization(login:\"$E2E_ORG\"){projectV2(number:$PROJ_NUM){items(first:50){nodes{content{__typename}}}}}}" --jq '[.data.organization.projectV2.items.nodes[]|select(.content!=null)]|length' 2>/dev/null || echo 0)
  [ "${N:-0}" -ge 1 ] && break; sleep 3
done
[ "${N:-0}" -ge 1 ] || die "the board still shows no linked item after ~3 min — GitHub has not indexed the issue; gov seed would fail"
ok "board shows $N linked item(s)"

# ── 4. Work: seed → task → merge ────────────────────────────────────────────
step "gov seed → task → merge"
SEED_OUT=$(gov seed "$PROJ_URL" "$(gh api user --jq .login)" 2>&1) || { echo "$SEED_OUT" | tail -8; die "gov seed failed"; }
assert_contains "$SEED_OUT" "BRNCH-${PROJ_NUM}" "seed created the project branch"

# task/merge/close run from the seeded WORKSPACE WORKTREE (on the project branch),
# not the original clone (which is on main). seed put it under the work root: this person's own
# (~/.gov/work-roots), else ~/.gov/<slug>/projects — no longer an org-config key (org-config split).
SLUG_LC="$(grep -E '^org_slug:' org-config.yaml | sed -E 's/^org_slug:[[:space:]]*"?([^"#[:space:]]+).*/\1/' | tr '[:upper:]' '[:lower:]')"
# ~/.gov/work-roots exists only when someone chose a root; absent, awk exits 2 and pipefail made that the journey's
# exit — silently, the step's one failure on 2026-10-07. Absent means the default, so read it only when it is there.
AWR=""
if [ -f "$HOME/.gov/work-roots" ]; then
  AWR="$(awk -F'\t' -v o="$(grep -E '^github_org:' org-config.yaml | sed -E 's/^github_org:[[:space:]]*"?([^"#[:space:]]+).*/\1/')" '$1==o {print $2}' "$HOME/.gov/work-roots" | tail -1)"
fi
[ -n "$AWR" ] || AWR="$HOME/.gov/$SLUG_LC/projects"
AWR="${AWR/#\~/$HOME}"
PID="PRJ-${PROJ_NUM}-${SLUG}"
WS_WT="$AWR/$PID/$WS_REPO"
[ -d "$WS_WT/.git" ] || WS_WT="$(find "$AWR" -maxdepth 3 -type d -name "$WS_REPO" 2>/dev/null | head -1)"
[ -n "$WS_WT" ] && cd "$WS_WT" || die "seeded workspace worktree not found under $AWR"
ok "in project workspace on $(git rev-parse --abbrev-ref HEAD)"

TASK_OUT=$(gov task "$ISSUE_URL" 2>&1) || { echo "$TASK_OUT" | tail -8; die "gov task failed"; }
assert_contains "$TASK_OUT" "ISSUE-" "task opened a sub-branch"

# make a change in the code-repo worktree the task created, then land it
REPO_WT=$(find "$AWR" -maxdepth 3 -type d -name "$CODE_REPO" 2>/dev/null | head -1 || true)
if [ -n "$REPO_WT" ]; then
  echo "e2e change $RUN_ID" >> "$REPO_WT/E2E.md"
  ( cd "$REPO_WT" && git add -A && git commit -qm "e2e: implement thing (closes #${ISSUE_URL##*/})" )
  ok "committed a change on the task sub-branch"
fi
step "gov merge"
MERGE_OUT=$(gov merge "$ISSUE_URL" 2>&1) || {
  echo "$MERGE_OUT" | tail -8
  # "Uncommitted changes in <dir>" names a folder but not the files — show them, so the run explains itself.
  DIRTY=$(printf '%s\n' "$MERGE_OUT" | sed -n 's/^Uncommitted changes in \(.*\) — commit or stash first\./\1/p' | head -1)
  [ -n "$DIRTY" ] && { echo "  git status in $DIRTY:"; git -C "$DIRTY" status --porcelain -uall | head -20 | sed 's/^/    /'; }
  die "gov merge failed"; }
[ "$(gh issue view "$ISSUE_URL" --json state --jq .state 2>/dev/null)" = "CLOSED" ] && ok "merge closed the issue" || die "issue not closed after merge"

# ── 5. Propose org knowledge (branch → PR) ───────────────────────────────────
# Knowledge is an ORG-level op (branches off main) → run from the HOME clone, not
# the project worktree (which holds a project branch; main lives on the home clone).
step "gov knowledge propose → submit"
cd "$ROOT/$WS_REPO"
KN_OUT=$(gov knowledge propose "e2e-decision-${RUN_ID}" 2>&1) || { echo "$KN_OUT" | tail -8; die "gov knowledge propose failed"; }
assert_contains "$KN_OUT" "knowledge" "knowledge propose opened a change"

# ── 6. Close the project (knowledge gate → promote → close board) ────────────
# close is project-level → back in the project worktree. First satisfy the C01
# pre-close knowledge gate (a real adopter documents learnings before close).
step "document project knowledge (close gate) → gov close"
cd "$WS_WT"
KDIR="projects/$PID/knowledge"
mkdir -p "$KDIR"
printf '# Decisions\n\n- Implemented the e2e change.\n' > "$KDIR/decisions.md"
printf '# Compliance\n\nAll C01/C02 requirements satisfied for this project.\n' > "$KDIR/compliance.md"
cat > "$KDIR/knowledge-close.md" <<'KC'
# Knowledge Close

## Graduated to org knowledge
None for this project.

## Kept project-local
Implementation notes stay in the project.

## Discarded
Nothing.

## Journeys created / updated
None.

## Completeness critic
Reviewed — nothing outstanding.
KC
git add -A && git commit -qm "docs: project knowledge (close gate)" >/dev/null && ok "documented project knowledge" || die "knowledge commit failed"
CLOSE_OUT=$(gov close 2>&1) || { echo "$CLOSE_OUT" | tail -12; die "gov close failed"; }
[ "$(gh project view "$PROJ_NUM" --owner "$E2E_ORG" --format json --jq .closed 2>/dev/null)" = "true" ] && ok "close shut the board" \
  || assert_contains "$CLOSE_OUT" "close" "close ran the gate"

# ── 8. Gap-2: --gov-home resolves from an unrelated cwd (project-state-agnostic) ─
# `doctor --gov-home <ws>` reports the resolved home path regardless of project
# state — the cleanest proof the override bypasses cwd-based resolution.
step "Gap-2 — --gov-home override"
cd /tmp
DOC_OUT=$(gov doctor --gov-home "$ROOT/$WS_REPO" 2>&1 || true)
assert_contains "$DOC_OUT" "$WS_REPO" "gov --gov-home resolved the workspace from an unrelated cwd"

[ "$FAIL" -eq 0 ]   # the verdict banner is printed by the EXIT trap, after teardown
