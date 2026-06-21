#!/usr/bin/env python3
"""
Version-sync validator.

The package version lives in three places that MUST agree, or installs and the
downgrade guard misbehave:

    1. package.json            -> "version"   (the source of truth)
    2. framework/VERSION       (shipped framework version)
    3. .framework-version      (install marker read by setup.sh on upgrade)

The README's diagram images are served by jsDelivr out of the published npm
tarball, referenced with the FLOATING `@latest` tag — so they are deliberately
NOT version-pinned and need no bump. This check also guards that nobody
accidentally re-pins them to an exact version (which would silently go stale on
the next release).

Bump all three with: scripts/bump-version.sh <x.y.z>

Run standalone (the Jenkins publish gate does this):
    python3 scripts/validate/check_version_sync.py [REPO_ROOT]
Exits 0 on pass, 1 on drift.
"""

import json
import re
import sys
from pathlib import Path

# jsDelivr URLs for THIS package in the README. Capture the version spec.
_README_PIN_RE = re.compile(
    r"cdn\.jsdelivr\.net/npm/@svayam-opensource/prj@([^/]+)/"
)


def check_version_sync(repo_root):
    errors = []

    pkg_path = repo_root / "package.json"
    if not pkg_path.exists():
        return ["package.json not found"]
    try:
        version = (json.loads(pkg_path.read_text()).get("version") or "").strip()
    except json.JSONDecodeError as e:
        return [f"package.json does not parse: {e}"]
    if not version:
        return ["package.json: no 'version' field"]

    # The two plain-text version files must equal package.json exactly.
    for rel in ("framework/VERSION", ".framework-version"):
        p = repo_root / rel
        if not p.exists():
            errors.append(f"{rel}: missing (expected to equal package.json {version})")
            continue
        got = p.read_text().strip()
        if got != version:
            errors.append(f"{rel}: {got!r} != package.json {version!r}")

    # README diagram URLs must stay on @latest (floating), never an exact pin.
    readme = repo_root / "README.md"
    if readme.exists():
        for spec in _README_PIN_RE.findall(readme.read_text()):
            if spec != "latest":
                errors.append(
                    f"README.md: jsDelivr URL is pinned to @{spec}; use @latest "
                    f"(diagram assets ship in the package and float with the release)"
                )

    return errors


def main() -> int:
    repo_root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    errors = check_version_sync(repo_root)
    if errors:
        print(f"[FAIL] version-sync ({len(errors)} error{'s' if len(errors) != 1 else ''}):")
        for e in errors:
            print(f"   - {e}")
        return 1
    print("[PASS] version-sync")
    return 0


if __name__ == "__main__":
    sys.exit(main())
