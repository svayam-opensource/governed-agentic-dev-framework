#!/usr/bin/env python3
"""
Workspace repo validator.

Runs schema, registry, lifecycle, and cross-reference checks against the
repo's working-tree state. Used by scripts/test-merge.sh as the pre-merge
gate, and by CI on PRs to main/publish.

Usage:
    python3 scripts/validate/run.py [REPO_ROOT]

Exits 0 on pass, 1 on any validation failure.

Notes:
    Framework files (all *.md, *.yaml, *.yml, CODEOWNERS) are scanned for
    leftover {{PLACEHOLDER}} tokens unconditionally. Direction A: framework
    files never carry placeholders — org values live in org-config.yaml only.
    A placeholder anywhere is a regression.
"""

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_knowledge import check_knowledge  # noqa: E402
from check_secrets import check_secrets  # noqa: E402
from check_protocol import check_protocol  # noqa: E402
from check_version_sync import check_version_sync  # noqa: E402

try:
    import yaml
except ImportError:
    print("[FAIL] PyYAML not installed. Run: bash scripts/install-deps.sh", file=sys.stderr)
    sys.exit(2)


ALLOWED_STATUSES = {"proposed", "active", "paused", "completed", "cancelled"}
ALLOWED_KNOWLEDGE_STATUSES = {
    None, "pending_review", "merged", "rejected", "under_revision", "abandoned",
}
REQUIRED_PROJECT_FIELDS = ["id", "slug", "status"]
REQUIRED_CONFIG_FIELDS = [
    "org_name", "org_short_name", "org_slug", "org_slug_lower",
    "org_repo_url", "github_org", "workspace_repo",
    "default_branch", "default_code_branch", "agent_work_root",
    "policy_owner_email", "policy_owner_github",
]
PLACEHOLDER_RE = re.compile(r"\{\{[A-Z_a-z0-9]+\}\}")
PLACEHOLDER_SCAN_SUFFIXES = {".md", ".yaml", ".yml", ".mdc"}
PLACEHOLDER_SCAN_NAMES = {"CODEOWNERS"}


# ── Schema ──────────────────────────────────────────────────────────────────

def check_schema(repo_root: Path) -> list[str]:
    errors: list[str] = []

    config_path = repo_root / "org-config.yaml"
    if not config_path.exists():
        return [f"org-config.yaml not found at {config_path}"]
    try:
        config = yaml.safe_load(config_path.read_text())
    except yaml.YAMLError as e:
        return [f"org-config.yaml does not parse: {e}"]
    if not isinstance(config, dict):
        return [f"org-config.yaml: top-level must be a mapping, got {type(config).__name__}"]

    # Template state: org-config.yaml ships from TEMPLATE with all values
    # empty. After ./setup.sh runs, values are populated. The validator must
    # accept both: structure (keys present) is always required; populated
    # values are only required post-setup. Detect template state from org_name.
    is_template_state = not bool(config.get("org_name"))

    for field in REQUIRED_CONFIG_FIELDS:
        if field not in config:
            errors.append(f"org-config.yaml: missing required field '{field}'")
        elif not is_template_state and config[field] in (None, ""):
            errors.append(f"org-config.yaml: '{field}' is empty")

    # registry.yaml is a FROZEN LEGACY SHIM (registry-elimination Increment 2):
    # GitHub is the authoritative project index. It is OPTIONAL — when present we
    # only sanity-check its shape. last_issued is vestigial (the GitHub board
    # number allocates ids now), so it is optional too. We do NOT early-return on
    # its absence; the projects/ folder checks below always run.
    registry_path = repo_root / "registry.yaml"
    if registry_path.exists():
        try:
            registry = yaml.safe_load(registry_path.read_text())
        except yaml.YAMLError as e:
            errors.append(f"registry.yaml does not parse: {e}")
            registry = None
        if registry is not None:
            if not isinstance(registry, dict):
                errors.append("registry.yaml: top-level must be a mapping")
            else:
                li = registry.get("last_issued")
                if li is not None and (not isinstance(li, int) or li < 0):
                    errors.append(
                        f"registry.yaml: last_issued, if present, must be a non-negative int, got {li!r}"
                    )
                projects = registry.get("projects")
                if projects is not None and not isinstance(projects, list):
                    errors.append(
                        f"registry.yaml: 'projects' must be a list, got {type(projects).__name__}"
                    )

    projects_dir = repo_root / "projects"
    if projects_dir.is_dir():
        for project_dir in sorted(projects_dir.iterdir()):
            if not project_dir.is_dir():
                continue
            pf = project_dir / "project.yaml"
            if not pf.exists():
                continue  # folder may exist for staging; covered by registry check
            rel = pf.relative_to(repo_root)
            try:
                p = yaml.safe_load(pf.read_text())
            except yaml.YAMLError as e:
                errors.append(f"{rel}: does not parse: {e}")
                continue
            if not isinstance(p, dict):
                errors.append(f"{rel}: top-level must be a mapping")
                continue
            for field in REQUIRED_PROJECT_FIELDS:
                if field not in p or p[field] in (None, ""):
                    errors.append(f"{rel}: missing required field '{field}'")
            if p.get("status") not in ALLOWED_STATUSES:
                errors.append(
                    f"{rel}: status '{p.get('status')!r}' not in {sorted(ALLOWED_STATUSES)}"
                )
            ks = p.get("knowledge_status")
            if ks not in ALLOWED_KNOWLEDGE_STATUSES:
                errors.append(
                    f"{rel}: knowledge_status '{ks!r}' invalid"
                )

    return errors


