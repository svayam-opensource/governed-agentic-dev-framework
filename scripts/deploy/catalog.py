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
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError:
    # PyYAML isn't importable — e.g. minimal Slackware where pip can't build it.
    # `prj deps` guarantees a yaml reader on EVERY supported OS: PyYAML *or* the
    # static `yq` binary (Mike Farah's Go yq). Bridge that binary to the small
    # yaml surface this tool uses (safe_load / safe_dump) so the shipped catalog
    # works without PyYAML. graph.lock is written as JSON, so only services.yaml
    # / pins.yaml / deploy.yaml round-trip through here.
    class _YqYaml:
        def __init__(self):
            self._yq = shutil.which("yq")
            if not self._yq:
                raise ModuleNotFoundError(
                    "no yaml backend: neither PyYAML nor the `yq` binary is "
                    "available — run `prj deps` to prepare this environment")

        def _run(self, args, text):
            return subprocess.run([self._yq, *args, "eval", ".", "-"], input=text,
                                  capture_output=True, text=True, check=True).stdout

        def safe_load(self, stream):
            text = stream.read() if hasattr(stream, "read") else stream
            if not text or not text.strip():
                return None
            out = self._run(["-o=json"], text)            # yaml in (default) -> json out
            return json.loads(out) if out.strip() else None

        def safe_dump(self, data, stream=None, **_):
            out = self._run(["-p=json", "-o=yaml"], json.dumps(data))   # json in -> yaml out
            if stream is not None:
                stream.write(out)
                return None
            return out

    yaml = _YqYaml()

# Windows consoles default to cp1252; the dag/view printers emit box-drawing
# glyphs (├─ └─) and arrows (→). Force UTF-8 so those don't crash the command
# with a 'charmap' codec encode error (Git Bash / native python on Windows).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

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

# #109 — on-demand member-repo materialization for derivation. Deriving the
# build facts (paths/depends_on/semver/content-sha) needs the member repo's
# SOURCE, which may not be cloned into the project (shared libs never are). When
# CATALOG_MATERIALIZE=1, materialize it via materialize-repo.sh (worktree of the
# right branch for CATALOG_ENV, pulled) instead of pointing at an absent sibling.
# Viewing the DAG reads graph.lock and needs none of this (see the #108 spec).
_MATERIALIZE = os.environ.get("CATALOG_MATERIALIZE") == "1"
_CAT_ENV = os.environ.get("CATALOG_ENV", "local")
_MAT_SCRIPT = Path(__file__).resolve().parent / "materialize-repo.sh"
_repo_path_cache = {}


def _repo_path(repo):
    """'Svayamtech/911-SVM-LIB-SVC' -> the repo dir.

    Normally a sibling of the workspace (WORKSPACE_ROOT/<name>). When
    CATALOG_MATERIALIZE=1 and that sibling is absent, materialize the repo on
    demand (#109) via materialize-repo.sh and use the materialized path (cached
    so each repo is materialized at most once per process)."""
    name = repo.split("/")[-1]
    sib = WORKSPACE_ROOT / name
    if sib.exists() or not _MATERIALIZE:
        return sib
    if repo in _repo_path_cache:
        return _repo_path_cache[repo]
    p = sib
    try:
        import subprocess
        r = subprocess.run(["bash", str(_MAT_SCRIPT), repo, _CAT_ENV, str(REPO_ROOT)],
                           capture_output=True, text=True, timeout=600)
        out = (r.stdout or "").strip().splitlines()
        if r.returncode == 0 and out and out[-1].strip():
            p = Path(out[-1].strip())
        elif r.stderr:
            sys.stderr.write(r.stderr)
    except Exception as e:
        sys.stderr.write("materialize %s failed: %s\n" % (repo, e))
    _repo_path_cache[repo] = p
    return p


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


# ── Artifact version (#108.2) + build closure (#108.1) ───────────────────────────
#    A unit's artifact version is `<semver> + <content-sha>` (mirrors #101's
#    "semver + derived fingerprint", but for the BUILT bits, not the served
#    interface). semver is resolved per artifact type; content-sha fingerprints the
#    transitive build closure so identical inputs ⇒ identical sha and any build-input
#    change ⇒ a new sha. See unit-versioning-and-build-graph.md.

