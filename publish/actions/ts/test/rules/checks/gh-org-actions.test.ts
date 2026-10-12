// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// ORG `gh-action` CHECK ACTIONS RUN IN CI ONLY (PRJ-121 intent 05, Item 8 part 2; Policy Owner ruling Q9).
//
// The renderer emits a `uses:` step for each org gh-action a job's rule binds, from the DEFAULT branch's copy of
// `policies/actions/<name>/` (never the checkout under review — Q8); the step's outcome is handed to
// `gov check run`, so the verdict goes through the one fold (on_miss applies) and the job's conclusion IS the
// verdict. Locally there is no step: `gov check run` says cannot-tell "runs in CI only".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "chai";
import { parseCatalog, type Catalog, type CheckBinding } from "../../../src/rules/model/catalog.js";
import type { RuleRow } from "../../../src/rules/model/rule-row.js";
import type { EventContext, RuleSet } from "../../../src/rules/model/contracts.js";
import { createCheckRunner } from "../../../src/rules/checks/runner.js";
import { renderWorkflow } from "../../../src/rules/checks/render-github.js";
import { GH_ACTION_OUTCOMES_ENV, ghActionKey, isOrgGhAction } from "../../../src/rules/checks/gh-org-actions.js";

const here = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = parseCatalog(readFileSync(resolve(here, "../../../../../content/framework/rules/catalog.yaml"), "utf8"));
const CATALOG: Catalog = { ...FRAMEWORK, actions: [...FRAMEWORK.actions, { id: "gh-action/spdx", tool: "gh-action" }] };

const bind = (resource: string, event: string, action: string, w: Record<string, unknown> = {}, on_miss: "fail" | "warn" = "fail"): CheckBinding =>
  ({ on: { resource, event }, action, with: w, on_miss });
const row = (id: string, checks: CheckBinding[]): RuleRow => ({
  id, source: { doc: "policies/org-policy.md", section: "3.1", sha: "a1b2c3" }, expectation: "Every file carries an SPDX header.",
  actor: ["everyone"], level: "C02", checks, start: { version: "1.0.0", date: "2026-10-06" }, end: null,
});
const rules = (checks: CheckBinding[]): RuleSet => ({ framework: [], org: [row("GOV-SVM-060", checks)], orgScope: "SVM", catalog: CATALOG, orgVersion: "1.0.0" });
const PR: EventContext = { resource: "vcs.code-repo", event: "pull_request", payload: { changed: [] } };
const readDefault = (): string | null => null;
const SPDX = bind("vcs.code-repo", "pull_request", "gh-action/spdx", { license: "MIT", strict: true });

describe("org gh-action — which actions are the org's", () => {
  it("gh-action/<name> is the org's, except the framework's own landed-by-pr (run inside gov)", () => {
    expect(isOrgGhAction("gh-action/spdx")).to.equal(true);
    expect(isOrgGhAction("gh-action/landed-by-pr")).to.equal(false);
    expect(isOrgGhAction("bash/lint")).to.equal(false);
  });
});

