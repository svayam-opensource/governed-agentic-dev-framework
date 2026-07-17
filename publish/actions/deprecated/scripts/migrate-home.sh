#!/usr/bin/env bash
# Script: migrate-home
# Purpose: Relocate the home governance repo ("gov_repo") to its canonical
#          deterministic location ($GOV_WORKSPACE, e.g. ~/.<slug>/gov_repo),
#          preserving every per-project worktree and its branch, and record the
#          gov-home pointer file. This is the explicit, interactive counterpart
#          to the resolver's record-only self-heal — the only place that *moves*
#          the repo. Non-destructive: it copies (never deletes) the old home.
#
# Usage:
#   bash migrate-home.sh            # interactive (asks to confirm)
#   bash migrate-home.sh --yes      # non-interactive (skip confirmation)
#   bash migrate-home.sh --to <dir> # override the canonical target
#
# Mechanics (same as a hand migration): cp -a the current home → target, then
# `git worktree repair` each linked worktree so it points at the new home, then
# write the pointer file. Worktrees stay in place; only the home moves.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
# lib.sh provides info/warn/hard_stop/confirm but not ok — define a fallback.
type ok >/dev/null 2>&1 || ok() { echo "  ✓ $*"; }
load_config

ASSUME_YES=false
DST_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes|--non-interactive) ASSUME_YES=true ;;
    --to) shift; DST_OVERRIDE="${1:-}" ;;
    -h|--help) grep '^# ' "$0" | sed 's/^# \{0,1\}//' | head -20; exit 0 ;;
    *) hard_stop "Unknown arg: $1 (expected --yes | --to <dir>)" ;;
  esac
  shift
done

PTR="${XDG_CONFIG_HOME:-$HOME/.config}/prj/gov-workspace"

# Current resolved gov home (REPO_ROOT from lib.sh) and canonical target.
SRC="$REPO_ROOT"
DST="${DST_OVERRIDE:-$GOV_WORKSPACE}"
case "$DST" in "~/"*) DST="$HOME/${DST#\~/}" ;; "~") DST="$HOME" ;; esac

[[ -n "$SRC" && -f "$SRC/org-config.yaml" ]] \
  || hard_stop "Current gov home '$SRC' has no org-config.yaml — nothing to migrate."
[[ -n "$DST" ]] || hard_stop "No canonical target — set gov_workspace in org-config.yaml."

# Normalize to absolute, comparable paths.
SRC="$(cd "$SRC" && pwd)"

# Already canonical? Just (re)write the pointer and exit — idempotent.
if [[ "$SRC" == "$DST" ]]; then
  mkdir -p "$(dirname "$PTR")"
  printf '%s\n' "$DST" > "$PTR"
  ok "Gov home already at canonical location: $DST"
  ok "Pointer refreshed: $PTR"
  exit 0
fi

# Guards: never migrate FROM a base clone / per-project worktree, never clobber.
[[ "$SRC" != "$AGENT_WORK_ROOT"/* ]] \
  || hard_stop "Current home '$SRC' is under \$AGENT_WORK_ROOT (a base/per-project clone, not a gov home). Aborting."
[[ ! -e "$DST" ]] \
  || hard_stop "Target '$DST' already exists. Move/remove it, or pass --to <dir>."
git -C "$SRC" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || hard_stop "'$SRC' is not a git repository."
# SRC must be the main worktree of its repo (not itself a linked worktree).
_common="$(git -C "$SRC" rev-parse --git-common-dir 2>/dev/null)"
[[ "$_common" == ".git" || "$_common" == "$SRC/.git" ]] \
  || hard_stop "'$SRC' is a linked worktree, not the main gov repo. Run from / point at the main clone."
[[ -z "$(git -C "$SRC" status --porcelain)" ]] \
  || hard_stop "Current gov home has uncommitted changes. Commit or stash first, then retry."

echo ""
echo "Migrate gov home:"
echo "  from : $SRC"
echo "  to   : $DST"
echo "  note : per-project worktrees are repaired in place; the old home is KEPT (not deleted)."
echo ""
if ! $ASSUME_YES; then
  confirm "Proceed with the migration?"
fi

# 1) Copy preserving .git + worktree registrations.
mkdir -p "$(dirname "$DST")"
cp -a "$SRC" "$DST"
ok "copied → $DST"

# 2) Repair each linked worktree so its .git points at the NEW home.
git -C "$DST" worktree list --porcelain | awk '/^worktree /{print $2}' | while IFS= read -r wt; do
  [[ -z "$wt" || "$wt" == "$DST" ]] && continue
  if git -C "$DST" worktree repair "$wt" >/dev/null 2>&1; then
    ok "repaired worktree → $wt"
  else
    warn "could not repair worktree: $wt (repair it manually: git -C \"$DST\" worktree repair \"$wt\")"
  fi
done

# 3) Record the deterministic pointer.
mkdir -p "$(dirname "$PTR")"
printf '%s\n' "$DST" > "$PTR"
ok "pointer → $PTR ($DST)"

echo ""
ok "Migration complete. Canonical gov home: $DST"
echo "  • Old home kept at: $SRC  (verify it works, then delete when confident)"
echo "  • If you export ADF_WORKSPACE in a shell rc, remove it — the pointer is authoritative"
echo "    (pinning the home breaks mid-project commands, which run from the per-project workspace)."
