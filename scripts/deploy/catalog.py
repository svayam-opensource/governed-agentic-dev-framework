#!/usr/bin/env python3
"""
Deploy catalog resolver (PRJ-012 #71 / S1).

Reads the org-wide service catalog (knowledge/deployment/catalog/services.yaml) and
answers the questions `prj deploy` (#73/S2) + triggers (#75/S5) need:
  - members(app)              dependency-ordered services of an application
  - resolve(target, env)      services + per-env pins + repos for an app|service
  - changed(paths)            which services' path-globs a diff touched (path-guard)
  - select(token, paths)      token-authoritative artifact selection + path-guard +
                              downstream-dependent scope (lib change -> dependent apps)

Pure stdlib + pyyaml (same as scripts/validate/*). Library + CLI.
"""
import argparse
import fnmatch
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

# Promoted to the framework CLI: resolve the governance workspace from $ADF_WORKSPACE
# (exported by `prj` / serve-local.sh), NOT from this file's location — which is now the
# CLI package, not the workspace. Fall back to the vendored layout (CLI inside the
# workspace: scripts/deploy/catalog.py -> parents[2] = the workspace) when unset.
_WS = os.environ.get("ADF_WORKSPACE")
REPO_ROOT = Path(_WS).resolve() if _WS else Path(__file__).resolve().parents[2]
DEFAULT_CATALOG = REPO_ROOT / "knowledge/deployment/catalog/services.yaml"
DEFAULT_PINS = DEFAULT_CATALOG.parent / "pins.yaml"
DEFAULT_LOCK = DEFAULT_CATALOG.parent / "graph.lock"
# Member repos are siblings of the workspace under the workspace's parent.
WORKSPACE_ROOT = REPO_ROOT.parent
# Config files (within a unit's path-set) scanned to DERIVE runtime deps (#5).
CONFIG_GLOBS = [".env*.example", "*.env.example", "environments/*.json",
                "public/config.json", "src/app/**/config.json", "config/*.json"]

PINS_HEADER = """# Machine-managed desired-version pins, per environment (PRJ-012 #73/S2).
# DO NOT hand-edit casually — `prj deploy` writes this: a successful deploy sets the
# service's pin; `prj deploy --promote <from> <to>` copies pins env->env (build-once-
# promote). The hand-maintained topology (services/apps/schedules) is in services.yaml.
# An absent service = not deployed in that env.
"""

DESCRIPTOR_HEADER = """# deploy.yaml — per-unit deploy descriptor (config-as-build, PRJ-012).
# SCAFFOLDED by `prj config` (catalog.py descriptor scaffold) — the developer reviews,
# never authors from blank. Two halves:
#   derived:  mechanical facts re-derived from this unit's package.json closure +
#             config_service_map. REVIEW them; CI (`descriptor check`) drift-gates them.
#   intent:   facts the tool can't know — edge identity, healthcheck, serve, hooks.
#             AUTHOR / own these.
# Step-1 migration: additive. The gov services.yaml is still the catalog SoT; this
# descriptor mirrors it for review until dual-read (step 2) lands.
"""


def load(catalog_path=None):
    p = Path(catalog_path) if catalog_path else DEFAULT_CATALOG
    with open(p) as f:
        return yaml.safe_load(f) or {}


# ── Pins (machine-managed desired versions, pins.yaml) ───────────────────────────

def load_pins(pins_path=None):
    p = Path(pins_path) if pins_path else DEFAULT_PINS
    if not p.exists():
        return {}
    with open(p) as f:
        return (yaml.safe_load(f) or {}).get("pins", {}) or {}


def _write_pins(pins, pins_path=None):
    p = Path(pins_path) if pins_path else DEFAULT_PINS
    with open(p, "w") as f:
        f.write(PINS_HEADER)
        yaml.safe_dump({"version": 1, "pins": pins}, f, default_flow_style=False, sort_keys=True)


def get_pin(service, env, pins_path=None):
    return (load_pins(pins_path).get(env, {}) or {}).get(service)


def set_pin(service, env, version, pins_path=None):
    pins = load_pins(pins_path)
    pins.setdefault(env, {})
    if version in (None, "", "null", "-"):
        pins[env].pop(service, None)
    else:
        pins[env][service] = version
    _write_pins(pins, pins_path)
    return pins


