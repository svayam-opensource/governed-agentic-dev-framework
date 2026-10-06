// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THREE DEFECTS FROM A SANDBOX RUN (svayam-e2e/prj121-gov PR #5, propose with Gemini), each pinned here:
//
//   1. an on-demand cue on a rule with no check (Q19: nothing can ever show it) — the bot wrote GOV-E2E-001 so;
//   2. two changelog entries for one pull request — a prose-only run bumped to 1.0.2, a later one to 1.1.0, and
//      the 1.0.2 entry was left behind;
//   3. the interview recorded the reply "1" instead of the option it chose.
//
// The model, the channel and the trees are fakes; the engine, the writers and the gate are real.
import { expect } from "chai";
import yaml from "js-yaml";
import { runPropose } from "../../../src/rules/propose/run.js";
import { interviewSection, prCommentChannel, resolveReply, terminalChannel, type InterviewChannel, type PrComment, type PrCommentsPort } from "../../../src/rules/propose/interview.js";
import { checkProposal, parseProposal, CUE_DROP, CUE_RESIDENT, NO_CUE_NOTE, type ProposalQuestion } from "../../../src/rules/propose/parse.js";
import { finishPolicyChange } from "../../../src/rules/propose/write-result.js";
import type { ModelPort } from "../../../src/rules/propose/model-port.js";
import { createIdIssuer, isStoreError, isStoreWarning, loadRuleStoresFrom } from "../../../src/rules/model/store-io.js";
import { parseRuleStore, validateRuleStore, type RuleRow, type Stamp } from "../../../src/rules/model/rule-row.js";
import type { Catalog } from "../../../src/rules/model/catalog.js";
import type { RuleSet } from "../../../src/rules/model/contracts.js";
import { judgePolicyPr, changelogVersions } from "../../../src/rules/policy-pr/gate.js";
import { memTree } from "../../../src/rules/policy-pr/tree.js";
import { policyPrWriter } from "../../../src/rules/policy-pr/write.js";
import { sectionShas } from "../../../src/rules/checks/sections.js";

const DOC = "policies/org-policy.md";
const AT: Stamp = { version: "1.1.0", date: "2026-10-07", pr: 5 };
const CATALOG: Catalog = {
  resources: [{ id: "vcs.code-repo", renderer: "github-actions", events: [{ name: "pull_request", mode: "gate" }] }],
  tools: [{ id: "gov-builtin" }],
  actions: [{ id: "gov-builtin/forbid-forced-push", tool: "gov-builtin" }],
};
const setWith = (org: RuleRow[] = []): RuleSet => ({ framework: [], org, orgScope: "E2E", catalog: CATALOG, orgVersion: "1.0.1" });

/** GOV-E2E-001 exactly as Gemini proposed it on PR #5: C02, everyone, an on-demand cue, NO checks. */
const PR5_ROW = {
  expectation: "Everyone accompanies every change to application behaviour in a code repository with a test.",
  actor: ["everyone"], level: "C02",
  cue: { tier: "on-demand", text: "Add a test with this change." },
};
const CHECK = { on: { resource: "vcs.code-repo", event: "pull_request" }, action: "gov-builtin/forbid-forced-push", on_miss: "fail" };

function fakeModel(replies: object[]): ModelPort & { calls: number } {
  const m = { calls: 0, async complete() { m.calls++; const r = replies.shift(); if (!r) throw new Error("fake model: no more replies"); return JSON.stringify(r); } };
  return m;
}
function scripted(answers: string[]): InterviewChannel & { asked: ProposalQuestion[] } {
  const asked: ProposalQuestion[] = [];
  return { asked, async ask(q) { asked.push(q); const a = answers.shift(); return a === undefined ? { kind: "pending" } : { kind: "answer", text: a }; } };
}
const section = { doc: DOC, section: "3", sha: "abc1234", text: "Every change carries a test.", rows: [], catalog: CATALOG, frameworkRules: [], scope: "E2E" };
const proposal = (row: object) => ({ verdicts: [{ kind: "add", row }], ownership: [], questions: [] });

