#!/usr/bin/env bash
# framework/bin/lib-upgrade.sh
#
# Helpers for framework/bin/setup.sh. Self-contained — sources nothing else.
# bash 3.2 compatible (macOS default).
#
# Public functions (called from setup.sh):
#   detect_install_state         → echoes "first-install" | "upgrade" | "bc-from-pre-v0.3"
#   read_manifest                → emits "mode|src|dst|perm" per file, one per line
#   apply_manifest_file          → applies one manifest entry, dispatching by mode
#   scaffold_auto                → overwrite dst with framework/src content
#   scaffold_prompt              → 3-way (or 2-way in BC mode) merge, prompts on diverge
#   overlay_schema               → add missing keys from .example to dst
#   write_version_marker         → writes .framework-version
#   cleanup_framework_dir        → removes framework/ from working tree

# ── Console helpers ──────────────────────────────────────────────────────────
BOLD='\033[1m'; DIM='\033[2m'
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log_ok()        { echo -e "${GREEN}  ✓${NC} $*"; }
log_warn()      { echo -e "${YELLOW}  !${NC} $*"; }
log_err()       { echo -e "${RED}  ✗${NC} $*" >&2; }
log_info()      { echo -e "${CYAN}  →${NC} $*"; }
log_header()    { echo ""; echo -e "${BOLD}${CYAN}$*${NC}"; }
log_diverged()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
hard_stop()     { echo ""; log_err "$*"; exit 1; }

# ── Install state detection ──────────────────────────────────────────────────
#
# first-install     : no .framework-version, no populated canonical paths
#                     (a fresh template clone before any setup ran)
# upgrade           : .framework-version exists (org is on v0.3.0+)
# bc-from-pre-v0.3  : no .framework-version but canonical paths populated
#                     (org migrating from v0.2.x or earlier; we infer prev=legacy)

detect_install_state() {
  local repo_root="$1"
  if [[ -f "$repo_root/.framework-version" ]]; then
    echo "upgrade"
    return 0
  fi
  # No version file. Are there populated canonical paths? Use CLAUDE.md or
  # scripts/lib.sh as cheap canaries.
  if [[ -f "$repo_root/CLAUDE.md" || -f "$repo_root/scripts/lib.sh" || -f "$repo_root/prj" ]]; then
    echo "bc-from-pre-v0.3"
    return 0
  fi
  echo "first-install"
}

# ── Manifest reader ──────────────────────────────────────────────────────────
#
# Expands directory entries by listing every file under framework/<src>/.
# Outputs lines: mode|src|dst|perm  (perm defaulted if absent).

read_manifest() {
  local manifest="$1" framework_dir="$2"
  python3 - "$manifest" "$framework_dir" <<'PY'
import sys, os, yaml
manifest_path, framework_dir = sys.argv[1], sys.argv[2]
m = yaml.safe_load(open(manifest_path))

def is_executable_name(p):
    return p.endswith('.sh') or p.endswith('.py') or os.path.basename(p) == 'prj'

for entry in m.get('files', []):
    src = entry['src']
    dst = entry['dst']
    mode = entry['mode']
    perm = entry.get('perm')
    src_path = os.path.join(framework_dir, src)
    if src.endswith('/'):
        # Directory entry — recurse
        if not os.path.isdir(src_path):
            continue
        for root, _, files in os.walk(src_path):
            for fname in files:
                fpath = os.path.join(root, fname)
                rel = os.path.relpath(fpath, framework_dir)
                rel_dst = os.path.relpath(fpath, src_path)
                file_dst = os.path.join(dst.rstrip('/'), rel_dst)
                p = perm
                if p is None:
                    p = '0755' if is_executable_name(rel) else '0644'
                print(f"{mode}|{rel}|{file_dst}|{p}")
    else:
        p = perm
        if p is None:
            p = '0755' if is_executable_name(src) else '0644'
        print(f"{mode}|{src}|{dst}|{p}")
PY
}

# ── scaffold-auto: overwrite dst with framework/src ──────────────────────────

