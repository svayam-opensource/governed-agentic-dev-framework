// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// W4 — THE PROPOSE ENGINE (rule-model-design.md Q2, Q9, Q10, Q16–Q18, W2-Q2, W2-Q8). A FAKE model replays recorded
// JSON; the engine around it is real: parsing, checking, the interview, applyVerdicts with gov's issuer.
import { expect } from "chai";
import { runPropose, createProposer, type PolicyDoc } from "../../../src/rules/propose/run.js";
import { interviewSection, terminalChannel, prCommentChannel, type InterviewChannel, type PrComment, type PrCommentsPort } from "../../../src/rules/propose/interview.js";
import { parseProposal, ProposeError, type ProposalQuestion } from "../../../src/rules/propose/parse.js";
import { buildProposalRequest, SYSTEM_PROMPT } from "../../../src/rules/propose/prompt.js";
import type { ModelPort, ModelRequest } from "../../../src/rules/propose/model-port.js";
import { createIdIssuer, everIssuedIds } from "../../../src/rules/model/store-io.js";
import { validateRuleStore, inForce, type RuleRow, type Stamp } from "../../../src/rules/model/rule-row.js";
import type { Catalog } from "../../../src/rules/model/catalog.js";
import type { RuleSet } from "../../../src/rules/model/contracts.js";
import { policySections, sectionShas } from "../../../src/rules/checks/sections.js";

const DOC = "policies/org-policy.md";
const AT: Stamp = { version: "1.5.0", date: "2026-10-06", pr: 91 };

const CATALOG: Catalog = {
  resources: [{ id: "vcs.code-repo", renderer: "github-actions", events: [{ name: "pull_request", mode: "gate" }, { name: "push", mode: "observe" }] }],
  tools: [{ id: "gov-builtin" }],
  actions: [{ id: "gov-builtin/list-membership", tool: "gov-builtin", params: { list: { type: "string" } } }, { id: "gov-builtin/forbid-forced-push", tool: "gov-builtin" }],
};

const FW: RuleRow = {
  id: "GOV-FRM-466", source: { doc: "framework/docs/specs/framework-specification.md", section: "5.5", sha: "fff0000" },
  expectation: "No one force-pushes a branch others work on.", actor: ["gov-client", "everyone"], level: "C01",
  start: { version: "2.0.0", date: "2026-10-01" }, end: null,
};

const POLICY = (s3: string, extra = "") => `# Org policy

Intro text.

## 3 Technology

${s3}

## 4 Data

Section 4 is owned by the Data Owner.
${extra}`;

const shaOf = (text: string, section: string): string => sectionShas(text).get(section)!;

const row = (id: string, over: Partial<RuleRow> = {}): RuleRow => ({
  id, source: { doc: DOC, section: "3", sha: "0ld0000" }, expectation: `Rule ${id}.`, actor: ["everyone"], level: "C02",
  start: { version: "1.4.0", date: "2026-10-01", pr: 80 }, end: null, ...over,
});

const setWith = (org: RuleRow[], over: Partial<RuleSet> = {}): RuleSet => ({
  framework: [FW], org, orgScope: "SVM", catalog: CATALOG, orgVersion: "1.4.0", ...over,
});

/** Replays recorded replies in order and keeps every request it was sent. */
function fakeModel(replies: (string | object)[]): ModelPort & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async complete(req) {
      requests.push(req);
      const r = replies.shift();
      if (r === undefined) throw new Error("fake model: no more recorded replies");
      return typeof r === "string" ? r : JSON.stringify(r);
    },
  };
}

/** Answers from a script; records what was asked. */
function scripted(answers: string[]): InterviewChannel & { asked: ProposalQuestion[] } {
  const asked: ProposalQuestion[] = [];
  return {
    asked,
    async ask(q) {
      asked.push(q);
      const a = answers.shift();
      return a === undefined ? { kind: "pending" } : { kind: "answer", text: a };
    },
  };
}

const ADD = (expectation: string, level = "C02", extra: object = {}) => ({ kind: "add", row: { expectation, actor: ["everyone"], level, ...extra } });

