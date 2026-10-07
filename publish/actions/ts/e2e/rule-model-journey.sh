#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# RULE-MODEL JOURNEY — the sandbox run of 2026-10-07 in svayam-e2e, scripted (rule-model-design.md, "sandbox CI").
# Against REAL GitHub, in ephemeral private repos it creates and always deletes:
#
#   <prefix>-gov   a governance repo: org-config + governance.yaml → gov setup → gov upgrade → checks on the TARBALL
#   <prefix>-app   a code repo whose check reads the gov repo's rules through the sandbox GitHub App
#
# Assertions:
#   (a) a PR touching only workflows/config: GOV-FRM-455, 467 and 468 pass
#   (b) a direct push to the default branch: GOV-FRM-040 opens a gov-violation issue assigned to the Policy Owner
#   (c) a policy prose PR: GOV-FRM-467 reports the section unreviewed; GOV-FRM-468 runs propose (stub model)
#   (d) the bot's follow-up run waits for approval (action_required); approved through the API, GOV-FRM-467 passes
#   (e) merging a PR with a red gov check under soft posture opens a gov-violation record naming the PR
#   (f) the code repo's check reads the gov repo's rules through the App (SKIPPED, never failed, without the App)
#
# Propose uses a STUB `command` model (a script returning one fixed valid proposal): no key, no cost. The REAL
# model (gemini, GEMINI_API_KEY) runs only with E2E_REAL_MODEL=1 — CI sets that on workflow_dispatch only.
#
# Required env (live):
#   E2E_ORG       the sandbox org (svayam-e2e) — never a real org
#   GH_TOKEN      classic PAT: repo, workflow, delete_repo, read:org (falls back to `gh auth token`)
#   GOV_TARBALL   the packed gov under test (npm pack output) — every workflow installs THIS, nothing published
#   CONTENT_DIR   publish/content (the framework content `gov upgrade --from` installs)
# Optional:
#   E2E_APP_CLIENT_ID / E2E_APP_PRIVATE_KEY   the sandbox App (created once by a human) — enables (f)
#   E2E_REAL_MODEL=1 + GEMINI_API_KEY [+ E2E_GEMINI_MODEL]   the real model instead of the stub
#   E2E_KEEP=1            leave the repos for inspection
#   E2E_WAIT_SECS         cap on one wait for a check (default 480)
#   E2E_DEADLINE_SECS     cap on the whole run's waiting (default 2100 — inside the job's timeout)
#
#   --dry-run (or E2E_DRY_RUN=1)  HERMETIC: prints every gh / git / gov / npm / curl call instead of making it.
#                                 No token, org or network needed; assertions are listed, not evaluated.
# shellcheck disable=SC2015,SC2016  # `a && b || die` is the house idiom (adopter-journey.sh); perl's $1 is literal
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=token-scopes.sh
. "$HERE/token-scopes.sh"
# shellcheck source=check-annotations.sh
. "$HERE/check-annotations.sh"
DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;; esac; done
[ "${E2E_DRY_RUN:-0}" = "1" ] && DRY=1
exec 3>&2   # the dry run's "+ call" lines: the terminal, even from inside a redirected subshell

if [ "$DRY" = 1 ]; then
  E2E_ORG="${E2E_ORG:-dry-sandbox-org}"; GH_TOKEN="dry-token-never-used"
  GOV_TARBALL="${GOV_TARBALL:-/dry/svayam-opensource-gov.tgz}"
  CONTENT_DIR="${CONTENT_DIR:-$(cd "$HERE/../../../content" && pwd)}"
fi
: "${E2E_ORG:?set E2E_ORG}"; : "${GOV_TARBALL:?set GOV_TARBALL}"; : "${CONTENT_DIR:?set CONTENT_DIR}"
# THE TOKEN BEFORE HOME MOVES: on macOS gh keeps it in a keyring found through HOME.
if [ -z "${GH_TOKEN:-}" ]; then GH_TOKEN="$(gh auth token 2>/dev/null || true)"; fi
: "${GH_TOKEN:?set GH_TOKEN (or log gh in)}"
export GH_TOKEN