def _read_text(p):
    try:
        return Path(p).read_text(errors="ignore")
    except Exception:
        return ""


# FROM <img> (skips an optional --platform=… and an `AS <stage>` suffix).
_FROM_RE = re.compile(r"(?im)^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)")
# org.opencontainers.image.version label, tolerant of LABEL k=v / k "v" forms.
_OCI_VER_RE = re.compile(r"""org\.opencontainers\.image\.version["'\s=]+v?([0-9][^\s"']*)""")


def _base_image(root, anchor):
    """The base image a docker artifact builds FROM (display + closure input). The
    Dockerfile's full text is already folded into the path-set content-sha; this is
    the human-readable FROM ref (a tag/ref, not a pulled registry digest)."""
    froms = _FROM_RE.findall(_read_text(root / anchor / "Dockerfile"))
    # Last stage's base is the runtime base in a multi-stage build; fall back to first.
    return (froms[-1] if froms else None)


def _resolve_semver(kind, root, anchor, anchor_pkg):
    """semver per artifact type (§1):
         lib (npm)     → the anchor package.json `version`
         api/spa (img) → org.opencontainers.image.version label, or a VERSION file,
                         else the anchor package.json version (most repos version there)."""
    if not anchor:
        return None
    if kind == "lib":
        return anchor_pkg.get("version")
    m = _OCI_VER_RE.search(_read_text(root / anchor / "Dockerfile"))
    if m:
        return m.group(1)
    for vf in (root / anchor / "VERSION", root / "VERSION"):
        if vf.exists():
            first = _read_text(vf).strip().splitlines()
            if first and first[0].strip():
                return first[0].strip().lstrip("v")
    return anchor_pkg.get("version")