# ── Registry consistency ────────────────────────────────────────────────────

def check_registry(repo_root: Path) -> list[str]:
    # registry.yaml is a FROZEN LEGACY SHIM (registry-elimination Increment 2):
    # GitHub is the authoritative project index, so the registry is OPTIONAL and
    # is NEVER cross-checked against the projects/ folders — new projects are not
    # added to the shim, so a folder with no shim entry is expected, and a shim
    # entry for a now-archived project may have no folder. last_issued no longer
    # allocates ids. We only sanity-check the shim's OWN hygiene: each entry's id
    # format and no duplicate board number within the shim.
    errors: list[str] = []
    registry_path = repo_root / "registry.yaml"
    if not registry_path.exists():
        return errors
    try:
        registry = yaml.safe_load(registry_path.read_text())
    except Exception as e:
        return [f"registry.yaml: {e}"]
    if registry is None:
        return errors
    if not isinstance(registry, dict):
        return ["registry.yaml: top-level must be a mapping"]

    projects = registry.get("projects") or []
    nnn_seen: dict[int, str] = {}
    for entry in projects:
        if not isinstance(entry, dict):
            continue
        pid = entry.get("id") or ""
        # Accept any uppercase prefix (pre-v0.2.0 <ORG_SLUG>-NNN-slug + PRJ-NNN).
        m = re.match(r"^[A-Z]+-(\d+)-", pid)
        if not m:
            errors.append(f"registry.yaml (shim): entry has invalid id format: {pid!r} (expected <PREFIX>-NNN-slug)")
            continue
        nnn = int(m.group(1))
        if nnn in nnn_seen:
            errors.append(
                f"registry.yaml (shim): duplicate NNN {nnn:03d} ({nnn_seen[nnn]} and {pid})"
            )
        nnn_seen[nnn] = pid

    return errors


# ── Lifecycle invariants ────────────────────────────────────────────────────

def check_lifecycle(repo_root: Path) -> list[str]:
    errors: list[str] = []
    projects_dir = repo_root / "projects"
    if not projects_dir.is_dir():
        return errors

    for project_dir in sorted(projects_dir.iterdir()):
        if not project_dir.is_dir():
            continue
        pf = project_dir / "project.yaml"
        if not pf.exists():
            continue
        rel = pf.relative_to(repo_root)
        try:
            p = yaml.safe_load(pf.read_text())
        except Exception:
            continue
        if not isinstance(p, dict):
            continue

        status = p.get("status")
        if status == "completed":
            if not p.get("completed_at"):
                errors.append(f"{rel}: status=completed but completed_at is null")
        elif status == "cancelled":
            if not p.get("cancellation_reason"):
                errors.append(f"{rel}: status=cancelled but cancellation_reason is null")
            if not p.get("cancelled_at"):
                errors.append(f"{rel}: status=cancelled but cancelled_at is null")
        elif status == "paused":
            if not p.get("paused_at"):
                errors.append(f"{rel}: status=paused but paused_at is null")
        elif status == "active":
            if not p.get("started_at"):
                errors.append(f"{rel}: status=active but started_at is null")
            if p.get("paused_at"):
                errors.append(f"{rel}: status=active but paused_at is set ({p['paused_at']})")

        if p.get("completed_at") and p.get("cancelled_at"):
            errors.append(f"{rel}: both completed_at and cancelled_at are set")

        # Tasks-on-board model: tasks are not tracked in project.yaml (they are
        # GitHub Issues + sub-branches), so there is no tasks[] to validate here.

    return errors


# ── Cross-references ────────────────────────────────────────────────────────

