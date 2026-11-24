// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// P3 wave 2 — `gov rules propose` WIRED: the org's model setting, the two provider adapters, the gh comment adapter,
// the writers, the terminal verb and the pull request trigger (GOV-FRM-468). No network: fetch, gh, git and the
// model are fakes; the engine, the writers and the gate are real.
import { expect } from "chai";
import { readModelSettings, NO_MODEL } from "../../../src/rules/propose/model-settings.js";
import { chooseModel, lazyModel, NO_APPROVED_MODEL, ModelRefused } from "../../../src/rules/propose/providers/index.js";
import { anthropicModel, ModelProviderError, ANTHROPIC_URL, type FetchLike } from "../../../src/rules/propose/providers/anthropic.js";
import { commandModel, splitCommand } from "../../../src/rules/propose/providers/command.js";
import { ghPrComments, parsePages, runRecords } from "../../../src/rules/propose/pr-comments-gh.js";
import { dumpOwnership, writeProposal } from "../../../src/rules/propose/write-result.js";
import { rulesPropose } from "../../../src/cli/rules-propose.js";
import { proposeOnPullRequest, NO_CI_WRITE } from "../../../src/cli/rules-propose-ci.js";
import { numberPolicyPr } from "../../../src/rules/propose/number-pr.js";
import { checkCommandAsync } from "../../../src/cli/check-verb.js";
import { memTree, treeAsGit, type TreeWriter } from "../../../src/rules/policy-pr/tree.js";
import { policyPrWriter } from "../../../src/rules/policy-pr/write.js";
import { judgePolicyPr } from "../../../src/rules/policy-pr/gate.js";
import { approvalsFrom } from "../../../src/rules/checks/event-payload.js";
import { runBuiltin } from "../../../src/rules/checks/builtin.js";
import { parseRuleStore } from "../../../src/rules/model/rule-row.js";
import { sectionShas } from "../../../src/rules/checks/sections.js";
import type { ModelPort, ModelRequest } from "../../../src/rules/propose/model-port.js";
import type { InterviewChannel } from "../../../src/rules/propose/interview.js";
import type { GitRead } from "../../../src/cli/policy-gate-io.js";
import type { Gh } from "../../../src/rules/checks/github-adapters.js";

const REQ: ModelRequest = { system: "SYS", user: "USER" };
const KEY = "sk-ant-test-secret-key";

function fakeFetch(replies: { status: number; body: unknown; retryAfter?: string }[]): FetchLike & { calls: { url: string; init: { headers: Record<string, string>; body: string } }[] } {
  const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
  const f = (async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    return { status: r.status, headers: { get: (n: string) => (n === "retry-after" ? r.retryAfter ?? null : null) }, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) };
  }) as FetchLike & { calls: typeof calls };
  f.calls = calls;
  return f;
}
const ok = (text: string, stop = "end_turn") => ({ status: 200, body: { content: [{ type: "text", text }], stop_reason: stop } });

describe("rules propose — the org's model setting (policies/governance.yaml)", () => {
  it("reads models.propose, models.command and models.ci_allowed", () => {
    expect(readModelSettings("models:\n  propose: { provider: anthropic, model: m-1 }\n  command: \"x -p\"\n  ci_allowed: true\n"))
      .to.deep.equal({ provider: "anthropic", model: "m-1", command: "x -p", ciAllowed: true });
  });
  it("absent, unparseable, or an unknown provider → no model approved; ci_allowed only when literally true", () => {
    expect(readModelSettings(null)).to.deep.equal(NO_MODEL);
    expect(readModelSettings("models: [")).to.deep.equal(NO_MODEL);
    expect(readModelSettings("models:\n  propose: { provider: openai, model: x }\n  ci_allowed: \"yes\"\n")).to.include({ provider: null, ciAllowed: false });
  });
});

describe("rules propose — choosing the model", () => {
  const deps = { ci: false, anthropicKey: () => KEY, geminiKey: () => null, runCommand: () => "" };
  it("no provider → refuses, naming governance.yaml and §9.3 in plain words", () => {
    const c = chooseModel(NO_MODEL, deps);
    expect(c.ok).to.equal(false);
    const text = (c.ok ? [] : c.lines).join("\n");
    expect(text).to.contain("has not approved a language model").and.contain("policies/governance.yaml").and.contain("§9.3");
    expect(c.ok ? null : c.lines).to.equal(NO_APPROVED_MODEL);
  });
  it("in CI without ci_allowed → refuses: run it locally", () => {
    const c = chooseModel({ provider: "anthropic", model: "m", command: "", ciAllowed: false }, { ...deps, ci: true });
    expect(c.ok ? "" : c.lines.join(" ")).to.contain("run gov rules propose locally");
  });
  it("anthropic with no model, or no key; command with no command → refuses, saying which", () => {
    expect(chooseModel({ provider: "anthropic", model: "", command: "", ciAllowed: false }, deps).ok).to.equal(false);
    const nokey = chooseModel({ provider: "anthropic", model: "m", command: "", ciAllowed: false }, { ...deps, anthropicKey: () => null });
    expect(nokey.ok ? "" : nokey.lines.join(" ")).to.contain("ANTHROPIC_API_KEY");
    expect(chooseModel({ provider: "command", model: "", command: "", ciAllowed: false }, deps).ok).to.equal(false);
  });
  it("a lazy model never asks for a model it is never used for — a run with nothing stale needs none", async () => {
    let chosen = 0;
    lazyModel(() => { chosen++; return { ok: false, lines: ["no"] }; });
    expect(chosen).to.equal(0);
    const m = lazyModel(() => { chosen++; return { ok: false, lines: ["no model"] }; });
    try { await m.complete(REQ); expect.fail("should refuse"); } catch (e) { expect(e).to.be.instanceOf(ModelRefused); expect((e as ModelRefused).lines).to.deep.equal(["no model"]); }
  });
});

