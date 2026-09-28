// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A CHECK CALLED BY NOTHING IS NOT A CHECK (PRJ-121, defect 3, 2026-09-28).
 *
 * `render-harness.mjs --check` was written, documented in the script's own usage block, and invoked by no
 * workflow, no test and no hook. So editing `agent/session-protocol.md` or a policy's `gov:cue` block and
 * forgetting to re-render passed everything this repository has — and the nine harness files, the only thing
 * that puts governance in an agent's context, drifted from their source with every gate green.
 *
 * Wiring it into `.github/workflows/node-ci.yml` fixes the instance. This file is what stops the class:
 * three npm scripts whose whole value is being RUN, asserted against the workflow that runs them, in the same
 * spirit as the test that ties `ROOT_HARNESS_FILES` to the manifest. Deleting the job now fails here, loudly,
 * instead of quietly restoring the defect.
 *
 * Parsed as TEXT, not as YAML. Adding a YAML parser to this package's dependencies to read a CI file would be
 * a new dependency for a test, and what is being asserted is that a command APPEARS in a workflow that runs on
 * pull requests — a question about strings.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const workflowDir = path.join(repoRoot, ".github", "workflows");

/** Every workflow that runs on a pull request — the only place a merge gate can live. */
function prWorkflows(): { name: string; text: string }[] {
  return fs.readdirSync(workflowDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(workflowDir, f), "utf8") }))
    .filter((w) => /^\s*pull_request:?\s*$/m.test(w.text));
}

describe("CI — the checks that keep generated files honest are actually invoked", () => {
  it("there IS a workflow that runs on pull requests", () => {
    expect(prWorkflows().map((w) => w.name)).to.include("node-ci.yml");
  });

  /**
   * THE HARNESS GATE. Without this the nine files an agent reads can say anything, and the drift is invisible
   * until somebody diffs by hand — which is how it was found.
   */
  it("`render-harness:check` runs on a pull request", () => {
    const wired = prWorkflows().filter((w) => w.text.includes("render-harness:check"));
    expect(wired.map((w) => w.name), "no PR workflow runs it — the defect is back").to.not.be.empty;
  });

  it("`docs:cli:check` runs on a pull request", () => {
    const wired = prWorkflows().filter((w) => w.text.includes("docs:cli:check"));
    expect(wired.map((w) => w.name)).to.not.be.empty;
  });

  it("`harness:freshness` is invoked, and on the PR it is marked as unable to fail the build", () => {
    // ADVISORY BY CONSTRUCTION — the script exits 0 whatever it finds, because a vendor renaming a context
    // file between releases is news, not a broken build. It is asserted as "invoked", never as "gating": on a
    // PR it needs the network, and `continue-on-error` is what stops a green tick here being read as a
    // verified vendor path. Hardening it into a real gate would redden pull requests on a registry hiccup.
    const all = fs.readdirSync(workflowDir).map((f) => fs.readFileSync(path.join(workflowDir, f), "utf8"));
    expect(all.some((t) => t.includes("harness:freshness")), "nothing asks the vendors any more").to.equal(true);
    for (const w of prWorkflows().filter((x) => x.text.includes("harness:freshness"))) {
      expect(w.text, `${w.name} runs it on a PR, so it must say it cannot fail the build`)
        .to.contain("continue-on-error: true");
    }
  });

  /** Each failure must name the command to run locally, or the gate costs more time than it saves. */
  it("every gate names the local command that fixes it", () => {
    const ci = fs.readFileSync(path.join(workflowDir, "node-ci.yml"), "utf8");
    expect(ci, "re-render the harness").to.contain("npm run render-harness");
    expect(ci, "regenerate the CLI reference").to.contain("npm run docs:cli");
  });

  /**
   * A PUSH PATH FILTER THAT EXCLUDES THE SOURCES IS THE SAME DEFECT IN A DIFFERENT PLACE. `pull_request` in
   * this workflow is deliberately unfiltered, so the gate always runs on a PR; the `push` filter must still
   * cover the trees the generated files are rendered FROM, or a direct push to `dev` that edits only the
   * protocol skips the one job that would have noticed.
   */
  it("the push filter covers what the generated files are rendered from", () => {
    const ci = fs.readFileSync(path.join(workflowDir, "node-ci.yml"), "utf8");
    for (const tree of ['"agent/**"', '"publish/content/**"']) {
      expect(ci, `${tree} is a source of a generated file this workflow checks`).to.contain(tree);
    }
  });

  /**
   * `render-harness.mjs` runs through tsx, from the ROOT manifest. tsx was in the root tree only because
   * `packages/*` happen to depend on it — a required gate whose tool no manifest declares is a gate that
   * disappears the day a workspace is dropped, with nothing failing. That is this whole ticket's shape.
   */
  it("the root manifest declares the tools its checked scripts need", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>; devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["render-harness:check"], "the script CI calls").to.be.a("string");
    expect(pkg.devDependencies).to.have.property("tsx");
    expect(pkg.devDependencies).to.have.property("js-yaml");
  });
});