describe("rule model — W4 propose engine", () => {
  const text = POLICY("Everyone must use only technologies on the approved list unless the Policy Owner approves an exception.");
  const docs: PolicyDoc[] = [{ doc: DOC, head: text, base: null }];

  it("clear prose → zero questions; the new rule's id comes from gov's issuer; bump minor", async () => {
    const model = fakeModel([
      { verdicts: [ADD("Everyone uses only technologies on the approved list.")], ownership: [], questions: [] },
      { verdicts: [], ownership: [{ section: "4", role: "Data Owner" }], questions: [] },
    ]);
    const ch = scripted([]);
    const r = await runPropose({ docs, set: setWith([]), model, channel: ch, issuer: createIdIssuer([]), at: AT });
    expect(ch.asked).to.deep.equal([]);
    expect(r.status).to.equal("ready");
    if (r.status !== "ready") return;
    expect(r.rows).to.have.length(1);
    expect(r.rows[0]).to.deep.include({ id: "GOV-SVM-001", level: "C02", start: AT, end: null });
    expect(r.rows[0]!.source).to.deep.equal({ doc: DOC, section: "3", sha: shaOf(text, "3") });
    expect(r.rows[0]!.qa, "no interview, no Q&A").to.equal(undefined);
    expect(r.changelogDraft.rules).to.deep.equal([{ id: "GOV-SVM-001", change: "added", expectation: "Everyone uses only technologies on the approved list." }]);
    expect(r.bump).to.equal("minor");
    expect(validateRuleStore(r.rows, { scope: "SVM" })).to.deep.equal([]);
  });

  it("ownership prose → ownership rows (W2-Q8)", async () => {
    const model = fakeModel([
      { verdicts: [ADD("Everyone uses only approved technologies.")], ownership: [], questions: [] },
      { verdicts: [], ownership: [{ section: "4", role: "Data Owner" }], questions: [] },
    ]);
    const r = await runPropose({ docs, set: setWith([], { roles: { "Policy Owner": "po", "Data Owner": "do" } }), model, channel: scripted([]), issuer: createIdIssuer([]), at: AT });
    expect(r.status === "ready" && r.ownership).to.deep.equal([{ doc: DOC, section: "4", role: "Data Owner", sha: shaOf(text, "4") }]);
  });

  describe("ownership carries the sha of the section its SENTENCE is written in", () => {
    const owned = (sha: string) => ({ doc: DOC, section: "4", role: "Data Owner", sha });
    const roles = { "Policy Owner": "po", "Data Owner": "do" };

    it("a sentence in §3 granting §4 records §3's sha, not §4's", async () => {
      const head = POLICY("Everyone uses approved tech. Section 4 is owned by the Data Owner.").replace("Section 4 is owned by the Data Owner.\n", "");
      const model = fakeModel([
        { verdicts: [ADD("Everyone uses approved tech.")], ownership: [{ section: "4", role: "Data Owner" }], questions: [] },
        { verdicts: [], ownership: [], questions: [] },
      ]);
      const r = await runPropose({ docs: [{ doc: DOC, head, base: null }], set: setWith([], { roles }), model, channel: scripted([]), issuer: createIdIssuer([]), at: AT });
      expect(r.status === "ready" && r.ownership).to.deep.equal([owned(shaOf(head, "3"))]);
    });

    it("the granting sentence deleted → the ownership row is removed, and that is an ownership change (minor)", async () => {
      const base = POLICY("Tech.");
      const head = base.replace("Section 4 is owned by the Data Owner.", "Data is kept for a year.");
      const model = fakeModel([{ verdicts: [], ownership: [], questions: [] }]);
      const r = await runPropose({ docs: [{ doc: DOC, head, base }], set: setWith([], { roles, ownership: [owned(shaOf(base, "4"))] }), model, channel: scripted([]), issuer: createIdIssuer([]), at: AT });
      expect(r.status).to.equal("ready");
      if (r.status !== "ready") return;
      expect(r.ownership).to.deep.equal([]);
      expect(r.bump).to.equal("minor");
    });

    it("the granting section deleted outright → the row is removed without asking the model", async () => {
      const base = POLICY("Tech.");
      const head = base.replace(/## 4 Data[\s\S]*$/, "");
      const set = setWith([row("GOV-SVM-001", { source: { doc: DOC, section: "3", sha: shaOf(head, "3") } })], { roles, ownership: [owned(shaOf(base, "4"))] });
      const model = fakeModel([]);
      const r = await runPropose({ docs: [{ doc: DOC, head, base }], set, model, channel: scripted([]), issuer: createIdIssuer([]), at: AT });
      expect(model.requests).to.have.length(0);
      expect(r.status === "ready" && r.ownership).to.deep.equal([]);
    });

    it("the granting section reworded, sentence kept → re-extracted at the new sha; not an ownership change (patch)", async () => {
      const base = POLICY("Tech.");
      const head = base.replace("Section 4 is owned by the Data Owner.", "Section 4 is owned by the Data Owner. Data is kept a year.");
      const model = fakeModel([{ verdicts: [], ownership: [{ section: "4", role: "Data Owner" }], questions: [] }]);
      const r = await runPropose({ docs: [{ doc: DOC, head, base }], set: setWith([], { roles, ownership: [owned(shaOf(base, "4"))] }), model, channel: scripted([]), issuer: createIdIssuer([]), at: AT });
      expect(r.status === "ready" && r.ownership).to.deep.equal([owned(shaOf(head, "4"))]);
      expect(r.status === "ready" && r.bump).to.equal("patch");
    });

    it("a new ownership row (prose otherwise unchanged in meaning) is an ownership change → minor (the gate plans the same: see policy-pr.test.ts)", async () => {
      const base = POLICY("Tech.");
      const head = base.replace("Section 4 is owned by the Data Owner.", "Section 4 is owned by the Data Owner. Section 3 is owned by the Data Owner.");
      const model = fakeModel([{ verdicts: [], ownership: [{ section: "4", role: "Data Owner" }, { section: "3", role: "Data Owner" }], questions: [] }]);
      const r = await runPropose({ docs: [{ doc: DOC, head, base }], set: setWith([], { roles, ownership: [owned(shaOf(base, "4"))] }), model, channel: scripted([]), issuer: createIdIssuer([]), at: AT });
      expect(r.status === "ready" && r.bump).to.equal("minor");
    });

    it("an unchanged granting section keeps its row as it was", async () => {
      const base = POLICY("Tech.");
      const head = POLICY("Tech, reworded.");
      const set = setWith([row("GOV-SVM-001")], { roles, ownership: [owned(shaOf(base, "4"))] });
      const model = fakeModel([{ verdicts: [{ kind: "keep", id: "GOV-SVM-001" }], ownership: [], questions: [] }]);
      const r = await runPropose({ docs: [{ doc: DOC, head, base }], set, model, channel: scripted([]), issuer: createIdIssuer(["GOV-SVM-001"]), at: AT });
      expect(r.status === "ready" && r.ownership).to.deep.equal([owned(shaOf(base, "4"))]);
    });
  });

  it("an ownership role the org does not have → gov asks which role", async () => {
    const model = fakeModel([
      { verdicts: [], ownership: [{ section: "4", role: "Data Steward" }], questions: [] },
      { verdicts: [], ownership: [{ section: "4", role: "Data Owner" }], questions: [] },
    ]);
    const ch = scripted(["Data Owner"]);
    const o = await interviewSection(
      { doc: DOC, section: "4", sha: "abc1234", text: "Section 4 is owned by the Data Steward.", rows: [], catalog: CATALOG, frameworkRules: [FW], roles: ["Policy Owner", "Data Owner"], scope: "SVM" },
      { model, channel: ch },
    );
    expect(ch.asked.map((q) => q.kind)).to.deep.equal(["ownership-role"]);
    expect(ch.asked[0]!.options).to.deep.equal(["Policy Owner", "Data Owner"]);
    expect(o.status === "done" && o.ownership).to.deep.equal([{ section: "4", role: "Data Owner" }]);
  });

  it("ambiguous level → one question at the terminal, then resolved; the Q&A rides on the row and the changelog", async () => {
    const model = fakeModel([
      { verdicts: [], ownership: [], questions: [{ id: "q1", kind: "level", text: "Is approved-list use C01 or C02?", options: ["C01", "C02", "C03"] }] },
      { verdicts: [ADD("Everyone uses only approved technologies.", "C02")], ownership: [], questions: [] },
    ]);
    const typed: string[] = [];
    const ch = terminalChannel(async (q) => { typed.push(q); return "2"; });
    const o = await interviewSection(
      { doc: DOC, section: "3", sha: "abc1234", text: "Use approved technologies.", rows: [], catalog: CATALOG, frameworkRules: [FW], scope: "SVM" },
      { model, channel: ch },
    );
    expect(typed).to.have.length(1);
    expect(typed[0]).to.include("2. C02");
    expect(o.status).to.equal("done");
    expect(o.qa).to.deep.equal([{ id: "q1", q: "Is approved-list use C01 or C02?", a: "C02" }]);
    expect(model.requests[1]!.user).to.include("Q: Is approved-list use C01 or C02?\nA: C02");
  });

  it("the terminal never invents an answer: empty → pending → the run is BLOCKED", async () => {
    const model = fakeModel([{ verdicts: [], ownership: [], questions: [{ id: "q1", kind: "actor", text: "Who is bound?" }] }, { verdicts: [], ownership: [], questions: [] }]);
    const r = await runPropose({ docs: [{ doc: DOC, head: POLICY("Use approved tech."), base: null }], set: setWith([]), model, channel: terminalChannel(async () => "  "), issuer: createIdIssuer([]), at: AT });
    expect(r.status).to.equal("blocked");
    expect(r.status === "blocked" && r.open[0]!.questions.map((q) => q.text)).to.deep.equal(["Who is bound?"]);
  });

  it("contradiction with a framework rule → flagged; gov sets the options and 'approve anyway' is not one (W2-Q2)", async () => {
    const model = fakeModel([
      { verdicts: [], ownership: [], questions: [{ id: "c1", kind: "contradiction", contradicts: "GOV-FRM-466", text: "Section 3 lets leads force-push shared branches; GOV-FRM-466 forbids it.", options: ["approve it"] }] },
      { verdicts: [], ownership: [], questions: [] },
    ]);
    const ch = scripted(["drop the rule — GOV-FRM-466 stands"]);
    const o = await interviewSection(
      { doc: DOC, section: "3", sha: "abc1234", text: "Leads may force-push shared branches.", rows: [], catalog: CATALOG, frameworkRules: [FW], scope: "SVM" },
      { model, channel: ch },
    );
    expect(ch.asked[0]!.kind).to.equal("contradiction");
    expect(ch.asked[0]!.options!.join(" ")).to.not.match(/approve/i);
    expect(ch.asked[0]!.options![0]).to.include("GOV-FRM-466");
    expect(o.status === "done" && o.verdicts).to.deep.equal([]);
  });

  it("a contradiction that cites no real framework rule goes back to the model", async () => {
    const model = fakeModel([
      { verdicts: [], ownership: [], questions: [{ id: "c1", kind: "contradiction", contradicts: "GOV-FRM-999", text: "?" }] },
      { verdicts: [], ownership: [], questions: [] },
    ]);
    const ch = scripted([]);
    await interviewSection({ doc: DOC, section: "3", sha: "abc1234", text: "x", rows: [], catalog: CATALOG, frameworkRules: [FW], scope: "SVM" }, { model, channel: ch });
    expect(ch.asked).to.deep.equal([]);
    expect(model.requests[1]!.user).to.include("YOUR PREVIOUS REPLY WAS REFUSED").and.include("GOV-FRM-999");
  });

  it("keep / revise / retire keep their ids; a kept rule is re-stamped with the new sha; an add gets an id past every id EVER issued", async () => {
    const retiredElsewhere = row("GOV-SVM-005", { source: { doc: DOC, section: "9", sha: "x" }, start: { version: "1.0.0", date: "2026-01-01" }, end: { version: "1.2.0", date: "2026-02-01" } });
    const org = [row("GOV-SVM-001"), row("GOV-SVM-002"), row("GOV-SVM-003"), retiredElsewhere];
    const head = POLICY("Changed technology prose.");
    const model = fakeModel([
      {
        verdicts: [{ kind: "keep", id: "GOV-SVM-001" }, { kind: "revise", id: "GOV-SVM-002", row: { expectation: "Everyone records each new dependency.", actor: ["everyone"], level: "C03" } }, { kind: "retire", id: "GOV-SVM-003" }, ADD("Agents do not add a dependency without approval.", "C02")],
        ownership: [], questions: [],
      },
      { verdicts: [], ownership: [], questions: [] },
    ]);
    const set = setWith(org);
    const r = await runPropose({ docs: [{ doc: DOC, head, base: POLICY("Old prose.") }], set, model, channel: scripted([]), issuer: createIdIssuer(everIssuedIds(set)), at: AT });
    expect(r.status).to.equal("ready");
    if (r.status !== "ready") return;
    expect(r.changelogDraft.rules).to.deep.equal([
      { id: "GOV-SVM-001", change: "kept", expectation: "Rule GOV-SVM-001." },
      { id: "GOV-SVM-002", change: "revised", expectation: "Everyone records each new dependency." },
      { id: "GOV-SVM-003", change: "retired", expectation: "Rule GOV-SVM-003." },
      { id: "GOV-SVM-006", change: "added", expectation: "Agents do not add a dependency without approval." },
    ]);
    const live = inForce(r.rows);
    expect(live.map((x) => x.id).sort()).to.deep.equal(["GOV-SVM-001", "GOV-SVM-002", "GOV-SVM-006"]);
    const sha = shaOf(head, "3");
    expect(live.every((x) => x.source.sha === sha), "every rule in force carries the section's new sha").to.equal(true);
    expect(live.find((x) => x.id === "GOV-SVM-001")!.expectation).to.equal("Rule GOV-SVM-001.");
    expect(validateRuleStore(r.rows, { scope: "SVM" })).to.deep.equal([]);
    expect(r.bump).to.equal("minor");
  });

  it("a kept rule is refreshed IN PLACE (Q17): one row, its start unchanged — no same-meaning revision", async () => {
    const head = POLICY("Changed technology prose.");
    const org = [row("GOV-SVM-001"), row("GOV-SVM-002")];
    const model = fakeModel([
      { verdicts: [{ kind: "keep", id: "GOV-SVM-001" }, { kind: "revise", id: "GOV-SVM-002", row: { expectation: "Rule GOV-SVM-002.", actor: ["everyone"], level: "C02" } }], ownership: [], questions: [] },
      { verdicts: [], ownership: [], questions: [] },
    ]);
    const r = await runPropose({ docs: [{ doc: DOC, head, base: POLICY("Old prose.") }], set: setWith(org), model, channel: scripted([]), issuer: createIdIssuer(["GOV-SVM-001", "GOV-SVM-002"]), at: AT });
    expect(r.status).to.equal("ready");
    if (r.status !== "ready") return;
    const sha = shaOf(head, "3");
    expect(r.rows, "same rows, only the sha moved").to.deep.equal(org.map((x) => ({ ...x, source: { ...x.source, sha } })));
    expect(r.changelogDraft.rules.map((x) => x.change)).to.deep.equal(["kept", "kept"]);
    expect(r.bump).to.equal("patch");
  });

  it("prose changed, every rule kept → bump patch", async () => {
    const model = fakeModel([
      { verdicts: [{ kind: "keep", id: "GOV-SVM-001" }], ownership: [], questions: [] },
      { verdicts: [], ownership: [], questions: [] },
    ]);
    const r = await runPropose({ docs: [{ doc: DOC, head: POLICY("Reworded."), base: POLICY("Original.") }], set: setWith([row("GOV-SVM-001")]), model, channel: scripted([]), issuer: createIdIssuer(["GOV-SVM-001"]), at: AT });
    expect(r.status === "ready" && r.bump).to.equal("patch");
    expect(r.status === "ready" && r.changelogDraft.rules.map((x) => x.change)).to.deep.equal(["kept"]);
  });

  it("ONE RUN PER SECTION SHA: rows that carry the current sha are skipped — the model is never called", async () => {
    const head = POLICY("Settled prose.");
    const org = [row("GOV-SVM-001", { source: { doc: DOC, section: "3", sha: shaOf(head, "3") } })];
    const model = fakeModel([]);
    const r = await runPropose({ docs: [{ doc: DOC, head, base: head }], set: setWith(org), model, channel: scripted([]), issuer: createIdIssuer([]), at: AT });
    expect(model.requests).to.have.length(0);
    expect(r.status === "ready" && r.bump).to.equal("none");
    expect(r.status === "ready" && r.rows).to.deep.equal(org);
  });

  it("a section removed from the document retires its rules without asking the model", async () => {
    const head = "# Org policy\n\n## 4 Data\n\nSection 4 is owned by the Data Owner.\n";
    const org = [row("GOV-SVM-001"), row("GOV-SVM-002", { source: { doc: DOC, section: "4", sha: shaOf(head, "4") } })];
    const model = fakeModel([]);
    const r = await runPropose({ docs: [{ doc: DOC, head, base: POLICY("Old.") }], set: setWith(org), model, channel: scripted([]), issuer: createIdIssuer([]), at: AT });
    expect(model.requests).to.have.length(0);
    expect(r.status === "ready" && r.changelogDraft.rules).to.deep.equal([{ id: "GOV-SVM-001", change: "retired", expectation: "Rule GOV-SVM-001." }]);
  });

  it("the model may not number a rule: an id on an add is refused (Q17)", async () => {
    expect(() => parseProposal(JSON.stringify({ verdicts: [{ kind: "add", id: "GOV-SVM-042", row: { expectation: "x", actor: ["agent"], level: "C01" } }], ownership: [], questions: [] })))
      .to.throw(ProposeError).with.property("kind", "model-issued-id");
    expect(() => parseProposal(JSON.stringify({ verdicts: [{ kind: "add", row: { id: "GOV-SVM-042", expectation: "x", actor: ["agent"], level: "C01" } }], ownership: [], questions: [] })))
      .to.throw(ProposeError).with.property("kind", "model-issued-id");
  });

  it("a keep/revise/retire naming a rule this section does not own goes back to the model, never into the store", async () => {
    const model = fakeModel([
      { verdicts: [{ kind: "retire", id: "GOV-SVM-777" }, { kind: "keep", id: "GOV-SVM-001" }], ownership: [], questions: [] },
      { verdicts: [{ kind: "keep", id: "GOV-SVM-001" }], ownership: [], questions: [] },
    ]);
    const o = await interviewSection({ doc: DOC, section: "3", sha: "abc1234", text: "x", rows: [row("GOV-SVM-001")], catalog: CATALOG, frameworkRules: [FW], scope: "SVM" }, { model, channel: scripted([]) });
    expect(o.status).to.equal("done");
    expect(model.requests[1]!.user).to.include("GOV-SVM-777");
  });

  it("malformed replies are typed errors, never guessed at", () => {
    expect(() => parseProposal("Sure! Here are the rules: …")).to.throw(ProposeError).with.property("kind", "not-json");
    expect(() => parseProposal(JSON.stringify({ verdicts: [ADD("x", "must")], ownership: [], questions: [] }))).to.throw(ProposeError).with.property("kind", "bad-shape");
    expect(() => parseProposal(JSON.stringify({ verdicts: [], ownership: [], questions: [], notes: "hi" }))).to.throw(ProposeError).with.property("kind", "bad-shape");
    expect(() => parseProposal(JSON.stringify({ verdicts: [{ kind: "merge", id: "GOV-SVM-001" }] }))).to.throw(ProposeError).with.property("kind", "bad-shape");
    // One fence around the whole reply is the reply, not a guess.
    expect(parseProposal("```json\n{\"verdicts\":[],\"ownership\":[],\"questions\":[]}\n```").verdicts).to.deep.equal([]);
  });

  it("malformed JSON from the model surfaces from runPropose as the typed error", async () => {
    const model = fakeModel(["{not json"]);
    let err: unknown;
    try { await runPropose({ docs, set: setWith([]), model, channel: scripted([]), issuer: createIdIssuer([]), at: AT }); } catch (e) { err = e; }
    expect(err).to.be.instanceOf(ProposeError);
    expect((err as ProposeError).kind).to.equal("not-json");
  });

  it("a row the store validator refuses (gov-client in an org rule, unknown action) goes back to the model", async () => {
    const model = fakeModel([
      { verdicts: [{ kind: "add", row: { expectation: "gov checks it.", actor: ["gov-client"], level: "C01", checks: [{ on: { resource: "vcs.code-repo", event: "pull_request" }, action: "gov-builtin/nope", on_miss: "fail" }] } }], ownership: [], questions: [] },
      { verdicts: [ADD("Everyone checks it.")], ownership: [], questions: [] },
    ]);
    const o = await interviewSection({ doc: DOC, section: "3", sha: "abc1234", text: "x", rows: [], catalog: CATALOG, frameworkRules: [FW], scope: "SVM" }, { model, channel: scripted([]) });
    expect(o.status).to.equal("done");
    expect(model.requests[1]!.user).to.include("gov-client").and.include("gov-builtin/nope");
  });

  it("a C01 rule bound only to observe events → gov asks the owner once (Q15)", async () => {
    const c01 = ADD("No one force-pushes main.", "C01", { checks: [{ on: { resource: "vcs.code-repo", event: "push" }, action: "gov-builtin/forbid-forced-push", on_miss: "fail" }] });
    const model = fakeModel([
      { verdicts: [c01], ownership: [], questions: [] },
      { verdicts: [c01], ownership: [], questions: [] },
    ]);
    const ch = scripted(["accept: detected after the fact"]);
    const o = await interviewSection({ doc: DOC, section: "3", sha: "abc1234", text: "x", rows: [], catalog: CATALOG, frameworkRules: [FW], scope: "SVM" }, { model, channel: ch });
    expect(ch.asked.map((q) => q.kind)).to.deep.equal(["c01-observe-only"]);
    expect(o.status).to.equal("done");
  });

  it("an interview that never settles fails with what is still open", async () => {
    const bad = { verdicts: [{ kind: "retire", id: "GOV-SVM-777" }], ownership: [], questions: [] };
    const model = fakeModel([bad, bad]);
    const o = await interviewSection({ doc: DOC, section: "3", sha: "abc1234", text: "x", rows: [], catalog: CATALOG, frameworkRules: [FW], scope: "SVM" }, { model, channel: scripted([]), maxRounds: 2 });
    expect(o.status).to.equal("failed");
    expect(o.status === "failed" && o.problems.join()).to.include("GOV-SVM-777");
  });

  describe("PR-comment channel (CI trigger)", () => {
    const BOT = "gov-bot";
    function fakePr(initial: PrComment[] = []): PrCommentsPort & { comments: PrComment[] } {
      const comments = [...initial];
      return {
        self: BOT, comments,
        async list() { return [...comments]; },
        async post(body) { const id = `c${comments.length + 1}`; comments.push({ id, author: BOT, body, createdAt: `2026-10-06T00:00:0${comments.length}Z` }); return id; },
      };
    }
    const q = { id: "q1", kind: "level", text: "Is it C01 or C02?", options: ["C01", "C02"] };
    const head = POLICY("Use approved tech.");

    it("posts one comment per open question and the run ends BLOCKED", async () => {
      const pr = fakePr();
      const model = fakeModel([
        { verdicts: [], ownership: [], questions: [q, { id: "q2", kind: "actor", text: "Agents too?" }] },
        { verdicts: [], ownership: [], questions: [] },
      ]);
      const r = await runPropose({ docs: [{ doc: DOC, head, base: null }], set: setWith([]), model, channel: prCommentChannel(pr), issuer: createIdIssuer([]), at: AT });
      expect(r.status).to.equal("blocked");
      expect(pr.comments).to.have.length(2);
      expect(pr.comments[0]!.body).to.include("<!-- gov-propose").and.include(`sha=${shaOf(head, "3")}`).and.include("Is it C01 or C02?");
    });

    it("the owner's reply is the answer on the next run; gov's own replies never count", async () => {
      const pr = fakePr();
      const first = fakeModel([{ verdicts: [], ownership: [], questions: [q] }, { verdicts: [], ownership: [], questions: [] }]);
      await runPropose({ docs: [{ doc: DOC, head, base: null }], set: setWith([]), model: first, channel: prCommentChannel(pr), issuer: createIdIssuer([]), at: AT });
      const root = pr.comments[0]!.id;
      pr.comments.push({ id: "r0", author: BOT, body: "C01", inReplyTo: root, createdAt: "2026-10-06T01:00:00Z" });

      const stillPending = fakeModel([{ verdicts: [], ownership: [], questions: [q] }, { verdicts: [], ownership: [], questions: [] }]);
      const r1 = await runPropose({ docs: [{ doc: DOC, head, base: null }], set: setWith([]), model: stillPending, channel: prCommentChannel(pr), issuer: createIdIssuer([]), at: AT });
      expect(r1.status, "a bot reply is not an answer").to.equal("blocked");

      pr.comments.push({ id: "r1", author: "policy-owner", body: "C02", inReplyTo: root, createdAt: "2026-10-06T02:00:00Z" });
      const second = fakeModel([{ verdicts: [ADD("Everyone uses approved tech.", "C02")], ownership: [], questions: [] }, { verdicts: [], ownership: [], questions: [] }]);
      const r2 = await runPropose({ docs: [{ doc: DOC, head, base: null }], set: setWith([]), model: second, channel: prCommentChannel(pr), issuer: createIdIssuer([]), at: AT });
      expect(r2.status).to.equal("ready");
      expect(second.requests[0]!.user, "the PR thread's answer is fed to the model up front").to.include("A: C02");
      expect(r2.status === "ready" && r2.changelogDraft.qa).to.deep.equal([{ doc: DOC, section: "3", q: "Is it C01 or C02?", a: "C02" }]);
      expect(pr.comments.filter((c) => c.author === BOT && !c.inReplyTo), "no duplicate question posted").to.have.length(1);
    });
  });

  describe("prompt", () => {
    it("carries the section, its rows, the catalog, the framework rules, the guide, and demands strict JSON", () => {
      const req = buildProposalRequest({ doc: DOC, section: "3", sha: "abc1234", text: "PROSE HERE", rows: [row("GOV-SVM-001")], catalog: CATALOG, frameworkRules: [FW], qa: [], corrections: [] });
      expect(req.system).to.equal(SYSTEM_PROMPT);
      for (const s of ["→ C01", "→ C02", "→ C03", "No signal", "NEVER \"gov-client\"", "keep-revise-retire", "uncheckable", "contradiction", "Section 4 is owned by", "JSON"]) expect(req.system).to.include(s);
      for (const s of ["PROSE HERE", "abc1234", "GOV-SVM-001", "gov-builtin/list-membership", "\"mode\": \"observe\"", "GOV-FRM-466"]) expect(req.user).to.include(s);
      expect(req.schema).to.be.an("object");
    });
  });

  describe("sections", () => {
    it("policySections and sectionShas agree — one definition of a section and its sha", () => {
      const t = POLICY("Body.");
      const s = policySections(t);
      expect(s.map((x) => x.section)).to.deep.equal(["", "3", "4"]);
      expect(new Map(s.map((x) => [x.section, x.sha]))).to.deep.equal(sectionShas(t));
      expect(s[1]!.text).to.include("## 3 Technology").and.include("Body.");
    });
  });

  it("the Proposer contract runs the same engine and returns verdicts without ids on adds", async () => {
    const model = fakeModel([{ verdicts: [{ kind: "keep", id: "GOV-SVM-001" }, ADD("New one.")], ownership: [], questions: [] }]);
    const p = createProposer({ set: setWith([row("GOV-SVM-001")]), model, channel: scripted([]) });
    const { verdicts: v } = await p.propose([{ doc: DOC, section: "3", sha: "abc1234", text: "x", rows: [row("GOV-SVM-001")] }]);
    expect(v.map((x) => x.kind)).to.deep.equal(["keep", "add"]);
    expect(v[0], "a keep carries the section's sha, so applyVerdicts can refresh in place").to.deep.equal({ kind: "keep", id: "GOV-SVM-001", sha: "abc1234" });
    expect(v[1]).to.not.have.property("id");
  });

  it("the Proposer contract returns the ownership and the Q&A too — nothing the interview settled is dropped", async () => {
    const model = fakeModel([
      { verdicts: [], ownership: [], questions: [{ id: "q1", kind: "level", text: "C01 or C02?", options: ["C01", "C02"] }] },
      { verdicts: [ADD("Everyone uses approved tech.")], ownership: [{ section: "4", role: "Data Owner" }], questions: [] },
    ]);
    const p = createProposer({ set: setWith([], { roles: { "Policy Owner": "po", "Data Owner": "do" } }), model, channel: scripted(["C02"]) });
    const out = await p.propose([{ doc: DOC, section: "3", sha: "abc1234", text: "x", rows: [] }]);
    expect(out.ownership).to.deep.equal([{ doc: DOC, section: "4", role: "Data Owner", sha: "abc1234" }]);
    expect(out.qa).to.deep.equal([{ section: "3", q: "C01 or C02?", a: "C02" }]);
  });
});