scaffold_auto() {
  local framework_dir="$1" repo_root="$2" src="$3" dst="$4" perm="$5"
  local src_path="$framework_dir/$src"
  local dst_path="$repo_root/$dst"
  mkdir -p "$(dirname "$dst_path")"
  if [[ -f "$dst_path" ]] && cmp -s "$src_path" "$dst_path"; then
    return 0  # already identical, nothing to do
  fi
  cp "$src_path" "$dst_path"
  chmod "$perm" "$dst_path" 2>/dev/null || true
  log_ok "scaffold $dst"
}

# ── scaffold-prompt: prompt if user has customized ──────────────────────────
#
# Args: framework_dir repo_root src dst perm prev_version
# prev_version is "" in BC mode (no base for 3-way; falls back to 2-way diff).
#
# Logic:
#   1. If dst doesn't exist → just write it (first-install equivalent).
#   2. If dst already matches framework/src → nothing to do.
#   3. In upgrade mode (prev_version set, not "legacy"):
#        Get base = previous template version of this file from git (template/<prev_version> tag).
#        If base == ours == theirs → noop.
#        If base == ours, theirs != base → org didn't customize; overwrite without prompt.
#        If base == theirs, ours != base → org customized but template unchanged; keep ours.
#        Otherwise → three-way merge; prompt on conflict.
#   4. In BC mode (prev_version == "legacy"):
#        Two-way diff between ours and theirs. If different, prompt user.

scaffold_prompt() {
  local framework_dir="$1" repo_root="$2" src="$3" dst="$4" perm="$5" prev_version="${6:-}"
  local src_path="$framework_dir/$src"
  local dst_path="$repo_root/$dst"
  mkdir -p "$(dirname "$dst_path")"

  # Case 1: dst missing
  if [[ ! -f "$dst_path" ]]; then
    cp "$src_path" "$dst_path"
    chmod "$perm" "$dst_path" 2>/dev/null || true
    log_ok "create $dst"
    return 0
  fi

  # Case 2: already identical
  if cmp -s "$src_path" "$dst_path"; then
    return 0
  fi

  # Case 3 & 4: diverged — handle by mode
  if [[ -z "$prev_version" || "$prev_version" == "legacy" ]]; then
    # BC mode: 2-way diff
    _prompt_2way "$src_path" "$dst_path" "$dst"
  else
    _three_way "$framework_dir" "$repo_root" "$src" "$dst" "$src_path" "$dst_path" "$prev_version"
  fi
}

# Two-way prompt: org's version diverges from framework's; ask what to do.
_prompt_2way() {
  local src_path="$1" dst_path="$2" dst="$3"
  log_diverged "$dst — your copy differs from the framework's. Diff (first 20 lines):"
  diff "$src_path" "$dst_path" | head -20 | sed 's/^/    /'
  echo ""
  echo "  [k]eep your version  /  [r]eplace with framework's  /  [v]iew full diff  /  [s]kip (decide later)"
  while true; do
    printf "    Choose [k/r/v/s]: "
    read -r choice </dev/tty 2>/dev/null || choice="k"
    case "$choice" in
      k|K) log_ok "$dst — kept your version"; return 0 ;;
      r|R) cp "$src_path" "$dst_path"; log_ok "$dst — replaced with framework's"; return 0 ;;
      v|V) diff "$src_path" "$dst_path" | less ;;
      s|S) log_warn "$dst — skipped (you'll need to reconcile later)"; return 0 ;;
      *) echo "    Invalid choice." ;;
    esac
  done
}

