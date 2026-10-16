// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 §2.3 / D2 — build.md's "Shipped in" is filled when a release's deploy.md names the intent. */
import { expect } from "chai";
import { fillShippedIn, includedIntents, releasesNaming } from "../../src/intent/status.js";
import type { TreeReader } from "../../src/intent/scan.js";

const DEPLOY = (rows: string): string =>
  `# Release gadf 1.4.0 → 1.5.0\n\n**Status:** DRAFT\n\n## Unit\ngadf\n\n## Included intents\n| Project | Intent | Issues |\n|---|---|---|\n${rows}\n## Migration and rollback\nnone\n`;

const BUILD = (shipped: string): string =>
  `# Build 03\n\n**Status:** DRAFT\n\n## Tests run and results\nall green\n\n## Shipped in\n${shipped}\n## After\nkept\n`;

function tree(files: Record<string, string>): TreeReader {
  return {
    async list(dir) {
      const pre = dir.endsWith("/") ? dir : `${dir}/`;
      const names = new Set<string>();
      for (const p of Object.keys(files)) if (p.startsWith(pre)) names.add(p.slice(pre.length).split("/")[0]);
      return names.size ? [...names].sort() : null;
    },
    async read(p) { return files[p] ?? null; },
  };
}

describe("build.md forward link", () => {
  it("reads the Included intents table (backticks and links stripped)", () => {
    const rows = "| PRJ-121 | `03-lifecycle-signals-ports` | #12 |\n| PRJ-119 | [02-rules](../x) | #3 |\n";
    expect(includedIntents(DEPLOY(rows))).to.deep.equal([
      { project: "PRJ-121", intent: "03-lifecycle-signals-ports", issues: "#12" },
      { project: "PRJ-119", intent: "02-rules", issues: "#3" },
    ]);
  });

  it("a template placeholder row names nothing", () => {
    expect(includedIntents(DEPLOY("| <PRJ> | <NN-slug> | <refs> |\n"))).to.deep.equal([]);
  });

  it("finds every release whose deploy.md names this project + intent", async () => {
    const t = tree({
      "releases/gadf/1.5.0/deploy.md": DEPLOY("| PRJ-121 | 03-lifecycle-signals-ports | #12 |\n"),
      "releases/gadf/1.4.0/deploy.md": DEPLOY("| PRJ-121 | 02-other | #1 |\n"),
      "releases/gov-cicd/2.0.0/deploy.md": DEPLOY("| PRJ-121 | 03-lifecycle-signals-ports | #12 |\n"),
      "releases/gov-cicd/2.0.0/run.md": "x",
      "releases/odd/1.0.0/notes.md": "no deploy.md here",
    });
    expect(await releasesNaming(t, "PRJ-121", "03-lifecycle-signals-ports")).to.deep.equal(["releases/gadf/1.5.0", "releases/gov-cicd/2.0.0"]);
    expect(await releasesNaming(t, "PRJ-999", "03-lifecycle-signals-ports")).to.deep.equal([]);
    expect(await releasesNaming(tree({}), "PRJ-121", "03-x")).to.deep.equal([]);
  });

  it("fills Shipped in, replacing the template placeholder; every other byte unchanged", () => {
    const before = BUILD("<Filled at release: `releases/<unit>/<version>` — the deploy.md that names this intent.>\n");
    const r = fillShippedIn(before, ["releases/gadf/1.5.0"]);
    expect(r.ok && r.value).to.equal(BUILD("- `releases/gadf/1.5.0`\n"));
  });

  it("adds a second release below the first and is idempotent", () => {
    const one = BUILD("- `releases/gadf/1.5.0`\n");
    const two = fillShippedIn(one, ["releases/gadf/1.5.0", "releases/gov-cicd/2.0.0"]);
    expect(two.ok && two.value).to.equal(BUILD("- `releases/gadf/1.5.0`\n- `releases/gov-cicd/2.0.0`\n"));
    const again = fillShippedIn(two.ok ? two.value : "", ["releases/gadf/1.5.0", "releases/gov-cicd/2.0.0"]);
    expect(again.ok && again.value).to.equal(two.ok && two.value);
  });

  it("works when Shipped in is the last section", () => {
    const text = "# B\n\n## Shipped in\n<Filled at release>\n";
    const r = fillShippedIn(text, ["releases/gadf/1.5.0"]);
    expect(r.ok && r.value).to.equal("# B\n\n## Shipped in\n- `releases/gadf/1.5.0`\n");
  });

  it("a build.md with no Shipped in section is refused", () => {
    expect(fillShippedIn("# B\n", ["releases/gadf/1.5.0"]).ok).to.equal(false);
  });
});