describe("defect 1 — an on-demand cue with no check can never fire (Q19)", () => {
  it("the store validator WARNS (on-demand-cue-unbound); it is not an error, so the store still loads and builds", () => {
    const r: RuleRow = { id: "GOV-E2E-001", source: { doc: DOC, section: "3", sha: "abc1234" }, ...(PR5_ROW as Pick<RuleRow, "expectation" | "actor" | "level" | "cue">), start: { version: "1.1.0", date: "2026-10-07", pr: 5 }, end: null };
    expect(validateRuleStore([r], { scope: "E2E" }).map((d) => d.kind)).to.deep.equal(["on-demand-cue-unbound"]);
    expect(validateRuleStore([{ ...r, checks: [CHECK as never] }], { scope: "E2E" })).to.deep.equal([]);
    const loaded = loadRuleStoresFrom({ where: "test", read: (rel) => ({ "org-config.yaml": "org_slug: E2E\n", "policies/rules.yaml": yaml.dump([r]), "policies/VERSION": "1.1.0\n" } as Record<string, string>)[rel] });
    expect(loaded.ok).to.equal(true);
    const d = loaded.ok ? loaded.diagnostics.filter((x) => x.kind === "on-demand-cue-unbound") : [];
    expect(d).to.have.length(1);
    expect(isStoreWarning(d[0]!)).to.equal(true);
    expect(isStoreError(d[0]!)).to.equal(false);
  });

  it("PR #5's row: the cue is dropped and the interview says why — no question, nothing for the model to fix", async () => {
    const o = await interviewSection(section, { model: fakeModel([proposal(PR5_ROW)]), channel: scripted([]) });
    expect(o.status).to.equal("done");
    if (o.status !== "done") return;
    expect(o.verdicts[0]!.kind === "add" && o.verdicts[0]!.row).to.not.have.property("cue");
    expect(o.qa.map((x) => x.a)).to.deep.equal([NO_CUE_NOTE]);
    expect(o.qa[0]!.q).to.contain(PR5_ROW.expectation);
  });

  it("through the engine: the row is written WITHOUT the cue, and the note rides on the row and into the changelog's interview", async () => {
    const head = `# Org policy\n\n## 3 Testing\n\nEvery change carries a test.\n`;
    const r = await runPropose({ docs: [{ doc: DOC, head, base: null }], set: setWith(), model: fakeModel([proposal(PR5_ROW)]), channel: scripted([]), issuer: createIdIssuer([]), at: AT });
    expect(r.status).to.equal("ready");
    if (r.status !== "ready") return;
    expect(r.rows[0]).to.not.have.property("cue");
    expect(r.rows[0]!.qa).to.deep.equal([{ q: r.rows[0]!.qa![0]!.q, a: NO_CUE_NOTE }]);
    expect(r.changelogDraft.qa.map((x) => x.a)).to.deep.equal([NO_CUE_NOTE]);
    expect(validateRuleStore(r.rows, { scope: "E2E" })).to.deep.equal([]);
  });

  it("a C01 rule binding agents is OFFERED a resident cue instead; the owner's choice is applied by gov", async () => {
    const c01 = { ...PR5_ROW, level: "C01", actor: ["agent"] };
    const yes = scripted(["1"]);
    const o = await interviewSection(section, { model: fakeModel([proposal(c01), proposal(c01)]), channel: terminalChannel(async () => "1") });
    expect(o.status).to.equal("done");
    expect(o.status === "done" && o.verdicts[0]!.kind === "add" && o.verdicts[0]!.row.cue).to.deep.equal({ tier: "resident", text: PR5_ROW.cue.text });
    expect(o.qa[0]!.a, "the option's text, not its number").to.equal(CUE_RESIDENT);

    const o2 = await interviewSection(section, { model: fakeModel([proposal(c01), proposal(c01)]), channel: yes });
    expect(yes.asked.map((q) => [q.kind, q.options])).to.deep.equal([["cue-tier", [CUE_RESIDENT, CUE_DROP]]]);
    expect(o2.status === "done" && o2.verdicts[0]!.kind === "add" && o2.verdicts[0]!.row.cue?.tier).to.equal("resident");

    const no = await interviewSection(section, { model: fakeModel([proposal(c01), proposal(c01)]), channel: scripted([CUE_DROP]) });
    expect(no.status === "done" && no.verdicts[0]!.kind === "add" && no.verdicts[0]!.row).to.not.have.property("cue");
  });

  it("the resident offer is only for C01 rules binding agents: C01 binding only humans loses the cue, with the note", () => {
    const human = { ...PR5_ROW, level: "C01", actor: ["human"] };
    const c = checkProposal(parseProposal(JSON.stringify(proposal(human))), { ...section, sha: "abc1234", rows: [], answered: new Set() });
    expect(c.questions).to.deep.equal([]);
    expect(c.problems).to.deep.equal([]);
    expect(c.notes.map((n) => n.a)).to.deep.equal([NO_CUE_NOTE]);
    expect(c.verdicts[0]!.kind === "add" && c.verdicts[0]!.row).to.not.have.property("cue");
  });

  it("an on-demand cue WITH a check is untouched", () => {
    const bound = { ...PR5_ROW, checks: [CHECK] };
    const c = checkProposal(parseProposal(JSON.stringify(proposal(bound))), { ...section, rows: [], answered: new Set() });
    expect(c).to.deep.include({ problems: [], questions: [], notes: [] });
    expect(c.verdicts[0]!.kind === "add" && c.verdicts[0]!.row.cue?.tier).to.equal("on-demand");
  });
});

