// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ADOPTION WALK #11 (2026-10-07): hints still printed `gov org add <org> <path>`. Today's syntax is
 * `gov org add <org> --home <path>`, and the old form is a usage error when typed. Every `gov org add …` a gov
 * source prints must parse with today's argv rules and reach the command, not its usage line.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgv } from "../../src/cli/args.js";
import { routeOrg } from "../../src/cli/dispatch.js";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const sources = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? sources(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));

/** Every `gov org add <args>` hint in the sources, with `${…}` filled in as a value would be. */
function hints(): Array<{ file: string; cmd: string }> {
  const out: Array<{ file: string; cmd: string }> = [];
  for (const f of sources(SRC)) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/gov org add ((?:\$\{[^}]*\}|[^`'"\n$])+)/g)) {
      const cmd = m[1]!.replace(/\$\{[^}]*\}/g, "x").replace(/[\\.,;:)\s]+$/, "").trim();
      if (!cmd || cmd.startsWith("/") || /^(is|alone|\/use)\b/.test(cmd)) continue;    // prose about the verb, not a hint
      out.push({ file: path.relative(SRC, f), cmd });
    }
  }
  return out;
}

describe("gov-work — every `gov org add` hint is today's syntax (walk #11)", () => {
  it("there are hints to check (the scan found them)", () => {
    expect(hints().length).to.be.at.least(4);
  });

  for (const { file, cmd } of hints()) {
    it(`${file}: gov org add ${cmd}`, () => {
      const parsed = parseArgv(["org", "add", ...cmd.split(/\s+/)]);
      expect("error" in parsed, `does not parse: ${cmd}`).to.equal(false);
      if ("error" in parsed) return;
      const r = routeOrg(parsed.positionals, parsed.flags, {
        store: { readActiveOrg: () => null } as never,
        govConfigAt: () => null,
      } as never);
      expect(r.lines.join("\n"), `reaches the usage line: gov org add ${cmd}`).to.not.match(/^usage:/m);
    });
  }
});
