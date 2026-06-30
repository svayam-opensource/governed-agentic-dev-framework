# shellcheck shell=bash
# Multi-home gov registry (PRJ-43 — multi-org support). Resolves WHICH governance
# workspace (org) prj operates on when a developer belongs to more than one org.
# The old single global pointer could only name ONE gov home, so from a neutral cwd
# prj silently used whichever org `setup.sh` ran LAST (the Svayamtech↔aarambh flip-flop).
#
#   registry: $CFG/gov-workspaces  — lines of "<github_org>\t<gov_home>"
#   active:   $CFG/active-org       — one <github_org> (the default when cwd is neutral)
#   legacy:   $CFG/gov-workspace    — old single pointer; migrated into the registry once
#
# Resolution (prj_resolve_gov): cwd-walk → active-org → single home → DISAMBIGUATE-error.
# NEVER silently pick among multiple homes.

_prj_cfg_dir()     { printf '%s' "${XDG_CONFIG_HOME:-$HOME/.config}/prj"; }
_prj_reg_file()    { printf '%s/gov-workspaces' "$(_prj_cfg_dir)"; }
_prj_active_file() { printf '%s/active-org' "$(_prj_cfg_dir)"; }
_prj_legacy_ptr()  { printf '%s/gov-workspace' "$(_prj_cfg_dir)"; }

_prj_expand_tilde() {
  case "$1" in
    "~/"*) printf '%s' "$HOME/${1#\~/}" ;;
    "~")   printf '%s' "$HOME" ;;
    *)     printf '%s' "$1" ;;
  esac
}

