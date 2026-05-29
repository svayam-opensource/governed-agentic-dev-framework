#!/usr/bin/env bash
# Script: render-harness
# Purpose: Render per-tool agent entrypoints from the ONE canonical protocol so
#          they never drift. Source of truth:
#            - agent/session-protocol.md     (the protocol body)
#            - agent/harness-manifest.yaml    (which tools, paths, templates, tiers)
#          Regenerates every harness with generated:true and status:active.
#          CLAUDE.md (import tier, generated:false) is hand-maintained and never
#          overwritten — it @imports the canonical files instead.
# Usage:
#   bash render-harness.sh                  # (re)render all generated root files
#   bash render-harness.sh --check          # verify on-disk files match; exit 1 on drift (CI gate)
#   bash render-harness.sh --list           # list every registered harness + tier + status
#   bash render-harness.sh --project <PID>  # write per-project entrypoints under projects/<PID>/
# Compliance: keeps the POL-113..117 protocol single-sourced (one edit, re-render).

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$REPO/agent/harness-manifest.yaml"
PROTOCOL="$REPO/agent/session-protocol.md"
ENTRYPOINT="$REPO/framework/agent.md"

[[ -f "$MANIFEST" ]] || { echo "ERROR: manifest not found: $MANIFEST" >&2; exit 1; }
[[ -f "$PROTOCOL" ]] || { echo "ERROR: canonical protocol not found: $PROTOCOL" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required" >&2; exit 1; }

MODE="render"; PID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)   MODE="check" ;;
    --list)    MODE="list" ;;
    --project) MODE="project"; PID="${2:-}"; shift; [[ -n "$PID" ]] || { echo "ERROR: --project needs a <PID>" >&2; exit 1; } ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

python3 - "$MANIFEST" "$PROTOCOL" "$ENTRYPOINT" "$REPO" "$MODE" "$PID" <<'PY'
import sys, os, yaml

manifest_path, protocol_path, entrypoint_path, repo, mode, pid = sys.argv[1:7]

M = yaml.safe_load(open(manifest_path)) or {}
banner = (M.get("generated_banner") or "").strip()
templates = M.get("templates", {}) or {}
harnesses = M.get("harnesses", []) or []
body = open(protocol_path).read().rstrip("\n")

def subst(tmpl, mapping, extra=None):
    out = tmpl
    # Render markers are namespaced ({{render.X}} / {{template_extra.X}}) so the
    # dot keeps them out of the org-placeholder regex ({{NAME}}, no dots), which
    # setup.sh substitutes and STRICT_PLACEHOLDERS validates.
    for k, v in mapping.items():
        out = out.replace("{{render.%s}}" % k, v)
    for k, v in (extra or {}).items():
        sv = "true" if v is True else "false" if v is False else str(v)
        out = out.replace("{{template_extra.%s}}" % k, sv)
    return out.rstrip("\n") + "\n"

def render_file(harness, body_text):
    """Render one harness's file content from its named template."""
    tname = harness.get("template")
    if not tname or tname not in templates:
        raise SystemExit("ERROR: harness '%s' references unknown template '%s'" % (harness.get("id"), tname))
    return subst(templates[tname],
                 {"generated_banner": banner, "body": body_text},
                 harness.get("template_extra"))

def generated_active():
    return [h for h in harnesses if h.get("generated") and h.get("status") == "active"]

def write(path, content):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    open(path, "w").write(content)

# ── Mode: list ───────────────────────────────────────────────────────────────
if mode == "list":
    print("%-18s %-22s %-15s %-9s %-7s %s" % ("id", "tool", "tier", "status", "gen", "path"))
    print("-" * 100)
    for h in harnesses:
        print("%-18s %-22s %-15s %-9s %-7s %s" % (
            h.get("id", "?"), (h.get("tool") or "")[:22], h.get("tier", "?"),
            h.get("status", "?"), str(bool(h.get("generated"))).lower(), h.get("path") or "(none)"))
    print("\nGenerated on `render`: " + ", ".join(h["id"] for h in generated_active()))
    sys.exit(0)

# ── Mode: render / check (root install paths) ────────────────────────────────
if mode in ("render", "check"):
    drift, wrote = [], []
    for h in generated_active():
        path = os.path.join(repo, h["path"])
        content = render_file(h, body)
        if mode == "check":
            existing = open(path).read() if os.path.exists(path) else None
            if existing != content:
                drift.append(h["path"])
        else:
            write(path, content)
            wrote.append(h["path"])
    if mode == "check":
        if drift:
            print("DRIFT — these generated files are out of sync with agent/session-protocol.md:")
            for d in drift:
                print("  - " + d)
            print("\nRun: ./scripts/render-harness.sh")
            sys.exit(1)
        print("OK — all %d generated harness files are in sync." % len(generated_active()))
        sys.exit(0)
    for w in wrote:
        print("rendered: " + w)
    print("\n%d files rendered from agent/session-protocol.md." % len(wrote))
    print("Note: CLAUDE.md is import-tier (hand-maintained) — not regenerated.")
    sys.exit(0)

# ── Mode: project (per-project entrypoints under projects/<PID>/) ────────────
if mode == "project":
    proj_dir = os.path.join(repo, "projects", pid)
    if not os.path.isdir(proj_dir):
        raise SystemExit("ERROR: project dir not found: projects/%s (seed it first)" % pid)
    # Compose a per-project body = canonical protocol + the project's own agent.md
    # inlined (so non-import tools get full project context in one file).
    pp_agent = os.path.join(proj_dir, "agent.md")
    if os.path.exists(pp_agent):
        proj_ctx = open(pp_agent).read().rstrip("\n")
    else:
        proj_ctx = "See `projects/%s/agent.md` for project-specific context." % pid
    pp_body = body + "\n\n---\n\n# Project entrypoint — " + pid + "\n\n" + proj_ctx
    wrote = []
    for h in harnesses:
        if h.get("status") != "active":
            continue
        # Claude: write the @import stub (expands canonical + project agent.md at launch).
        if h.get("tier") == "import" and h.get("per_project_path"):
            ppath = os.path.join(repo, h["per_project_path"].replace("{project_id}", pid))
            stub = (h.get("per_project_template") or "").rstrip("\n") + "\n"
            write(ppath, stub)
            wrote.append(os.path.relpath(ppath, repo))
            continue
        # Generated tools: render their template into projects/<PID>/<path> with the composed body.
        if h.get("generated") and h.get("path"):
            ppath = os.path.join(proj_dir, h["path"])
            write(ppath, render_file(h, pp_body))
            wrote.append(os.path.relpath(ppath, repo))
    for w in wrote:
        print("rendered: " + w)
    print("\n%d per-project entrypoints written under projects/%s/." % (len(wrote), pid))
    sys.exit(0)
PY