def promote(from_env, to_env, services=None, pins_path=None):
    """Copy pins from one env to the next (build-once-promote). Returns what moved."""
    pins = load_pins(pins_path)
    src = pins.get(from_env, {}) or {}
    pins.setdefault(to_env, {})
    moved = {}
    for svc, ver in src.items():
        if services and svc not in services:
            continue
        pins[to_env][svc] = ver
        moved[svc] = ver
    _write_pins(pins, pins_path)
    return moved


# ── Scheduled jobs (#75/S5(d)) → crontab lines ───────────────────────────────────
# REPO_ROOT is defined once at module top (ADF_WORKSPACE-aware) — do not redefine here.
CRON_MARKER = "# svm-deploy"   # tag for idempotent install/uninstall


def load_schedules(catalog_path=None):
    return load(catalog_path).get("schedules", []) or []


def _job_to_command(job):
    """Translate a catalog job string into a `prj deploy` command (or a # note)."""
    p = (job or "").split()
    verb = p[0] if p else ""
    if verb == "reconcile" and len(p) >= 3:        # reconcile <app> <env>
        return f"prj deploy {p[1]} --env {p[2]} --apply"
    if verb == "promote" and len(p) >= 4:          # promote <from> <to> <app>
        return f"prj deploy {p[3]} --promote {p[1]} {p[2]} --apply"
    if verb == "mirror-drill" and len(p) >= 2:     # mirror-drill <env>
        return f"# mirror-drill {p[1]} — needs the prod-mirror stage (S3); not yet a funnel flag"
    return f"# UNKNOWN schedule job: {job!r}"


def crontab_lines(catalog_path=None, workspace=None):
    ws = workspace or str(REPO_ROOT)
    out = []
    for s in load_schedules(catalog_path):
        cron, job = s.get("cron", ""), s.get("job", "")
        cmd = _job_to_command(job)
        if cmd.startswith("#"):
            out.append(f"{CRON_MARKER}: SKIPPED ({job}) -> {cmd}")
        else:
            out.append(f"{cron} cd {ws} && ./{cmd}  {CRON_MARKER}: {job}")
    return out


def _services(cat):
    return cat.get("services", {}) or {}


def _applications(cat):
    return cat.get("applications", {}) or {}


def members_in_order(cat, app):
    """Application members in dependency order (a member's in-app deps come first)."""
    apps = _applications(cat)
    if app not in apps:
        raise KeyError(f"unknown application: {app}")
    members = list(apps[app].get("members", []))
    svc = _services(cat)
    order, seen = [], set()

    def visit(s, stack):
        if s in seen:
            return
        if s in stack:
            raise ValueError(f"dependency cycle involving {s}")
        for dep in (svc.get(s, {}).get("depends_on") or []):
            if dep in members:  # only order WITHIN the app's member set
                visit(dep, stack | {s})
        seen.add(s)
        order.append(s)

    for m in members:
        visit(m, set())
    return order


def dependents(cat, service):
    """Services that declare `service` in their depends_on (downstream)."""
    return [n for n, s in _services(cat).items() if service in (s.get("depends_on") or [])]


def resolve(cat, target, env):
    """`target` is an application or a service name → ordered member records + pins."""
    apps, svc = _applications(cat), _services(cat)
    if target in apps:
        members = members_in_order(cat, target)
    elif target in svc:
        members = [target]
    else:
        raise KeyError(f"unknown app/service: {target}")
    pins = load_pins().get(env, {}) or {}
    out = []
    for m in members:
        s = svc[m]
        out.append({
            "service": m,
            "repo": s.get("repo"),
            "kind": s.get("kind"),
            "artifact": s.get("artifact"),
            "pin": pins.get(m),
            "depends_on": s.get("depends_on") or [],
            "requires": s.get("requires") or [],          # Tier-2 + Tier-1 runtime deps (preflight targets)
            "hosts": s.get("hosts"),
            "serve": s.get("serve"),
            "anchor": s.get("anchor"),
            "healthcheck": s.get("healthcheck"),
        })
    return out


