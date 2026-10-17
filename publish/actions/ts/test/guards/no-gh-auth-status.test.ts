/**
 * NO USER-FACING TEXT SENDS PEOPLE TO `gh auth status` (PRJ-121 intent 05, Item 10).
 *
 * gov's own sign-in check moved to `gh api user` (adoption walk #2, 2026-10-07) because `gh auth status` exits
 * non-zero when ANY stored gh account is stale, even while the active token works. Hints that still said "check
 * `gh auth status`" sent a person to a command that would report a failure gov itself no longer believes. Every hint
 * now says {@link GH_SIGNIN_HINT}: run `gov doctor` (which runs the `gh api user` check) or `gh api user`.
 *
 * The guard reads every string and template literal in `src/` through the TypeScript parser, so comments (which
 * explain the history) and regular expressions (the session gate RECOGNISES an agent's `gh auth status` probe) are
 * left alone — only text gov could print is checked.
 */
import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { GH_SIGNIN_HINT } from "../../src/maintain/fix-env.js";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

function literalsIn(file: string): { text: string; line: number }[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: { text: string; line: number }[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push({ text: n.text, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function tsFiles(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(d, e.name);
    return e.isDirectory() ? tsFiles(f) : f.endsWith(".ts") ? [f] : [];
  });
}

describe("guard: no hint sends people to `gh auth status` (Item 10)", function () {
  // Parsing all of src/ takes ~1s on a laptop and over 2s on a loaded CI agent (Jenkins gov-work dev #21).
  this.timeout(30_000);

  it("no string or template literal in src/ mentions `gh auth status`", () => {
    const offenders = tsFiles(SRC).flatMap((f) =>
      literalsIn(f).filter((l) => /gh auth status/.test(l.text)).map((l) => `${path.relative(SRC, f)}:${l.line}`));
    expect(offenders, "say GH_SIGNIN_HINT (`gov doctor` / `gh api user`) instead").to.deep.equal([]);
  });

  it("the guard really sees literals — and ignores comments and regexes", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gh-hint-guard-"));
    const f = path.join(tmp, "probe.ts");
    fs.writeFileSync(f, "// check `gh auth status`\nconst r = /^gh auth status$/;\nconst s = `run \\`gh auth status\\``;\n");
    expect(literalsIn(f).filter((l) => /gh auth status/.test(l.text)).map((l) => l.line)).to.deep.equal([3]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the one hint names `gov doctor` and `gh api user`", () => {
    expect(GH_SIGNIN_HINT).to.contain("`gov doctor`");
    expect(GH_SIGNIN_HINT).to.contain("`gh api user`");
  });
});