# Three-way merge. Args: framework_dir repo_root src dst src_path dst_path prev_version
_three_way() {
  local framework_dir="$1" repo_root="$2" src="$3" dst="$4"
  local src_path="$5" dst_path="$6" prev_version="$7"

  # Fetch the previous template version's copy of this file.
  # The PREVIOUS version's tree had this file at `framework/<src>` (v0.3.0+)
  # OR at the canonical `<dst>` location (pre-v0.3 historical).
  local base_content=""
  base_content=$(git -C "$repo_root" show "$prev_version:framework/$src" 2>/dev/null || \
                 git -C "$repo_root" show "$prev_version:$dst" 2>/dev/null || echo "")

  if [[ -z "$base_content" ]]; then
    # No common ancestor for this file — fall back to 2-way prompt
    _prompt_2way "$src_path" "$dst_path" "$dst"
    return 0
  fi

  local base_file
  base_file=$(mktemp)
  printf '%s' "$base_content" > "$base_file"

  # Three-way merge. git merge-file modifies the OURS file in place.
  # We'll merge into a temp copy so we can inspect/revert if it conflicts.
  local merged_file
  merged_file=$(mktemp)
  cp "$dst_path" "$merged_file"
  if git merge-file -p -L "ours" -L "base" -L "framework" "$merged_file" "$base_file" "$src_path" \
       > "$merged_file.new" 2>/dev/null; then
    # Clean merge
    mv "$merged_file.new" "$dst_path"
    log_ok "$dst — merged your customizations with framework update"
    rm -f "$base_file" "$merged_file"
  else
    # Conflict; merged_file.new contains conflict markers
    log_diverged "$dst — 3-way merge conflict. Top of conflict region:"
    grep -A 20 '^<<<<<<<' "$merged_file.new" 2>/dev/null | head -30 | sed 's/^/    /'
    echo ""
    echo "  [k]eep your version  /  [r]eplace with framework's  /  [m]anual: write conflict to file  /  [s]kip"
    while true; do
      printf "    Choose [k/r/m/s]: "
      read -r choice </dev/tty 2>/dev/null || choice="k"
      case "$choice" in
        k|K) log_ok "$dst — kept your version (conflict abandoned)"; break ;;
        r|R) cp "$src_path" "$dst_path"; log_ok "$dst — replaced with framework's"; break ;;
        m|M) cp "$merged_file.new" "$dst_path"; log_warn "$dst — conflict markers written; resolve before committing"; break ;;
        s|S) log_warn "$dst — skipped"; break ;;
        *) echo "    Invalid choice." ;;
      esac
    done
    rm -f "$base_file" "$merged_file" "$merged_file.new"
  fi
}

# ── overlay-schema: extend org-config.yaml with missing keys ────────────────
#
# Read the .example template. For each top-level key not present in dst,
# add it with the .example's value (empty string for empty values).

overlay_schema() {
  local framework_dir="$1" repo_root="$2" src="$3" dst="$4"
  local src_path="$framework_dir/$src"
  local dst_path="$repo_root/$dst"

  if [[ ! -f "$dst_path" ]]; then
    # First install — copy example as-is (org will fill values later via prompts elsewhere).
    cp "$src_path" "$dst_path"
    log_ok "create $dst (schema only — populate values via setup prompts)"
    return 0
  fi

  python3 - "$src_path" "$dst_path" <<'PY'
import sys, yaml
example_path, dst_path = sys.argv[1], sys.argv[2]
with open(example_path) as f:
    example = yaml.safe_load(f) or {}
with open(dst_path) as f:
    current = yaml.safe_load(f) or {}

added = []
for key, default_value in example.items():
    if key not in current:
        current[key] = default_value
        added.append(key)

if added:
    # Re-write dst preserving comment headers from .example. Simplest: write
    # YAML output with safe defaults; we lose comments, but the example file
    # has them and is shipped, so users can refer back.
    with open(dst_path, 'w') as f:
        yaml.dump(current, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    print(f"  added keys: {', '.join(added)}")
PY
  if [[ $? -eq 0 ]]; then
    log_ok "overlay $dst (added any missing schema keys)"
  fi
}

# ── Version marker ──────────────────────────────────────────────────────────

write_version_marker() {
  local repo_root="$1" version="$2"
  echo "$version" > "$repo_root/.framework-version"
  log_ok "wrote $repo_root/.framework-version → $version"
}

# ── Cleanup framework/ ──────────────────────────────────────────────────────

cleanup_framework_dir() {
  local framework_dir="$1"
  if [[ -d "$framework_dir" ]]; then
    rm -rf "$framework_dir"
    log_ok "removed framework/ from working tree"
  fi
}
