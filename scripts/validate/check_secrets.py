#!/usr/bin/env python3
"""
Secret / credential scanner (POL-143 enforcement).

PRJ-013 audit finding H8 (dimension H/I): POL-143 forbids committing secrets,
tokens, keys, and credentials, but the framework had ZERO automated
enforcement — privacy-check.yml/check_privacy.py only catch org-config values
leaking to publish, not credentials. This scanner closes that gap as a CI gate
(it runs inside scripts/validate/run.py, which the test-merge `validate` job
invokes on every PR to main/publish).

Design goals:
  - HIGH SIGNAL, LOW false-positive. Patterns match only well-known,
    structurally-distinctive credential shapes, not anything that merely looks
    "password-ish". This keeps the gate trustworthy so it is never disabled.
  - stdlib only (runs under any python3, no pip deps).
  - tracked text files only (skips .git, skips binaries via a NUL-byte sniff).
  - an inline `# pragma: allowlist secret` on the matching line suppresses the
    finding (for fixtures, docs that must show an example token shape, etc.).

Usage:
    python3 scripts/validate/check_secrets.py [REPO_ROOT]

Exits 0 if no secrets found, 1 if any high-confidence secret is found.
Invokable directly or via run.py's `check_secrets(repo_root)` entry point.
"""

import re
import subprocess
import sys
from pathlib import Path

# Inline suppression marker (detect-secrets compatible style).
ALLOWLIST_MARKER = "pragma: allowlist secret"

# Directories never scanned (in addition to anything git doesn't track).
SKIP_DIR_PARTS = {".git"}

# A placeholder value is NOT a secret. Used by the generic assignment patterns
# (password=/api_key=) to avoid flagging example/empty/template values.
PLACEHOLDER_RE = re.compile(
    r"""^(?:
          | \s*                                  # empty / whitespace
          | x+ | \.\.\. | -+ | \*+               # x..., ---, ***
          | changeme | example | placeholder
          | your[-_].* | my[-_].* | some[-_].*
          | redacted | dummy | sample | test(?:ing)? | fake
          | none | null | nil | true | false
          | \$\{[^}]+\} | \{\{[^}]+\}\}          # ${VAR} / {{TOKEN}}
          | \$[A-Za-z_][A-Za-z0-9_]*             # $VAR
          | <[^>]+>                               # <your-token>
      )$""",
    re.IGNORECASE | re.VERBOSE,
)

# ── High-signal patterns ──────────────────────────────────────────────────────
# Each entry: (label, compiled-regex). A regex matching anywhere on a line
# (that is not an allowlisted line) is a finding. These shapes are
# distinctive enough that a match is almost certainly a real credential.
PATTERNS = [
    (
        "private key block",
        re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----"),
    ),
    (
        "GitHub token",
        re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b"),
    ),
    (
        "GitHub fine-grained PAT",
        re.compile(r"\bgithub_pat_[A-Za-z0-9_]{60,}\b"),
    ),
    (
        "AWS access key id",
        re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b"),
    ),
    (
        "Slack token",
        re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    ),
]

# Generic assignment patterns: `password = "..."` / `api_key: '...'` etc.
# These are the only patterns that gate on the VALUE not being a placeholder,
# since the keyword alone (password/api_key) is common in legitimate code/docs.
ASSIGNMENT_RE = re.compile(
    r"""(?P<key>\b(?:password|passwd|pwd|api[_-]?key|secret[_-]?key
            |access[_-]?token|auth[_-]?token|client[_-]?secret)\b)
        \s*[:=]\s*
        (?P<q>["'])(?P<val>[^"']{6,})(?P=q)""",
    re.IGNORECASE | re.VERBOSE,
)


def is_placeholder(value: str) -> bool:
    return bool(PLACEHOLDER_RE.match(value.strip()))


def tracked_files(repo_root: Path) -> list[Path]:
    """Return git-tracked files; fall back to a filesystem walk if not a repo."""
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "ls-files", "-z"],
            capture_output=True, check=True,
        )
        names = result.stdout.decode("utf-8", "replace").split("\0")
        return [repo_root / n for n in names if n]
    except (subprocess.CalledProcessError, FileNotFoundError):
        out = []
        for f in repo_root.rglob("*"):
            if f.is_file() and not any(p in SKIP_DIR_PARTS for p in f.relative_to(repo_root).parts):
                out.append(f)
        return out


def is_binary(path: Path) -> bool:
    try:
        with open(path, "rb") as fh:
            return b"\0" in fh.read(8192)
    except OSError:
        return True


def scan_file(repo_root: Path, path: Path) -> list[tuple[str, int, str, str]]:
    """Return (relpath, lineno, label, snippet) findings for one file."""
    findings: list[tuple[str, int, str, str]] = []
    rel = str(path.relative_to(repo_root))
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return findings

    for lineno, line in enumerate(text.splitlines(), 1):
        if ALLOWLIST_MARKER in line:
            continue
        for label, pat in PATTERNS:
            if pat.search(line):
                findings.append((rel, lineno, label, line.strip()[:120]))
        m = ASSIGNMENT_RE.search(line)
        if m and not is_placeholder(m.group("val")):
            findings.append((rel, lineno, "hardcoded credential", line.strip()[:120]))
    return findings


def check_secrets(repo_root: Path) -> list[str]:
    """run.py entry point: return a list of error strings (empty == pass)."""
    errors: list[str] = []
    for path in tracked_files(repo_root):
        if any(p in SKIP_DIR_PARTS for p in path.relative_to(repo_root).parts):
            continue
        if not path.is_file() or is_binary(path):
            continue
        for rel, lineno, label, snippet in scan_file(repo_root, path):
            errors.append(f"{rel}:{lineno}: {label}: {snippet}")
    return errors


def main() -> int:
    repo_root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    errors = check_secrets(repo_root)
    if errors:
        print(f"[FAIL] secrets ({len(errors)} finding(s)):")
        for e in errors:
            print(f"   - {e}")
        print()
        print("POL-143: remove the credential and rotate it. If this is a known")
        print("non-secret (fixture/example), append '# pragma: allowlist secret'")
        print("to the line.")
        return 1
    print("=== no secrets found ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