def _git_tree_sha(root, path):
    """git object id of <path> at HEAD — a cheap, faithful fingerprint of that
    sub-tree's content (§6). '' when the repo/path isn't available (deterministic:
    build and check then agree on '')."""
    rel = path[:-3] if path.endswith("/**") else path
    rel = rel.rstrip("/")
    ref = f"HEAD:{rel}" if rel and rel != "." else "HEAD^{tree}"
    try:
        r = subprocess.run(["git", "-C", str(root), "rev-parse", ref],
                           capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def _content_sha_map(cat, derived):
    """content-sha per unit = sha256 of (semver + base image + path-set tree-shas +
    rolled-up build-dep shas), TRANSITIVE over depends_on. A lib change thus
    re-fingerprints everything built on it. Memoized; cycle-safe."""
    roots = {n: _repo_path(_services(cat)[n]["repo"]) for n in derived}
    cache, stack = {}, set()

    def sha(name):
        if name in cache:
            return cache[name]
        if name in stack or name not in derived:
            return ""                                   # cycle / unknown → neutral
        stack.add(name)
        d = derived[name]
        h = hashlib.sha256()
        h.update(("semver:%s\n" % (d.get("semver") or "")).encode())
        h.update(("base:%s\n" % (d.get("base_image") or "")).encode())
        for p in sorted(d.get("paths") or []):
            h.update(("path:%s=%s\n" % (p, _git_tree_sha(roots[name], p))).encode())
        for dep in sorted(d.get("depends_on") or []):
            h.update(("dep:%s=%s\n" % (dep, sha(dep))).encode())
        stack.discard(name)
        cache[name] = h.hexdigest()
        return cache[name]

    return {n: sha(n) for n in derived}


def _local_port(name, kind, serve, healthcheck):
    """Stable local port for a SERVED unit (#108.3): its declared serve/healthcheck
    port if any, else a port DERIVED from the unit name — assigned at build and
    reused across runs (deterministic, stable per unit; range 39000-39999). The
    local edge is then `localhost:<this>`.

    Libraries (kind == 'lib') are NOT served — they're npm packages consumed as
    build inputs, with no host/port/edge — so they get None (no local endpoint),
    unless they explicitly declare a port."""
    sv = serve if isinstance(serve, dict) else {}
    hc = healthcheck if isinstance(healthcheck, dict) else {}
    p = sv.get("port") or hc.get("port")
    if p:
        try:
            return int(p)
        except (TypeError, ValueError):
            pass
    if kind == "lib":
        return None
    return 39000 + int(hashlib.sha256(name.encode()).hexdigest(), 16) % 1000


def local_edge(unit_lock):
    """The local edge for a lock unit: `localhost:<local_port>` for a served unit,
    or '-' when it has no local endpoint (e.g. a library) (#108.3)."""
    port = unit_lock.get("local_port")
    return "localhost:%s" % port if port else "-"


def artifact_version(unit_lock):
    """Render a lock unit's artifact version as `<semver>+<sha7>` (or '' if unknown)."""
    sv = unit_lock.get("semver")
    sha = (unit_lock.get("content_sha") or "")[:7]
    if sv and sha:
        return f"{sv}+{sha}"
    return sv or (("+" + sha) if sha else "")


def derive_unit(cat, name):
    """Derive the drift-prone facts for a Tier-1 unit from its repo."""
    s = _services(cat)[name]
    repo, anchor = s["repo"], s.get("anchor")
    root = _repo_path(repo)
    if not anchor:
        return {"paths": s.get("paths") or [], "depends_on": s.get("depends_on") or [],
                "kind": s.get("kind"), "artifact": s.get("artifact"),
                "npm_name": None, "requires_derived": [],
                "semver": None, "base_image": None}
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
            "requires_derived": sorted(_derive_requires(cat, root, paths)),
            "semver": _resolve_semver(kind, root, anchor, anchor_pkg),
            "base_image": (None if kind == "lib" else _base_image(root, anchor))}


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
    """Effective catalog = derived ⊕ declared. The thing deploy/serve read.

    Also derives the #108 artifact version (semver + content_sha) and build
    closure (#108.1) per unit, so the build graph + version are visible from the
    lock without cloning any repo."""
    derived = {name: derive_unit(cat, name) for name in _services(cat)}
    shas = _content_sha_map(cat, derived)        # transitive over depends_on
    units = {}
    for name in _services(cat):
        d = derived[name]
        decl = _services(cat)[name]
        units[name] = {
            "repo": decl.get("repo"), "anchor": decl.get("anchor"),
            "kind": d["kind"], "artifact": d["artifact"], "npm_name": d["npm_name"],
            "paths": d["paths"], "depends_on": d["depends_on"],
            "requires": decl.get("requires") or [], "requires_derived": d["requires_derived"],
            "hosts": decl.get("hosts"), "edge": decl.get("edge"),
            "serve": decl.get("serve"), "healthcheck": decl.get("healthcheck"),
            "build": decl.get("build"),
            # #108.3 — stable local port (assigned at build, reused): edge = localhost:<port>.
            "local_port": _local_port(name, d["kind"], decl.get("serve"), decl.get("healthcheck")),
            # #108.2 artifact version + #108.1 build closure (the build-side DAG).
            "semver": d.get("semver"),
            "content_sha": shas.get(name),
            "build_closure": {
                "base_image": d.get("base_image"),
                "anchor": decl.get("anchor"),
                "build_dep_units": d["depends_on"],   # transitive cross-repo build-deps
            },
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


# ── DAG view (developer-facing; derived LIVE, never written) ──────────────────
# The dependency TOPOLOGY (depends_on build edges + requires runtime edges) is
# env-invariant — derived from code + declared requires. Only the DECORATION
# (host / pin / edge / what-satisfies-a-requires) is per-env, applied when --env
# is given. So env is OPTIONAL here: no env = topology; --env = resolved graph.
def _platform_endpoint(ps, svc, env):
    s = ps.get(svc) or {}
    return (s.get("endpoints") or {}).get(env) or (s.get("hosts") or {}).get(env) or ""

def _svc_category(s):
    """Classify a platform service:
      data     — carries a data lifecycle (seed/checkpoint/restore): a DATASTORE.
      stateful — self-hosted (provisioning: container) but no declared data lifecycle.
      external — saas / external API (provisioning: saas)."""
    s = s or {}
    if any(k in s for k in ("seed", "checkpoint", "restore")):
        return "data"
    if s.get("provisioning") == "container":
        return "stateful"
    return "external"

def _platform_tag(s):
    """Short inline tag for a requires-edge (marks datastores + their version)."""
    cat, ver = _svc_category(s), (s or {}).get("version")
    if cat in ("data", "stateful") and ver:
        return f"{cat} · {ver}"
    return cat

def _fmt_platform_detail(name, s, env, ps_users):
    cat = _svc_category(s)
    hdr = {"data": "DATA store — stateful, preserve & never recreate",
           "stateful": "stateful — preserve, never recreate",
           "external": "external (saas)"}[cat]
    L = [f"{name}  [platform service · {hdr}]"]
    if s.get("scope"):
        L.append(f"  scope        : {s['scope']}" + (f"  (owner: {s['owner']})" if s.get("owner") else ""))
    if s.get("provisioning"):
        L.append(f"  provisioning : {s['provisioning']}" + (f"  ·  {s['version']}" if s.get("version") else ""))
    if env:
        loc = (s.get("hosts") or {}).get(env) or (s.get("endpoints") or {}).get(env) or "-"
        L.append(f"  location ({env}) : {loc}        # where it lives / is reached in {env}")
    h = s.get("health") or {}
    if h:
        L.append(f"  health       : {h.get('probe','?')}" + (f" :{h['port']}" if h.get("port") else "") + (f" {h['path']}" if h.get("path") else ""))
    # DATA service facts: WHAT it is + WHERE it lives (optional `datastore:` block).
    ds = s.get("datastore") or {}
    if ds:
        L.append("  datastore:")
        for k, lbl in (("kind", "type"), ("model_version", "model version"), ("location", "data location")):
            if ds.get(k):
                L.append(f"    {lbl:14}: {ds[k]}")
    # EXTERNAL target facts: HOW to reach & talk to it (optional `target:` block).
    # secret_ref is a LOCATION/reference only — never the secret (data-classification C01).
    tg = s.get("target") or {}
    if s.get("broker_client") and "identity" not in tg:
        tg = {**tg, "identity": s["broker_client"]}     # existing field → identity
    if tg:
        L.append("  target:")
        for k, lbl in (("surface", "surface"), ("protocol", "protocol"), ("version", "version"),
                       ("auth", "auth method"), ("identity", "identity (as)"), ("secret_ref", "secret ⟵ (location)")):
            if tg.get(k):
                L.append(f"    {lbl:18}: {tg[k]}")
    # DATA: where the data is loaded from + how it's preserved (the important bit).
    dl = [(lbl, s[k]) for k, lbl in (("provision", "provision"), ("seed", "seed (load from)"),
                                     ("checkpoint", "checkpoint"), ("restore", "restore")) if s.get(k)]
    if dl:
        L.append("  data:")
        for lbl, v in dl:
            L.append(f"    {lbl:14}: {v}")
    lc = s.get("lifecycle") or {}
    if lc.get("start") or lc.get("stop"):
        L.append("  lifecycle:")
        for k in ("start", "stop"):
            if lc.get(k):
                L.append(f"    {k:14}: {lc[k]}")
    L.append(f"  required by  : {', '.join(ps_users) if ps_users else '(no units)'}")
    return "\n".join(L)

def _dag_include(units, names):
    incl = set(names)
    for n in list(names):
        incl.update(units.get(n, {}).get("depends_on") or [])
    return incl

def _fmt_requires(reqs, ps, units, env):
    if not reqs:
        return "(none)"
    parts = []
    for r in reqs:
        if r in ps:                           # platform service — surface DATA vs external
            tag = _platform_tag(ps[r])
            if env:
                parts.append(f"{r} → {_platform_endpoint(ps, r, env) or '(unresolved)'} [{tag}]")
            else:
                parts.append(f"{r} [{tag}]")
        else:                                 # unit→unit edge
            if env:
                parts.append(f"{r} → {(units.get(r, {}).get('hosts') or {}).get(env) or '(unit)'}")
            else:
                parts.append(f"{r} [unit]")
    return ", ".join(parts)


def _fmt_dag_tree(units, ps, names, env, epins, allpins=None):
    allpins = allpins or {}
    out = []
    for n in names:
        d = units.get(n, {})
        ver = artifact_version(d)
        head = f"{n}  ({d.get('kind') or '?'} · {d.get('artifact') or '—'}{'@' + ver if ver else ''})"
        if env:
            if env == "local":
                # local isn't a public domain — served units run on localhost at
                # their stable assigned port (#108.3). Non-served units (libs) have
                # NO endpoint → host/edge are '-'.
                if d.get("local_port"):
                    host, edge = "localhost", "localhost:%s" % d["local_port"]
                else:
                    host, edge = "-", "-"
            else:
                host = (d.get("hosts") or {}).get(env) or "-"
                edge = (d.get("edge") or "").replace("<env>", env) or "-"
            head += f"   [env={env}: host={host} · edge={edge}]"
        out.append(head)
        # #108.1 — build INPUTS → artifact (the build side; was an empty leaf line).
        bc = d.get("build_closure") or {}
        bi = []
        if bc.get("base_image"):
            bi.append("base " + bc["base_image"])
        if bc.get("anchor"):
            # show the repo with the anchor so it's clear WHERE the source lives
            repo = d.get("repo")
            bi.append("anchor %s:%s" % (repo, bc["anchor"]) if repo else "anchor " + bc["anchor"])
        deps = d.get("depends_on") or []
        reqs = (d.get("requires") or []) or (d.get("requires_derived") or [])
        # #108.2 — built version + per-env pins (deployed bits per env).
        vline = ("built " + ver) if ver else "(unversioned)"
        pin_str = " · ".join(f"{e} {allpins.get(e, {}).get(n)}"
                             for e in ("dev", "uat", "prod") if allpins.get(e, {}).get(n))
        if env and epins.get(n):
            vline += f"  ·  pin[{env}]={epins.get(n)}"
        elif pin_str:
            vline += "  ·  pins: " + pin_str
        rows = [
            ("build inputs", ", ".join(bi) if bi else "(declared-only)"),
            ("build deps", ", ".join(deps) if deps else "(none)"),
            ("requires", _fmt_requires(reqs, ps, units, env)),
            ("version", vline),
        ]
        for i, (lbl, val) in enumerate(rows):
            conn = "└─" if i == len(rows) - 1 else "├─"
            out.append(f"  {conn} {lbl:12}: {val}")
    return "\n".join(out) or "  (no units)"

def _fmt_dag_mermaid(units, ps, names, env, epins):
    incl = _dag_include(units, names)
    lines = ["graph LR", f"  %% deploy DAG {'(env=' + env + ')' if env else '(topology — env-invariant)'}"]
    drawn = set()
    for n in sorted(incl):
        d = units.get(n, {})
        lines.append(f'  {n}["{n}<br/>{d.get("kind") or "?"}"]')
        for dep in (d.get("depends_on") or []):
            lines.append(f"  {n} --> {dep}")
        for r in ((d.get("requires") or []) or (d.get("requires_derived") or [])):
            if r in ps and r not in drawn:
                lines.append(f'  {r}(["{r}<br/>platform"])'); drawn.add(r)
            lines.append(f"  {n} -.->|requires| {r}")
    return "\n".join(lines)

def dag(cat, target=None, env=None, fmt="tree"):
    """Render the DAG from the COMMITTED graph.lock — the SoT for derived facts, so
    the build graph + version are visible WITHOUT cloning any repo (#108). This is
    why a `dag --env dev|prod` from the bare gov repo still shows real build
    inputs/deps: it reads the lock, it does NOT re-derive live (a live derive there
    has no member repos and would show empty closures). Falls back to a live
    derivation only when no lock exists yet. <target> may be a UNIT or an
    APPLICATION (renders the app's member units). No target = the whole graph."""
    lock = load_lock() or build_lock(cat)
    units, ps = lock.get("units", {}) or {}, lock.get("platform_services", {}) or {}
    apps = lock.get("applications", {}) or {}
    allpins = load_pins()                              # all envs, for the version line
    epins = (allpins.get(env) or {}) if env else {}
    if target:
        if target in ps:
            # platform service target → its detail view (data/stateful facts + users)
            users = sorted(n for n, u in units.items() if target in (u.get("requires") or []))
            return _fmt_platform_detail(target, ps[target], env, users)
        if target in units:
            names = [target]
        elif target in apps:
            names = [m for m in (apps[target].get("members") or []) if m in units]
        elif target in ("build", "check", "add", "update", "rm", "dag"):
            # A sibling catalog SUBCOMMAND was passed where a dag TARGET is expected
            # (e.g. `prj catalog dag check`). Point at the right grammar.
            raise ValueError(
                f"'{target}' is a catalog subcommand, not a dag target. "
                f"Did you mean `prj catalog {target}`?  "
                f"Dag grammar: `prj catalog dag [<unit|app|service>] [--env <env>]`.")
        else:
            raise KeyError(
                f"no such unit, application or platform service '{target}'.  "
                f"units: {', '.join(sorted(units)) or '(none)'}  ·  "
                f"applications: {', '.join(sorted(apps)) or '(none)'}  ·  "
                f"platform services: {', '.join(sorted(ps)) or '(none)'}")
    else:
        names = sorted(units)
    return _fmt_dag_mermaid(units, ps, names, env, epins) if fmt == "mermaid" \
        else _fmt_dag_tree(units, ps, names, env, epins, allpins)


# ── Authoring: add / update / rm a unit (PROPOSE — print a YAML block) ─────────
# services.yaml is comment-rich and PyYAML can't round-trip comments, so we never
# re-serialize the whole file. `add` can safely APPEND a block; `update`/`rm`
# print the change for review (rm --write does a targeted block removal).
def _yaml_block_for_unit(spec):
    """Render a 2-space-indented services.yaml block from a spec dict. Declared
    facts only — paths/depends_on/kind(inferred)/artifact are DERIVED by build."""
    name = spec["name"]
    L = [f"  {name}:"]
    L.append(f"    repo: {spec['repo']}")
    if spec.get("anchor"):
        L.append(f"    anchor: {spec['anchor']}")
    else:
        # declared-only: derivation is skipped, so kind/artifact/paths are hand-given
        if spec.get("kind"):     L.append(f"    kind: {spec['kind']}")
        if spec.get("artifact"): L.append(f"    artifact: {spec['artifact']}")
        if spec.get("paths"):    L.append(f"    paths: [{', '.join(repr(p) for p in spec['paths'])}]")
    if spec.get("anchor") and spec.get("kind"):
        L.append(f"    kind: {spec['kind']}                # override of inference")
    if spec.get("requires"):
        L.append(f"    requires: [{', '.join(spec['requires'])}]")
    if spec.get("hosts"):
        hs = ", ".join(f"{e}: {h}" for e, h in spec["hosts"].items() if h)
        L.append(f"    hosts: {{ {hs} }}")
    if spec.get("edge"):        L.append(f"    edge: {spec['edge']}")
    if spec.get("serve"):       L.append(f"    serve: {spec['serve']}")
    if spec.get("healthcheck"): L.append(f"    healthcheck: {spec['healthcheck']}")
    return "\n".join(L) + "\n"

def _load_spec(spec_path):
    with open(spec_path) as f:
        return json.load(f)

def add_unit(cat, spec_path, catalog_path, write=False):
    spec = _load_spec(spec_path)
    name = spec["name"]
    if name in _services(cat):
        return 2, f"unit '{name}' already exists — use `update` instead."
    block = _yaml_block_for_unit(spec)
    if write:
        p = Path(catalog_path)
        text = p.read_text()
        # append under the existing `services:` mapping (end-of-services heuristic:
        # insert before the next top-level key after services, else at EOF).
        import re as _re
        m = _re.search(r"(?m)^services:\s*$", text)
        if not m:
            return 2, "no top-level `services:` key in services.yaml — add it manually."
        nxt = _re.search(r"(?m)^[A-Za-z_]", text[m.end():])
        ins = m.end() + (nxt.start() if nxt else len(text[m.end():]))
        text = text[:ins].rstrip("\n") + "\n\n" + block + "\n" + text[ins:].lstrip("\n")
        p.write_text(text)
        return 0, f"appended unit '{name}' to {p}\n\nNext: `catalog build` (derive) then `catalog check` (validate)."
    return 0, ("# Proposed services.yaml block (place under `services:`):\n\n" + block +
               "\n# Then: `prj catalog build` (derive paths/depends_on) + `prj catalog check`.")

def update_unit(cat, spec_path, name):
    if name not in _services(cat):
        return 2, f"no such unit '{name}'."
    cur = dict(_services(cat)[name])
    spec = _load_spec(spec_path)
    cur.update({k: v for k, v in spec.items() if k != "name" and v not in (None, "", [], {})})
    cur["name"] = name
    block = _yaml_block_for_unit(cur)
    return 0, ("# Updated block for '%s' — replace the existing `%s:` block under `services:`:\n\n" % (name, name)
               + block + "\n# Then: `prj catalog build` + `prj catalog check`.")

def rm_unit(cat, name):
    if name not in _services(cat):
        return 2, f"no such unit '{name}'."
    # dangling-edge scan: who references this unit?
    dependents = [n for n, s in _services(cat).items()
                  if name in (s.get("depends_on") or []) or name in (s.get("requires") or [])]
    msg = [f"# Remove the `{name}:` block from `services:` in services.yaml, plus any\n"
           f"# pins for it in pins.yaml. Then: `prj catalog build` + `prj catalog check`."]
    if dependents:
        msg.append(f"\n# ⚠ WARNING — these units still reference '{name}' (fix their requires/depends_on first):")
        for d in dependents:
            msg.append(f"#   - {d}")
    return 0, "\n".join(msg)


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
    p = sub.add_parser("version"); p.add_argument("unit")   # artifact version <semver>+<sha> (#108.2)
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
    # ── developer-facing DAG (derived live) ──
    p = sub.add_parser("dag")          # render the derived DAG (no env = topology)
    p.add_argument("target", nargs="?", default=None, help="a unit (else the whole graph)")
    p.add_argument("--env", default=None, help="decorate with per-env host/pin/edge/endpoints")
    p.add_argument("--format", choices=["tree", "mermaid"], default="tree")
    # ── authoring: add / update / rm a unit (PROPOSE) ──
    p = sub.add_parser("add")          # propose a new unit block (env-agnostic)
    p.add_argument("--spec", required=True, help="path to a JSON spec (built by `prj catalog add`)")
    p.add_argument("--write", action="store_true", help="append the block to services.yaml")
    p = sub.add_parser("update")       # propose an updated block for an existing unit
    p.add_argument("name"); p.add_argument("--spec", required=True)
    p = sub.add_parser("rm")           # show how to remove a unit + dangling-edge scan
    p.add_argument("name")
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
    cat = raw if args.cmd in ("build", "check", "descriptor", "dag", "add", "update", "rm") else effective_cat(raw)
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
            if any(k == "anchor-missing" for k, _, _ in issues):
                print("", file=sys.stderr)
                print("  Note: 'anchor-missing' means a unit's member repo isn't cloned in THIS", file=sys.stderr)
                print("  workspace, so `check` can't read its package.json. Run `check` where the", file=sys.stderr)
                print("  member repos are present (a project workspace after `prj work` brings them", file=sys.stderr)
                print("  in) — not the bare gov/common project.", file=sys.stderr)
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
        elif args.cmd == "version":
            lock = load_lock() or build_lock(cat)
            u = (lock.get("units") or {}).get(args.unit)
            if u is None:
                print(f"no such unit: {args.unit}", file=sys.stderr)
                return 2
            print(artifact_version(u))
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
        elif args.cmd == "dag":
            print(dag(cat, args.target, args.env, args.format))
        elif args.cmd == "add":
            rc, msg = add_unit(cat, args.spec, str(DEFAULT_CATALOG), args.write)
            print(msg); return rc
        elif args.cmd == "update":
            rc, msg = update_unit(cat, args.spec, args.name)
            print(msg); return rc
        elif args.cmd == "rm":
            rc, msg = rm_unit(cat, args.name)
            print(msg); return rc
    except (KeyError, ValueError) as e:
        print(f"catalog error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