_prj_home_ok() { [[ -n "$1" && -f "$1/org-config.yaml" && "$1" != */.bases/* ]]; }

_prj_org_of_home() {                       # github_org of a gov home's org-config.yaml
  local cfg="$1/org-config.yaml"; [[ -f "$cfg" ]] || return 1
  if command -v yq >/dev/null 2>&1; then yq '.github_org' "$cfg" 2>/dev/null
  else python3 -c "import yaml; print(yaml.safe_load(open('$cfg')).get('github_org',''))" 2>/dev/null; fi
}

_prj_reg_migrate() {                       # legacy single pointer → registry (once, if registry empty)
  local reg leg p org
  reg="$(_prj_reg_file)"; [[ -s "$reg" ]] && return 0
  leg="$(_prj_legacy_ptr)"; [[ -f "$leg" ]] || return 0
  p="$(_prj_expand_tilde "$(head -n1 "$leg" | tr -d '[:space:]')")"
  _prj_home_ok "$p" || return 0
  org="$(_prj_org_of_home "$p")"           # may be empty (unconfigured template / test fixture)
  mkdir -p "$(_prj_cfg_dir)" 2>/dev/null || true
  printf '%s\t%s\n' "$org" "$p" >> "$reg"  # register regardless — resolves as the single home
}

_prj_reg_upsert() {                        # <github_org> <gov_home> — add/replace mapping; does NOT touch active-org
  local org="$1" home="$2" reg tmp       # org may be empty (unconfigured template)
  [[ -n "$home" ]] || return 1
  reg="$(_prj_reg_file)"; mkdir -p "$(_prj_cfg_dir)" 2>/dev/null || true; touch "$reg"
  tmp="$reg.tmp.$$"
  awk -F'\t' -v o="$org" '$1!=o' "$reg" > "$tmp" 2>/dev/null || true
  printf '%s\t%s\n' "$org" "$home" >> "$tmp"
  mv "$tmp" "$reg"
}

prj_reg_add() {                            # <github_org> <gov_home> — upsert + set active
  _prj_reg_upsert "$1" "$2" || return 1
  printf '%s\n' "$1" > "$(_prj_active_file)"
}

# Self-healing: teach the registry an org's CANONICAL gov home from a config we walked into,
# WITHOUT changing the active org (standing in a tree must not flip your default). Reads
# gov_workspace (the canonical home), NOT the walked dir — which may be a project CLONE that
# also carries org-config.yaml. Cheap, no churn: skips entirely if the org is already known.
# grep/sed only (no python/yq) so it stays light on the resolver's hot path.
_prj_reg_learn() {                         # <config-dir>
  local cd="$1" cfg org home reg tab; tab="$(printf '\t')"
  cfg="$cd/org-config.yaml"; [[ -f "$cfg" ]] || return 0
  org="$(sed -nE 's/^github_org:[[:space:]]*"?([^"#]*)"?.*/\1/p' "$cfg" | head -1 | tr -d '[:space:]')"
  [[ -n "$org" ]] || return 0                                  # unconfigured template → nothing to learn
  reg="$(_prj_reg_file)"
  [[ -f "$reg" ]] && grep -q "^${org}${tab}" "$reg" && return 0  # already known → no work
  home="$(sed -nE 's/^gov_workspace:[[:space:]]*"?([^"#]*)"?.*/\1/p' "$cfg" | head -1 | tr -d '[:space:]')"
  home="$(_prj_expand_tilde "$home")"
  _prj_home_ok "$home" || return 0                            # canonical home not on disk → don't register
  _prj_reg_upsert "$org" "$home"
}

prj_reg_list() {                           # prints "<org>\t<home>" for valid, deduped homes
  _prj_reg_migrate
  local reg tab line org home; tab="$(printf '\t')"
  reg="$(_prj_reg_file)"; [[ -f "$reg" ]] || return 0
  # NOTE: split with parameter expansion, NOT `IFS=$'\t' read` — tab is whitespace-IFS,
  # so a LEADING tab (empty github_org) would be trimmed and the home lost.
  awk -F'\t' 'NF>=2 && !seen[$1]++' "$reg" | while IFS= read -r line; do
    org="${line%%${tab}*}"; home="${line#*${tab}}"
    home="$(_prj_expand_tilde "$home")"
    _prj_home_ok "$home" && printf '%s\t%s\n' "$org" "$home"
  done
}

prj_reg_active_org() {
  local af; af="$(_prj_active_file)"; [[ -f "$af" ]] || return 1
  head -n1 "$af" | tr -d '[:space:]'
}

prj_reg_active_home() {
  local org home; org="$(prj_reg_active_org)"; [[ -n "$org" ]] || return 1
  home="$(prj_reg_list | awk -F'\t' -v o="$org" '$1==o{print $2; exit}')"
  _prj_home_ok "$home" && printf '%s' "$home"
}

prj_reg_set_active() {                     # <github_org>
  local org="$1" home
  home="$(prj_reg_list | awk -F'\t' -v o="$org" '$1==o{print $2; exit}')"
  [[ -n "$home" ]] || { echo "prj: '$org' is not a registered gov workspace." >&2; return 1; }
  mkdir -p "$(_prj_cfg_dir)" 2>/dev/null || true
  printf '%s\n' "$org" > "$(_prj_active_file)"
}

# THE resolver. Echoes the gov home on success. cwd-walk → active → single → disambiguate.
# On ambiguity prints guidance to stderr and returns 2; returns 1 if nothing is registered.
prj_resolve_gov() {
  local d="$PWD"
  while [[ "$d" != "/" && -n "$d" ]]; do
    if [[ -f "$d/org-config.yaml" && "$d" != */.bases/* ]]; then
      _prj_reg_learn "$d" 2>/dev/null || true   # self-heal: persist this org's canonical home so future neutral-cwd runs + the menu know it
      printf '%s' "$d"; return 0
    fi
    d="$(dirname "$d")"
  done
  local h list n
  h="$(prj_reg_active_home)"
  if [[ -n "$h" ]]; then printf '%s' "$h"; return 0; fi
  list="$(prj_reg_list)"
  n="$(printf '%s\n' "$list" | sed '/^[[:space:]]*$/d' | wc -l | tr -d '[:space:]')"
  if [[ "${n:-0}" -eq 1 ]]; then printf '%s' "$(printf '%s' "$list" | cut -f2)"; return 0; fi
  if [[ "${n:-0}" -gt 1 ]]; then
    {
      echo "prj: multiple governance workspaces are registered and none is active:"
      printf '%s\n' "$list" | awk -F'\t' '{printf "  - %s  (%s)\n", $1, $2}'
      echo "Pick one with:  prj org use <github_org>     (or cd into a workspace)"
    } >&2
    return 2
  fi
  return 1
}
