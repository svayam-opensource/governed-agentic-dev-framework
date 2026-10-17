// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ORGANIZATION'S RUNNER — `ci.runs_on` in policies/governance.yaml (Policy Owner, 2026-10-17).
 *
 * Every workflow gov writes asks for the runner the organization names; absent, it asks for `ubuntu-latest`, as it
 * always did. A value gov cannot use is refused with the key named, never written into a workflow.
 */
import { expect } from "chai";
import yaml from "js-yaml";
import {
  classifyRunsOn, runsOnYaml, withRunsOn, runsOnOf, sameButRunner, runnerFor, DEFAULT_RUNNER, DEFAULT_RUNS_ON,
} from "../../src/config/ci-runner.js";
import { parseGovernance, describeGovernanceChanges, renderGovernance, EMPTY_GOVERNANCE_VALUES } from "../../src/config/governance.js";

const WORKFLOW = `name: x
on: [push]
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo a
  b:
    runs-on: \${{ matrix.os }}
    steps:
      - run: echo b
`;

describe("ci.runs_on — the organization's runner", () => {
  it("absent, null or empty → ubuntu-latest, and not a choice", () => {
    for (const raw of [undefined, null, "", "  "]) expect(classifyRunsOn(raw)).to.deep.equal(DEFAULT_RUNNER);
    expect(DEFAULT_RUNNER.runsOn).to.equal("ubuntu-latest");
  });

  it("one label, or a list of labels", () => {
    expect(classifyRunsOn("ubuntu-24.04")).to.deep.equal({ runsOn: "ubuntu-24.04", chosen: true, problem: null });
    expect(classifyRunsOn(["self-hosted", "linux", "svayam-e2e"])).to.deep.equal({ runsOn: ["self-hosted", "linux", "svayam-e2e"], chosen: true, problem: null });
  });

  it("a bad value is refused, naming the key, and the default applies", () => {
    for (const raw of [42, true, { group: "x" }, [], ["self-hosted", 3], ["a", "a"], "self hosted", "${{ vars.RUNNER }}", "a,b", ["x y"]]) {
      const c = classifyRunsOn(raw);
      expect(c.chosen, JSON.stringify(raw)).to.equal(false);
      expect(c.runsOn).to.equal(DEFAULT_RUNS_ON);
      expect(c.problem, JSON.stringify(raw)).to.match(/^ci\.runs_on: .* — expected one runner label such as ubuntu-latest, or a list such as \[self-hosted, linux\]$/);
    }
  });

  it("renders as valid YAML: a scalar or a flow list", () => {
    expect(runsOnYaml("ubuntu-latest")).to.equal("ubuntu-latest");
    expect(runsOnYaml(["self-hosted", "linux"])).to.equal("[self-hosted, linux]");
    const doc = yaml.load(withRunsOn(WORKFLOW, runsOnYaml(["self-hosted", "linux"]))) as { jobs: Record<string, { "runs-on": unknown }> };
    expect(doc.jobs.a!["runs-on"]).to.deep.equal(["self-hosted", "linux"]);
  });

  it("withRunsOn sets every job's runner, keeps an expression, and is idempotent", () => {
    const out = withRunsOn(WORKFLOW, "[self-hosted, linux]");
    expect(out).to.include("    runs-on: [self-hosted, linux]\n");
    expect(out).to.include("    runs-on: ${{ matrix.os }}\n");
    expect(withRunsOn(out, "[self-hosted, linux]")).to.equal(out);
    expect(withRunsOn(WORKFLOW, "ubuntu-latest")).to.equal(WORKFLOW);
    expect(runsOnOf(out)).to.equal("[self-hosted, linux]");
    expect(runsOnOf("name: x\n")).to.equal(null);
    expect(sameButRunner(out, WORKFLOW)).to.equal(true);
    expect(sameButRunner(out, WORKFLOW.replace("echo a", "echo c"))).to.equal(false);
  });

  it("runnerFor: the organization's choice wins; without one, a workflow keeps the runner it has", () => {
    expect(runnerFor(classifyRunsOn(["self-hosted"]), WORKFLOW)).to.equal("[self-hosted]");
    expect(runnerFor(DEFAULT_RUNNER, withRunsOn(WORKFLOW, "[self-hosted, gpu]"))).to.equal("[self-hosted, gpu]");
    expect(runnerFor(DEFAULT_RUNNER, null)).to.equal("ubuntu-latest");
  });
});

describe("governance.yaml reads ci.runs_on", () => {
  it("block or flow form; absent → the default; no problem either way", () => {
    expect(parseGovernance("ci:\n  runs_on: [self-hosted, linux]\n").ci).to.deep.equal({ runsOn: ["self-hosted", "linux"], chosen: true, problem: null });
    expect(parseGovernance("ci: { runs_on: self-hosted }\n").ci.runsOn).to.equal("self-hosted");
    const none = parseGovernance("governance_posture: soft\n");
    expect(none.ci).to.deep.equal(DEFAULT_RUNNER);
    expect(none.problems).to.deep.equal([]);
  });

  it("a bad value, or a ci that is not a mapping, is a problem naming the key", () => {
    expect(parseGovernance("ci:\n  runs_on: 7\n").problems).to.deep.equal([
      "ci.runs_on: 7 is not a label or a list of labels — expected one runner label such as ubuntu-latest, or a list such as [self-hosted, linux]; gov is using ubuntu-latest",
    ]);
    expect(parseGovernance("ci: self-hosted\n").problems.join("\n")).to.match(/^ci: expected a mapping/m);
    expect(parseGovernance("ci:\n  runner: x\n").problems.join("\n")).to.match(/ci\.runner: gov does not read this key/);
  });

  it("the shipped template documents ci.runs_on and leaves it at the default", () => {
    const text = renderGovernance(EMPTY_GOVERNANCE_VALUES);
    expect(text).to.match(/^# ci:\n# {3}runs_on: \[self-hosted, linux\]$/m);
    expect(parseGovernance(text).ci).to.deep.equal(DEFAULT_RUNNER);
  });

  it("a change to the runner is named in the change summary", () => {
    expect(describeGovernanceChanges("governance_posture: soft\n", "governance_posture: soft\nci:\n  runs_on: [self-hosted, linux]\n"))
      .to.deep.equal(["CI runner (ci.runs_on): ubuntu-latest (the default) → [self-hosted, linux]"]);
  });
});