def requirements(cat, target, env):
    """Resolve every `requires` of a target's members into preflight records for `env`.
    Tier-1 (a unit) = shared service; Tier-2 (a platform service) = standing infra.
    The readiness ladder (deploy/serve) consumes this."""
    rows = resolve(cat, target, env)
    units = _services(cat)
    pservices = cat.get("platform_services", {}) or {}
    members = {r["service"] for r in rows}
    out, seen = [], set()
    for m in rows:
        for r in (m.get("requires") or []):
            if r in seen:
                continue
            seen.add(r)
            rec = {"name": r, "required_by": m["service"], "is_member": r in members}
            if r in units:
                u = units[r]
                rec.update(tier=1, host=(u.get("hosts") or {}).get(env),
                           healthcheck=u.get("healthcheck"), edge=u.get("edge"))
            elif r in pservices:
                ps = pservices[r]
                rec.update(tier=2, scope=ps.get("scope"), owner=ps.get("owner"),
                           provisioning=ps.get("provisioning"), version=ps.get("version"),
                           endpoint=(ps.get("endpoints") or {}).get(env),
                           host=(ps.get("hosts") or {}).get(env),
                           health=ps.get("health"), lifecycle=ps.get("lifecycle"))
            else:
                rec.update(tier=0, error="unknown requirement (neither unit nor platform service)")
            out.append(rec)
    return out


def changed_services(cat, changed_paths):
    """Which services' path-globs match any of the changed files."""
    hits = []
    for name, s in _services(cat).items():
        globs = s.get("paths") or []
        if any(fnmatch.fnmatch(f, g) for f in changed_paths for g in globs):
            hits.append(name)
    return hits


def select_artifact(cat, token, changed_paths):
    """
    Token-authoritative + path-guard (the merge artifact-selection rule).
    The token NAMES the artifact; the changed-paths diff is a guard rail that warns
    on mismatch. Deploy scope = token + downstream dependents (lib -> dependent apps).
    """
    svc = _services(cat)
    if token not in svc:
        return {"error": f"token names unknown service: {token}", "ok": False}
    changed = changed_services(cat, changed_paths) if changed_paths else []
    warnings = []
    if not changed_paths:
        warnings.append("no changed paths supplied — token taken on trust")
    elif token not in changed:
        warnings.append(f"path-guard: token '{token}' not among changed services {changed}")
    scope = [token] + dependents(cat, token)
    return {"ok": True, "selected": token, "scope": scope, "changed": changed, "warnings": warnings}


# ── Derivation: build-DAG + path-sets + kind/artifact + runtime deps ─────────────
#    The DRIFT-PRONE facts are DERIVED from each unit's `anchor` package.json closure,
#    NOT hand-maintained. Cadence: CI (build/check), never deploy. See SoT-and-dependency-dag.md.

def _repo_path(repo):
    """'Svayamtech/911-SVM-LIB-SVC' -> <workspace>/911-SVM-LIB-SVC (sibling of svm-prj-work)."""
    return WORKSPACE_ROOT / repo.split("/")[-1]


def _read_json(p):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return {}


def _svayam_deps(pkg):
    deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
    return [k for k in deps if k.startswith("@svayam")]


def _repo_pkg_index(repo):
    """npm-name -> dir(relative to repo root) for every workspace package in `repo`."""
    root = _repo_path(repo)
    rootpkg = _read_json(root / "package.json")
    idx = {}
    for ws in (rootpkg.get("workspaces") or []):
        for pj in root.glob(ws.rstrip("/") + "/package.json"):
            nm = _read_json(pj).get("name")
            if nm:
                idx[nm] = str(pj.parent.relative_to(root))
    return idx


def _anchor_name_to_unit(cat):
    """npm-name of each unit's anchor package -> unit name (for cross-repo build edges)."""
    out = {}
    for u, s in _services(cat).items():
        if not s.get("anchor"):
            continue
        pkg = _read_json(_repo_path(s["repo"]) / s["anchor"] / "package.json")
        if pkg.get("name"):
            out[pkg["name"]] = u
    return out


def _infer_kind(root, anchor, pkg):
    if (root / anchor / "Dockerfile").exists():
        return "api"
    if (root / anchor / "angular.json").exists() or (root / anchor / "project.json").exists():
        return "spa"
    return "lib"


def _infer_artifact(kind, name, pkg):
    if kind == "lib":
        return "npm.svayamtech.com/" + (pkg.get("name") or name)
    return f"docker.svayamtech.com/svayam/{name}"


def _derive_requires(cat, root, paths):
    """Scan config files within the unit's path-set for config_service_map keys (#5)."""
    keymap = cat.get("config_service_map", {}) or {}
    found = set()
    dirs = sorted({p[:-3] for p in paths if p.endswith("/**")})
    for d in dirs:
        base = root / d
        if not base.exists():
            continue
        for cg in CONFIG_GLOBS:
            for f in base.glob(cg):
                if not f.is_file():
                    continue
                try:
                    txt = f.read_text(errors="ignore")
                except Exception:
                    continue
                for key, svc in keymap.items():
                    if key in txt:
                        found.add(svc)
    return found


