#!/usr/bin/env bash
# =============================================================================
# serve-local.sh — the `prj deploy <target> --local` backend (PRJ-012, 2026-06-22).
#
# LOCAL is a polymorphic backend of the SAME verb surface as dev/uat/prod, but
# instead of build+Jenkins it runs the WATCH/SERVE orchestrator:
#   1. resolve the target's members (dep order) + requirements from graph.lock
#   2. Tier-2 READINESS LADDER on each requirement (stub-skip | auto-start | halt)
#   3. bring up members by kind: api = ensure the local container stack;
#      spa = native dev-server (build + SPA static serve); lib = build --watch
#   4. write the local wiring (spa config.json → the LOCAL iam base url)
#   5. foreground (tail) by default; -d detaches. State in .local/serve/<target>/.
#
# Cross-repo deps not served locally resolve to shared DEV (the local rule).
# =============================================================================
set -euo pipefail
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"        # scripts/deploy (lib.sh clobbers SCRIPT_DIR — don't use it)
source "$DEPLOY_DIR/../lib.sh"
load_config
CATALOG="python3 $DEPLOY_DIR/catalog.py"
# Promoted to the framework CLI: resolve the governance workspace from $ADF_WORKSPACE
# (exported by `prj`), NOT from this script's location (now the CLI package, not the
# workspace). Fall back to the vendored layout (CLI inside the workspace) when unset.
REPO_ROOT_SP="${ADF_WORKSPACE:-$(cd "$DEPLOY_DIR/../.." && pwd)}"   # the governance workspace (svm-prj-work)
WORKSPACE_ROOT="$(cd "$REPO_ROOT_SP/.." && pwd)"                    # holds member repos (siblings of the workspace)
export ADF_WORKSPACE="$REPO_ROOT_SP"                               # so catalog.py resolves the same workspace

TARGET="${1:-}"; shift || true
[[ -n "$TARGET" ]] || hard_stop "serve-local.sh <app|unit> [-d] [--image]"
DETACH=0; IMAGE=0; ACTION="up"; PROVISION=0; SEED=0; ALL=0
while [[ $# -gt 0 ]]; do case "$1" in
  -d|--detach) DETACH=1; shift ;;
  --image) IMAGE=1; shift ;;
  --stop) ACTION="stop"; shift ;;
  --all) ALL=1; shift ;;               # with --stop: also bring down the catalog Tier-2 containers
  --logs) ACTION="logs"; shift ;;
  --provision) PROVISION=1; shift ;;   # auto bring-up an api member that isn't up yet (rung ① of the ladder)
  --seed) SEED=1; PROVISION=1; shift ;; # also load curated data (catalog seed hook); implies provision
  *) shift ;;
esac; done

STATE_DIR="$REPO_ROOT_SP/.local/serve/$TARGET"; mkdir -p "$STATE_DIR"
LOG_DIR="$STATE_DIR/logs"; mkdir -p "$LOG_DIR"
PIDS_FILE="$STATE_DIR/pids"

# ── Lifecycle: stop / logs (the same surface as dev/uat/prod, local backend) ───
if [[ "$ACTION" == "stop" ]]; then
  echo "=== prj stop $TARGET --local$([[ $ALL == 1 ]] && echo ' --all') ==="
  if [[ -f "$PIDS_FILE" ]]; then
    while read -r u k p port; do
      [[ -z "$p" ]] && continue
      pkill -P "$p" 2>/dev/null || true                 # child procs (npx forks node)
      kill "$p" 2>/dev/null || true                     # the recorded wrapper
      prt="${port#:}"                                    # kill the actual listener by port
      if [[ -n "$prt" ]]; then for x in $(lsof -ti tcp:"$prt" 2>/dev/null); do kill "$x" 2>/dev/null || true; done; fi
      info "  stopped $u ($k) [pid $p ${port}]"
    done < "$PIDS_FILE"
    : > "$PIDS_FILE"
    info "host dev-servers stopped."
  else
    info "no host dev-servers recorded."
  fi
  # --all: also bring down the target's catalog-declared Tier-2 containers, via each
  # owner's stop script (the inverse of --provision: dirname(provision)/stop.sh → compose
  # stop, volume preserved). Without --all, shared containers are deliberately left up.
  if [[ "$ALL" == 1 ]]; then
    echo "--- --all: bringing down catalog Tier-2 containers ---"
    python3 -c "
