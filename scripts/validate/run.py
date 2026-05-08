#!/usr/bin/env python3
"""
Workspace repo validator.

Runs schema, registry, lifecycle, and cross-reference checks against the
repo's working-tree state. Used by scripts/test-merge.sh as the pre-merge
gate, and by CI on PRs to main/publish.

Usage:
    python3 scripts/validate/run.py [REPO_ROOT]

Exits 0 on pass, 1 on any validation failure.

Env vars:
    STRICT_PLACEHOLDERS=1
        Fail if any {{PLACEHOLDER}} tokens are found in non-template files.
        Set this on the main branch (post-setup.sh) — placeholders are a leak.
        Do NOT set on publish (placeholders are expected there).
"""

import os
import re
import sys
from pathlib import Path

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
    "github_org", "workspace_repo", "default_branch", "default_code_branch",
    "policy_owner_email", "policy_owner_github",
]
PLACEHOLDER_RE = re.compile(r"\{\{[A-Z_a-z0-9]+\}\}")
PLACEHOLDER_ALLOWED_FILES = {"setup.sh"}
PLACEHOLDER_SCAN_SUFFIXES = {".md", ".yaml", ".yml"}
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

    for field in REQUIRED_CONFIG_FIELDS:
        if field not in config:
            errors.append(f"org-config.yaml: missing required field '{field}'")
        elif config[field] in (None, ""):
            errors.append(f"org-config.yaml: '{field}' is empty")

    registry_path = repo_root / "registry.yaml"
    if not registry_path.exists():
        errors.append("registry.yaml not found")
        return errors
    try:
        registry = yaml.safe_load(registry_path.read_text())
    except yaml.YAMLError as e:
        errors.append(f"registry.yaml does not parse: {e}")
        return errors
    if not isinstance(registry, dict):
        errors.append("registry.yaml: top-level must be a mapping")
        return errors

    if not isinstance(registry.get("last_issued"), int) or registry["last_issued"] < 0:
        errors.append(
            f"registry.yaml: last_issued must be non-negative int, "
            f"got {registry.get('last_issued')!r}"
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
    errors: list[str] = []
    registry_path = repo_root / "registry.yaml"
    try:
        registry = yaml.safe_load(registry_path.read_text())
    except Exception as e:
        return [f"registry.yaml: {e}"]
    if not isinstance(registry, dict):
        return ["registry.yaml: top-level must be a mapping"]

    projects = registry.get("projects") or []
    last_issued = registry.get("last_issued", 0)

    nnn_seen: dict[int, str] = {}
    max_nnn = 0
    for entry in projects:
        if not isinstance(entry, dict):
            continue
        pid = entry.get("id") or ""
        m = re.match(r"^[A-Z]+-(\d+)-", pid)
        if not m:
            errors.append(f"registry.yaml: project entry has invalid id format: {pid!r}")
            continue
        nnn = int(m.group(1))
        if nnn in nnn_seen:
            errors.append(
                f"registry.yaml: duplicate NNN {nnn:03d} ({nnn_seen[nnn]} and {pid})"
            )
        nnn_seen[nnn] = pid
        max_nnn = max(max_nnn, nnn)

    if isinstance(last_issued, int) and last_issued < max_nnn:
        errors.append(
            f"registry.yaml: last_issued ({last_issued}) < max NNN in projects[] ({max_nnn})"
        )

    projects_dir = repo_root / "projects"
    registered_ids = {e.get("id") for e in projects if isinstance(e, dict) and e.get("id")}

    for entry in projects:
        if not isinstance(entry, dict):
            continue
        pid = entry.get("id")
        if not pid:
            continue
        folder = projects_dir / pid
        if not folder.is_dir():
            errors.append(f"registry.yaml: project '{pid}' has no folder at projects/{pid}")

    if projects_dir.is_dir():
        for folder in sorted(projects_dir.iterdir()):
            if not folder.is_dir():
                continue
            if folder.name in {".gitkeep"}:
                continue
            if folder.name not in registered_ids:
                errors.append(
                    f"projects/{folder.name}: folder exists but no entry in registry.yaml"
                )

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

        if status in {"completed", "cancelled"}:
            for task in (p.get("tasks") or []):
                if isinstance(task, dict) and task.get("status") == "active":
                    errors.append(
                        f"{rel}: project status={status} but task '{task.get('id')}' "
                        f"is still active"
                    )

    return errors


# ── Cross-references ────────────────────────────────────────────────────────

def check_cross_refs(repo_root: Path) -> list[str]:
    errors: list[str] = []

    codeowners = repo_root / "CODEOWNERS"
    if codeowners.exists():
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

    if os.environ.get("STRICT_PLACEHOLDERS"):
        for f in repo_root.rglob("*"):
            if not f.is_file():
                continue
            if any(part.startswith(".") for part in f.relative_to(repo_root).parts):
                continue
            if f.name in PLACEHOLDER_ALLOWED_FILES:
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


# ── Runner ──────────────────────────────────────────────────────────────────

CHECKS = [
    ("schema",      check_schema),
    ("registry",    check_registry),
    ("lifecycle",   check_lifecycle),
    ("cross-refs",  check_cross_refs),
]


def main() -> int:
    repo_root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

    if not (repo_root / "registry.yaml").exists():
        print(
            f"[FAIL] {repo_root} does not look like a workspace repo (no registry.yaml)",
            file=sys.stderr,
        )
        return 1

    total_errors = 0
    for name, check in CHECKS:
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