describe("rules propose — the anthropic adapter (Messages API over fetch)", () => {
  it("posts the org's model, the system prompt and the section; returns the text", async () => {
    const f = fakeFetch([ok("{\"verdicts\":[]}")]);
    const out = await anthropicModel({ apiKey: KEY, model: "org-model", fetch: f }).complete(REQ);
    expect(out).to.equal("{\"verdicts\":[]}");
    expect(f.calls[0]!.url).to.equal(ANTHROPIC_URL);
    expect(f.calls[0]!.init.headers).to.include({ "x-api-key": KEY, "anthropic-version": "2023-06-01" });
    const body = JSON.parse(f.calls[0]!.init.body);
    expect(body).to.deep.include({ model: "org-model", system: "SYS", messages: [{ role: "user", content: "USER" }] });
  });
  it("retries a 429 (after retry-after) and a 529, then succeeds", async () => {
    const waits: number[] = [];
    const f = fakeFetch([{ status: 429, body: {}, retryAfter: "3" }, { status: 529, body: {} }, ok("x")]);
    expect(await anthropicModel({ apiKey: KEY, model: "m", fetch: f, sleep: async (ms) => { waits.push(ms); } }).complete(REQ)).to.equal("x");
    expect(waits).to.deep.equal([3000, 2000]);
  });
  it("a 400 is not retried; the error names the API's message and never the key", async () => {
    const f = fakeFetch([{ status: 400, body: { error: { type: "invalid_request_error", message: `bad model (key ${KEY.slice(0, 3)})` } } }]);
    try {
      await anthropicModel({ apiKey: KEY, model: "m", fetch: f }).complete(REQ);
      expect.fail("should throw");
    } catch (e) {
      expect(e).to.be.instanceOf(ModelProviderError);
      expect((e as Error).message).to.contain("400").and.contain("bad model").and.not.contain(KEY);
    }
    expect(f.calls).to.have.length(1);
  });
  it("a refusal, or a reply cut off at max_tokens, is an error rather than a reply", async () => {
    for (const stop of ["refusal", "max_tokens"]) {
      try { await anthropicModel({ apiKey: KEY, model: "m", fetch: fakeFetch([ok("{\"verd", stop)]) }).complete(REQ); expect.fail(stop); } catch (e) { expect(e).to.be.instanceOf(ModelProviderError); }
    }
  });
});

describe("rules propose — the command adapter", () => {
  it("splits the command (quotes group), sends the request on stdin, reads stdout", async () => {
    expect(splitCommand(`claude -p --model "a b" 'c d'`)).to.deep.equal(["claude", "-p", "--model", "a b", "c d"]);
    const seen: { cmd: string; args: readonly string[]; input: string }[] = [];
    const m = commandModel({ command: "llm -m x", run: (cmd, args, input) => { seen.push({ cmd, args, input }); return "{}"; } });
    expect(await m.complete(REQ)).to.equal("{}");
    expect(seen[0]).to.deep.include({ cmd: "llm", args: ["-m", "x"] });
    expect(seen[0]!.input).to.contain("SYS").and.contain("USER");
  });
  it("a failing program, or one that prints nothing, is a provider error", async () => {
    const bad = commandModel({ command: "x", run: () => { throw new Error("exit 1"); } });
    try { await bad.complete(REQ); expect.fail(); } catch (e) { expect(e).to.be.instanceOf(ModelProviderError); }
    try { await commandModel({ command: "x", run: () => "  " }).complete(REQ); expect.fail(); } catch (e) { expect(e).to.be.instanceOf(ModelProviderError); }
  });
});

// ── a governance repository in memory ───────────────────────────────────────────────────────────────────────
const DOC = "policies/org-policy.md";
const POLICY = (s3: string) => `# Org policy\n\n## 3 Technology\n\n${s3}\n\n## 4 Data\n\nKeep data safe.\n`;
const OLD = POLICY("Use approved tools.");
const NEW = POLICY("Everyone must use only technologies on the approved list.");
const RULES_HEADER = "# YOUR ORGANIZATION'S RULES — machine-written.\n";
const OWN_HEADER = "# WHO APPROVES A CHANGE TO EACH POLICY SECTION.\n";

function baseFiles(extra: Record<string, string> = {}): Record<string, string> {
  return {
    // After the org-config split the Policy Owner lives in policies/governance.yaml, not org-config.yaml.
    "org-config.yaml": "org_slug: \"SVM\"\n",
    "policies/governance.yaml": "policy_owner: { github: \"polly\" }\n",
    [DOC]: OLD,
    "policies/VERSION": "1.0.0\n",
    "policies/rules/rules.yaml": `${RULES_HEADER}[]\n`,
    "policies/ownership.yaml": `${OWN_HEADER}[]\n`,
    "policies/CHANGELOG.md": "# Policy changelog\n\nNewest first.\n",
    ...extra,
  };
}