import json, os.path
c=json.load(open('$REPO_ROOT_SP/knowledge/deployment/catalog/graph.lock'))
apps=c.get('applications',{}) or {}; units=c.get('units',{}) or {}; ps=c.get('platform_services',{}) or {}
t='$TARGET'
members=(apps.get(t,{}) or {}).get('members') or ([t] if t in units else list(units))
seen=set()
for m in members:
    for r in (units.get(m,{}).get('requires') or []):
        sp=ps.get(r,{})
        if sp.get('provisioning')=='container' and sp.get('provision') and sp.get('owner'):
            leaf=(units.get(sp['owner'],{}).get('repo') or '').split('/')[-1]
            stopsh=os.path.dirname(sp['provision'])+'/stop.sh'
            key=leaf+'|'+stopsh
            if leaf and key not in seen: seen.add(key); print(key)
" | while IFS='|' read -r leaf stopsh; do
      [[ -z "$leaf" ]] && continue
      script="$WORKSPACE_ROOT/$leaf/$stopsh"
      if [[ -f "$script" ]]; then info "  ▶ stopping $leaf via $stopsh"; bash "$script" || warn "  stop script failed: $script"
      else warn "  no stop script at $script — Tier-2 left running"; fi
    done
  else
    info "  (shared Tier-2 containers like svm-ident/SVC_DB left running — use --all to bring them down too)"
  fi
  exit 0
fi
if [[ "$ACTION" == "logs" ]]; then
  [[ -d "$LOG_DIR" ]] && exec tail -n +1 -F "$LOG_DIR"/*.log
  info "no logs yet for $TARGET."; exit 0
fi
: > "$PIDS_FILE"

repo_dir() { echo "$WORKSPACE_ROOT/${1##*/}"; }   # Svayamtech/912-... -> <ws>/912-...

echo "=== prj deploy $TARGET --local   ($([[ $DETACH == 1 ]] && echo detached || echo foreground)$([[ $IMAGE == 1 ]] && echo ', image-fidelity'))"

# ── 1. Tier-2 readiness ladder ────────────────────────────────────────────────
echo "--- preflight: Tier-2 readiness ladder (env=local) ---"
PF_JSON="$($CATALOG preflight "$TARGET" --env local)"
# Emit one TSV line per requirement: name<TAB>tier<TAB>provisioning<TAB>endpoint<TAB>host<TAB>probe<TAB>port<TAB>is_member
echo "$PF_JSON" | python3 -c '
import sys, json
for r in json.load(sys.stdin):
    h = r.get("health") or {}
    print("|".join(str(x) for x in [          # | (non-whitespace) so empty fields survive read
        r["name"], r["tier"], r.get("provisioning",""), r.get("endpoint") or "",
        r.get("host") or "", h.get("probe",""), h.get("port",""), r.get("is_member")]))
' > "$STATE_DIR/preflight.tsv"

STUBS="hermetic-stub recording-stub sms-stub"
while IFS="|" read -r name tier prov endpoint host probe port is_member; do
  [[ -z "$name" ]] && continue
  if [[ "$tier" == "1" ]]; then
    if [[ "$is_member" == "True" ]]; then info "  ✓ $name (Tier-1, served locally as a member)";
    else info "  • $name (Tier-1 shared) — preflight deferred to member bring-up"; fi
    continue
  fi
  # Tier-2
  if [[ " $STUBS " == *" $endpoint "* || "$prov" == "saas" ]]; then
    info "  ⏭  $name — stubbed locally (endpoint=$endpoint) → skip"
    continue
  fi
  if [[ "$prov" == "container" && "$probe" == "tcp" && -n "$port" ]]; then
    if (exec 3<>"/dev/tcp/${host:-localhost}/$port") 2>/dev/null; then exec 3>&- 2>/dev/null || true
      info "  ✓ $name — rung④ healthy (${host:-localhost}:$port)"
    else
      # SVC_DB is dedicated+bundled in its owner's compose → comes up with the owner (api member).
      info "  ▶ $name — rung② not yet up; bundled with its owner, will start with the member stack"
    fi
    continue
  fi
  info "  • $name — no local probe (prov=$prov)"
done < "$STATE_DIR/preflight.tsv"

# Product code for the launcher home_url wiring (application's oidc_client, else the target).
PRODUCT_CD="$(python3 -c "import json;c=json.load(open('$REPO_ROOT_SP/knowledge/deployment/catalog/graph.lock'));a=(c.get('applications') or {}).get('$TARGET') or {};print(a.get('oidc_client') or '$TARGET')" 2>/dev/null || echo "$TARGET")"

