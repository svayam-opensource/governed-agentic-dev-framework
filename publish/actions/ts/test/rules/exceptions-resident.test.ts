// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// GOV-FRM-464 — AN APPROVED EXCEPTION REACHES THE AGENT, AND LEAVES WHEN IT EXPIRES (spec §10.4).
//
// Two halves. The loader reads `policies/exceptions/**` at the DEFAULT branch, judged against the rules read at the
// same ref, and keeps "none", "bad ones" and "could not tell" apart. The resident block lists each one in force
// under the C02 rule it relaxes, one line each with its expiry — and drops it, with nothing else to do, once lapsed.
import { expect } from "chai";
import type { RuleRow, Level } from "../../src/rules/model/rule-row.js";
import type { RuleSet } from "../../src/rules/model/contracts.js";
import type { GitRead } from "../../src/cli/policy-gate-io.js";
import { renderResidentBlock } from "../../src/rules/cues/resident.js";
import { carriesResidentBlock } from "../../src/rules/harness-render.js";
import { loadExceptions, EXCEPTIONS_DIR } from "../../src/rules/exceptions-io.js";
import type { Exception } from "../../src/rules/exceptions.js";

const row = (id: string, level: Level, over: Partial<RuleRow> = {}): RuleRow => ({
  id, source: { doc: "policies/org-policy.md", section: "2.1", sha: "abc1234" },
  expectation: `Everyone does what ${id} asks.`, actor: ["everyone"], level,
  start: { version: "0.1.0", date: "2026-10-06" }, end: null, ...over,
});
const SET: RuleSet = {
  framework: [row("GOV-FRM-012", "C01", { actor: ["agent"], cue: { tier: "resident", text: "C01 MEANS STOP." } })],
  org: [
    row("GOV-SVM-210", "C02", { expectation: "Agents use only approved datastores." }),
    row("GOV-SVM-220", "C02", { expectation: "Agents log to the central sink." }),
    row("GOV-SVM-011", "C01"),
  ],
  orgScope: "SVM", orgVersion: "0.1.0", catalog: { resources: [], tools: [], actions: [] },
};
const ex = (over: Partial<Exception> = {}): Exception => ({
  path: "policies/exceptions/policy/EX-14.md", id: "EX-14", clause: "GOV-SVM-210", expires: "2026-12-31",
  approvedBy: "policy-owner", scope: ["910-GOV-CICD"], why: "redis for the job queue", ...over,
});

describe("exceptions in the resident rules (GOV-FRM-464)", () => {
  it("GOV-FRM-464: lists an in-force exception under the C02 rule it relaxes — one line, with its expiry", () => {
    const out = renderResidentBlock(SET, { exceptions: [ex()], today: "2026-10-06", project: "910-GOV-CICD" }) as string;
    const lines = out.split("\n");
    const at = lines.indexOf("- GOV-SVM-210 · Agents use only approved datastores.");
    expect(at, "the rule it relaxes is named").to.be.greaterThan(-1);
    expect(lines[at + 1]).to.equal(
      "  - EXCEPTION EX-14 permits redis for the job queue in 910-GOV-CICD until 2026-12-31 (approved: policy-owner).");
    expect(carriesResidentBlock(out), "the block still opens with the lead the verifier knows").to.equal(true);
    expect(lines.findIndex((l) => l.startsWith("- GOV-FRM-012")), "rules first, exceptions after").to.be.lessThan(at);
  });

  it("GOV-FRM-464: removes the exception once it has expired — the rule binds again with nothing else to do", () => {
    const before = renderResidentBlock(SET, { exceptions: [ex()], today: "2026-12-31" }) as string;
    const after = renderResidentBlock(SET, { exceptions: [ex()], today: "2027-01-01" }) as string;
    expect(before, "the last day is still in force").to.include("EXCEPTION EX-14");
    expect(after).to.not.include("EX-14").and.not.include("Approved exceptions");
    expect(after).to.equal(renderResidentBlock(SET));
  });

  it("GOV-FRM-464: groups several exceptions under their rules, in rule order, each on its own line", () => {
    const out = renderResidentBlock(SET, {
      exceptions: [ex({ id: "EX-20", clause: "GOV-SVM-220", why: "a local log file", scope: [] }), ex({ id: "EX-15" }), ex()],
      today: "2026-10-06",
    }) as string;
    const tail = out.slice(out.indexOf("**Approved exceptions")).split("\n").filter((l) => l.startsWith("-") || l.startsWith("  -"));
    expect(tail).to.deep.equal([
      "- GOV-SVM-210 · Agents use only approved datastores.",
      "  - EXCEPTION EX-14 permits redis for the job queue in 910-GOV-CICD until 2026-12-31 (approved: policy-owner).",
      "  - EXCEPTION EX-15 permits redis for the job queue in 910-GOV-CICD until 2026-12-31 (approved: policy-owner).",
      "- GOV-SVM-220 · Agents log to the central sink.",
      "  - EXCEPTION EX-20 permits a local log file in this organization until 2026-12-31 (approved: policy-owner).",
    ]);
  });

  it("leaves out an exception scoped to another project, and renders exactly as before with none", () => {
    expect(renderResidentBlock(SET, { exceptions: [ex()], today: "2026-10-06", project: "PRJ-7-billing" }))
      .to.equal(renderResidentBlock(SET));
    expect(renderResidentBlock(SET, { exceptions: [], today: "2026-10-06" })).to.equal(renderResidentBlock(SET));
  });

  it("GOV-FRM-465: fails rather than render an exception that names a framework or C01 rule, even past the loader", () => {
    const out = renderResidentBlock(SET, {
      exceptions: [ex({ id: "EX-1", clause: "GOV-FRM-012" }), ex({ id: "EX-2", clause: "GOV-SVM-011" })], today: "2026-10-06",
    });
    expect(out).to.have.property("error");
    const f = out as { error: string; ids: readonly string[] };
    expect(f.ids).to.deep.equal(["GOV-FRM-012", "GOV-SVM-011"]);
    expect(f.error).to.include("framework rule").and.include("C01 rule");
  });
});