def derive_unit(cat, name):
    """Derive the drift-prone facts for a Tier-1 unit from its repo."""
    s = _services(cat)[name]
    repo, anchor = s["repo"], s.get("anchor")
    root = _repo_path(repo)
    if not anchor:
        return {"paths": s.get("paths") or [], "depends_on": s.get("depends_on") or [],
                "kind": s.get("kind"), "artifact": s.get("artifact"),
                "npm_name": None, "requires_derived": []}
    idx = _repo_pkg_index(repo)
    name2unit = _anchor_name_to_unit(cat)
    anchor_pkg = _read_json(root / anchor / "package.json")
    paths, depends, seen = {anchor.rstrip("/") + "/**"}, set(), set()

    def walk(dirrel):
        if dirrel in seen:
            return
        seen.add(dirrel)
        pkg = _read_json(root / dirrel / "package.json")
        for dep in _svayam_deps(pkg):
            if dep in name2unit and name2unit[dep] != name:
                depends.add(name2unit[dep])             # unit-level edge (may be cross-repo)
            if dep in idx:                               # same-repo build-input → path-set
                d = idx[dep]
                paths.add(d.rstrip("/") + "/**")
                walk(d)

    walk(anchor)
    kind = s.get("kind") or _infer_kind(root, anchor, anchor_pkg)
    artifact = s.get("artifact") or _infer_artifact(kind, name, anchor_pkg)
    return {"paths": sorted(paths), "depends_on": sorted(depends), "kind": kind,
            "artifact": artifact, "npm_name": anchor_pkg.get("name"),
            "requires_derived": sorted(_derive_requires(cat, root, paths))}


# ── Per-unit descriptor (deploy.yaml) — config-as-build step 1 (additive) ────────
#    The tool PROPOSES a per-unit deploy.yaml from the same derivation engine `build`
#    uses, splitting facts into `derived` (re-derivable, drift-gated) and `intent`
#    (authored). Step-1 lifts intent from the existing gov services.yaml entry so the
#    descriptor is faithful to today's catalog; the dev then owns/edits it. See
#    config-as-build-design.md §3.1, §5.

def _edge_intent(edge):
    """Split a gov edge value into authored intent.
    'security-<env>.svayamtech.com' -> {'slug': 'security'} (the gov template fills <env>);
    a non-templated host -> {'host': <edge>} (vanity override). None -> None."""
    if not edge:
        return None
    m = re.match(r"^(?P<slug>.+?)-<env>\.(?P<domain>.+)$", edge)
    if m:
        return {"slug": m.group("slug")}
    return {"host": edge}


def descriptor_for(cat, name):
    """Build a proposed per-unit deploy.yaml dict (derived ⊕ intent) for review."""
    s = _services(cat).get(name)
    if s is None:
        raise KeyError(f"unknown unit: {name}")
    d = derive_unit(cat, name)
    # Owning hooks: a generic catalog hook belongs to this unit when it runs out of the
    # unit's repo and names the unit in its cmd path (e.g. .../svm-ident/scripts/seed-iam.py).
    hooks = {hn: hv for hn, hv in (cat.get("hooks") or {}).items()
             if hv.get("repo") == s.get("repo") and name in (hv.get("cmd") or "")}
    return {
        "schema": 1,
        "unit": name,
        "repo": s.get("repo"),
        "anchor": s.get("anchor"),
        # derived — re-derivable, REVIEW only (drift-gated by `descriptor check`).
        "derived": {
            "kind": d["kind"],
            "artifact": d["artifact"],
            "npm_name": d["npm_name"],
            "paths": d["paths"],
            "depends_on": d["depends_on"],
            # declared requires is today's reviewed SoT; config-derived must be ⊆ it (checked).
            "requires": list(s.get("requires") or []),
        },
        # intent — AUTHOR/own these (lifted from gov services.yaml for step-1 review).
        "intent": {
            "edge": _edge_intent(s.get("edge")),
            "healthcheck": s.get("healthcheck"),
            "serve": s.get("serve"),
            "hooks": hooks or None,
        },
    }