describe("org gh-action — gov check run", () => {
  it("locally (no step ran it) → cannot-tell \"runs in CI only\", never a pass", () => {
    const v = createCheckRunner({ rules: rules([SPDX]), readDefault }).run("GOV-SVM-060", PR);
    expect(v.verdict).to.equal("cannot-tell");
    expect(v.findings.join()).to.match(/runs in CI only/);
  });

  it("in CI: the step's outcome is the verdict — success passes, failure fails under on_miss: fail", () => {
    const key = ghActionKey(SPDX);
    const pass = createCheckRunner({ rules: rules([SPDX]), readDefault, ghActionOutcomes: { [key]: "success" } }).run("GOV-SVM-060", PR);
    expect(pass.verdict).to.equal("pass");
    const fail = createCheckRunner({ rules: rules([SPDX]), readDefault, ghActionOutcomes: { [key]: "failure" } }).run("GOV-SVM-060", PR);
    expect(fail.verdict).to.equal("fail");
    expect(fail.findings.join()).to.match(/GOV-SVM-060 \[gh-action\/spdx\]: the action's step failed/);
  });

  it("failure under on_miss: warn → pass with a warn: finding (the same fold as any action)", () => {
    const warn = bind("vcs.code-repo", "pull_request", "gh-action/spdx", { license: "MIT", strict: true }, "warn");
    const v = createCheckRunner({ rules: rules([warn]), readDefault, ghActionOutcomes: { [ghActionKey(warn)]: "failure" } }).run("GOV-SVM-060", PR);
    expect(v.verdict).to.equal("pass");
    expect(v.findings[0]).to.match(/^warn: /);
  });

  it("skipped, cancelled or an unknown outcome → cannot-tell", () => {
    for (const o of ["skipped", "cancelled", "", "weird"]) {
      const v = createCheckRunner({ rules: rules([SPDX]), readDefault, ghActionOutcomes: { [ghActionKey(SPDX)]: o } }).run("GOV-SVM-060", PR);
      expect(v.verdict, o).to.equal("cannot-tell");
    }
  });
});

describe("org gh-action — the rendered workflow", () => {
  const LANDED = bind("vcs.code-repo", "push", "gh-action/landed-by-pr");

  it("a gov repo job: checks out the DEFAULT branch's actions apart, runs the action's step, hands its outcome to gov check run", () => {
    const [f] = renderWorkflow([{ id: "GOV-SVM-060", check: { ...SPDX, on: { resource: "vcs.gov-repo", event: "pull_request" } } }], { defaultBranch: "main" });
    const key = ghActionKey(SPDX);
    expect(f!.text).to.contain([
      "      - name: Check out the default branch's check actions (never the change under review)",
      "        uses: actions/checkout@v4",
      "        with:",
      "          ref: main",
      "          path: .gov-actions",
      "          persist-credentials: false",
      "      - name: gh-action/spdx",
      "        id: gov_action_0",
      "        continue-on-error: true",
      "        uses: ./.gov-actions/policies/actions/spdx",
      "        with:",
      '          license: "MIT"',
      '          strict: "true"',
    ].join("\n"));
    expect(f!.text).to.contain([
      "      - name: gov check run GOV-SVM-060",
      "        env:",
      `          ${GH_ACTION_OUTCOMES_ENV}: '{${JSON.stringify(key)}:"\${{ steps.gov_action_0.outcome }}"}'`,
      "        run: gov check run GOV-SVM-060 --resource vcs.gov-repo --event pull_request --gov-home .",
    ].join("\n"));
  });

  it("a code repo job: the action comes from the governance repo checked out at .gov (its default branch)", () => {
    const [f] = renderWorkflow([{ id: "GOV-SVM-060", check: SPDX }], { defaultBranch: "dev", govCheckout: { repository: "acme/acme-gov" } });
    expect(f!.text).to.contain("        uses: ./.gov/policies/actions/spdx");
    expect(f!.text).to.not.contain(".gov-actions");
  });

  it("the framework's landed-by-pr and every other action render exactly as before — no step, no env", () => {
    const [f] = renderWorkflow([{ id: "GOV-FRM-040", check: LANDED }], { defaultBranch: "main" });
    expect(f!.text).to.not.contain("uses: ./");
    expect(f!.text).to.not.contain(GH_ACTION_OUTCOMES_ENV);
  });

  it("byte-stable: the same bindings in any order render the same bytes", () => {
    const other = bind("vcs.code-repo", "pull_request", "gh-action/spdx", { license: "Apache-2.0" });
    const a = renderWorkflow([{ id: "GOV-SVM-060", check: SPDX }, { id: "GOV-SVM-060", check: other }], { defaultBranch: "main" });
    const b = renderWorkflow([{ id: "GOV-SVM-060", check: other }, { id: "GOV-SVM-060", check: SPDX }], { defaultBranch: "main" });
    expect(a).to.deep.equal(b);
    expect(a[0]!.text).to.contain("gov_action_1");
  });
});
