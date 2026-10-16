// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE DOOR, AS THE DOCS DESCRIBE IT (#181, plan 04 T07, ruling Q2 A).
 *
 * An adopter meets the framework through a handful of pages: the repo README, the npm README, the install
 * site's start page, `docs/installing.md` and `docs/operating-systems.md`. Each used to send people somewhere
 * that no longer exists — `gov.svayam.ai` (does not resolve), `@svayam-opensource/prj` (the frozen bash CLI),
 * "run it from Git Bash" (Windows is native now). This test holds the people-facing docs to the current door:
 *
 *   · no `@svayam-opensource/prj` and no `gov.svayam.ai` anywhere people read (CHANGELOG and package.json
 *     history are not people-facing docs; `site/README.md` is the maintainers' note on the DNS plan, P2 B);
 *   · the READMEs name the live door, `https://gov.svayamtech.com` (until P2 B flips it — then this test
 *     changes with the DNS, in one commit);
 *   · operating-systems.md describes native Windows — the MSI and winget — not Git Bash or `prj`;
 *   · each doc this task rewrote says who it is for in its first line;
 *   · P1 REVISED (Policy Owner, 2026-10-14): the installer ships UNSIGNED until a production certificate exists,
 *     so the Windows door is `winget install Svayam.Gov` alone, nobody is promised a "signed .msi", and every page
 *     that mentions the .msi says a directly downloaded one shows "Unknown publisher".
 *
 * Hermetic: it reads files only. Whether the door URL answers 200 is `npm run door:check` (scripts/
 * door-link-check.mjs), run on a schedule in CI — a network check would make every PR depend on DNS.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DOOR_URL, peopleFacingDocs } from "../../scripts/door-docs.mjs";

function repoRoot(): string {
  let d = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(d, "publish", "content", "MANIFEST.yaml"))) return d;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  throw new Error("could not locate the repo root");
}

const ROOT = repoRoot();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** The docs T07 rewrote; each states its audience on line 1. */
const REWRITTEN = ["README.md", "publish/actions/ts/README.md", "docs/installing.md", "docs/operating-systems.md"];
/** Every doc T07 touched — the rewritten ones and those it only corrected. */
const TOUCHED = [...REWRITTEN, "docs/CONTRIBUTING.md", "docs/operating-model.md", "publish/content/README.md"];

describe("door docs (#181)", () => {
  const docs: string[] = peopleFacingDocs(ROOT);

  it("the people-facing doc set is found, and covers the pages an adopter meets first", () => {
    for (const must of [...REWRITTEN, "site/template/index.html", "publish/content/README.md"]) {
      expect(docs, must).to.include(must);
    }
    expect(docs).to.not.include("CHANGELOG.md");
  });

  it("no people-facing doc names the frozen bash CLI's package", () => {
    const hits = docs.filter((f) => read(f).includes("@svayam-opensource/prj"));
    expect(hits, "use `gov` (@svayam-opensource/gov); the bash CLI is history, kept in CHANGELOG").to.deep.equal([]);
  });

  it("no people-facing doc sends anyone to gov.svayam.ai, which does not resolve (Q2 A)", () => {
    const hits = docs.filter((f) => read(f).includes("gov.svayam.ai"));
    expect(hits, `point at ${DOOR_URL} until P2 B makes gov.svayam.ai live`).to.deep.equal([]);
  });

  it("the READMEs and the install page name the live door", () => {
    expect(DOOR_URL).to.equal("https://gov.svayamtech.com");
    for (const f of ["README.md", "publish/actions/ts/README.md", "publish/content/README.md", "docs/installing.md"]) {
      expect(read(f), f).to.include(DOOR_URL);
    }
  });

  it("the READMEs give one door per OS and end in the first-run flow", () => {
    for (const f of ["README.md", "publish/actions/ts/README.md", "docs/installing.md"]) {
      const t = read(f);
      expect(t, `${f}: macOS/Linux door`).to.match(/install\.sh/);
      expect(t, `${f}: Windows door`).to.include("winget install Svayam.Gov");
      expect(t, `${f}: the .msi`).to.match(/\.msi\b/);
      expect(t, `${f}: says the Windows door is not live yet`).to.match(/first release/i);
      expect(t, `${f}: ends in the first-run flow`).to.match(/first-run flow/i);
      expect(t, `${f}: no npm i -g route`).to.not.match(/npm i(nstall)? -g @svayam/);
      expect(t, `${f}: gov setup is a machine verb, not a door`).to.not.match(/\bgov setup\b/);
    }
  });

  it("operating-systems.md describes native Windows: MSI and winget, no Git Bash, no prj", () => {
    const t = read("docs/operating-systems.md");
    expect(t).to.include("winget install Svayam.Gov");
    expect(t).to.match(/\.msi\b/);
    expect(t).to.not.match(/Git Bash/i);
    expect(t).to.not.match(/\bprj\b/);
    expect(t).to.not.match(/\byq\b/);
    // T10/T11's section is accurate and stays.
    expect(t).to.include("## Windows: how gov runs other programs and installs agents");
    expect(t).to.include("winget upgrade Svayam.Gov");
  });

  it("P1 REVISED: Windows = winget; no page promises a signed MSI; a downloaded .msi shows 'Unknown publisher'", () => {
    for (const f of ["README.md", "publish/actions/ts/README.md", "docs/installing.md", "docs/operating-systems.md", "site/template/index.html"]) {
      const t = read(f);
      expect(t, `${f}: Windows door`).to.include("winget install Svayam.Gov");
      expect(t, `${f}: promises a signed installer`).to.not.match(/signed (`|<code>)?\.msi|signed MSI|first signed release/i);
      expect(t, `${f}: says what a direct download shows`).to.include("Unknown publisher");
      expect(t, `${f}: says until when`).to.match(/until a production (code-signing )?certificate exists/i);
    }
  });

  it("every doc T07 touched says who it is for in its first line", () => {
    for (const f of TOUCHED) {
      const first = read(f).split("\n")[0];
      expect(first, f).to.match(/^> \*\*Who this is for:\*\* \S/);
    }
  });
});