# ── 2/4. Bring up members in dependency order ─────────────────────────────────
echo "--- members (dependency order) ---"
MEMB_TSV="$($CATALOG resolve "$TARGET" --env local | python3 -c '
import sys, json
for m in json.load(sys.stdin):
    print("|".join([m["service"], m.get("kind") or "", m.get("repo") or "",
                    m.get("anchor") or "", m.get("serve") or "", m.get("healthcheck") or ""]))')"

# Resolve the LOCAL iam base url from the spa member config.json (the contract).
iam_base_url() {
  local cfg="$1/public/config.json"
  [[ -f "$cfg" ]] && python3 -c "import json;print(json.load(open('$cfg')).get('iamBaseUrl',''))" 2>/dev/null || true
}

ensure_api() {   # $1=unit  — ensure the local container stack for an api/service is healthy
  local unit="$1" base="$2"
  if [[ -n "$base" ]] && curl -fsS -m 5 "$base/health" >/dev/null 2>&1; then
    info "  ✓ $unit — already healthy at $base (reuse)"
    return 0
  fi
  if [[ "$PROVISION" == 1 ]]; then
    # rung ①: provision the member's own substrate (its dedicated SVC_DB engine+data).
    # The owner + provision script come from the catalog (graph.lock), so we never
    # hard-code app paths here. The script (e.g. bootstrap.sh) brings up the DB and migrates.
    local prov; prov="$(python3 -c "
import json
c=json.load(open('$REPO_ROOT_SP/knowledge/deployment/catalog/graph.lock'))
u=c.get('units',{}).get('$unit',{}); ps=c.get('platform_services',{})
for r in u.get('requires',[]):
    sp=ps.get(r,{}); pv=sp.get('provision'); own=sp.get('owner')
    if pv and own:
        repo=c.get('units',{}).get(own,{}).get('repo','')
        print((repo.split('/')[-1])+'|'+pv); break
" 2>/dev/null)"
    if [[ -n "$prov" ]]; then
      local leaf="${prov%%|*}" rel="${prov#*|}" script="$WORKSPACE_ROOT/${prov%%|*}/${prov#*|}"
      if [[ -f "$script" ]]; then
        info "  ▶ $unit — provisioning via $leaf/$rel"
        if bash "$script"; then
          base="${base:-http://localhost:3060}"
          for _ in $(seq 1 20); do curl -fsS -m 5 "$base/health" >/dev/null 2>&1 && { info "  ✓ $unit — provisioned & healthy at $base"; return 0; }; sleep 3; done
          warn "  $unit provisioned but not healthy yet at $base — check its logs"; return 1
        fi
        warn "  $unit provision script failed ($script)"; return 1
      fi
      warn "  $unit — catalog provision script not found at $script"; return 1
    fi
    warn "  $unit — no catalog-declared provision command; bring it up manually"; return 1
  fi
  warn "  $unit not healthy at ${base:-<unknown>} — pass --provision to auto-start it, or run its package start.sh"
  return 1
}

# Per-env catalog debt (Bucket D): the launcher tile target = iam_product.home_url, seeded
# with ONE env URL (usually prod). Locally, point the served app's home_url at its local URL
# so clicking its tile stays local. Best-effort against the bundled IAM MariaDB.
wire_local_launcher() {   # $1=product_cd  $2=local_url
  local pcd="$1" url="$2"
  local envf="$WORKSPACE_ROOT/911-SVM-LIB-SVC/packages/libraries/ts/svm-ident/.env.iam"
  local db; db="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -m1 'svm-iam-mariadb' || true)"
  [[ -n "$db" && -f "$envf" ]] || { warn "  launcher: could not auto-wire $pcd home_url (patch iam_product manually)"; return 0; }
  local mu mp mdb
  mu="$(sed -n 's/^MARIADB_USER=//p' "$envf" | tail -1)"
  mp="$(sed -n 's/^MARIADB_PASSWORD=//p' "$envf" | tail -1)"
  mdb="$(sed -n 's/^MARIADB_DB=//p' "$envf" | tail -1)"; mdb="${mdb:-iam}"
  if docker exec "$db" mariadb -u"$mu" -p"$mp" "$mdb" \
       -e "UPDATE iam_product SET home_url='$url' WHERE product_cd='$pcd' AND (txn_end IS NULL OR txn_end > NOW());" 2>/dev/null; then
    info "  ✓ launcher: $pcd home_url → $url (local IAM catalog)"
  else
    warn "  launcher: failed to set $pcd home_url in local IAM"
  fi
}

