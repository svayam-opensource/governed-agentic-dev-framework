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
#
# THE JOINER HANDOFF (PRJ-121 intent 05, Item 4 — T15). A second identity (e2e/joiner-journey.sh, bot B) works on THIS
# run's project, so the run is split in two phases around it, both in the CI `live` job:
#   E2E_PHASE=work    steps 1–5; with E2E_JOINER_LOGIN it also opens issue #2 for bot B and grants bot B write on the
#                     two repos and the board. Everything a later step needs goes to E2E_HANDOFF (a sourceable env
#                     file, appended as each thing is created, so a failure still leaves the teardown its list).
#                     Nothing is deleted: the repos must outlive the joiner.
#   E2E_PHASE=finish  reads E2E_HANDOFF; closes the project (step 6) and checks --gov-home (step 8) once the joiner is
#                     done, then tears down everything the work phase recorded. Run with `if: always()`.
#   unset / all       the whole journey in one process, as before (local and container runs).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=token-scopes.sh
. "$HERE/token-scopes.sh"
# shellcheck source=token-probe.sh
. "$HERE/token-probe.sh"

: "${E2E_ORG:?set E2E_ORG}"; : "${GH_TOKEN:?set GH_TOKEN}"; : "${GOV_TARBALL:?set GOV_TARBALL}"; : "${CONTENT_DIR:?set CONTENT_DIR}"
PHASE="${E2E_PHASE:-all}"; HANDOFF="${E2E_HANDOFF:-}"
case "$PHASE" in all|work|finish) ;; *) echo "E2E_PHASE must be all, work or finish (got '$PHASE')" >&2; exit 2 ;; esac
[ "$PHASE" = all ] || [ -n "$HANDOFF" ] || { echo "E2E_PHASE=$PHASE needs E2E_HANDOFF (the file the two phases share)" >&2; exit 2; }
JOINER_LOGIN="${E2E_JOINER_LOGIN:-}"
RUN_ID="${E2E_RUN_ID:-$(date +%s)}"           # unique namespace per run
SLUG="gov-e2e-${RUN_ID}"
WS_REPO="${SLUG}-gov"                          # the adopter workspace repo
CODE_REPO="${SLUG}-svc"                        # a code repo in the project
ROOT="$(mktemp -d)"
PASS=0; FAIL=0; CREATED=()
# The finish phase takes the work phase's names (RUN_ID, repos, ROOT, the board, CREATED) from the handoff.
if [ "$PHASE" = finish ]; then
  [ -f "$HANDOFF" ] || { echo "  no handoff at $HANDOFF — the work phase created nothing to finish or tear down"; exit 0; }
  rmdir "$ROOT" 2>/dev/null || true
  # shellcheck disable=SC1090
  . "$HANDOFF"
fi
# One line per fact, shell-quoted, appended as it becomes true — the finish phase and the joiner read it back.
handoff() { [ -n "$HANDOFF" ] || return 0; local k; for k in "$@"; do printf '%s=%q\n' "$k" "${!k}" >>"$HANDOFF"; done; }
created() { CREATED+=("$1"); [ -z "$HANDOFF" ] || printf 'CREATED+=(%q)\n' "$1" >>"$HANDOFF"; }
if [ "$PHASE" = work ]; then : >"$HANDOFF"; handoff E2E_ORG RUN_ID SLUG WS_REPO CODE_REPO ROOT; fi
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
  if [ "$PHASE" = work ]; then echo "  teardown deferred to the finish phase (E2E_PHASE=finish) — the joiner works in these repos first"
  elif [ "${E2E_KEEP:-0}" = "1" ]; then echo "E2E_KEEP=1 — leaving $WS_REPO / $CODE_REPO / project"; else
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
  printf '\n\033[1m═══ adopter-journey%s: %d passed, %s ═══\033[0m\n' "$([ "$PHASE" = all ] || echo " ($PHASE phase)")" "$PASS" "$([ "$rc" -eq 0 ] && echo ok || echo "FAILED (exit $rc)")"
  exit "$rc"
}
trap teardown EXIT

# ── 6 + 8, run last: by the single-process journey, or by the finish phase once the joiner is done ──
close_and_check() {
  # ── 6. Close the project (knowledge gate → promote → close board) ────────────
  # close is project-level → back in the project worktree. First satisfy the C01
  # pre-close: close proposes projects/<id>/knowledge/, so the project writes something there (no compliance.md or
  # knowledge-close.md is required — PRJ-121 §3.3, §3.4).
  step "document project knowledge (close gate) → gov close"
  cd "$WS_WT"
  KDIR="projects/$PID/knowledge"
  mkdir -p "$KDIR"
  printf '# Decisions\n\n- Implemented the e2e change.\n' > "$KDIR/decisions.md"
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
}

