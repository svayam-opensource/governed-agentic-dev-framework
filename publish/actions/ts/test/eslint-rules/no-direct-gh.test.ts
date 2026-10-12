// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PORTS GUARD (PRJ-121 intent 03, D7, M4). The modules this intent adds — signal, autorun, intent, project,
 * skills — reach GitHub only through a port. A file there that runs `gh`, imports `gh-board`, or takes a `runGh`
 * fails lint. Linted through the REAL eslint.config.ts, so the test also proves the rule is wired to those paths
 * and to no others.
 */
import { expect } from "chai";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const TS = fileURLToPath(new URL("../../", import.meta.url));
const eslint = new ESLint({ cwd: TS });

async function messages(rel: string, code: string): Promise<string[]> {
  const [r] = await eslint.lintText(code, { filePath: path.join(TS, rel) });
  return r!.messages.filter((m) => m.ruleId === "gov/no-direct-gh").map((m) => m.message);
}

describe("eslint — gov/no-direct-gh", function () {
  this.timeout(60_000);

  it("a file under src/signal/ importing runGh fails lint", async () => {
    const m = await messages("src/signal/fixture.ts", `import { type RunGh } from "../lifecycle/gh-board.js";\nexport const x = (runGh: RunGh) => runGh;\n`);
    expect(m.length).to.be.greaterThan(0);
    expect(m.join("\n")).to.match(/port/i);
  });

  it("importing anything from gh-board fails, under every new module", async () => {
    for (const dir of ["signal", "autorun", "intent", "project", "skills"]) {
      const m = await messages(`src/${dir}/x.ts`, `import { createGhBoard } from "../lifecycle/gh-board.js";\nexport const b = createGhBoard;\n`);
      expect(m.length, dir).to.be.greaterThan(0);
    }
  });

  it("running gh through the process runner fails", async () => {
    const m = await messages("src/autorun/x.ts", `import { run } from "../run-process.js";\nexport const me = () => run("gh", ["api", "user"]);\n`);
    expect(m.length).to.equal(1);
  });

  it("a createGh* factory from any lifecycle module fails", async () => {
    const m = await messages("src/intent/x.ts", `import { createGhIssues } from "../lifecycle/issues.js";\nexport const i = createGhIssues;\n`);
    expect(m.length).to.equal(1);
  });

  it("going through a port is fine", async () => {
    const m = await messages("src/signal/ok.ts", `import { ok, type Result } from "../ports/index.js";\nexport const r = (): Result<number> => ok(1);\n`);
    expect(m).to.deep.equal([]);
  });

  it("the guard does not reach existing code (M4: ported when touched, not all at once)", async () => {
    const m = await messages("src/lifecycle/x.ts", `import { createGhBoard } from "./gh-board.js";\nexport const b = createGhBoard;\n`);
    expect(m).to.deep.equal([]);
  });
});