serve_spa() {   # $1=unit $2=repo $3=anchor
  local unit="$1" rdir; rdir="$(repo_dir "$2")/$3"
  [[ -d "$rdir" ]] || { warn "  $unit: anchor dir missing ($rdir)"; return 1; }
  local base; base="$(iam_base_url "$rdir")"
  info "  $unit (spa) — local IAM = ${base:-<config.json default>}; building + serving"
  local log="$LOG_DIR/$unit.log"
  # config.json already carries the local default (iamBaseUrl localhost:3060); leave as-is for local.
  ( cd "$rdir"
    echo "[serve-local] npm install (link @svayam libs) ..."; npm install --no-audit --no-fund 2>&1
    echo "[serve-local] ng build ..."; npx ng build 2>&1
    echo "[serve-local] serving dist/svm-portal/browser on :4202 ..."
    exec npx angular-http-server --path dist/svm-portal/browser -p 4202
  ) >"$log" 2>&1 &
  local pid=$!
  echo "$unit spa $pid :4202" >> "$PIDS_FILE"
  info "  $unit → http://localhost:4202   (pid $pid, log $log)"
  wire_local_launcher "${PRODUCT_CD:-$unit}" "http://localhost:4202"
}

while IFS="|" read -r unit kind repo anchor serve hc; do
  [[ -z "$unit" ]] && continue
  case "$kind" in
    api|service)
      base="$(iam_base_url "$(repo_dir "$repo")/${anchor%/*}")"   # spa sibling carries the contract; fallback below
      [[ -n "$base" ]] || base="http://localhost:3060"
      ensure_api "$unit" "$base" || true ;;
    spa)
      serve_spa "$unit" "$repo" "$anchor" || true ;;
    lib)
      info "  $unit (lib) — consumed via published npm locally; add a build --watch when editing it" ;;
    *)
      info "  $unit ($kind) — no local backend yet" ;;
  esac
done <<< "$MEMB_TSV"

# ── 4b. Seed (--seed): load curated data via the catalog seed hook ────────────
# Runs AFTER members are up (the api/IAM is healthy from the ladder) and BEFORE the
# foreground tail. prj orchestrates; the seed LOGIC lives in the hook's app repo.
if [[ "$SEED" == 1 ]]; then
  echo "--- seed (--seed): catalog seed hook (env=local) ---"
  SEED_SPEC="$(python3 -c "
import json
c=json.load(open('$REPO_ROOT_SP/knowledge/deployment/catalog/graph.lock'))
h=(c.get('hooks') or {}).get('seed')
print((h.get('repo') or '').split('/')[-1]+'|'+h['cmd']) if h and h.get('cmd') else ''
" 2>/dev/null)"
  if [[ -n "$SEED_SPEC" ]]; then
    _sleaf="${SEED_SPEC%%|*}"; _scmd="${SEED_SPEC#*|}"; _sdir="$WORKSPACE_ROOT/$_sleaf"
    if [[ -d "$_sdir" ]]; then
      info "  ▶ seeding via $_sleaf ($_scmd --env local)"
      ( cd "$_sdir" && eval "$_scmd --env local" ) && info "  ✓ seeded (env=local)" || warn "  seed failed (see output above)"
    else
      warn "  seed: owner repo '$_sleaf' not found at $_sdir — clone it into the project"
    fi
  else
    warn "  seed: no 'seed' hook declared in the catalog (hooks.seed)"
  fi
fi

# ── 5. Foreground tail or detach ──────────────────────────────────────────────
echo "--- $TARGET is up locally ---"
sed -n 's/^/  serving: /p' "$PIDS_FILE" 2>/dev/null || true
if [[ "$DETACH" == 1 ]]; then
  info "detached. logs: prj deploy $TARGET --local --logs    stop: prj deploy $TARGET --local --stop"
  exit 0
fi
info "foreground — Ctrl-C to stop. Tailing logs ..."
cleanup() { echo; info "stopping ..."; while read -r u k p rest; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done < "$PIDS_FILE"; exit 0; }
trap cleanup INT TERM
tail -n +1 -F "$LOG_DIR"/*.log 2>/dev/null &
wait