def descriptor_yaml(desc):
    """Render a descriptor dict as commented YAML (insertion order preserved)."""
    return DESCRIPTOR_HEADER + yaml.safe_dump(desc, default_flow_style=False, sort_keys=False)


def check_descriptor(cat, path):
    """Drift gate for a committed deploy.yaml: re-derive and assert its `derived` block
    equals a fresh derivation, and that config-derived requires are covered. Returns a
    list of (kind, field, msg) issues (empty = OK)."""
    with open(path) as f:
        doc = yaml.safe_load(f) or {}
    unit = doc.get("unit")
    if not unit:
        return [("schema", "unit", "descriptor missing `unit`")]
    if unit not in _services(cat):
        return [("unknown-unit", unit, f"unit '{unit}' not in services.yaml")]
    fresh = descriptor_for(cat, unit)
    issues = []
    committed = doc.get("derived") or {}
    for k, v in fresh["derived"].items():
        cv = committed.get(k)
        if isinstance(v, list):
            cv, v = sorted(cv or []), sorted(v)
        if cv != v:
            issues.append(("derived-drift", k, f"committed {cv!r} != derived {v!r} — re-scaffold"))
    d = derive_unit(cat, unit)
    for svc in sorted(set(d["requires_derived"]) - set(committed.get("requires") or [])):
        issues.append(("requires-missing", "requires", f"config references {svc} but `requires` omits it"))
    return issues


def build_lock(cat):
    """Effective catalog = derived ⊕ declared. The thing deploy/serve read."""
    units = {}
    for name in _services(cat):
        d = derive_unit(cat, name)
        decl = _services(cat)[name]
        units[name] = {
            "repo": decl.get("repo"), "anchor": decl.get("anchor"),
            "kind": d["kind"], "artifact": d["artifact"], "npm_name": d["npm_name"],
            "paths": d["paths"], "depends_on": d["depends_on"],
            "requires": decl.get("requires") or [], "requires_derived": d["requires_derived"],
            "hosts": decl.get("hosts"), "edge": decl.get("edge"),
            "serve": decl.get("serve"), "healthcheck": decl.get("healthcheck"),
            "build": decl.get("build"),
        }
    return {
        "_generated_by": "catalog.py build — DO NOT EDIT; regenerate from services.yaml + repos",
        "version": cat.get("version"),
        "units": units,
        "platform_services": cat.get("platform_services", {}) or {},
        "applications": cat.get("applications", {}) or {},
        "config_service_map": cat.get("config_service_map", {}) or {},
        # Generic verb→app-owned-script hooks (e.g. seed, iam-data) — prj dispatches
        # to these without embedding app logic in the CLI. Passed through verbatim.
        "hooks": cat.get("hooks", {}) or {},
    }


def write_lock(lock, lock_path=None):
    p = Path(lock_path) if lock_path else DEFAULT_LOCK
    with open(p, "w") as f:
        json.dump(lock, f, indent=2, sort_keys=True)
        f.write("\n")


def load_lock(lock_path=None):
    p = Path(lock_path) if lock_path else DEFAULT_LOCK
    if not p.exists():
        return None
    with open(p) as f:
        return json.load(f)


def effective_cat(cat):
    """Merge graph.lock (derived) over services.yaml (declared) so read commands are lock-aware."""
    lock = load_lock()
    if not lock:
        return cat
    merged = dict(cat)
    svc = {}
    for name, u in (lock.get("units") or {}).items():
        base = dict((cat.get("services") or {}).get(name, {}))
        base.update({k: v for k, v in u.items() if v is not None})
        svc[name] = base
    merged["services"] = svc
    merged["platform_services"] = lock.get("platform_services", cat.get("platform_services", {}))
    return merged