/** git over two trees: the default branch (`main`, and its merge-base `MB`) and nothing else. */
function fakeGit(base: Record<string, string>, extra: Record<string, string> = {}): GitRead {
  const tg = treeAsGit(memTree(base));
  return (repo, args) => {
    if (args[0] === "merge-base") return "MB\n";
    if (args[0] === "rev-parse") return null;
    if (args[0] === "show" && args[1]?.endsWith(":policies/governance.yaml") && "policies/governance.yaml" in extra) return extra["policies/governance.yaml"]!;
    return tg(repo, args);
  };
}

function scriptedModel(replies: object[]): ModelPort & { calls: number } {
  const m = { calls: 0, async complete() { m.calls++; const r = replies.shift(); if (!r) throw new Error("fake model: no more replies"); return JSON.stringify(r); } };
  return m;
}
const ADD = (expectation: string) => ({ kind: "add", row: { expectation, actor: ["everyone"], level: "C02" } });
const answers = (a: string[]): InterviewChannel & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, async ask(q) { asked.push(q.text); const x = a.shift(); return x === undefined ? { kind: "pending" } : { kind: "answer", text: x }; } };
};

describe("gov rules propose — the terminal trigger", () => {
  const run = (head: TreeWriter, model: ModelPort, channel: InterviewChannel, opts: { pr?: number; all?: boolean; git?: GitRead } = {}) =>
    rulesPropose({ git: opts.git ?? fakeGit(baseFiles()), head, channel, model: () => model }, {
      home: "/gov", defaultBranch: "main", all: opts.all ?? false, today: "2026-10-07", author: "alice", ...(opts.pr !== undefined ? { pr: opts.pr } : {}),
    });

  it("a changed section → rows, a minor bump, the snapshot, stamps and the changelog; a second run writes nothing and asks nothing", async () => {
    const files = baseFiles({ [DOC]: NEW });
    const head = memTree(files);
    const model = scriptedModel([{ verdicts: [ADD("Everyone uses only technologies on the approved list.")], ownership: [], questions: [] }]);
    const r = await run(head, model, answers([]), { pr: 12 });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const out = r.lines.join("\n");
    expect(out).to.contain("added 1 · revised 0 · retired 0 · kept 0").and.contain("minor (1.0.0 → 1.1.0)").and.contain("open questions: none");
    const rows = parseRuleStore(files["policies/rules/rules.yaml"]!);
    expect(rows).to.have.length(1);
    expect(rows[0]).to.deep.include({ id: "GOV-SVM-001", start: { version: "1.1.0", date: "2026-10-07", pr: 12 } });
    expect(rows[0]!.source.sha).to.equal(sectionShas(NEW).get("3"));
    expect(files["policies/rules/rules.yaml"]!.startsWith(RULES_HEADER), "the header comment is kept").to.equal(true);
    expect(files["policies/VERSION"]).to.equal("1.1.0\n");
    expect(files["policies/history/1.0.0/org-policy.md"]).to.equal(OLD);
    expect(files["policies/CHANGELOG.md"]).to.contain("## 1.1.0 — 2026-10-07").and.contain("| #12 | @alice | _pending_ |").and.contain("GOV-SVM-001");
    expect(files["policies/CHANGELOG.md"], "the section propose settled, and what it came to").to.contain(`- ${DOC} §3 (${sectionShas(NEW).get("3")}) → GOV-SVM-001 added`);

    const before = JSON.stringify(files);
    const again = await run(head, model, answers([]), { pr: 12 });
    expect(again.code).to.equal(0);
    expect(model.calls, "one run per section sha").to.equal(1);
    expect(JSON.stringify(files)).to.equal(before);
    expect(again.lines.join("\n")).to.contain("Nothing to change");
  });

  it("F154 A: no pull request yet → EVERYTHING is written before it opens — rows, version, snapshot, stamps and the whole changelog entry, `_not yet open_` for its number", async () => {
    const files = baseFiles({ [DOC]: NEW });
    const head = memTree(files);
    const model = scriptedModel([{ verdicts: [ADD("Everyone uses only approved technologies.")], ownership: [], questions: [] }]);
    const r = await run(head, model, answers([]));
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(r.lines.join("\n")).to.contain("no pull request yet").and.contain("gov close");
    expect(files["policies/VERSION"]).to.equal("1.1.0\n");
    expect(files["policies/history/1.0.0/org-policy.md"]).to.equal(OLD);
    const log = files["policies/CHANGELOG.md"]!;
    expect(log).to.contain("## 1.1.0 — 2026-10-07").and.contain("| _not yet open_ | @alice | _pending_ |").and.contain("GOV-SVM-001");
    expect(log, "the section reviewed is recorded now, while the run still knows it").to.contain(`- ${DOC} §3 (${sectionShas(NEW).get("3")}) → GOV-SVM-001 added`);
    const row = parseRuleStore(files["policies/rules/rules.yaml"]!)[0]!;
    expect(row.start).to.deep.equal({ version: "1.1.0", date: "2026-10-07" });
    // The gate on the pull request: only the number is missing — and it says so.
    const g = judgePolicyPr({ base: memTree(baseFiles()), head: memTree(files), pr: 7, today: "2026-10-07" });
    expect(g.findings.map((f) => f.check).sort()).to.deep.equal(["changelog", "stamp"]);
    expect(g.findings.map((f) => f.message).join("\n")).to.contain("does not name this pull request (#7)");
  });

  it("F154 A: once the pull request is open, a second run names it — in the entry and the stamps, nothing else, no model asked", async () => {
    const files = baseFiles({ [DOC]: NEW });
    const head = memTree(files);
    const model = scriptedModel([{ verdicts: [ADD("Everyone uses only approved technologies.")], ownership: [], questions: [] }]);
    await run(head, model, answers([]));
    const before = files["policies/CHANGELOG.md"]!;
    const later = await run(head, model, answers([]), { pr: 7 });
    expect(later.code, later.lines.join("\n")).to.equal(0);
    expect(model.calls).to.equal(1);
    expect(files["policies/CHANGELOG.md"]).to.equal(before.replace("| _not yet open_ |", "| #7 |"));
    expect(parseRuleStore(files["policies/rules/rules.yaml"]!)[0]!.start).to.deep.equal({ version: "1.1.0", date: "2026-10-07", pr: 7 });
    expect(judgePolicyPr({ base: memTree(baseFiles()), head: memTree(files), pr: 7, today: "2026-10-07" }).findings).to.deep.equal([]);
    // A later run that cannot find the pull request keeps the number rather than taking it out again.
    const offline = await run(head, model, answers([]));
    expect(offline.code).to.equal(0);
    expect(files["policies/CHANGELOG.md"]).to.contain("| #7 |").and.not.contain("_not yet open_");
    expect(parseRuleStore(files["policies/rules/rules.yaml"]!)[0]!.start.pr).to.equal(7);
  });

  it("F154 A: numberPolicyPr (what gov close runs once it has opened the pull request) names it; nothing when propose never ran or policies/ is untouched", async () => {
    const files = baseFiles({ [DOC]: NEW });
    const head = memTree(files);
    await run(head, scriptedModel([{ verdicts: [ADD("Everyone uses only approved technologies.")], ownership: [], questions: [] }]), answers([]));
    const git = fakeGit(baseFiles());
    const at = { home: "/gov", defaultBranch: "main", pr: 12, today: "2026-10-07", author: "alice" };
    const r = numberPolicyPr(git, head, at);
    expect("wrote" in r && [...r.wrote].sort()).to.deep.equal(["policies/CHANGELOG.md", "policies/rules/rules.yaml"]);
    expect(files["policies/CHANGELOG.md"]).to.contain("| #12 | @alice |");
    expect(judgePolicyPr({ base: memTree(baseFiles()), head: memTree(files), pr: 12, today: "2026-10-07" }).findings).to.deep.equal([]);
    expect(numberPolicyPr(git, head, at), "a second call writes nothing").to.deep.equal({ wrote: [] });
    const neverProposed = baseFiles({ [DOC]: NEW });
    expect(numberPolicyPr(git, memTree(neverProposed), at), "propose never ran: close does not half-do it").to.deep.equal({ wrote: [] });
    expect(neverProposed["policies/VERSION"]).to.equal("1.0.0\n");
    expect(numberPolicyPr(git, memTree(baseFiles()), at)).to.deep.equal({ wrote: [] });
  });

  it("an unanswered question stops the run with NOTHING written", async () => {
    const files = baseFiles({ [DOC]: NEW });
    const before = JSON.stringify(files);
    const model = scriptedModel([{ verdicts: [], ownership: [], questions: [{ id: "q1", kind: "level", text: "C01 or C02?" }] }]);
    const ch = answers([]);
    const r = await run(memTree(files), model, ch, { pr: 1 });
    expect(r.code).to.equal(1);
    expect(ch.asked).to.deep.equal(["C01 or C02?"]);
    expect(r.lines.join("\n")).to.contain("Nothing was written").and.contain("C01 or C02?");
    expect(JSON.stringify(files)).to.equal(before);
  });

  it("no model approved → refuses in plain words, only when a section actually needs reading", async () => {
    const refusing = lazyModel(() => chooseModel(NO_MODEL, { ci: false, anthropicKey: () => null, runCommand: () => "" }));
    const r = await run(memTree(baseFiles({ [DOC]: NEW })), refusing, answers([]), { pr: 1 });
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("has not approved a language model").and.contain("policies/governance.yaml");
    const quiet = await run(memTree(baseFiles()), refusing, answers([]), { pr: 1 });
    expect(quiet.code, "nothing changed: no model needed").to.equal(0);
  });

  it("--all reads unchanged sections that have no rules yet (the first extraction); without it they are left alone", async () => {
    const model = scriptedModel([]);
    expect((await run(memTree(baseFiles()), model, answers([]))).code).to.equal(0);
    expect(model.calls).to.equal(0);
    const all = scriptedModel([
      { verdicts: [ADD("Everyone uses approved tools.")], ownership: [], questions: [] },
      { verdicts: [], ownership: [{ section: "4", role: "Policy Owner" }], questions: [] },
    ]);
    const files = baseFiles();
    const r = await run(memTree(files), all, answers([]), { all: true, pr: 3 });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(all.calls).to.equal(2);
    expect(files["policies/ownership.yaml"]).to.equal(`${OWN_HEADER}- { doc: "${DOC}", section: "4", role: "Policy Owner", sha: "${sectionShas(OLD).get("4")}" }\n`);
  });
});

