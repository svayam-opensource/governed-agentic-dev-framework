#!/usr/bin/env python3
"""
Session-start protocol integrity check (#54 Increment 1 — Layer 3-A).

The session-start protocol (agent/session-protocol.md) is only enforceable if it
is reliably DELIVERED. This validator gates that precondition, author-agnostic
and deterministic:

  1. agent/session-protocol.md exists and is non-empty.
  2. It still carries the §0 "agent speaks first / context manifest / before you
     change any code" mandate — i.e. nobody gutted the protocol while leaving the
     file in place.
  3. Every generated tool copy is in sync with the canonical protocol
     (scripts/render-harness.sh --check) — i.e. no generated copy was hand-edited
     to weaken or drop the protocol, and the protocol is rendered to every active
     install path (a missing path counts as drift).

Invoked via scripts/validate/run.py (the test-merge `validate` gate) and runnable
directly: python3 scripts/validate/check_protocol.py [REPO_ROOT].
"""

import subprocess
import sys
from pathlib import Path

# Stable anchors from session-protocol.md §0. If any disappears, the protocol's
# core mandate was removed even if the file still exists.
MANDATE_ANCHORS = (
    "agent speaks first",
    "context manifest",
    "before you change any code",
)


def check_protocol(repo_root: Path) -> list[str]:
    errors: list[str] = []

    protocol = repo_root / "agent" / "session-protocol.md"
    if not protocol.exists():
        return ["agent/session-protocol.md is missing — the session-start protocol is undelivered"]
    text = protocol.read_text(encoding="utf-8", errors="replace")
    if not text.strip():
        errors.append("agent/session-protocol.md is empty")
    else:
        low = text.lower()
        missing = [a for a in MANDATE_ANCHORS if a not in low]
        if missing:
            errors.append(
                "agent/session-protocol.md no longer contains its §0 mandate "
                f"(missing: {', '.join(missing)})"
            )

    # Generated copies must match the canonical protocol. Reuse render-harness's
    # own --check (it also treats a missing install path as drift).
    renderer = repo_root / "scripts" / "render-harness.sh"
    manifest = repo_root / "agent" / "harness-manifest.yaml"
    if renderer.exists() and manifest.exists():
        try:
            r = subprocess.run(
                ["bash", str(renderer), "--check"],
                cwd=str(repo_root), capture_output=True, text=True,
            )
            if r.returncode != 0:
                detail = (r.stdout + r.stderr).strip().replace("\n", " ")
                errors.append(
                    "generated protocol copies are out of sync with "
                    f"agent/session-protocol.md — run ./scripts/render-harness.sh ({detail[:300]})"
                )
        except OSError as e:
            errors.append(f"could not run render-harness.sh --check: {e}")

    # #54 Increment 2 — if the Claude Code client gate is configured, its parts
    # must all be present (guard against a hook being deleted while settings.json
    # still points at it, which would break the gate). Conditional on
    # settings.json existing, so repos that haven't adopted the gate aren't forced
    # to.
    settings = repo_root / ".claude" / "settings.json"
    if settings.exists() and "session-start" in settings.read_text(encoding="utf-8", errors="replace"):
        for rel in (
            ".claude/hooks/session-start.sh",
            ".claude/hooks/pre-tool-gate.sh",
            ".claude/hooks/session-ack.sh",
            ".claude/commands/session-start.md",
        ):
            p = repo_root / rel
            if not p.exists() or not p.read_text(encoding="utf-8", errors="replace").strip():
                errors.append(f"session-start gate is configured but {rel} is missing/empty")

    # Same guard for the Cursor client gate (.cursor/hooks.json).
    cursor_hooks = repo_root / ".cursor" / "hooks.json"
    if cursor_hooks.exists() and "session-gate" in cursor_hooks.read_text(encoding="utf-8", errors="replace"):
        for rel in (
            ".cursor/hooks/session-start.sh",
            ".cursor/hooks/session-gate.sh",
            ".cursor/hooks/session-ack.sh",
        ):
            p = repo_root / rel
            if not p.exists() or not p.read_text(encoding="utf-8", errors="replace").strip():
                errors.append(f"Cursor session-start gate is configured but {rel} is missing/empty")

    return errors


def main() -> int:
    repo_root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    errors = check_protocol(repo_root)
    if errors:
        print(f"[FAIL] protocol ({len(errors)} error(s)):")
        for e in errors:
            print(f"   - {e}")
        return 1
    print("=== protocol integrity ok ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