def check(cat):
    """Drift gate: re-derive and assert the declared overlay + committed lock agree."""
    issues = []
    pservices = set(cat.get("platform_services", {}) or {})
    units = set(_services(cat))
    for name, s in _services(cat).items():
        # Referential integrity of declared requires (always).
        for r in (s.get("requires") or []):
            if r not in pservices and r not in units:
                issues.append(("requires-unknown", name, f"requires '{r}' is neither a platform service nor a unit"))
        anchor = s.get("anchor")
        if not anchor:
            continue  # declared-only unit (no npm-workspace package to derive from)
        if not (_repo_path(s["repo"]) / anchor / "package.json").exists():
            issues.append(("anchor-missing", name, f"no package.json at {s['repo']}/{anchor}"))
            continue
        d = derive_unit(cat, name)
        if s.get("paths") and sorted(s["paths"]) != d["paths"]:
            issues.append(("paths-drift", name, f"declared {s['paths']} != derived {d['paths']}"))
        if s.get("depends_on") and sorted(s["depends_on"]) != d["depends_on"]:
            issues.append(("depends_on-drift", name, f"declared {s['depends_on']} != derived {d['depends_on']}"))
        for svc in (set(d["requires_derived"]) - set(s.get("requires") or [])):
            issues.append(("requires-missing", name, f"config references {svc} but `requires` omits it"))
    # lock freshness
    lock = load_lock()
    if lock is None:
        issues.append(("lock-missing", "-", "graph.lock absent — run `catalog.py build`"))
    elif lock.get("units") != build_lock(cat)["units"]:
        issues.append(("lock-stale", "-", "graph.lock != freshly derived — run `catalog.py build`"))
    return issues


def _fmt_resolve_text(rows):
    return "\n".join(
        f"  {r['service']:14} pin={r['pin']}  ({r['repo']}, {r['kind']})" for r in rows
    ) or "  (no members)"


def _fmt_select_text(d):
    if not d.get("ok"):
        return f"  ERROR: {d.get('error')}"
    changed = ", ".join(d["changed"]) or "(none)"
    lines = [f"  selected: {d['selected']}   scope: {', '.join(d['scope'])}   changed: {changed}"]
    lines += [f"  WARN: {w}" for w in d.get("warnings", [])]
    return "\n".join(lines)


def _materialize_catalog_from_ref(ref):
    """Env-aware catalog source (PRJ-012). For non-local envs, read the CANONICAL
    catalog from a committed git ref in the gov repo (default `origin/main`) instead
    of the developer's working tree — so the CLI's unit/job resolution agrees with
    what Jenkins (which checks out main) actually deploys. Writes services.yaml +
    graph.lock + pins.yaml from that ref into a temp dir and returns it."""
    base = "knowledge/deployment/catalog"
    d = Path(tempfile.mkdtemp(prefix="catalog-ref-"))
    for fn in ("services.yaml", "graph.lock", "pins.yaml"):
        try:
            out = subprocess.run(
                ["git", "-C", str(REPO_ROOT), "show", f"{ref}:{base}/{fn}"],
                capture_output=True, text=True, check=True,
            ).stdout
            (d / fn).write_text(out)
        except subprocess.CalledProcessError:
            pass  # graph.lock / pins.yaml may legitimately be absent at the ref
    if not (d / "services.yaml").exists():
        sys.exit(
            f"catalog: cannot read {base}/services.yaml from '{ref}'. "
            f"Commit + push the catalog to the gov repo's canonical branch first "
            f"(or set CATALOG_REF). Local deploys (--local) read the working tree and need no commit."
        )
    return d