def check_cross_refs(repo_root: Path) -> list[str]:
    errors: list[str] = []

    # CODEOWNERS path-existence only applies to a WORKSPACE (org tree at root). In the
    # framework/template SOURCE repo (has framework/), the root CODEOWNERS describes the
    # workspace layout it scaffolds (/knowledge/…), which legitimately isn't present here —
    # so skip the existence check there. The placeholder scan below still runs everywhere.
    codeowners = repo_root / "CODEOWNERS"
    if codeowners.exists() and not (repo_root / "framework").is_dir():
        for lineno, raw in enumerate(codeowners.read_text().splitlines(), 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            path_pattern = parts[0]
            check_path = path_pattern.lstrip("/").rstrip("/")
            if not check_path:
                continue
            target = repo_root / check_path
            if not target.exists():
                errors.append(f"CODEOWNERS:{lineno}: path '{path_pattern}' does not exist")

    # Framework files must NEVER contain {{PLACEHOLDER}} tokens — org values
    # are read from org-config.yaml at runtime. .github/workflows/ files are
    # excluded because they use GitHub Actions ${{ expr }} syntax legitimately.
    for f in repo_root.rglob("*"):
        if not f.is_file():
            continue
        rel_parts = f.relative_to(repo_root).parts
        if any(part.startswith(".git") for part in rel_parts):
            continue
        if len(rel_parts) >= 2 and rel_parts[0] == ".github" and rel_parts[1] == "workflows":
            continue
        if f.suffix not in PLACEHOLDER_SCAN_SUFFIXES and f.name not in PLACEHOLDER_SCAN_NAMES:
            continue
        try:
            text = f.read_text()
        except Exception:
            continue
        for m in PLACEHOLDER_RE.finditer(text):
            errors.append(
                f"{f.relative_to(repo_root)}: leftover placeholder {m.group(0)}"
            )

    return errors


# ── Executable bits ─────────────────────────────────────────────────────────

# File mode in the git index must be 100755 for these scripts. A file
# committed as 100644 will fail with "permission denied" when an adopter
# runs ./scripts/X — the failure mode is silent until they hit it.
EXPECTED_EXEC_PATTERNS = (
    re.compile(r"^prj$"),
    re.compile(r"^setup\.sh$"),
    re.compile(r"^scripts/.+\.sh$"),
    re.compile(r"^scripts/validate/.+\.py$"),
    re.compile(r"^tests/.+\.sh$"),
)


def check_exec_bits(repo_root: Path) -> list[str]:
    import subprocess
    errors: list[str] = []
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "ls-files", "-s"],
            capture_output=True, text=True, check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Not a git repo, or git unavailable — skip silently
        return errors

    for line in result.stdout.splitlines():
        # Format: <mode> <hash> <stage>\t<path>
        if "\t" not in line:
            continue
        meta, path = line.split("\t", 1)
        parts = meta.split()
        if len(parts) < 1:
            continue
        mode = parts[0]
        # Check if path matches any expected-executable pattern
        is_expected_exec = any(p.match(path) for p in EXPECTED_EXEC_PATTERNS)
        if is_expected_exec and mode != "100755":
            errors.append(
                f"{path}: committed mode is {mode}, expected 100755 "
                f"(run: chmod +x {path} && git update-index --chmod=+x {path})"
            )
    return errors


# ── Runner ──────────────────────────────────────────────────────────────────

CHECKS = [
    ("schema",      check_schema),
    ("registry",    check_registry),
    ("lifecycle",   check_lifecycle),
    ("cross-refs",  check_cross_refs),
    ("exec-bits",   check_exec_bits),
    ("knowledge-org", check_knowledge),
    ("secrets",     check_secrets),
    ("protocol",    check_protocol),
    ("version-sync", check_version_sync),
]

# Data-workspace subset: a pure governance DATA repo (a consumer that installs
# the CLI from npm) has no scripts/ , agent/ harness, or package.json, so the
# CLI/framework-dev checks (exec-bits, protocol render, version-sync) don't apply.
# `prj validate` (and a consumer's CI) runs this subset via --data.
DATA_CHECKS = [
    ("schema",        check_schema),
    ("registry",      check_registry),
    ("lifecycle",     check_lifecycle),
    ("cross-refs",    check_cross_refs),
    ("knowledge-org", check_knowledge),
    ("secrets",       check_secrets),
]


def main() -> int:
    argv = sys.argv[1:]
    data_only = "--data" in argv
    argv = [a for a in argv if a != "--data"]
    repo_root = Path(argv[0] if argv else ".").resolve()
    checks = DATA_CHECKS if data_only else CHECKS

    if not (repo_root / "registry.yaml").exists():
        print(
            f"[FAIL] {repo_root} does not look like a workspace repo (no registry.yaml)",
            file=sys.stderr,
        )
        return 1

    total_errors = 0
    for name, check in checks:
        errors = check(repo_root)
        if errors:
            print(f"[FAIL] {name} ({len(errors)} error{'s' if len(errors) != 1 else ''}):")
            for e in errors:
                print(f"   - {e}")
            total_errors += len(errors)
        else:
            print(f"[PASS] {name}")

    print()
    if total_errors:
        print(f"=== {total_errors} validation error(s) ===")
        return 1
    print("=== all validators passed ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