# Bot B's way in, granted by bot A (the sandbox org's owner) — never by widening bot B's own token: issue #2 on the
# board for bot B to take, write on both repos, write on the board. Each grant is read back, not assumed.
joiner_prep() {
  step "Prepare the joiner's share — issue #2 + access for $JOINER_LOGIN"
  local me; me="$(gh api user --jq .login)"
  [ "$JOINER_LOGIN" != "$me" ] || die "the joiner ($JOINER_LOGIN) is the adopter bot itself — TESTBED_JOINER_LOGIN must be a SECOND account"
  gh api "orgs/$E2E_ORG/members/$JOINER_LOGIN" >/dev/null 2>&1 && ok "$JOINER_LOGIN is a member of $E2E_ORG" \
    || die "$JOINER_LOGIN is not a member of $E2E_ORG — the second test account must be an org member (Policy Owner prerequisite P1)"
  local r perm
  for r in "$WS_REPO" "$CODE_REPO"; do
    gh api -X PUT "repos/$E2E_ORG/$r/collaborators/$JOINER_LOGIN" -f permission=push >/dev/null || die "could not grant $JOINER_LOGIN write on $r"
    perm="$(gh api "repos/$E2E_ORG/$r/collaborators/$JOINER_LOGIN/permission" --jq .permission 2>/dev/null || true)"
    case "$perm" in write|admin|maintain) ok "$JOINER_LOGIN has $perm on $r" ;; *) die "$JOINER_LOGIN's permission on $r reads '${perm:-none}' after the grant" ;; esac
  done
  local pid uid role
  pid="$(gh project view "$PROJ_NUM" --owner "$E2E_ORG" --format json --jq .id)"
  uid="$(gh api "users/$JOINER_LOGIN" --jq .node_id)"
  gh api graphql -f p="$pid" -f u="$uid" -f query='mutation($p:ID!,$u:ID!){updateProjectV2Collaborators(input:{projectId:$p,collaborators:[{userId:$u,role:WRITER}]}){clientMutationId}}' >/dev/null \
    || die "could not make $JOINER_LOGIN a WRITER on board #$PROJ_NUM"
  role="$(gh api graphql -f p="$pid" -f query='query($p:ID!){node(id:$p){... on ProjectV2{collaborators(first:50){edges{role node{... on User{login}}}}}}}' \
    --jq ".data.node.collaborators.edges[]|select(.node.login==\"$JOINER_LOGIN\")|.role" 2>/dev/null || true)"
  case "$role" in WRITER|ADMIN) ok "$JOINER_LOGIN is $role on board #$PROJ_NUM" ;; *) die "$JOINER_LOGIN's role on board #$PROJ_NUM reads '${role:-none}' after the grant" ;; esac
  JOINER_ISSUE_URL=$(gh issue create --repo "$E2E_ORG/$CODE_REPO" --title "e2e: the joiner's change" --body "taken and landed by the second identity (joiner journey)") \
    && ok "joiner's issue: $JOINER_ISSUE_URL" || die "joiner issue create failed"
  local add; add="$(gh project item-add "$PROJ_NUM" --owner "$E2E_ORG" --url "$JOINER_ISSUE_URL" --format json 2>&1)" \
    && ok "joiner's issue linked to board #$PROJ_NUM" || die "gh project item-add (joiner issue) failed: ${add%%$'\n'*}"
  # shellcheck disable=SC2034  # read through ${!k} by handoff()
  ADOPTER_LOGIN="$me"
  handoff JOINER_ISSUE_URL ADOPTER_LOGIN JOINER_LOGIN
}

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

if [ "$PHASE" = finish ]; then
  # A work phase that stopped early has nothing to close — only its teardown, which the EXIT trap does now.
  [ "${WORK_DONE:-0}" = 1 ] || { echo "  the work phase did not finish — nothing to close; tearing down what it created"; exit 0; }
  cd "$WS_WT" 2>/dev/null || die "the project workspace $WS_WT is gone (the work phase's HOME was not kept?)"
  close_and_check
  [ "$FAIL" -eq 0 ]; exit
fi

# ── 1. Create the workspace repo from the framework template ─────────────────
step "Create adopter workspace repo ($E2E_ORG/$WS_REPO) from template content"
gh repo create "$E2E_ORG/$WS_REPO" --private --clone -- "$ROOT/$WS_REPO" >/dev/null 2>&1 || \
  { gh repo create "$E2E_ORG/$WS_REPO" --private >/dev/null && gh repo clone "$E2E_ORG/$WS_REPO" "$ROOT/$WS_REPO" >/dev/null 2>&1; }
