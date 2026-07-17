#!/usr/bin/env python3
"""
Knowledge Organization Standard enforcement (POL-416).

Checks every *.md under knowledge/ (org tree only — framework/ is the
upstream template and excluded):

  1. front-matter — present, schema-valid, domain/layer agree with the
     file's folder (domain-root instruments are exempt from layer-folder
     agreement; their paths are pinned by policy text — see the C03
     deviation in the PRJ-005 migration).
  2. orphan check — every non-README doc is linked from at least one other
     knowledge doc (its layer index or a journey doc).
  3. journey purity — paths/*.md are links-in-order docs: no code blocks,
     no embedded images, and a minimum link density.
  4. link check — every relative md link resolves; no [[wikilinks]].
  5. diagram rule — no binary diagram embeds (png/jpg/gif) in knowledge/;
     diagrams are Mermaid text (POL-414). Files whose link path contains
     "screenshot" are exempt.

Superseded redirect stubs (status: superseded) are exempt from orphan and
folder-agreement checks but must still parse.
"""

import re
from pathlib import Path

DOMAINS = {
    "policies", "legal", "architecture/system", "architecture/data",
    "development", "testing", "deployment", "infrastructure", "support",
    "compliance", "navigation",
}
LAYERS = {"mandate", "procedure", "pattern", "use-case", "spec", "compliance", "path"}
COMPLIANCE = {"C01", "C02", "C03", "instructional", "descriptive", "evidence"}
STATUSES = {"current", "draft", "superseded"}
LAYER_FOLDER = {
    "mandates": "mandate", "procedures": "procedure", "patterns": "pattern",
    "use-cases": "use-case", "specs": "spec", "compliance": "compliance",
    "paths": "path",
}
FM_RE = re.compile(r"\A---\n(.*?)\n---\n", re.S)
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
WIKILINK_RE = re.compile(r"\[\[[^\]]+\]\]")
IMG_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")


def _front_matter(text: str) -> dict | None:
    m = FM_RE.match(text)
    if not m:
        return None
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.lstrip().startswith("#"):
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
    return fm


def check_knowledge(repo_root: Path) -> list[str]:
    errors: list[str] = []
    kroot = repo_root / "knowledge"
    if not kroot.is_dir():
        # The framework/template SOURCE repo carries its template under framework/ and
        # has NO instantiated org-knowledge tree at root (v0.3.3 skinny template: "remove
        # root duplicates of framework files"). There is nothing to validate here — only a
        # real WORKSPACE (which has no framework/ template dir) must ship a root knowledge/.
        if (repo_root / "framework").is_dir():
            return []
        return ["knowledge/ directory missing"]

    docs: dict[Path, str] = {
        p: p.read_text(encoding="utf-8", errors="replace")
        for p in sorted(kroot.rglob("*.md"))
    }
    linked: set[Path] = set()

    def _strip_code(t: str) -> str:
        # CommonMark-ish fence matching: a fence opened with N backticks only
        # closes on a line with >= N backticks (so ````markdown wrappers can
        # embed ``` blocks). Then inline spans; then indented code (4+ spaces).
        out: list[str] = []
        fence_len = 0  # 0 = not in a fence
        for l in t.splitlines():
            stripped = l.lstrip()
            m = re.match(r"^(`{3,})", stripped)
            if m:
                n = len(m.group(1))
                if fence_len == 0:
                    fence_len = n          # open
                elif n >= fence_len:
                    fence_len = 0          # close
                continue
            if fence_len == 0:
                out.append(l)
        t = re.sub(r"`[^`\n]*`", "", "\n".join(out))
        return "\n".join(l for l in t.splitlines() if not l.startswith("    "))

    # Pass 1 — links, wikilinks, images, and link-graph construction
    for p, text in docs.items():
        rel = p.relative_to(repo_root)
        if WIKILINK_RE.search(_strip_code(text)):
            errors.append(f"{rel}: [[wikilink]] found — use relative markdown links (POL-413)")
        for target in IMG_RE.findall(text):
            if target.lower().endswith((".png", ".jpg", ".jpeg", ".gif")) and "screenshot" not in target.lower():
                errors.append(f"{rel}: binary diagram embed '{target}' — diagrams are Mermaid text (POL-414)")
        for target in LINK_RE.findall(text):
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            tpath = (p.parent / target.split("#")[0]).resolve()
            if not tpath.exists():
                errors.append(f"{rel}: broken link '{target}'")
            else:
                try:
                    linked.add(tpath.relative_to(repo_root.resolve()))
                except ValueError:
                    pass

    # Pass 2 — front-matter, folder agreement, orphan, journey purity
    for p, text in docs.items():
        rel = p.relative_to(repo_root)
        fm = _front_matter(text)
        if fm is None:
            errors.append(f"{rel}: missing front-matter (POL-408)")
            continue
        for key, allowed in (("domain", DOMAINS), ("layer", LAYERS),
                             ("compliance", COMPLIANCE), ("status", STATUSES)):
            val = fm.get(key)
            if val not in allowed:
                errors.append(f"{rel}: front-matter {key}='{val}' invalid (POL-408)")
        if not fm.get("owner"):
            errors.append(f"{rel}: front-matter owner missing (POL-408)")

        if fm.get("status") == "superseded":
            continue  # redirect stubs: parse-only

        parts = rel.parts  # ('knowledge', <domain..>, [layer], file)
        folder_layer = None
        for seg in parts[1:-1]:
            if seg in LAYER_FOLDER:
                folder_layer = LAYER_FOLDER[seg]
        if folder_layer and fm.get("layer") != folder_layer:
            errors.append(
                f"{rel}: layer '{fm.get('layer')}' disagrees with folder '{folder_layer}' (POL-408)"
            )

        # Orphan check: non-README docs must be linked from somewhere.
        if p.name != "README.md":
            try:
                relresolved = p.resolve().relative_to(repo_root.resolve())
            except ValueError:
                relresolved = rel
            if relresolved not in linked:
                errors.append(f"{rel}: orphan — not linked from any index or journey (POL-416)")

        # Journey purity
        if parts[1] == "paths" and p.name != "README.md":
            if "```" in text:
                errors.append(f"{rel}: journey docs are links-only — code block found (POL-410)")
            if IMG_RE.search(text):
                errors.append(f"{rel}: journey docs are links-only — image found (POL-410)")
            if len(LINK_RE.findall(text)) < 3:
                errors.append(f"{rel}: journey doc has fewer than 3 links — is it a journey? (POL-410)")

    return errors
