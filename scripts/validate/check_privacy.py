#!/usr/bin/env python3
"""
Privacy check for the publish branch.

Verifies that none of the per-org values from main's org-config.yaml have
leaked into the publish branch. This is the inverse of STRICT_PLACEHOLDERS=1
(which catches placeholders leaking into main): here we catch real values
leaking out of main into publish.

How it works:
  1. Read main's org-config.yaml via `git show main:org-config.yaml`.
  2. Extract values that are org-specific (skip generic defaults like
     "main", "dev", "@*-tbd", placeholder strings).
  3. Grep the working tree for any of those values.
  4. Any match is a privacy leak — exit non-zero.

Used as a CI gate on PRs to publish (defense in depth alongside the
test-merge gate, scripts/sync-from-publish.sh's STRICT_PLACEHOLDERS=1
check, and the discipline of editing publish-side only).

Designed to run in the private (source) repo where main is accessible.
Not intended for the public mirror repo.

Usage:
    python3 scripts/validate/check_privacy.py [REPO_ROOT]

Exits 0 if no leaks, 1 if leaks found, 2 on error.
"""

import re
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("[FAIL] PyYAML not installed. Run: bash scripts/install-deps.sh", file=sys.stderr)
    sys.exit(2)


# Keys whose values are scanned for leaks
PRIVATE_KEYS = [
    "org_name",
    "org_short_name",
    "org_slug",
    "org_slug_lower",
    "github_org",
    "workspace_repo",
    "policy_owner_email",
    "policy_owner_github",
    "legal_owner_github",
    "infra_owner_github",
    "system_arch_owner_github",
    "data_arch_owner_github",
]

# Generic values — never considered org-specific
GENERIC_VALUES = {
    "", "main", "dev", "master",
    "YYYY-MM-DD",
    "Your Organization Name", "YourOrg",
    "ORG", "org",
    "your-github-org", "000-org-prj",
    "you@example.com", "@your-github-handle",
}

# Patterns that indicate a value is still a placeholder / not org-specific
PLACEHOLDER_VALUE_PATTERNS = [
    re.compile(r"^@[a-z-]*-tbd$"),
    re.compile(r"^\{\{[A-Za-z_]+\}\}$"),
    re.compile(r"^\d{4}-\d{2}-\d{2}$"),
]

# File patterns to scan
SCAN_SUFFIXES = {".md", ".yaml", ".yml", ".sh", ".py"}
SCAN_NAMES = {"CODEOWNERS", "prj"}

# Files where leak values are expected and not actually leaks
ALLOWED_FILES = {
    "setup.sh",         # contains placeholder strings as part of substitution rules
    "org-config.yaml",  # the source of values; not itself in publish content
}

# Per-key attribution allowance: these (key, file) combinations are NOT leaks.
# Legitimate copyright/attribution of the framework's original author in the
# standard public-facing files. Any other key in those files, or these keys
# elsewhere, are still flagged.
# org_short_name is included because it is typically a substring of org_name
# (e.g., a short brand name appearing inside the full legal name) and would
# otherwise false-positive on every legitimate copyright line.
ATTRIBUTION_KEYS = {"org_name", "org_short_name"}
ATTRIBUTION_FILES = {
    "LICENSE", "README.md",
    "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md",
}


def is_generic(value: str) -> bool:
    if not isinstance(value, str):
        return True
    if value in GENERIC_VALUES:
        return True
    for pattern in PLACEHOLDER_VALUE_PATTERNS:
        if pattern.match(value):
            return True
    return False


def get_main_config(repo_root: Path) -> dict | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "show", "main:org-config.yaml"],
            capture_output=True, text=True, check=True,
        )
        config = yaml.safe_load(result.stdout)
        if not isinstance(config, dict):
            print("[ERROR] main:org-config.yaml is not a mapping.", file=sys.stderr)
            return None
        return config
    except subprocess.CalledProcessError as e:
        print(
            "[ERROR] Cannot read 'main:org-config.yaml'. "
            "Privacy check requires access to main branch in this repo.\n"
            f"  git error: {e.stderr.strip()}",
            file=sys.stderr,
        )
        return None
    except yaml.YAMLError as e:
        print(f"[ERROR] main:org-config.yaml does not parse: {e}", file=sys.stderr)
        return None


def scannable_files(repo_root: Path):
    for f in repo_root.rglob("*"):
        if not f.is_file():
            continue
        rel = f.relative_to(repo_root)
        if any(p.startswith(".") for p in rel.parts):
            continue
        if f.name in ALLOWED_FILES:
            continue
        if f.suffix in SCAN_SUFFIXES or f.name in SCAN_NAMES:
            yield f


def find_leaks(repo_root: Path, key: str, value: str) -> list[tuple[Path, int, str]]:
    leaks: list[tuple[Path, int, str]] = []
    attribution_ok = key in ATTRIBUTION_KEYS
    for f in scannable_files(repo_root):
        # Skip attribution-allowed files for keys that are valid attribution
        if attribution_ok and f.name in ATTRIBUTION_FILES:
            continue
        try:
            text = f.read_text()
        except Exception:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if value in line:
                leaks.append((f.relative_to(repo_root), lineno, line.strip()))
    return leaks


def main() -> int:
    repo_root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

    config = get_main_config(repo_root)
    if config is None:
        return 2

    # Collect non-generic values to check
    to_check: list[tuple[str, str]] = []
    for key in PRIVATE_KEYS:
        value = config.get(key)
        if isinstance(value, str) and not is_generic(value):
            # For @-prefixed handles, also strip the @ for substring matching
            to_check.append((key, value))

    if not to_check:
        print("=== no org-specific values to check (main appears to be unconfigured) ===")
        return 0

    print(f"Checking publish for leaks of {len(to_check)} value(s) from main:org-config.yaml...")
    print()

    total_leaks = 0
    for key, value in to_check:
        leaks = find_leaks(repo_root, key, value)
        if leaks:
            total_leaks += len(leaks)
            print(f"[LEAK] {key}={value!r} appears in {len(leaks)} location(s):")
            for relpath, lineno, line in leaks[:10]:
                snippet = line if len(line) <= 100 else line[:97] + "..."
                print(f"   {relpath}:{lineno}: {snippet}")
            if len(leaks) > 10:
                print(f"   ... and {len(leaks) - 10} more")
            print()

    if total_leaks:
        print(f"=== {total_leaks} privacy leak(s) found ===")
        print()
        print("These values from main:org-config.yaml have leaked into publish content.")
        print("Remove them or replace with placeholder/example values.")
        return 1

    print("=== no privacy leaks ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