// ── the loader ──────────────────────────────────────────────────────────────────────────────────────────────────

const exceptionFile = (clause: string, id: string) =>
  `---\nid: ${id}\nclause: ${clause}\nexpires: 2026-12-31\napproved_by: policy-owner\nscope: 910-GOV-CICD\nreason: redis\n---\n\n# ${id}\n`;

/** A repository as a map of `<ref>:<path>` → text. `null` answers stand for git failing. */
function fakeGit(tree: Record<string, string | null>, opts: { listFails?: boolean } = {}): GitRead & { calls: string[][] } {
  const calls: string[][] = [];
  const git = ((_repo: string, args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === "ls-tree") {
      if (opts.listFails) return null;
      const ref = args[3]!, dir = args[5]!;
      return Object.keys(tree).filter((k) => k.startsWith(`${ref}:${dir}/`)).map((k) => k.slice(ref.length + 1)).join("\n");
    }
    if (args[0] === "show") return tree[args[1]!] ?? null;
    return null;
  }) as GitRead & { calls: string[][] };
  git.calls = calls;
  return git;
}

describe("exceptions — read at the default branch (GOV-FRM-464)", () => {
  it("GOV-FRM-464: reads every exception at the ref, never the worktree, and keeps the bad ones as problems", () => {
    const git = fakeGit({
      [`main:${EXCEPTIONS_DIR}/policy/EX-14.md`]: exceptionFile("GOV-SVM-210", "EX-14"),
      [`main:${EXCEPTIONS_DIR}/policy/EX-15.md`]: exceptionFile("GOV-FRM-012", "EX-15"),
      [`main:${EXCEPTIONS_DIR}/policy/EX-16.md`]: exceptionFile("GOV-SVM-011", "EX-16"),
      [`main:${EXCEPTIONS_DIR}/README.md`]: "# How to ask for an exception\n",
      [`BRNCH-9-x:${EXCEPTIONS_DIR}/policy/EX-99.md`]: exceptionFile("GOV-SVM-220", "EX-99"),
    });
    const r = loadExceptions(git, "/repo", "main", SET);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.exceptions.map((e) => e.id), "only the C02 one, and nothing from a project branch").to.deep.equal(["EX-14"]);
    expect(r.problems.map((p) => p.path)).to.deep.equal([`${EXCEPTIONS_DIR}/policy/EX-15.md`, `${EXCEPTIONS_DIR}/policy/EX-16.md`]);
    expect(r.problems[0]!.why).to.include("framework rule");
    expect(r.problems[1]!.why).to.include("C01 rule");
    expect(git.calls.every((c) => c[0] === "ls-tree" ? c[3] === "main" : c[1]!.startsWith("main:")), "every read is at the ref").to.equal(true);
  });

  it("no exceptions folder is no exceptions — a state, not a fault", () => {
    const r = loadExceptions(fakeGit({}), "/repo", "main", SET);
    expect(r).to.deep.equal({ ok: true, exceptions: [], problems: [] });
  });

  it("git that cannot answer is 'could not tell', never 'no exceptions'", () => {
    expect(loadExceptions(fakeGit({}, { listFails: true }), "/repo", "main", SET)).to.have.property("ok", false);
    const unreadable = loadExceptions(fakeGit({ [`main:${EXCEPTIONS_DIR}/policy/EX-14.md`]: null }), "/repo", "main", SET);
    expect(unreadable).to.have.property("ok", false);
    expect((unreadable as { reason: string }).reason).to.include("EX-14.md").and.include("could not read");
  });
});