describe("defect 3 — the interview records the answer's TEXT", () => {
  const OPTS = ["draft a new check for the Check Owner to review", "leave it unchecked"];
  it("a number, an option's text, or a number with more words", () => {
    expect(resolveReply("1", OPTS)).to.equal(OPTS[0]);
    expect(resolveReply(" 2. ", OPTS)).to.equal(OPTS[1]);
    expect(resolveReply("Leave it unchecked.", OPTS)).to.equal(OPTS[1]);
    expect(resolveReply("1. draft a new check for the Check Owner to review", OPTS)).to.equal(OPTS[0]);
    expect(resolveReply("1 — and make it warn first", OPTS), "the raw reply adds something, so it is kept").to.equal(`${OPTS[0]} — and make it warn first`);
    expect(resolveReply("9", OPTS), "no such option: the reply as given").to.equal("9");
    expect(resolveReply("something else entirely", OPTS)).to.equal("something else entirely");
    expect(resolveReply("1", undefined)).to.equal("1");
  });

  it("on the pull request: the owner replies \"1\" (PR #5) and the interview, the row and the changelog say what 1 was", async () => {
    const BOT = "gov-bot";
    const comments: PrComment[] = [];
    const pr: PrCommentsPort = {
      self: BOT,
      async list() { return [...comments]; },
      async post(body) { const id = `c${comments.length + 1}`; comments.push({ id, author: BOT, body, createdAt: `2026-10-07T00:00:0${comments.length}Z` }); return id; },
    };
    const q = { id: "q1", kind: "uncheckable", text: "Draft a new check for this rule, or leave it unchecked?", options: OPTS };
    const head = `# Org policy\n\n## 3 Testing\n\nEvery change carries a test.\n`;
    const first = await runPropose({ docs: [{ doc: DOC, head, base: null }], set: setWith(), model: fakeModel([{ verdicts: [], ownership: [], questions: [q] }]), channel: prCommentChannel(pr), issuer: createIdIssuer([]), at: AT });
    expect(first.status).to.equal("blocked");
    comments.push({ id: "r1", author: "polly", body: "1", inReplyTo: comments[0]!.id, createdAt: "2026-10-07T01:00:00Z" });
    const second = await runPropose({ docs: [{ doc: DOC, head, base: null }], set: setWith(), model: fakeModel([proposal({ ...PR5_ROW, cue: undefined })]), channel: prCommentChannel(pr), issuer: createIdIssuer([]), at: AT });
    expect(second.status).to.equal("ready");
    expect(second.status === "ready" && second.rows[0]!.qa).to.deep.equal([{ q: q.text, a: OPTS[0] }]);
  });
});