def _main(argv=None):
    global DEFAULT_CATALOG, DEFAULT_LOCK, DEFAULT_PINS
    ap = argparse.ArgumentParser(prog="catalog.py", description="Deploy catalog resolver (S1)")
    ap.add_argument("--catalog", help="path to services.yaml (default: workspace catalog)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("members"); p.add_argument("app")
    p = sub.add_parser("resolve"); p.add_argument("target"); p.add_argument("--env", required=True); p.add_argument("--format", choices=["json", "text"], default="json")
    p = sub.add_parser("changed"); p.add_argument("--changed", nargs="*", default=[])
    p = sub.add_parser("preflight"); p.add_argument("target"); p.add_argument("--env", required=True)
    p = sub.add_parser("select"); p.add_argument("--token", required=True); p.add_argument("--changed", nargs="*", default=[]); p.add_argument("--format", choices=["json", "text"], default="json")
    p = sub.add_parser("pins"); p.add_argument("env")
    p = sub.add_parser("get-pin"); p.add_argument("service"); p.add_argument("env")
    p = sub.add_parser("set-pin"); p.add_argument("service"); p.add_argument("env"); p.add_argument("version")
    p = sub.add_parser("promote"); p.add_argument("from_env"); p.add_argument("to_env"); p.add_argument("services", nargs="*")
    p = sub.add_parser("schedules"); p.add_argument("--workspace", default=None)
    sub.add_parser("build")    # derive → write graph.lock
    sub.add_parser("check")    # drift gate: re-derive & assert == lock + declared
    p = sub.add_parser("descriptor")   # per-unit deploy.yaml: scaffold (propose) | check (drift)
    p.add_argument("action", choices=["scaffold", "check"])
    p.add_argument("target", help="unit name (scaffold) or path to a deploy.yaml (check)")
    p.add_argument("--write", action="store_true",
                   help="scaffold: write <repo>/<anchor>/deploy.yaml instead of printing")
    p.add_argument("--format", choices=["yaml", "json"], default="yaml")
    args = ap.parse_args(argv)
    # Env-aware source: --local reads the working tree (devs iterate freely, no commit);
    # dev/uat/prod resolve from the committed canonical catalog (gov repo `origin/main`,
    # override via CATALOG_REF). Only the deploy-resolution reads honour this — pin
    # management (pins/get-pin/set-pin/promote) and build/check stay on the working tree.
    if (args.cmd in ("resolve", "preflight")
            and getattr(args, "env", None) not in (None, "local")
            and not args.catalog):
        _ref = os.environ.get("CATALOG_REF", "origin/main")
        _d = _materialize_catalog_from_ref(_ref)
        DEFAULT_CATALOG = _d / "services.yaml"
        DEFAULT_LOCK = _d / "graph.lock"
        DEFAULT_PINS = _d / "pins.yaml"
    raw = load(args.catalog)
    # Read commands operate on the lock-merged (effective) catalog; build/check use raw.
    cat = raw if args.cmd in ("build", "check", "descriptor") else effective_cat(raw)
    try:
        if args.cmd == "build":
            lock = build_lock(raw)
            write_lock(lock)
            print(f"wrote {DEFAULT_LOCK} — {len(lock['units'])} units, "
                  f"{len(lock['platform_services'])} platform services")
        elif args.cmd == "check":
            issues = check(raw)
            for kind, name, msg in issues:
                print(f"  [{kind}] {name}: {msg}", file=sys.stderr)
            print(f"{'FAIL' if issues else 'OK'}: {len(issues)} issue(s)")
            return 1 if issues else 0
        elif args.cmd == "descriptor":
            if args.action == "scaffold":
                desc = descriptor_for(cat, args.target)
                text = (json.dumps(desc, indent=2) + "\n" if args.format == "json"
                        else descriptor_yaml(desc))
                if args.write:
                    s = _services(cat)[args.target]
                    anchor = s.get("anchor")
                    if not anchor:
                        print(f"cannot --write: '{args.target}' is declared-only (no anchor); "
                              f"place deploy.yaml manually", file=sys.stderr)
                        return 2
                    dest = _repo_path(s["repo"]) / anchor / "deploy.yaml"
                    dest.write_text(text)
                    print(f"wrote {dest}")
                else:
                    sys.stdout.write(text)
            else:  # check
                issues = check_descriptor(cat, args.target)
                for kind, fld, msg in issues:
                    print(f"  [{kind}] {fld}: {msg}", file=sys.stderr)
                print(f"{'FAIL' if issues else 'OK'}: {len(issues)} issue(s)")
                return 1 if issues else 0
        elif args.cmd == "members":
            print(json.dumps(members_in_order(cat, args.app)))
        elif args.cmd == "resolve":
            rows = resolve(cat, args.target, args.env)
            print(_fmt_resolve_text(rows) if args.format == "text" else json.dumps(rows, indent=2))
        elif args.cmd == "changed":
            print(json.dumps(changed_services(cat, args.changed)))
        elif args.cmd == "preflight":
            print(json.dumps(requirements(cat, args.target, args.env), indent=2))
        elif args.cmd == "select":
            d = select_artifact(cat, args.token, args.changed)
            print(_fmt_select_text(d) if args.format == "text" else json.dumps(d, indent=2))
        elif args.cmd == "pins":
            print(json.dumps(load_pins().get(args.env, {}) or {}, indent=2))
        elif args.cmd == "get-pin":
            print(get_pin(args.service, args.env) or "")
        elif args.cmd == "set-pin":
            set_pin(args.service, args.env, args.version)
            print(f"{args.service}@{args.env} = {args.version}")
        elif args.cmd == "promote":
            moved = promote(args.from_env, args.to_env, args.services or None)
            print(json.dumps({"promoted": moved, "from": args.from_env, "to": args.to_env}, indent=2))
        elif args.cmd == "schedules":
            for line in crontab_lines(args.catalog, args.workspace):
                print(line)
    except (KeyError, ValueError) as e:
        print(f"catalog error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
