#!/usr/bin/env bash
# scripts/deploy/materialize-repo.sh — #109 on-demand member-repo materialization.
#
# A catalog hook's logic (e.g. svm-ident's iam-data.sh) and the facts that
# `catalog build` derives live in a MEMBER repo that may NOT be cloned into the
# project — and for shared libraries it never will be, because they aren't in the
# project's repos[]. Rather than erroring "clone it into the project", materialize
# the repo on demand and run / derive from there:
#
#   local        → a git WORKTREE of the PROJECT branch (off a shared base clone).
#                  An already-cloned project sibling ($WS/../<name>) is reused.
#   dev|uat|prod → a worktree of the env's code branch, gathered under a per-env
#                  folder ($AGENT_WORK_ROOT/.envs/<env>/) that collects every repo
#                  needed for that env (the "folder with clones for all repos").
#
# The repo is fetched and the worktree reset to the upstream tip before returning,
# so derived answers always reflect current source (the "pull before deriving"
# requirement). Per-env worktrees use distinct local branches (prj-env/<env>) so
# the same upstream branch can be materialized for more than one env at once.
#
# Usage:  materialize-repo.sh <repo: owner/name|url> <env> [workspace_root]
#         Echoes the materialized repo directory on stdout (and nothing else).
#         Diagnostics go to stderr; non-zero exit on failure.
#
# Config (env wins; else read from <ws>/org-config.yaml, searched upward):
#         GITHUB_ORG · DEFAULT_CODE_BRANCH · AGENT_WORK_ROOT
# Flags:  PRJ_NO_PULL=1   skip all network ops (offline / scripted reuse).
set -uo pipefail

repo="${1:?repo (owner/name or url) required}"
env="${2:-local}"
ws="${3:-${ADF_WORKSPACE:-${WORKSPACE_ROOT:-$PWD}}}"

_log() { printf '%s\n' "materialize: $*" >&2; }

# ── Config: env vars win; otherwise read org-config.yaml at/above the workspace ──
_cfg() { sed -nE "s/^$1:[[:space:]]*\"?([^\"#]*)\"?.*/\1/p" "$2" 2>/dev/null | head -1 | sed -E 's/[[:space:]]+$//'; }
_find_cfg() {
  local d="$1"
  while [[ -n "$d" && "$d" != "/" ]]; do
    [[ -f "$d/org-config.yaml" ]] && { printf '%s\n' "$d/org-config.yaml"; return 0; }
    d="$(dirname "$d")"
  done
  return 1
}
CFG="$(_find_cfg "$ws" || true)"
GITHUB_ORG="${GITHUB_ORG:-$( [[ -n "$CFG" ]] && _cfg github_org "$CFG" || true )}"
DEFAULT_CODE_BRANCH="${DEFAULT_CODE_BRANCH:-$( [[ -n "$CFG" ]] && _cfg default_code_branch "$CFG" || true )}"
DEFAULT_CODE_BRANCH="${DEFAULT_CODE_BRANCH:-dev}"
AGENT_WORK_ROOT="${AGENT_WORK_ROOT:-$( [[ -n "$CFG" ]] && _cfg agent_work_root "$CFG" || true )}"
AGENT_WORK_ROOT="${AGENT_WORK_ROOT/#\~/$HOME}"
[[ -n "$AGENT_WORK_ROOT" ]] || AGENT_WORK_ROOT="$HOME/.${ORG_SLUG_LOWER:-svm}/projects"

name="$(basename "${repo%.git}")"
case "$repo" in
  *://*|*@*:*) url="$repo" ;;                        # already a full URL
  */*)         url="git@github.com:${repo}.git" ;;   # owner/name
  *)           url="git@github.com:${GITHUB_ORG:-Svayamtech}/${repo}.git" ;;
esac

# ── local: reuse an existing project sibling (the normal cloned-in case) ─────────
if [[ "$env" == "local" ]]; then
  sib="$(cd "$ws/.." 2>/dev/null && pwd)/$name"
  if [[ -e "$sib/.git" ]]; then
    [[ -n "${PRJ_NO_PULL:-}" ]] || git -C "$sib" pull --ff-only -q 2>/dev/null || true
    printf '%s\n' "$sib"; exit 0
  fi
fi

# ── Target upstream branch ──────────────────────────────────────────────────────
#   local        → the project branch (the branch checked out in the workspace),
#                  falling back to the code branch if it isn't on origin yet.
#   dev|uat|prod → the env code branch (default_code_branch).
if [[ "$env" == "local" ]]; then
  branch="$(git -C "$ws" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ -z "$branch" || "$branch" == "HEAD" ]] \
     || { [[ -z "${PRJ_NO_PULL:-}" ]] && ! git ls-remote --heads "$url" "$branch" 2>/dev/null | grep -q .; }; then
    branch="$DEFAULT_CODE_BRANCH"
  fi
else
  branch="$DEFAULT_CODE_BRANCH"
fi

# ── Materialize as a worktree off a single shared base clone ─────────────────────
base="$AGENT_WORK_ROOT/.bases/$name"        # one fetch / identity per repo
target="$AGENT_WORK_ROOT/.envs/$env/$name"  # per-env folder, all repos for the env
wt_branch="prj-env/$env"                     # per-env local branch (avoids clashes)

if [[ ! -e "$base/.git" ]]; then
  mkdir -p "$(dirname "$base")"
  git clone -q "$url" "$base" 2>/dev/null || { _log "clone failed: $url"; exit 1; }
fi
if [[ -z "${PRJ_NO_PULL:-}" ]]; then
  git -C "$base" fetch -q origin "$branch" 2>/dev/null || git -C "$base" fetch -q origin 2>/dev/null || true
fi

# Pick a start-point that exists (fresh upstream tip preferred).
start="origin/$branch"
git -C "$base" show-ref --verify --quiet "refs/remotes/origin/$branch" || start="$branch"

if [[ -e "$target/.git" ]]; then
  # Reset the per-env worktree to the upstream tip (the "pull before deriving").
  git -C "$target" checkout -q -B "$wt_branch" "$start" 2>/dev/null \
    || git -C "$target" checkout -q "$wt_branch" 2>/dev/null || true
else
  mkdir -p "$(dirname "$target")"
  git -C "$base" worktree add -q -B "$wt_branch" "$target" "$start" 2>/dev/null \
    || git -C "$base" worktree add -q "$target" 2>/dev/null \
    || { _log "worktree add failed: $name@$branch"; exit 1; }
fi

printf '%s\n' "$target"