// ── defect 2: one pull request, one changelog entry ─────────────────────────────────────────────────────────
const OLD = "# Org policy\n\n## 3 Testing\n\nChanges should be tested.\n";
const NEW = "# Org policy\n\n## 3 Testing\n\nEvery change to application behaviour carries a test.\n";
const SHA = sectionShas(NEW).get("3")!;
const BASE_LOG = "# Policy changelog\n\nNewest first.\n\n## 1.0.1 — 2026-10-01\n\n| Pull request | Author | Approver |\n|---|---|---|\n| #3 | @alice | @polly |\n\n_No rule changed — prose only._\n";
const baseFiles = (): Record<string, string> => ({
  "org-config.yaml": "org_slug: \"E2E\"\n",
  [DOC]: OLD,
  "policies/VERSION": "1.0.1\n",
  "policies/rules.yaml": "[]\n",
  "policies/ownership.yaml": "[]\n",
  "policies/CHANGELOG.md": BASE_LOG,
  "policies/history/1.0.0/org-policy.md": "# Org policy, as it was\n",
});
const E2E_ROW: RuleRow = {
  id: "GOV-E2E-001", source: { doc: DOC, section: "3", sha: SHA }, expectation: PR5_ROW.expectation, actor: ["everyone"], level: "C02",
  start: { version: "1.1.0", date: "2026-10-07", pr: 5 }, end: null,
};
const finish = (files: Record<string, string>, reviewed: "no-rule" | "rules") => finishPolicyChange({
  base: memTree(baseFiles()), head: memTree(files), pr: 5, today: "2026-10-07", author: "alice",
  reviewed: [{ doc: DOC, section: "3", sha: SHA, outcome: reviewed === "no-rule" ? { kind: "no-rule" } : { kind: "rules", rules: [{ id: "GOV-E2E-001", change: "added" }] } }],
});
const judge = (files: Record<string, string>) => judgePolicyPr({ base: memTree(baseFiles()), head: memTree(files), pr: 5, today: "2026-10-07" });
const added = (files: Record<string, string>) => changelogVersions(files["policies/CHANGELOG.md"]!).filter((v) => !changelogVersions(BASE_LOG).includes(v));

/** PR #5 after its FIRST bot run: prose only → 1.0.2, a snapshot of 1.0.1, a prose-only entry. */
function afterProseRun(): Record<string, string> {
  const files = { ...baseFiles(), [DOC]: NEW };
  expect(finish(files, "no-rule").ok).to.equal(true);
  expect(files["policies/VERSION"]).to.equal("1.0.2\n");
  expect(files["policies/CHANGELOG.md"]).to.contain("## 1.0.2").and.contain("_No rule changed — prose only._");
  return files;
}

