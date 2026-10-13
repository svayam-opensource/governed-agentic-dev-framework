// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * NO OLD PATH IS NAMED ANYWHERE gov READS OR SHIPS (PRJ-121 intent 01, spec §3.1 AC — task L02).
 *
 * The flat 1.2.x layout (`framework/docs/specs/`, `framework/templates/`, `policies/rules.yaml`, …) became the phase
 * tree of spec §2. A path literal left behind is a dead link in an adopter's repo, or a reader that looks where nothing
 * is. This greps gov's source (`src/`), the content it ships (`publish/content/`) and the e2e scripts (`e2e/`).
 *
 * Exempt, and only these:
 *   · files tagged `bridge` (a `bridge:` line in their first lines) — the 1.x → 2.0 migration, deleted in D01;
 *   · MANIFEST.yaml's `moves:` and `retire:` lists, which name old paths because that is their job;
 *   · the files in EXEMPT below, each with its reason. The list may only shrink.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = fileURLToPath(new URL("../../", import.meta.url));
const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));

/** The flat 1.2.x paths spec §2 replaced. */
export const OLD_PATH = new RegExp([
  "framework/docs/", "framework/config/", "framework/templates/", "framework/procedures",
  "framework/rules/catalog\\.yaml",
  "policies/rules\\.yaml", "policies/catalog\\.yaml",
  "policies/authorized-representatives\\.md", "policies/data-classification\\.md", "policies/policy-domains\\.md",
  "policies/approved-technologies\\.md",
  "docs/specs/", "docs/user-guides/",
].join("|"));

/** Files that may still name an old path, and why. Frozen: it may only SHRINK. */
const EXEMPT: Readonly<Record<string, string>> = {
  "ts/src/rules/policy-pr/relocation.ts": "T8 (a feature, not legacy): the table of specification splits names the pre-split path an org rule may still cite",
  "content/framework/rules/W2-classification.md": "a working paper of its time, never shipped (on the frozen POL allow-list as history)",
};

function walk(dir: string, rel = ""): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    if (e.name === "node_modules" || e.name === "fixtures") return [];
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : [r];
  });
}

const isBridge = (text: string): boolean => text.split("\n").slice(0, 6).some((l) => /^\s*(\/\/|#|\*)\s*bridge:/.test(l));

/** MANIFEST.yaml: only its `files:` part is held to the new layout; `moves:` and `retire:` name old paths by design. */
const manifestFilesPart = (text: string): string => text.slice(0, text.search(/^moves:/m) === -1 ? text.length : text.search(/^moves:/m));

function offenders(): string[] {
  const roots: Array<[string, string, string]> = [
    [path.join(PKG, "src"), "ts/src", ""],
    [path.join(PKG, "e2e"), "ts/e2e", ""],
    [CONTENT, "content", ""],
  ];
  const out: string[] = [];
  for (const [abs, label] of roots) {
    for (const rel of walk(abs)) {
      const key = `${label}/${rel}`;
      if (key in EXEMPT) continue;
      let text: string;
      try { text = fs.readFileSync(path.join(abs, rel), "utf8"); } catch { continue; }
      if (isBridge(text)) continue;
      if (key === "content/MANIFEST.yaml") text = manifestFilesPart(text);
      text.split("\n").forEach((line, i) => { if (OLD_PATH.test(line)) out.push(`${key}:${i + 1}: ${line.trim().slice(0, 160)}`); });
    }
  }
  return out;
}

describe("no old path literal in src/, publish/content/ or e2e/ (spec 01 §3.1 AC, L02)", function () {
  this.timeout(20000);

  it("finds none (exempt: bridge-tagged files, MANIFEST moves/retire, the frozen EXEMPT list)", () => {
    expect(offenders()).to.deep.equal([]);
  });

  it("each EXEMPT file still names an old path — otherwise take it off the list", () => {
    for (const key of Object.keys(EXEMPT)) {
      const abs = key.startsWith("content/") ? path.join(CONTENT, key.slice("content/".length)) : path.join(PKG, key.slice("ts/".length));
      expect(fs.existsSync(abs), `${key} is gone — take it off EXEMPT`).to.equal(true);
      expect(OLD_PATH.test(fs.readFileSync(abs, "utf8")), `${key} no longer names an old path — take it off EXEMPT`).to.equal(true);
    }
  });

  it("the pattern catches each old path and none of the new ones", () => {
    for (const old of ["framework/docs/specs/framework-specification.md", "framework/templates/todo-template.md", "policies/rules.yaml",
      "policies/catalog.yaml", "framework/rules/catalog.yaml", "policies/authorized-representatives.md", "framework/config/org-config.schema.yaml"]) {
      expect(OLD_PATH.test(old), old).to.equal(true);
    }
    for (const now of ["framework/framework-specification.md", "framework/build/templates/todo-template.md", "policies/rules/rules.yaml",
      "policies/rules/checks-catalog.yaml", "framework/rules/checks-catalog.yaml", "policies/common/authorized-representatives.md",
      "framework/common/reference/org-config.schema.yaml", "framework/build/guides/working-on-a-project.md"]) {
      expect(OLD_PATH.test(now), now).to.equal(false);
    }
  });
});
