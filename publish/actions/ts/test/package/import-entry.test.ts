// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE PACKAGE ENTRY LOADS (PRJ-121 intent 05, Item 12). `main` / `exports["."]` point at the src/index.ts barrel.
// `maintain/upgrade.ts` imported PACKAGE_NAME back FROM that barrel and read it at module top, so importing the
// published library threw "Cannot access 'PACKAGE_NAME' before initialization". The constants now live in the leaf
// `src/package-identity.ts`, and a lint rule keeps every module inside src/ off the barrel.
import { expect } from "chai";
import { createRequire } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import { PKG_ROOT, requireFreshLib } from "../helpers/lib-fresh.js";

describe("the package entry (lib/esm/index.js, lib/cjs/index.js) loads", function () {
  this.timeout(30000);
  // The compiled lib/: skip when none was built, FAIL when it is stale (Item 7a).
  before(function () { requireFreshLib(this); });

  it("import of the ESM entry gives PACKAGE_NAME", async () => {
    const m = (await import(pathToFileURL(path.join(PKG_ROOT, "lib", "esm", "index.js")).href)) as { PACKAGE_NAME: string };
    expect(m.PACKAGE_NAME).to.equal("@svayam-opensource/gov");
  });

  it("require of the CJS entry gives PACKAGE_NAME", () => {
    const req = createRequire(path.join(PKG_ROOT, "package.json"));
    const m = req(path.join(PKG_ROOT, "lib", "cjs", "index.js")) as { PACKAGE_NAME: string };
    expect(m.PACKAGE_NAME).to.equal("@svayam-opensource/gov");
  });
});

describe("no module inside src/ imports a barrel (lint)", function () {
  this.timeout(60000);
  const lint = async (file: string, code: string) => {
    const [r] = await new ESLint({ cwd: PKG_ROOT }).lintText(code, { filePath: path.join(PKG_ROOT, file) });
    return r!.messages.filter((m) => m.ruleId === "no-restricted-imports");
  };

  for (const [file, spec] of [
    ["src/maintain/planted.ts", "../index.js"],
    ["src/cli/main.ts", "../index.js"], // main.ts is exempt from the process rule — never from this one
    ["src/run-process.ts", "./index.js"],
    ["src/lifecycle/sub/planted.ts", "../../index.js"],
  ] as const) {
    it(`${file} importing "${spec}" fails lint`, async () => {
      const msgs = await lint(file, `import { PACKAGE_NAME } from "${spec}";\nexport const X = PACKAGE_NAME;\n`);
      expect(msgs.map((m) => m.message).join("\n")).to.match(/barrel/);
    });
  }

  it("the leaf import passes, and the process rule still holds beside the barrel rule", async () => {
    expect(await lint("src/maintain/planted.ts", `import { PACKAGE_NAME } from "../package-identity.js";\nexport const X = PACKAGE_NAME;\n`)).to.deep.equal([]);
    const msgs = await lint("src/maintain/planted.ts", `import { spawn } from "node:child_process";\nexport const X = spawn;\n`);
    expect(msgs.map((m) => m.message).join("\n")).to.match(/run-process/);
  });
});