describe("rules propose — the deterministic writers", () => {
  it("ownership YAML is the same bytes whatever order the rows come in, header kept, [] when empty", () => {
    const a = { doc: "policies/b.md", section: "10", role: "R", sha: "1" }, b = { doc: "policies/b.md", section: "9", role: "R", sha: "2" }, c = { doc: "policies/a.md", section: "1", role: "R", sha: "3" };
    expect(dumpOwnership("# h\n[]\n", [a, b, c])).to.equal(dumpOwnership("# h\n[]\n", [c, a, b]));
    expect(dumpOwnership("# h\n[]\n", [a, b, c]).split("\n")[1]).to.contain("policies/a.md");
    expect(dumpOwnership("# h\n\n- {}\n", [])).to.equal("# h\n[]\n");
  });
  it("writeProposal writes each file only when its content differs", () => {
    const files = baseFiles();
    expect(writeProposal(memTree(files), { rows: [], ownership: [] })).to.deep.equal([]);
  });
  it("a changelog entry this PR wrote and nobody approved is rewritten when the change grows; anyone else's is kept", () => {
    const files = baseFiles();
    const w = policyPrWriter({ base: memTree(baseFiles()), head: memTree(files) });
    const e = { version: "1.1.0", date: "2026-10-07", pr: 5, author: "a", approver: null, qa: [] };
    w.writeChangelogEntry({ ...e, rules: [{ id: "GOV-SVM-001", change: "added", expectation: "x" }] });
    expect(w.writeChangelogEntry({ ...e, rules: [{ id: "GOV-SVM-001", change: "added", expectation: "x" }, { id: "GOV-SVM-002", change: "added", expectation: "y" }] }).wrote).to.equal(true);
    expect(files["policies/CHANGELOG.md"]).to.contain("GOV-SVM-002");
    expect((files["policies/CHANGELOG.md"]!.match(/## 1\.1\.0/g) ?? []).length).to.equal(1);
    expect(w.writeChangelogEntry({ ...e, pr: 6, rules: [] }).wrote, "another PR's entry is frozen").to.equal(false);
  });
});

describe("rules propose — the pull request's comments over gh", () => {
  const ref = { repo: "acme/gov", pr: 9, headSha: "HEADSHA", self: "github-actions[bot]" };
  it("pages are one list; review comments map to the channel's shape, replies by in_reply_to_id", async () => {
    expect(parsePages("[1][2,3]")).to.deep.equal([1, 2, 3]);
    expect(parsePages("[[1],[2]]")).to.deep.equal([1, 2]);
    expect(parsePages(null)).to.equal(null);
    const gh: Gh = () => JSON.stringify([{ id: 1, user: { login: "github-actions[bot]" }, body: "q", created_at: "t1" }, { id: 2, user: { login: "polly" }, body: "C01", in_reply_to_id: 1, created_at: "t2" }]);
    expect(await ghPrComments(gh, ref).list()).to.deep.equal([
      { id: "1", author: "github-actions[bot]", body: "q", createdAt: "t1" },
      { id: "2", author: "polly", body: "C01", inReplyTo: "1", createdAt: "t2" },
    ]);
  });
  it("a question is a review comment on its policy file at the head commit", async () => {
    const calls: { args: readonly string[]; input?: string }[] = [];
    const gh: Gh = (args, input) => { calls.push({ args, ...(input !== undefined ? { input } : {}) }); return "{\"id\": 77}"; };
    const id = await ghPrComments(gh, ref).post(`<!-- gov-propose q=abc doc=${DOC} section=3 sha=x -->\n**Question:** ?`);
    expect(id).to.equal("77");
    expect(calls[0]!.args).to.include("repos/acme/gov/pulls/9/comments");
    expect(JSON.parse(calls[0]!.input!)).to.deep.include({ path: DOC, subject_type: "file", commit_id: "HEADSHA" });
  });
  it("run records are gov's own conversation comments, by key", () => {
    const gh: Gh = () => JSON.stringify([{ user: { login: "github-actions[bot]" }, body: "<!-- gov-propose-run key=abc123 -->\nx" }, { user: { login: "mallory" }, body: "<!-- gov-propose-run key=ffff -->" }]);
    expect(runRecords(gh, ref).keys()).to.deep.equal(["abc123"]);
  });
});

// ── the pull request trigger ─────────────────────────────────────────────────────────────────────────────────
const HEAD = "1111111111111111111111111111111111111111";
const BASE = "2222222222222222222222222222222222222222";
const EVENT = {
  pull_request: {
    number: 9, user: { login: "alice" },
    head: { ref: "BRNCH-9-tech", sha: HEAD, repo: { full_name: "acme/gov" } },
    base: { ref: "main", sha: BASE, repo: { full_name: "acme/gov" } },
  },
};

/** The PR's two commits (merge-base and head) over one fake git — read only: the check has nothing else. */
function prWorld(headFiles: Record<string, string>, baseF = baseFiles()) {
  const trees: Record<string, Record<string, string>> = { MB: baseF, [HEAD]: headFiles };
  const calls: string[] = [];
  const git: GitRead = (_repo, args) => {
    const k = args.join(" ");
    calls.push(k);
    if (k === `merge-base ${BASE} ${HEAD}`) return "MB\n";
    if (k === `show -s --format=%ct ${HEAD}`) return "1791374400\n";   // 2026-10-07T12:00Z
    if (args[0] === "ls-tree") {
      const ref = args.find((a) => a in trees);
      return ref ? treeAsGit(memTree(trees[ref]!))("", args) : null;
    }
    if (args[0] === "show" && args[1]?.includes(":")) {
      const ref = args[1].slice(0, args[1].indexOf(":"));
      return trees[ref] ? treeAsGit(memTree(trees[ref]!))("", args) : null;
    }
    return null;
  };
  return { git, calls, deps: { git, repoDir: "/gov" } };
}

/** Every git call the check made is a read: no worktree, add, commit or push (F154 A). */
const WRITES = /^(worktree|add|commit|push|fetch|checkout|switch|reset|update-ref|config)\b/;
const readOnly = (calls: readonly string[]): boolean => !calls.some((c) => WRITES.test(c));

const TAG = "GOV-FRM-468 [gov-builtin/rules-propose]";
const STALE_ROW = `${RULES_HEADER}- id: GOV-SVM-001\n  source: { doc: ${DOC}, section: "3", sha: "${sectionShas(OLD).get("3")}" }\n  expectation: "Everyone uses approved tools."\n  actor: [everyone]\n  level: C02\n  start: { version: "1.0.0", date: "2026-10-01", pr: 1 }\n  end: null\n`;

describe("GOV-FRM-468 on a policy pull request gov only checks: it fails naming the local fix and never writes (F154 A)", () => {
  it("GOV-FRM-468 policies/ untouched → pass, nothing written", async () => {
    const w = prWorld(baseFiles());
    const r = await proposeOnPullRequest(TAG, "pull_request", EVENT, w.deps);
    expect(r.verdict).to.equal("pass");
    expect(readOnly(w.calls)).to.equal(true);
  });

  it("GOV-FRM-468 stale rows → fails with the gate's message and the local fix, naming the pull request; nothing written", async () => {
    const w = prWorld(baseFiles({ [DOC]: NEW, "policies/rules/rules.yaml": STALE_ROW }), baseFiles({ "policies/rules/rules.yaml": STALE_ROW }));
    const r = await proposeOnPullRequest(TAG, "pull_request", EVENT, w.deps);
    expect(r.verdict).to.equal("miss");
    const text = r.findings.join("\n");
    expect(text).to.contain("§3 changed; run gov rules propose");
    expect(text).to.contain("run `gov rules propose` on this branch").and.contain("organization's model").and.contain("#9").and.contain("--pr 9");
    expect(text).to.contain(NO_CI_WRITE);
    expect(readOnly(w.calls), w.calls.join("\n")).to.equal(true);
  });

  it("GOV-FRM-468 nothing stale, paperwork missing (here: the snapshot) → fails: run propose, no model asked; nothing written", async () => {
    const files = baseFiles({ [DOC]: NEW });
    const model = scriptedModel([{ verdicts: [ADD("Everyone uses only approved technologies.")], ownership: [], questions: [] }]);
    await rulesPropose({ git: fakeGit(baseFiles()), head: memTree(files), channel: answers([]), model: () => model },
      { home: "/gov", defaultBranch: "main", all: false, today: "2026-10-07", author: "alice", pr: 9 });
    for (const f of Object.keys(files)) if (f.startsWith("policies/history/")) delete files[f];
    const snapshotless = JSON.stringify(files);
    const w = prWorld(files);
    const r = await proposeOnPullRequest(TAG, "pull_request", EVENT, w.deps);
    expect(r.verdict).to.equal("miss");
    const text = r.findings.join("\n");
    expect(text).to.contain("no snapshot of 1.0.0").and.contain("no model is asked").and.contain("#9");
    expect(JSON.stringify(files), "the head is untouched").to.equal(snapshotless);
    expect(readOnly(w.calls)).to.equal(true);
  });

  it("GOV-FRM-468 the entry written before the pull request opened, number missing → fails: run propose again (it finds #9)", async () => {
    const files = baseFiles({ [DOC]: NEW });
    const model = scriptedModel([{ verdicts: [ADD("Everyone uses only approved technologies.")], ownership: [], questions: [] }]);
    await rulesPropose({ git: fakeGit(baseFiles()), head: memTree(files), channel: answers([]), model: () => model },
      { home: "/gov", defaultBranch: "main", all: false, today: "2026-10-07", author: "alice" });
    const w = prWorld(files);
    const r = await proposeOnPullRequest(TAG, "pull_request", EVENT, w.deps);
    expect(r.verdict).to.equal("miss");
    expect(r.findings.join("\n")).to.contain("does not name this pull request (#9)").and.contain("no model is asked");
    expect(readOnly(w.calls)).to.equal(true);
  });

  it("GOV-FRM-468 the author's commit carries everything → pass, nothing written — the gate (GOV-FRM-467) passes on it", async () => {
    const files = baseFiles({ [DOC]: NEW });
    const model = scriptedModel([{ verdicts: [ADD("Everyone uses only approved technologies.")], ownership: [], questions: [] }]);
    const r0 = await rulesPropose({ git: fakeGit(baseFiles()), head: memTree(files), channel: answers([]), model: () => model },
      { home: "/gov", defaultBranch: "main", all: false, today: "2026-10-07", author: "alice", pr: 9 });
    expect(r0.code, r0.lines.join("\n")).to.equal(0);
    const w = prWorld(files);
    const r = await proposeOnPullRequest(TAG, "pull_request", EVENT, w.deps);
    expect(r, r.findings.join("\n")).to.deep.equal({ verdict: "pass", findings: [] });
    expect(judgePolicyPr({ base: memTree(baseFiles()), head: memTree(files), pr: 9, today: "2026-10-07" }).findings).to.deep.equal([]);
    expect(readOnly(w.calls)).to.equal(true);
  });

  it("GOV-FRM-468 a fork is judged the same way — read only", async () => {
    const w = prWorld(baseFiles({ [DOC]: NEW, "policies/rules/rules.yaml": STALE_ROW }), baseFiles({ "policies/rules/rules.yaml": STALE_ROW }));
    const fork = { pull_request: { ...EVENT.pull_request, head: { ...EVENT.pull_request.head, repo: { full_name: "mallory/gov" } } } };
    const r = await proposeOnPullRequest(TAG, "pull_request", fork, w.deps);
    expect(r.verdict).to.equal("miss");
    expect(r.findings.join("\n")).to.contain("run `gov rules propose` on this branch");
    expect(readOnly(w.calls)).to.equal(true);
  });

  it("GOV-FRM-468 a bot's review never counts as an approval", () => {
    const reviews = JSON.stringify([
      { user: { login: "github-actions[bot]", type: "Bot" }, state: "APPROVED", commit_id: HEAD },
      { user: { login: "gov-app[bot]" }, state: "APPROVED", commit_id: HEAD },
      { user: { login: "polly", type: "User" }, state: "APPROVED", commit_id: HEAD },
    ]);
    expect(approvalsFrom(reviews, HEAD)).to.deep.equal(["polly"]);
  });

  it("GOV-FRM-468 the builtin reports the injected outcome; without one it cannot tell", () => {
    const base = { ruleId: "GOV-FRM-468", action: "gov-builtin/rules-propose", params: {}, ctx: { resource: "vcs.gov-repo", event: "pull_request", payload: {} }, readDefault: () => null };
    expect(runBuiltin(base).verdict).to.equal("cannot-tell");
    expect(runBuiltin({ ...base, propose: { verdict: "miss", findings: ["x"] } })).to.deep.equal({ verdict: "miss", findings: ["x"] });
  });

  it("GOV-FRM-468 `gov check run` runs the proposer's check first when the rule in force binds it, and judges by its outcome", async () => {
    const store = `- id: GOV-FRM-468\n  source: { doc: framework/framework-specification.md, section: "9.3", sha: "x" }\n  expectation: "gov checks."\n  actor: [gov-client]\n  level: C01\n  checks:\n    - on: { resource: vcs.gov-repo, event: pull_request }\n      action: gov-builtin/rules-propose\n      on_miss: fail\n  start: { version: "1.2.3", date: "2026-10-06" }\n  end: null\n`;
    const catalog = "resources:\n  - id: vcs.gov-repo\n    renderer: github-actions\n    events:\n      - { name: pull_request, mode: gate }\ntools:\n  - id: gov-builtin\nactions:\n  - id: gov-builtin/rules-propose\n    tool: gov-builtin\n    params: { type: object, additionalProperties: false, properties: {} }\n";
    const git = treeAsGit(memTree({ "org-config.yaml": "org_slug: \"SVM\"\n", "framework/rules/rules.yaml": store, "framework/rules/checks-catalog.yaml": catalog }));
    const seen: string[] = [];
    const r = await checkCommandAsync(["run", "GOV-FRM-468"], { resource: "vcs.gov-repo", event: "pull_request" }, {
      git, gh: () => "[]", env: { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/e.json" },
      readFile: (f) => (f === "/e.json" ? JSON.stringify(EVENT) : null), writeFile: () => {},
      proposeOnPr: async (tag, eventName) => { seen.push(`${tag} ${eventName}`); return { verdict: "miss", findings: [`${tag}: run \`gov rules propose\` on this branch`] }; },
    }, { home: "/gov", defaultBranch: "main", defaultCodeBranch: "dev", githubOrg: "acme", workspaceRepo: "gov", posture: "soft" });
    expect(seen).to.deep.equal(["GOV-FRM-468 [gov-builtin/rules-propose] pull_request"]);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("run `gov rules propose` on this branch");
  });
});

describe("a runner without a tool gov needs FAILS the check, whatever the posture (Policy Owner ruling, 2026-10-17)", () => {
  // On chinhut-e2e, `gh` was not installed (run 39033584186): the proposer read "the review comments on #3 could not
  // be read", could not tell, and soft posture showed a green check that did nothing. A check that cannot RUN is not
  // a "could not tell" about the change: it fails, soft or hard, naming the tool and the fix. git likewise.
  const store = `- id: GOV-FRM-468\n  source: { doc: framework/framework-specification.md, section: "9.3", sha: "x" }\n  expectation: "gov proposes."\n  actor: [gov-client]\n  level: C01\n  checks:\n    - on: { resource: vcs.gov-repo, event: pull_request }\n      action: gov-builtin/rules-propose\n      on_miss: fail\n  start: { version: "1.2.3", date: "2026-10-06" }\n  end: null\n`;
  const catalog = "resources:\n  - id: vcs.gov-repo\n    renderer: github-actions\n    events:\n      - { name: pull_request, mode: gate }\ntools:\n  - id: gov-builtin\nactions:\n  - id: gov-builtin/rules-propose\n    tool: gov-builtin\n    params: { type: object, additionalProperties: false, properties: {} }\n";
  const git = treeAsGit(memTree({ "org-config.yaml": "org_slug: \"SVM\"\n", "framework/rules/rules.yaml": store, "framework/rules/checks-catalog.yaml": catalog }));
  const CFG = (posture: "soft" | "hard") => ({ home: "/gov", defaultBranch: "main", defaultCodeBranch: "dev", githubOrg: "acme", workspaceRepo: "gov", posture });
  const runWith = async (env: Record<string, string>, missing: readonly string[], posture: "soft" | "hard" = "soft", proposer: "pass" | "cannot-tell" = "pass") => {
    const seen: string[] = [];
    const r = await checkCommandAsync(["run", "GOV-FRM-468"], { resource: "vcs.gov-repo", event: "pull_request" }, {
      git, gh: () => null, env: { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/e.json", ...env },
      readFile: (f) => (f === "/e.json" ? JSON.stringify(EVENT) : null), writeFile: () => {},
      toolOnPath: (tool) => !missing.includes(tool),
      proposeOnPr: async (tag) => { seen.push(tag); return proposer === "pass" ? { verdict: "pass", findings: [] } : { verdict: "cannot-tell", findings: [`${tag}: something else could not be read`] }; },
    }, CFG(posture));
    return { r, text: r.lines.join("\n"), seen };
  };

  for (const posture of ["soft", "hard"] as const) {
    it(`no gh, ${posture} posture: exit 1, nothing run, the tool and the fix named — as an ::error`, async () => {
      const { r, text, seen } = await runWith({ GITHUB_ACTIONS: "true" }, ["gh"], posture);
      expect(r.code, text).to.equal(1);
      expect(seen, "nothing ran").to.deep.equal([]);
      expect(text).to.contain("GOV-FRM-468: the GitHub CLI (`gh`) is not on this runner's PATH").and.contain("https://cli.github.com");
      expect(text).to.contain("fails under any posture");
      expect(text).to.match(/^::error [^\n]*the GitHub CLI \(`gh`\) is not on this runner's PATH/m);
    });
  }

  it("no git: the same — exit 1 under soft, git named", async () => {
    const { r, text, seen } = await runWith({ GITHUB_ACTIONS: "true" }, ["git"], "soft");
    expect(r.code, text).to.equal(1);
    expect(seen).to.deep.equal([]);
    expect(text).to.contain("GOV-FRM-468: `git` is not on this runner's PATH").and.contain("https://git-scm.com");
  });

  it("any other could-not-tell keeps the posture rules: soft exit 0, hard exit 1", async () => {
    const soft = await runWith({ GITHUB_ACTIONS: "true" }, [], "soft", "cannot-tell");
    expect(soft.text).to.contain("something else could not be read");
    expect(soft.r.code).to.equal(0);
    expect((await runWith({ GITHUB_ACTIONS: "true" }, [], "hard", "cannot-tell")).r.code).to.equal(1);
  });

  it("tools present, or not in GitHub Actions: no such finding, and the proposer runs", async () => {
    for (const [env, missing] of [[{ GITHUB_ACTIONS: "true" }, []], [{}, ["gh", "git"]]] as const) {
      const { text, seen } = await runWith(env, missing);
      expect(text).to.not.contain("not on this runner's PATH");
      expect(seen).to.have.length(1);
    }
  });
});

// ── the gate starts from the prose (Policy Owner, 2026-10-07): PR #5 in the sandbox ──────────────────────────
describe("GOV-FRM-468 a changed section with no rules is stale too — the check names it, and local propose writes its line", () => {
  // §4 changes; §4 has no rule rows. The gate starts from the prose: someone (propose and its model) must read it.
  const S4 = POLICY("Use approved tools.").replace("Keep data safe.", "Keep data safe and encrypted at rest.");
  const sha4 = sectionShas(S4).get("4")!;
  const NO_RULE = { verdicts: [], ownership: [], questions: [] };

  it("gate `unreviewed` → the check fails naming the section and the local fix (the model's run), and writes nothing", async () => {
    const w = prWorld(baseFiles({ [DOC]: S4 }));
    const before = judgePolicyPr({ base: memTree(baseFiles()), head: memTree(baseFiles({ [DOC]: S4 })), pr: 9, today: "2026-10-07" });
    expect(before.findings.map((f) => f.check)).to.include("unreviewed").and.not.include("sha");
    const r = await proposeOnPullRequest(TAG, "pull_request", EVENT, w.deps);
    expect(r.verdict).to.equal("miss");
    expect(r.findings.join("\n")).to.contain(`${DOC} §4`).and.contain("organization's model");
    expect(readOnly(w.calls)).to.equal(true);
  });

  it("local `gov rules propose` before the pull request opens writes the `no rule` line; the number follows; then the check and the gate pass", async () => {
    const files = baseFiles({ [DOC]: S4 });
    const head = memTree(files);
    const model = scriptedModel([NO_RULE]);
    const r = await rulesPropose({ git: fakeGit(baseFiles()), head, channel: answers([]), model: () => model },
      { home: "/gov", defaultBranch: "main", all: false, today: "2026-10-07", author: "alice" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(files["policies/CHANGELOG.md"]).to.contain(`- ${DOC} §4 (${sha4}) → no rule`).and.contain("| _not yet open_ |");
    expect(files["policies/VERSION"], "prose only → patch").to.equal("1.0.1\n");
    // gov close opens #9 and names it — no model, the no-rule line kept.
    expect(numberPolicyPr(fakeGit(baseFiles()), head, { home: "/gov", defaultBranch: "main", pr: 9, today: "2026-10-07", author: "alice" })).to.deep.equal({ wrote: ["policies/CHANGELOG.md"] });
    expect(files["policies/CHANGELOG.md"]).to.contain(`- ${DOC} §4 (${sha4}) → no rule`).and.contain("| #9 | @alice |");
    expect(model.calls).to.equal(1);
    expect(judgePolicyPr({ base: memTree(baseFiles()), head: memTree(files), pr: 9, today: "2026-10-07" }).findings).to.deep.equal([]);
    const w = prWorld(files);
    expect((await proposeOnPullRequest(TAG, "pull_request", EVENT, w.deps)).verdict).to.equal("pass");
    expect(readOnly(w.calls)).to.equal(true);
  });
});