created "$E2E_ORG/$WS_REPO"
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
# Its exit is checked (it was `|| true`, read only through the grep below — PRJ-121 intent 05, Item 1): a setup that
# failed after writing org-config would have passed.
SETUP_RC=0; gov setup --non-interactive >/tmp/setup.log 2>&1 || SETUP_RC=$?
[ "$SETUP_RC" -eq 0 ] || { echo "  --- setup log ---"; tail -15 /tmp/setup.log; die "gov setup --non-interactive exited $SETUP_RC"; }
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
gh repo create "$E2E_ORG/$CODE_REPO" --private --add-readme >/dev/null && created "$E2E_ORG/$CODE_REPO" && ok "code repo $CODE_REPO created" || die "code repo create failed"
CODE_BASE=$(grep -E '^default_code_branch:' org-config.yaml | sed -E 's/^default_code_branch:[[:space:]]*"?([^"#[:space:]]+).*/\1/')
DEFB=$(gh api "repos/$E2E_ORG/$CODE_REPO" --jq .default_branch 2>/dev/null)
if [ -n "$CODE_BASE" ] && [ "$CODE_BASE" != "$DEFB" ]; then
  SHA=$(gh api "repos/$E2E_ORG/$CODE_REPO/git/ref/heads/$DEFB" --jq .object.sha 2>/dev/null)
  gh api "repos/$E2E_ORG/$CODE_REPO/git/refs" -f ref="refs/heads/$CODE_BASE" -f sha="$SHA" >/dev/null 2>&1 && ok "base branch '$CODE_BASE' created" || die "could not create base branch '$CODE_BASE'"
fi
PROJ_URL=$(gh project create --owner "$E2E_ORG" --title "$SLUG" --format json --jq .url 2>/dev/null) && ok "project board: $PROJ_URL" || die "project create failed"
PROJ_NUM="${PROJ_URL##*/}"
handoff PROJ_URL PROJ_NUM
ISSUE_URL=$(gh issue create --repo "$E2E_ORG/$CODE_REPO" --title "e2e: implement thing" --body "outcome under test" 2>/dev/null) && ok "issue: $ISSUE_URL" || die "issue create failed"
# item-add's exit is checked and its failure named (it was `|| true` — PRJ-121 intent 05, Item 5).
ADD_OUT="$(gh project item-add "$PROJ_NUM" --owner "$E2E_ORG" --url "$ISSUE_URL" --format json 2>&1)" && ok "issue linked to board" \
  || die "gh project item-add failed: ${ADD_OUT%%$'\n'*}"
# The item's node id, so a board that stays empty can be told apart: the item exists but is not listed yet, or is gone.
ITEM_ID="$(printf '%s' "$ADD_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).id||"")}catch{}})')"
export ITEM_ID ISSUE_URL
# THE TOKEN PROBE (ruling Q6): what the token is, and whether it can read the new repo, its issue and the board's item.
token_probe "$E2E_ORG" "$E2E_ORG/$CODE_REPO" "${ISSUE_URL##*/}" "$PROJ_NUM"
# GitHub's project index is eventually consistent: a linked issue can take well over 40 s to appear on the board, and
# `gov seed` then fails with "no linked Issues or PRs". board_poll waits up to 3 min for NO items — but items whose
# content is null mean the token cannot read the issue, and it dies on that at once (token-probe.sh).
board_poll "$E2E_ORG" "$PROJ_NUM" "$E2E_ORG/$CODE_REPO"
ok "board shows $BOARD_ITEMS linked item(s) (poll $BOARD_POLLS)"

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
handoff PID WS_WT
ok "in project workspace on $(git rev-parse --abbrev-ref HEAD)"

TASK_OUT=$(gov task "$ISSUE_URL" 2>&1) || { echo "$TASK_OUT" | tail -8; die "gov task failed"; }
assert_contains "$TASK_OUT" "ISSUE-" "task opened a sub-branch"
# gadf#225 — the issue's board Status, read back from GitHub (never from gov's own output), from the ISSUE side.
board_status() { gh api graphql -f u="$ISSUE_URL" -f query='query($u:URI!){resource(url:$u){... on Issue{projectItems(first:20){nodes{project{number} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}' \
  --jq ".data.resource.projectItems.nodes[]|select(.project.number==$PROJ_NUM)|.fieldValueByName.name // empty"; }
assert_status() { local s; s=$(board_status 2>&1) || s="(read failed: $s)"
  [ "$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" ] && ok "board Status is '$s' after $2" \
    || { printf '%s\n' "$3" | grep 'board:' | sed 's/^/    /'; die "board Status after $2 is '${s:-none}', expected '$1'"; }; }
assert_status "In progress" "gov task" "$TASK_OUT"