REAL_MODEL="${E2E_REAL_MODEL:-0}"
if [ "$REAL_MODEL" = "1" ] && [ "$DRY" != 1 ]; then : "${GEMINI_API_KEY:?E2E_REAL_MODEL=1 needs GEMINI_API_KEY}"; fi
WAIT_SECS="${E2E_WAIT_SECS:-480}"
DEADLINE=$((SECONDS + ${E2E_DEADLINE_SECS:-2100}))
RUN_ID="${E2E_RUN_ID:-$(date +%s)-$((RANDOM % 1000))}"
[ "$DRY" = 1 ] && RUN_ID="dry"
PREFIX="rmj-${RUN_ID}"
GOV_REPO="$PREFIX-gov"; APP_REPO="$PREFIX-app"
R_GOV="$E2E_ORG/$GOV_REPO"; R_APP="$E2E_ORG/$APP_REPO"
ROOT="$(mktemp -d)"
PASS=0; SKIP=0; CREATED=()

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
note() { printf '  \033[33m! %s\033[0m\n' "$*"; }
skip() { printf '  \033[33m⤼ SKIPPED: %s\033[0m\n' "$*"; SKIP=$((SKIP+1)); [ -n "${GITHUB_ACTIONS:-}" ] && echo "::notice::rule-model journey: skipped $*"; return 0; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::rule-model journey: $*"; exit 1; }
# No silent exit: a line that fails under `set -e` is named, with its command (see adopter-journey.sh, 2026-10-07).
on_err() { local rc=$? line=$1 cmd=$2; [ "$rc" -eq 0 ] && return 0
  printf '  \033[31m✗ line %s exited %s: %s\033[0m\n' "$line" "$rc" "$cmd"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::rule-model journey: line $line exited $rc: $cmd"; return 0; }
trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR

# THE ONLY DOORS TO THE OUTSIDE. Dry: print the call, make none. `x` runs; `xo DEFAULT …` captures stdout (dry: DEFAULT).
x()  { if [ "$DRY" = 1 ]; then printf '  + %s\n' "$*" >&3; return 0; fi; "$@"; }
xo() { local d="$1"; shift; if [ "$DRY" = 1 ]; then printf '  + %s\n' "$*" >&3; printf '%s\n' "$d"; return 0; fi; "$@"; }
# An assertion: dry lists it; live evaluates `cond…` and passes or dies.
expect() { local msg="$1"; shift; if [ "$DRY" = 1 ]; then printf '  ◇ would assert: %s\n' "$msg"; PASS=$((PASS+1)); return 0; fi
  if "$@"; then ok "$msg"; else die "$msg"; fi; }
# A secret's value goes on stdin, never on a command line (and never into the dry-run's output).
secret_set() { local name="$1" repo="$2" var="$3"
  if [ "$DRY" = 1 ]; then printf '  + gh secret set %s --repo %s   (value from $%s on stdin)\n' "$name" "$repo" "$var" >&3; return 0; fi
  printf '%s' "${!var}" | gh secret set "$name" --repo "$repo" >/dev/null; }

# ── Teardown: ALWAYS, on success, failure or cancellation ────────────────────────────────────────────────────────
teardown() {
  local rc=$?
  trap - ERR
  if [ "${E2E_KEEP:-0}" = "1" ]; then echo "E2E_KEEP=1 — leaving ${CREATED[*]:-nothing}"; else
    step "Teardown"
    local leaked=() err
    for r in "${CREATED[@]:+${CREATED[@]}}"; do
      if err="$(x gh repo delete "$r" --yes 2>&1 >/dev/null)"; then echo "  deleted $r"
      else leaked+=("$r"); echo "  ! could not delete $r: ${err%%$'\n'*}"; fi
    done
    leak_report "${leaked[@]:+${leaked[@]}}"   # exactly what is left behind, as a ::warning:: in Actions
  fi
  rm -rf "$ROOT"
  printf '\n\033[1m═══ rule-model-journey%s: %d passed, %d skipped, %s ═══\033[0m\n' "$([ "$DRY" = 1 ] && echo ' (DRY RUN)')" "$PASS" "$SKIP" "$([ $rc -eq 0 ] && echo ok || echo FAILED)"
  exit $rc
}
trap teardown EXIT
trap 'exit 130' INT TERM   # a cancelled job still deletes its repos

# Wait for check run `name` on `sha` to complete. Prints "<conclusion> <check-run id>", or "timeout -".
wait_check() { local repo="$1" sha="$2" name="$3" t0=$SECONDS line
  if [ "$DRY" = 1 ]; then printf '  + poll gh api repos/%s/commits/%s/check-runs until "%s" completes (≤%ss)\n' "$repo" "$sha" "$name" "$WAIT_SECS" >&3; echo "dry 0"; return 0; fi
  while :; do
    line="$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" \
      --jq ".check_runs[] | select(.name == \"$name\") | \"\(.status) \(.conclusion) \(.id)\"" 2>/dev/null | head -1 || true)"
    if [ "${line%% *}" = "completed" ]; then echo "${line#* }"; return 0; fi
    if [ $((SECONDS - t0)) -ge "$WAIT_SECS" ] || [ "$SECONDS" -ge "$DEADLINE" ]; then echo "timeout -"; return 0; fi
    sleep 10
  done
}
# What a check FOUND is read from its check run's annotations (expect_annotation, check-annotations.sh) — never from
# the job's log, whose download came back empty in two live runs. What a check DID is read from the repository.
# A file at a ref, raw (dry: DEFAULT).
file_at() { xo "$4" gh api "repos/$1/contents/$2?ref=$3" -H "Accept: application/vnd.github.raw"; }
# Poll `cmd…` until it prints something non-empty; prints it (empty on timeout).
poll() { local t0=$SECONDS out
  if [ "$DRY" = 1 ]; then printf '  + poll: %s\n' "$*" >&3; echo "dry"; return 0; fi
  while :; do out="$("$@" 2>/dev/null || true)"; [ -n "$out" ] && { echo "$out"; return 0; }
    if [ $((SECONDS - t0)) -ge "$WAIT_SECS" ] || [ "$SECONDS" -ge "$DEADLINE" ]; then return 0; fi; sleep 10; done; }
violations() { gh issue list --repo "$1" --label gov-violation --state all --json number,title,assignees \
  --jq ".[] | select(.title | test(\"$2\")) | select([.assignees[].login] | index(\"$LOGIN\")) | .number" | head -1; }
open_pr() { # branch title → prints the PR number
  x git -C "$3" push -q -u origin "$1"
  local url; url="$(xo "https://github.com/$4/pull/1" gh pr create --repo "$4" --base "$DEF" --head "$1" --title "$2" --body "rule-model journey $RUN_ID")"
  echo "${url##*/}"; }
head_of() { xo "dry-sha-$2" gh pr view "$2" --repo "$1" --json headRefOid --jq .headRefOid; }

# ── 0. Bootstrap: isolated HOME, the packed gov, gh + git ────────────────────────────────────────────────────────
step "Bootstrap (isolated HOME · packed gov · gh)"
export HOME="$ROOT/home" XDG_CONFIG_HOME="$ROOT/home/.config" GH_CONFIG_DIR="$ROOT/home/.config/gh" GIT_CONFIG_GLOBAL="$ROOT/home/.gitconfig"
export NPM_CONFIG_PREFIX="$ROOT/npm" PATH="$ROOT/npm/bin:$PATH" GH_PROMPT_DISABLED=1
mkdir -p "$HOME" "$NPM_CONFIG_PREFIX/bin"
x npm i -g "$GOV_TARBALL" >/dev/null 2>&1 || die "could not install $GOV_TARBALL"
x gov --version >/dev/null || die "gov not on PATH after installing the tarball"
LOGIN="$(xo e2e-bot gh api user --jq .login)" || die "gh auth failed (GH_TOKEN)"
[ -n "$LOGIN" ] || die "gh auth failed (GH_TOKEN)"
# CAN IT CLEAN UP? Checked before anything is created: without delete_repo every repo below is leaked (run 37550667671).
scope_check "$(xo $'HTTP/2.0 200 OK\nX-Oauth-Scopes: repo, workflow, delete_repo, read:org' gh api -i user 2>/dev/null || true)" "$R_GOV" "$R_APP"
x git config --global user.name "$LOGIN"
x git config --global user.email "$LOGIN@users.noreply.github.com"
x git config --global init.defaultBranch main
x git config --global credential.https://github.com.helper '!gh auth git-credential'
ok "gov from the tarball · gh as $LOGIN · HOME=$HOME"

# Sweep leftovers of runs that were killed before their trap (prefix rmj-<epoch>-, older than two hours).
for r in $(xo "" gh repo list "$E2E_ORG" --limit 200 --json name --jq '.[].name | select(test("^rmj-[0-9]+-"))'); do
  ts="${r#rmj-}"; ts="${ts%%-*}"
  [ "$ts" -lt $(( $(date +%s) - 7200 )) ] 2>/dev/null && x gh repo delete "$E2E_ORG/$r" --yes >/dev/null 2>&1 && note "swept leftover $r"
done

# ── 1. Ephemeral repos ───────────────────────────────────────────────────────────────────────────────────────────
step "Create $R_GOV + $R_APP (private, ephemeral)"
for r in "$R_GOV" "$R_APP"; do
  x gh repo create "$r" --private --add-readme >/dev/null || die "could not create $r"
  CREATED+=("$r")
done
DEF="$(xo main gh api "repos/$R_GOV" --jq .default_branch)"
APP_DEF="$(xo main gh api "repos/$R_APP" --jq .default_branch)"
x git clone -q "https://github.com/$R_GOV.git" "$ROOT/gov" || die "clone $R_GOV failed"
x git clone -q "https://github.com/$R_APP.git" "$ROOT/app" || die "clone $R_APP failed"
mkdir -p "$ROOT/gov/policies" "$ROOT/gov/.gov-ci" "$ROOT/app/.gov-ci"
ok "created both repos (default branch $DEF)"

# ── 2. Governance repo: org-config + governance.yaml → gov setup → gov upgrade, landed by PR ─────────────────────
step "gov setup + gov upgrade --apply --from <content> (PR, merged)"
G="$ROOT/gov"
x git -C "$G" switch -q -c e2e/setup
cat > "$G/org-config.yaml" <<YAML
org_name: "Rule Model E2E $RUN_ID"
org_short_name: "RME2E"
org_slug: "RME"
org_repo_url: "https://github.com/$R_GOV"
github_org: "$E2E_ORG"
org_gov_repo: "$GOV_REPO"
default_branch: "$DEF"
default_code_branch: "$APP_DEF"
YAML
if [ "$REAL_MODEL" = "1" ]; then
  PROVIDER="gemini"; MODEL="${E2E_GEMINI_MODEL:-gemini-2.5-pro}"; COMMAND=""
else
  PROVIDER="command"; MODEL=""; COMMAND="bash .gov-ci/stub-model.sh"
fi
cat > "$G/policies/governance.yaml" <<YAML
# rule-model journey $RUN_ID — soft posture (GitHub Free, private), the token's owner holds every role.
governance_posture: "soft"
policy_owner:
  email: ""
  github: "@$LOGIN"
check_owner:
  github: "@$LOGIN"
authorized_agents:
  default: ""
knowledge_publication: "none"
models:
  propose:
    provider: "$PROVIDER"
    model: "$MODEL"
  command: "$COMMAND"
  ci_allowed: true
YAML
# THE STUB MODEL: ignores the request, returns one fixed valid proposal (an add for the edited section).
cat > "$G/.gov-ci/stub-model.sh" <<'SH'
#!/usr/bin/env bash
# Stub `command` model for the rule-model e2e — no API key, no cost, the same answer every run.
cat >/dev/null
cat <<'JSON'
{"verdicts":[{"kind":"add","row":{"expectation":"A change to application behaviour, or a bug fix, comes with a test that would fail without it.","actor":["human","agent"],"level":"C02","cue":{"tier":"on-demand","text":"Add a test that fails without your change."}}}],"ownership":[],"questions":[]}
JSON
SH
( cd "$G" && x gov setup --non-interactive >"$ROOT/setup.log" 2>&1 ) || { tail -15 "$ROOT/setup.log"; die "gov setup failed"; }
( cd "$G" && x gov upgrade --apply --from "$CONTENT_DIR" --gov-home . >"$ROOT/upgrade.log" 2>&1 ) || { tail -15 "$ROOT/upgrade.log"; die "gov upgrade failed"; }
expect "governance.yaml kept the CI model setting through setup + upgrade" grep -q 'ci_allowed: true' "$G/policies/governance.yaml"
expect "upgrade installed the framework rules" test -f "$G/framework/rules/rules.yaml"
x git -C "$G" add -A && x git -C "$G" commit -qm "gov setup + upgrade (rule-model journey)" || die "commit failed"
PR_SETUP="$(open_pr e2e/setup "gov setup + upgrade" "$G" "$R_GOV")"
x gh pr merge "$PR_SETUP" --repo "$R_GOV" --merge --delete-branch >/dev/null || die "merge of #$PR_SETUP failed"
x git -C "$G" switch -q "$DEF" && x git -C "$G" pull -q --ff-only || die "pull $DEF failed"
ok "setup PR #$PR_SETUP merged"

# ── 3. Secrets per repo (Free + private: org secrets do not arrive) · the App on both repos ─────────────────────
step "Repo secrets + the sandbox App"
APP_READY=0
if [ "$REAL_MODEL" = "1" ]; then secret_set GEMINI_API_KEY "$R_GOV" GEMINI_API_KEY; ok "GEMINI_API_KEY set on $R_GOV"; fi
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
app_jwt() { local now h p s; now="$(date +%s)"
  h="$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)"
  p="$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' $((now - 60)) $((now + 540)) "$E2E_APP_CLIENT_ID" | b64url)"
  s="$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -binary -sign <(printf '%s\n' "$E2E_APP_PRIVATE_KEY") | b64url)" || return 1
  printf '%s.%s.%s' "$h" "$p" "$s"; }
if [ -z "${E2E_APP_CLIENT_ID:-}" ] || [ -z "${E2E_APP_PRIVATE_KEY:-}" ]; then
  skip "(f) — no sandbox App (set GOV_E2E_APP_CLIENT_ID + GOV_E2E_APP_PRIVATE_KEY; see e2e/README.md)"
else
  for r in "$R_GOV" "$R_APP"; do secret_set GOV_APP_CLIENT_ID "$r" E2E_APP_CLIENT_ID; secret_set GOV_APP_PRIVATE_KEY "$r" E2E_APP_PRIVATE_KEY; done
  ok "GOV_APP_CLIENT_ID / GOV_APP_PRIVATE_KEY set as repo secrets on both repos"
  if [ "$DRY" = 1 ]; then
    printf '  + curl -H @- https://api.github.com/orgs/%s/installation   (App JWT on stdin)\n' "$E2E_ORG" >&3
    INST="1 selected"
  else
    INST="$( { printf 'Authorization: Bearer %s\nAccept: application/vnd.github+json\n' "$(app_jwt)"; } \
      | curl -fsS -H @- "https://api.github.com/orgs/$E2E_ORG/installation" 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.id+" "+j.repository_selection)})' 2>/dev/null || true)"
  fi
  IID="${INST%% *}"; SEL="${INST#* }"
  if ! [[ "$IID" =~ ^[0-9]+$ ]]; then
    skip "(f) — the App is not installed on $E2E_ORG, or its key/client id is wrong"
  elif [ "$SEL" = "all" ]; then
    APP_READY=1; ok "App installation $IID covers all repositories"
  else
    added=1
    for r in "$R_GOV" "$R_APP"; do
      rid="$(xo 1 gh api "repos/$r" --jq .id)"
      x gh api -X PUT "user/installations/$IID/repositories/$rid" >/dev/null 2>&1 || added=0
    done
    if [ "$added" = 1 ]; then APP_READY=1; ok "App installation $IID now includes both repos"
    else skip "(f) — could not add the repos to App installation $IID (the token needs an org owner, classic repo scope)"; fi
  fi
fi

# (f) is started early so it runs while the gov repo's PRs do: the code repo's checks, on the tarball, pushed.
if [ "$APP_READY" = 1 ]; then
  ( cd "$G" && x gov check install --repo "$ROOT/app" --gov-package ./.gov-ci/gov.tgz --gov-home . >"$ROOT/app-install.log" 2>&1 ) \
    || { tail -10 "$ROOT/app-install.log"; die "gov check install (code repo) failed"; }
  x cp "$GOV_TARBALL" "$ROOT/app/.gov-ci/gov.tgz"
  x git -C "$ROOT/app" add -A && x git -C "$ROOT/app" commit -qm "gov checks (rule-model journey)" && x git -C "$ROOT/app" push -q origin "$APP_DEF" \
    || die "could not push the code repo's workflow"
  APP_SHA="$(xo dry-app-sha git -C "$ROOT/app" rev-parse HEAD)"
  ok "code repo workflow pushed ($APP_SHA) — checked at the end"
fi

# ── (a) a PR touching only workflows/config: the gov checks pass ─────────────────────────────────────────────────
step "(a) workflows/config-only PR — GOV-FRM-455 · 467 · 468 pass"
x git -C "$G" switch -q -c e2e/checks
x cp "$GOV_TARBALL" "$G/.gov-ci/gov.tgz"
( cd "$G" && x gov check install --gov-package ./.gov-ci/gov.tgz --gov-home . >"$ROOT/install.log" 2>&1 ) || { tail -10 "$ROOT/install.log"; die "gov check install failed"; }
# gov-validate.yml installs the published gov; the journey tests the TARBALL everywhere.
x perl -pi -e 's{npm install -g \@svayam-opensource/gov}{npm install -g ./.gov-ci/gov.tgz}' "$G/.github/workflows/gov-validate.yml"
expect "gov-checks.yml installs the tarball" grep -q 'npm install -g ./.gov-ci/gov.tgz' "$G/.github/workflows/gov-checks.yml"
expect "gov-validate.yml installs the tarball" grep -q 'npm install -g ./.gov-ci/gov.tgz' "$G/.github/workflows/gov-validate.yml"
x git -C "$G" add -A && x git -C "$G" commit -qm "gov checks on the packed gov" || die "commit failed"
PR_A="$(open_pr e2e/checks "gov checks (workflows only)" "$G" "$R_GOV")"
SHA_A="$(head_of "$R_GOV" "$PR_A")"
for id in GOV-FRM-455 GOV-FRM-467 GOV-FRM-468; do
  res="$(wait_check "$R_GOV" "$SHA_A" "$id · pull_request")"
  expect "(a) $id · pull_request passed on PR #$PR_A (got: ${res%% *})" test "${res%% *}" = success
done
x gh pr merge "$PR_A" --repo "$R_GOV" --merge --delete-branch >/dev/null || die "merge of #$PR_A failed"
x git -C "$G" switch -q "$DEF" && x git -C "$G" pull -q --ff-only || die "pull $DEF failed"

# ── (b) a direct push to the default branch ──────────────────────────────────────────────────────────────────────
step "(b) direct push to $DEF — GOV-FRM-040 opens a violation (checked after (c) starts)"
echo "direct push $RUN_ID" >> "$G/README.md"
x git -C "$G" commit -qam "direct push (rule-model journey)" && x git -C "$G" push -q origin "$DEF" || die "direct push failed"
SHA_B="$(xo dry-sha-b git -C "$G" rev-parse HEAD)"
ok "pushed $SHA_B straight to $DEF"

# ── (c) a policy prose PR ────────────────────────────────────────────────────────────────────────────────────────
step "(c) policy prose PR — GOV-FRM-467 unreviewed · GOV-FRM-468 proposes"
x git -C "$G" switch -q -c e2e/policy
x perl -0pi -e 's/(unless an exception is\napproved\.)/$1 A bug fix comes with a test that reproduces the bug./' "$G/policies/org-policy.md"
x git -C "$G" commit -qam "policy §2.2: a bug fix comes with a test" || die "policy commit failed (did §2.2 move?)"
PR_C="$(open_pr e2e/policy "policy: a bug fix comes with a test" "$G" "$R_GOV")"
SHA_C="$(head_of "$R_GOV" "$PR_C")"
res="$(wait_check "$R_GOV" "$SHA_C" "GOV-FRM-467 · pull_request")"
expect "(c) GOV-FRM-467 failed on the prose change (got: ${res%% *})" test "${res%% *}" = failure
expect_annotation "(c) GOV-FRM-467 names the section unreviewed" "was added or changed" "$R_GOV" "${res#* }"
expect_annotation "(c) the unreviewed finding sits on policies/org-policy.md" "^failure policies/org-policy\.md:[0-9]+ .*§2\.2 .*was added or changed" "$R_GOV" "${res#* }"
res="$(wait_check "$R_GOV" "$SHA_C" "GOV-FRM-468 · pull_request")"
BOT_PUSHED=1
if [ "$REAL_MODEL" = "1" ] && [ "$DRY" != 1 ] && [ "${res%% *}" = failure ]; then
  # The real model may ask instead of answering: 468 then fails, and says why on its check run.
  expect_annotation "(c) GOV-FRM-468 ran propose with the real model (questions asked)" "question\(s\) are open" "$R_GOV" "${res#* }"
  BOT_PUSHED=0
else
  expect "(c) GOV-FRM-468 passed (got: ${res%% *})" test "${res%% *}" = success
  # WHAT IT DID, from the repository: the bot's commit on the PR, its rows, and the changelog's "Sections reviewed".
  SHA_D="$(poll bash -c "s=\$(gh pr view $PR_C --repo $R_GOV --json headRefOid --jq .headRefOid); [ \"\$s\" != $SHA_C ] && echo \$s")"
  expect "(c) GOV-FRM-468 committed to PR #$PR_C — the head moved past $SHA_C (${SHA_D:-none})" test -n "$SHA_D"
  CHANGELOG_D="$(file_at "$R_GOV" policies/CHANGELOG.md "$SHA_D" '**Sections reviewed**
- policies/org-policy.md §2.2 (dry0sha) → GOV-RME-001 added')"
  expect "(c) the bot's commit lists policies/org-policy.md §2.2 under Sections reviewed" \
    grep -Eq '^- policies/org-policy\.md §2\.2 \([0-9a-f]{7,}\) → ' <<<"$CHANGELOG_D"
  if [ "$REAL_MODEL" != "1" ]; then
    RULES_D="$(file_at "$R_GOV" policies/rules.yaml "$SHA_D" 'expectation: A change to application behaviour, or a bug fix, comes with a test that would fail without it.')"
    expect "(c) the bot's commit adds the stub model's row to policies/rules.yaml" grep -q "or a bug fix, comes with a test that would fail without it" <<<"$RULES_D"
  fi
fi

# (b), now that its run has had the time (c) took.
res="$(wait_check "$R_GOV" "$SHA_B" "GOV-FRM-040 · push")"
expect "(b) GOV-FRM-040 · push ran on the direct push (got: ${res%% *})" test "${res%% *}" = success
V_B="$(poll violations "$R_GOV" '^gov-violation: GOV-FRM-040 ')"
expect "(b) gov-violation issue opened, assigned to the Policy Owner @$LOGIN (#${V_B:-none})" test -n "$V_B"

# ── (d) the bot's follow-up run waits for approval ───────────────────────────────────────────────────────────────
if [ "$BOT_PUSHED" = 1 ]; then
  step "(d) bot's follow-up run — approve through the API, GOV-FRM-467 passes"
  # Wait for the runs to EXIST, then pick those waiting for approval (status or conclusion action_required).
  ALL="$(poll gh api "repos/$R_GOV/actions/runs?head_sha=$SHA_D" --jq '.workflow_runs[] | "\(.id) \(.status) \(.conclusion)"')"
  [ "$DRY" = 1 ] && ALL="1 action_required action_required"
  sleep "$([ "$DRY" = 1 ] && echo 0 || echo 15)"   # sibling workflows of the same push register within seconds
  [ "$DRY" = 1 ] || ALL="$(gh api "repos/$R_GOV/actions/runs?head_sha=$SHA_D" --jq '.workflow_runs[] | "\(.id) \(.status) \(.conclusion)"' 2>/dev/null || echo "$ALL")"
  RUNS="$(awk '$2 == "action_required" || $3 == "action_required" { print $1 }' <<<"$ALL")"
  if [ -n "$RUNS" ]; then
    ok "(d) follow-up run(s) show action_required: $(tr "\n" " " <<<"$RUNS")"
    for id in $RUNS; do x gh api -X POST "repos/$R_GOV/actions/runs/$id/approve" >/dev/null || die "could not approve run $id"; done
    ok "(d) approved through POST /actions/runs/{id}/approve"
  else
    note "(d) no run waited for approval at $SHA_D — GitHub started it directly, or not at all; waiting for GOV-FRM-467 either way"
  fi
  res="$(wait_check "$R_GOV" "$SHA_D" "GOV-FRM-467 · pull_request")"
  expect "(d) GOV-FRM-467 passes on the bot's commit (got: ${res%% *})" test "${res%% *}" = success
  HEAD_E="$SHA_D"
else
  skip "(d) — the real model asked questions, so the bot pushed nothing to approve"
  HEAD_E="$SHA_C"
fi

# ── (e) merging with a red gov check under soft posture ──────────────────────────────────────────────────────────
step "(e) merge PR #$PR_C with a red gov check (soft) — a violation record names it"
res="$(wait_check "$R_GOV" "$HEAD_E" "GOV-FRM-455 · pull_request")"
expect "(e) GOV-FRM-455 is red (the author cannot approve their own policy change) (got: ${res%% *})" test "${res%% *}" = failure
x gh pr merge "$PR_C" --repo "$R_GOV" --merge >/dev/null || die "soft posture: merging #$PR_C should be allowed"
SHA_E="$(poll gh pr view "$PR_C" --repo "$R_GOV" --json mergeCommit --jq '.mergeCommit.oid // empty')"
res="$(wait_check "$R_GOV" "$SHA_E" "GOV-FRM-040 · push")"
expect "(e) GOV-FRM-040 · push ran on the merge (got: ${res%% *})" test "${res%% *}" = success
V_E="$(poll violations "$R_GOV" "PR #$PR_C merged with")"
expect "(e) gov-violation record for PR #$PR_C, assigned to @$LOGIN (#${V_E:-none})" test -n "$V_E"

# ── (f) the code repo reads the gov repo's rules through the App ─────────────────────────────────────────────────
if [ "$APP_READY" = 1 ]; then
  step "(f) code repo check reads $R_GOV through the App"
  res="$(wait_check "$R_APP" "$APP_SHA" "GOV-FRM-040 · push")"
  expect "(f) $R_APP GOV-FRM-040 · push minted the App token and ran (got: ${res%% *})" test "${res%% *}" = success
  V_F="$(poll violations "$R_APP" '^gov-violation: GOV-FRM-040 ')"
  expect "(f) the code repo judged its direct push by the gov repo's rules (violation #${V_F:-none})" test -n "$V_F"
fi