describe("defect 2 — one changelog entry, and one version jump, per pull request", () => {
  it("PR #5: prose-only to 1.0.2, then rules → ONE entry, 1.1.0, from the base; the gate passes", () => {
    const files = afterProseRun();
    files["policies/rules.yaml"] = yaml.dump([E2E_ROW]);
    const fin = finish(files, "rules");
    expect(fin.ok, fin.lines.join("\n")).to.equal(true);
    expect(files["policies/VERSION"]).to.equal("1.1.0\n");
    expect(added(files)).to.deep.equal(["1.1.0"]);
    expect(files["policies/CHANGELOG.md"]).to.not.contain("## 1.0.2");
    expect(files["policies/CHANGELOG.md"]).to.not.contain("prose only._\n\n## 1.0.1");
    expect(files["policies/CHANGELOG.md"]).to.contain("GOV-E2E-001").and.contain("## 1.0.1 — 2026-10-01");
    expect(fin.lines.join("\n")).to.contain("earlier entry 1.0.2 replaced by 1.1.0");
    expect([...new Set(Object.keys(files).filter((f) => f.startsWith("policies/history/")).map((f) => f.split("/")[2]))].sort(), "one snapshot: of the base").to.deep.equal(["1.0.0", "1.0.1"]);
    const j = judge(files);
    expect(j.findings, j.findings.map((f) => f.message).join("\n")).to.deep.equal([]);
    expect(j.verdict).to.equal("pass");
  });

  it("the gate: PR #5's head as the bot left it — entries 1.1.0 AND 1.0.2 — is an error; a re-run repairs it", () => {
    const files = afterProseRun();
    const prose = files["policies/CHANGELOG.md"]!;
    files["policies/rules.yaml"] = yaml.dump([E2E_ROW]);
    finish(files, "rules");
    // What the old writers left: the 1.1.0 entry inserted above the 1.0.2 one.
    const entry110 = files["policies/CHANGELOG.md"]!.slice(files["policies/CHANGELOG.md"]!.indexOf("## 1.1.0"), files["policies/CHANGELOG.md"]!.indexOf("## 1.0.1"));
    files["policies/CHANGELOG.md"] = prose.replace("## 1.0.2", `${entry110}## 1.0.2`);
    expect(added(files)).to.deep.equal(["1.1.0", "1.0.2"]);
    expect(judge(files).findings.filter((f) => f.check === "changelog").map((f) => f.message)).to.deep.equal([
      "policies/CHANGELOG.md gains 2 entries (1.1.0, 1.0.2); a pull request adds exactly one, for 1.1.0 — run gov rules propose, which keeps that one and removes the others it wrote",
    ]);
    expect(finish(files, "rules").wrote).to.include("policies/CHANGELOG.md");
    expect(added(files)).to.deep.equal(["1.1.0"]);
    expect(judge(files).verdict).to.equal("pass");
  });

  it("never touches another pull request's entry, nor this pull request's APPROVED one", () => {
    const files = afterProseRun();
    files["policies/CHANGELOG.md"] = files["policies/CHANGELOG.md"]!.replace("| #5 | @alice | _pending_ |", "| #5 | @alice | @polly |");
    files["policies/rules.yaml"] = yaml.dump([E2E_ROW]);
    finish(files, "rules");
    expect(added(files), "approved: kept — the gate then says so").to.deep.equal(["1.1.0", "1.0.2"]);
    expect(judge(files).findings.some((f) => f.check === "changelog" && f.message.includes("gains 2 entries"))).to.equal(true);

    const other = afterProseRun();
    other["policies/CHANGELOG.md"] = other["policies/CHANGELOG.md"]!.replace("| #5 |", "| #6 |");
    other["policies/rules.yaml"] = yaml.dump([E2E_ROW]);
    finish(other, "rules");
    expect(other["policies/CHANGELOG.md"], "#6's entry is not this PR's to remove").to.contain("## 1.0.2");
    expect(changelogVersions(other["policies/CHANGELOG.md"]!)).to.include("1.0.1");
  });

  it("an intermediate snapshot this branch froze for another base version is removed; the base's own are kept", () => {
    const files = { ...baseFiles(), [DOC]: NEW, "policies/history/0.9.0/org-policy.md": "# frozen by an earlier run of this PR\n" };
    const w = policyPrWriter({ base: memTree(baseFiles()), head: memTree(files) });
    const r = w.writeSnapshot("1.0.1");
    expect(r.wrote).to.equal(true);
    expect(r.detail).to.contain("policies/history/0.9.0/");
    expect(files).to.not.have.property("policies/history/0.9.0/org-policy.md");
    expect(files["policies/history/1.0.0/org-policy.md"], "in the base: frozen, never touched").to.equal("# Org policy, as it was\n");
    expect(files["policies/history/1.0.1/org-policy.md"]).to.equal(OLD);
  });

  it("the rows are re-stamped at the recomputed version", () => {
    const files = afterProseRun();
    files["policies/rules.yaml"] = yaml.dump([{ ...E2E_ROW, start: { version: "1.0.2", date: "2026-10-07", pr: 5 } }]);
    finish(files, "rules");
    expect(parseRuleStore(files["policies/rules.yaml"]!)[0]!.start).to.deep.equal({ version: "1.1.0", date: "2026-10-07", pr: 5 });
  });
});
