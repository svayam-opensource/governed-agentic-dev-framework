// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `gov evidence enable` (plan 02 E07; Policy Owner Q1 + Q2) over a FAKE gh: the evidence branch `gov/evidence` as an
// orphan with evidence/README.md and evidence/keys/roots.json; a ruleset that refuses force push and deletion on it;
// a customer-owned GitHub App with contents:write, installed on the gov repo only, its key stored as an org secret.
// A second run changes nothing, and the default branch is never touched. No live GitHub.
import { expect } from "chai";
import { evidenceEnable, evidenceAppManifest, EVIDENCE_RULESET, EVIDENCE_APP_SECRETS, type EvidenceSetupConfig } from "../../src/lifecycle/evidence-setup.js";
import { githubVcs, type GhCall } from "../../src/adapters/github/vcs-evidence.js";
import type { StartLoopback } from "../../src/cli/app-loopback.js";

const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIfakeKEYmaterial\n-----END RSA PRIVATE KEY-----\n";

interface Call { args: readonly string[]; input?: string }

/** A fake GitHub behind `gh`: one org, one gov repo, state that persists across runs. */
function fakeGitHub(opts: { rulesetsForbidden?: boolean } = {}) {
  const state = {
    branches: new Map<string, string>([["main", "m0"]]),
    rulesets: [] as { id: number; name: string; body: unknown }[],
    apps: new Set<string>(),
    secrets: new Map<string, string>(),
    trees: [] as unknown[], commits: [] as { parents: unknown[]; tree: string }[], refs: [] as string[],
  };
  const calls: Call[] = [];
  const okOut = (j: unknown) => ({ status: 0, stdout: JSON.stringify(j), stderr: "" });
  const notFound = { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
  const gh: GhCall = (args, input) => {
    calls.push({ args, ...(input !== undefined ? { input } : {}) });
    const a = args.join(" ");
    let m: RegExpExecArray | null;
    if (a === "api /repos/acme/gov") return okOut({ default_branch: "main", html_url: "https://github.com/acme/gov", visibility: "private" });
    if ((m = /^api \/repos\/acme\/gov\/branches\/(.+)$/.exec(a))) {
      const name = decodeURIComponent(m[1]!);
      const sha = state.branches.get(name);
      return sha ? okOut({ name, commit: { sha }, protected: state.rulesets.length > 0 }) : notFound;
    }
    if (a === "api -X POST /repos/acme/gov/git/trees --input -") { state.trees.push(JSON.parse(input!)); return okOut({ sha: `t${state.trees.length}` }); }
    if (a === "api -X POST /repos/acme/gov/git/commits --input -") { const b = JSON.parse(input!); state.commits.push(b); return okOut({ sha: `c${state.commits.length}` }); }
    if (a === "api -X POST /repos/acme/gov/git/refs --input -") {
      const b = JSON.parse(input!) as { ref: string; sha: string };
      const name = b.ref.replace(/^refs\/heads\//, "");
      if (state.branches.has(name)) return { status: 1, stdout: "", stderr: "Reference already exists (HTTP 422)" };
      state.refs.push(b.ref); state.branches.set(name, b.sha); return okOut({ ref: b.ref });
    }
    if (a === "api /repos/acme/gov/rulesets?per_page=100") return opts.rulesetsForbidden ? { status: 1, stdout: "", stderr: "Upgrade to GitHub Team to enable this feature. (HTTP 403)" } : okOut(state.rulesets.map(({ id, name }) => ({ id, name })));
    if (a === "api -X POST /repos/acme/gov/rulesets --input -") { const b = JSON.parse(input!) as { name: string }; const id = state.rulesets.length + 10; state.rulesets.push({ id, name: b.name, body: b }); return okOut({ id }); }
    if ((m = /^api \/apps\/(.+)$/.exec(a))) return state.apps.has(m[1]!) ? okOut({ slug: m[1] }) : notFound;
    if (/^api -X POST \/app-manifests\/(.+)\/conversions$/.test(a)) { state.apps.add("acme-gov-evidence"); return okOut({ slug: "acme-gov-evidence", client_id: "Iv1.abc", pem: PEM, id: 5 }); }
    if (a === "secret list --org acme --json name") return okOut([...state.secrets.keys()].map((name) => ({ name })));
    if ((m = /^secret set (\S+) --org acme --visibility all$/.exec(a))) { state.secrets.set(m[1]!, input ?? ""); return okOut({}); }
    return { status: 1, stdout: "", stderr: `fake gh: unexpected ${a}` };
  };
  return { gh, calls, state };
}

function loopbackFake(): StartLoopback & { pages: string[] } {
  const pages: string[] = [];
  const f = (o: Parameters<StartLoopback>[0]) => {
    pages.push(o.page("http://127.0.0.1:5555/callback"));
    return Promise.resolve({ url: "http://127.0.0.1:5555/", code: Promise.resolve("code123"), close: () => undefined });
  };
  return Object.assign(f, { pages }) as StartLoopback & { pages: string[] };
}

const cfg: EvidenceSetupConfig = { githubOrg: "acme", workspaceRepo: "gov", orgSlugLower: "acme" };

const writes = (calls: readonly Call[]): Call[] => calls.filter((c) => c.args.includes("POST") || c.args[1] === "set" || c.args.includes("PATCH") || c.args.includes("PUT") || c.args.includes("DELETE"));

describe("gov evidence enable — branch, ruleset, writer App (Q1, Q2)", () => {
  it("creates gov/evidence as an orphan holding evidence/README.md and evidence/keys/roots.json", async () => {
    const g = fakeGitHub();
    const r = await evidenceEnable({ vcs: githubVcs(g.gh), loopback: loopbackFake(), newState: () => "st", say: () => undefined }, cfg);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(g.state.branches.has("gov/evidence")).to.equal(true);
    expect(g.state.commits).to.have.length(1);
    expect(g.state.commits[0]!.parents).to.deep.equal([]);
    const tree = g.state.trees[0] as { tree: { path: string; content: string }[] };
    expect(tree.tree.map((t) => t.path).sort()).to.deep.equal(["evidence/README.md", "evidence/keys/roots.json"]);
    const roots = JSON.parse(tree.tree.find((t) => t.path === "evidence/keys/roots.json")!.content) as { roots: unknown[] };
    expect(roots.roots).to.be.an("array");   // the shape gov-check writes and gov evidence verify reads
    expect(tree.tree.find((t) => t.path === "evidence/README.md")!.content).to.match(/gov evidence verify/);
  });

  it("the ruleset payload is exact: on refs/heads/gov/evidence, no force push, no deletion, no bypass", async () => {
    const g = fakeGitHub();
    await evidenceEnable({ vcs: githubVcs(g.gh), loopback: loopbackFake(), newState: () => "st", say: () => undefined }, cfg);
    expect(g.state.rulesets).to.have.length(1);
    expect(g.state.rulesets[0]!.body).to.deep.equal({
      name: "gov evidence",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/heads/gov/evidence"], exclude: [] } },
      rules: [{ type: "non_fast_forward" }, { type: "deletion" }],
      bypass_actors: [],
    });
    expect(EVIDENCE_RULESET.rules.map((x) => x.type)).to.not.include("update");   // pushes stay open to the App and members
  });

  it("the App manifest asks for exactly contents: write, for the gov repo only — no webhook, private", async () => {
    const lb = loopbackFake();
    const g = fakeGitHub();
    const lines: string[] = [];
    const r = await evidenceEnable({ vcs: githubVcs(g.gh), loopback: lb, newState: () => "st", say: (l) => lines.push(l) }, cfg);
    const m = evidenceAppManifest(cfg, "http://127.0.0.1:5555/callback");
    expect(m.default_permissions).to.deep.equal({ contents: "write" });
    expect(m.default_events).to.deep.equal([]);
    expect(m.public).to.equal(false);
    expect(m.hook_attributes.active).to.equal(false);
    expect(m.name).to.equal("acme gov evidence");
    expect(lb.pages[0]).to.include(encodeURIComponent("acme")).and.include("&quot;contents&quot;:&quot;write&quot;");
    const out = [...lines, ...r.lines].join("\n");
    expect(out).to.match(/Only select repositories.*→ gov\b/);
    expect(out).to.include("https://github.com/apps/acme-gov-evidence/installations/new");
  });

  it("stores the App's client id and private key as org secrets — the key on gh's stdin only, never printed", async () => {
    const g = fakeGitHub();
    const lines: string[] = [];
    const r = await evidenceEnable({ vcs: githubVcs(g.gh), loopback: loopbackFake(), newState: () => "st", say: (l) => lines.push(l) }, cfg);
    expect(g.state.secrets.get(EVIDENCE_APP_SECRETS.privateKey)).to.equal(PEM);
    expect(g.state.secrets.get(EVIDENCE_APP_SECRETS.clientId)).to.equal("Iv1.abc");
    for (const c of g.calls) expect(c.args.join(" ")).to.not.include("MIIfakeKEYmaterial");
    expect([...lines, ...r.lines].join("\n")).to.not.include("MIIfakeKEYmaterial");
  });

  it("a second run is a no-op: nothing written, each step says it is already there", async () => {
    const g = fakeGitHub();
    const deps = { vcs: githubVcs(g.gh), loopback: loopbackFake(), newState: () => "st", say: () => undefined };
    await evidenceEnable(deps, cfg);
    const before = g.calls.length;
    const lb2 = loopbackFake();
    const r2 = await evidenceEnable({ ...deps, loopback: lb2 }, cfg);
    expect(r2.code, r2.lines.join("\n")).to.equal(0);
    expect(writes(g.calls.slice(before))).to.deep.equal([]);
    expect(lb2.pages).to.deep.equal([]);   // no browser round-trip either
    expect(r2.lines.join("\n")).to.match(/already/);
  });

  it("never touches the default branch: the only ref written is refs/heads/gov/evidence", async () => {
    const g = fakeGitHub();
    await evidenceEnable({ vcs: githubVcs(g.gh), loopback: loopbackFake(), newState: () => "st", say: () => undefined }, cfg);
    expect(g.state.refs).to.deep.equal(["refs/heads/gov/evidence"]);
    expect(g.state.branches.get("main")).to.equal("m0");
    for (const c of writes(g.calls)) {
      expect(c.args.join(" ") + (c.input ?? "")).to.not.match(/refs\/heads\/main|"main"|branches\/main/);
    }
  });

  it("a plan without rulesets: says so plainly, still creates the branch and the App, exits 1", async () => {
    const g = fakeGitHub({ rulesetsForbidden: true });
    const r = await evidenceEnable({ vcs: githubVcs(g.gh), loopback: loopbackFake(), newState: () => "st", say: () => undefined }, cfg);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/ruleset/i).and.match(/Upgrade to GitHub Team/);
    expect(g.state.branches.has("gov/evidence")).to.equal(true);
    expect(g.state.secrets.has(EVIDENCE_APP_SECRETS.privateKey)).to.equal(true);
  });

  it("org-config without github_org / org_gov_repo → nothing is asked of GitHub", async () => {
    const g = fakeGitHub();
    const r = await evidenceEnable({ vcs: githubVcs(g.gh), loopback: loopbackFake(), newState: () => "st", say: () => undefined }, { ...cfg, githubOrg: "" });
    expect(r.code).to.equal(1);
    expect(g.calls).to.deep.equal([]);
  });
});