# make a change in the code-repo worktree the task created, then land it. The clone is at EXACTLY
# <project work root>/<repo> — the work root `gov seed` printed ("  workspace: <dir>"). A `find | head -1` under the
# whole work root could pick another project's clone, or none, and then the commit was silently skipped (PRJ-121 Item 6).
PWR=$(printf '%s\n' "$SEED_OUT" | sed -n 's/^  workspace: //p' | head -1)
[ -n "$PWR" ] || PWR="$AWR/$PID"
REPO_WT="${PWR/#\~/$HOME}/$CODE_REPO"
[ -d "$REPO_WT/.git" ] || [ -f "$REPO_WT/.git" ] || die "code-repo clone not found at $REPO_WT (work root from gov seed: $PWR)"
echo "e2e change $RUN_ID" >> "$REPO_WT/E2E.md"
# ONLY THE WORK FILE IS COMMITTED (D20, Policy Owner 2026-10-13 — the T06 gap). `git add -A` used to commit gov's
# agent files too, so CI never saw merge face them uncommitted. Now they stay as gov left them, and the run proves
# two things: merge proceeds past gov's own files, and it names any OTHER uncommitted file.
( cd "$REPO_WT" && git add -- E2E.md && git commit -qm "e2e: implement thing (closes #${ISSUE_URL##*/})" )
ok "committed the work file only, on the task sub-branch"
GOV_LEFT=$( { git -C "$REPO_WT" status --porcelain -uall; git -C "$WS_WT" status --porcelain -uall; } | wc -l | tr -d ' ')
[ "$GOV_LEFT" -gt 0 ] && ok "gov's agent files are left uncommitted ($GOV_LEFT path(s)) for merge to face" \
  || die "nothing is left uncommitted — the case D20 tests is not exercised (did gov seed place the harness?)"

step "gov merge names a dirty file that is not gov's"
echo "not gov's" > "$REPO_WT/e2e-stray.txt"
STRAY_OUT=$(gov merge "$ISSUE_URL" 2>&1) && die "gov merge went ahead with e2e-stray.txt uncommitted"
assert_contains "$STRAY_OUT" "e2e-stray.txt" "merge refused, naming the stray file"
printf '%s\n' "$STRAY_OUT" | grep -qE "CLAUDE\.md|AGENTS\.md|\.claude/skills|\.agents/skills" \
  && die "the refusal named gov's own agent files — they must never block (Q7)" || ok "and only that file — not gov's agent files"
rm -f "$REPO_WT/e2e-stray.txt"

step "gov merge"
MERGE_OUT=$(gov merge "$ISSUE_URL" 2>&1) || {
  echo "$MERGE_OUT" | tail -8
  # "Uncommitted changes in <dir>: <files>" names at most five files — show the full status, so the run explains itself.
  DIRTY=$(printf '%s\n' "$MERGE_OUT" | sed -n 's/^Uncommitted changes in \([^:]*\): .* — commit or stash first\./\1/p' | head -1)
  [ -n "$DIRTY" ] && { echo "  git status in $DIRTY:"; git -C "$DIRTY" status --porcelain -uall | head -20 | sed 's/^/    /'; }
  die "gov merge failed"; }
[ "$(gh issue view "$ISSUE_URL" --json state --jq .state 2>/dev/null)" = "CLOSED" ] && ok "merge closed the issue" || die "issue not closed after merge"
assert_status "Done" "gov merge" "$MERGE_OUT"

# ── 5. Propose org knowledge (branch → PR) ───────────────────────────────────
# Knowledge is an ORG-level op (branches off main) → run from the HOME clone, not
# the project worktree (which holds a project branch; main lives on the home clone).
step "gov knowledge propose → submit"
cd "$ROOT/$WS_REPO"
KN_OUT=$(gov knowledge propose "e2e-decision-${RUN_ID}" 2>&1) || { echo "$KN_OUT" | tail -8; die "gov knowledge propose failed"; }
assert_contains "$KN_OUT" "knowledge" "knowledge propose opened a change"

# ── 7. The joiner's share (PRJ-121 intent 05, Item 4 — T15) ─────────────────
# Only in the split run: a single-process journey has no joiner to take issue #2, and an open #2 would block close.
if [ -n "$JOINER_LOGIN" ] && [ "$PHASE" = work ]; then joiner_prep; fi
if [ "$PHASE" = work ]; then
  WORK_DONE=1; handoff WORK_DONE
  ok "handoff written for the joiner and the finish phase"
  exit 0                       # the EXIT trap prints the verdict; teardown is the finish phase's
fi
close_and_check
[ "$FAIL" -eq 0 ]   # the verdict banner is printed by the EXIT trap, after teardown
