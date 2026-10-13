// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov autorun [--intent <NN>|--all] [--dry-run] [--agent <id>] [--max-minutes <n>] [--serial|--parallel <k>]` —
 * the verb (spec 03 §3, Q11, Q16): its flags, which agent runs (only one with a verified headless mode, and one the
 * organization approved), the C01 board authorization before anything, and its place in the command reference.
 */
import { expect } from "chai";
import { parseAutorunFlags, resolveAgent } from "../../src/autorun/command.js";
import { AGENT_CATALOG } from "../../src/cli/agent-catalog.js";
import { parseArgv } from "../../src/cli/args.js";
import { routeAsync, type CliContext } from "../../src/cli/dispatch.js";
import { COMMAND_SPECS } from "../../src/cli/help-spec.js";
import { isMutatingVerb } from "../../src/rules-pending.js";
import { classifyPosture } from "../../src/config/governance.js";
import { DEFAULT_SELECTION } from "../../src/adapters/registry.js";
import type { OrgConfig } from "../../src/config/org-config.js";

const parse = (...argv: string[]) => {
  const p = parseArgv(["autorun", ...argv]);
  if ("error" in p) throw new Error(p.error);
  return parseAutorunFlags(p.positionals, p.flags);
};

describe("gov autorun — flags", () => {
  it("defaults: every item, serial, a real run", () => {
    expect(parse()).to.deep.equal({ ok: true, value: { dryRun: false } });
    expect(parse("--all")).to.deep.equal({ ok: true, value: { dryRun: false } });
    expect(parse("--serial")).to.deep.equal({ ok: true, value: { dryRun: false } });
  });

  it("--intent takes the intent's number, two digits", () => {
    expect(parse("--intent", "3")).to.deep.equal({ ok: true, value: { intent: "03", dryRun: false } });
    expect(parse("--intent", "03", "--dry-run")).to.deep.equal({ ok: true, value: { intent: "03", dryRun: true } });
    expect(parse("--intent", "x").ok).to.equal(false);
    expect(parse("--intent").ok).to.equal(false);
    expect(parse("--intent", "03", "--all").ok, "--intent and --all are two answers to one question").to.equal(false);
  });

  it("--agent and --max-minutes", () => {
    expect(parse("--agent", "claude-code", "--max-minutes", "10")).to.deep.equal({ ok: true, value: { agent: "claude-code", maxMinutes: 10, dryRun: false } });
    expect(parse("--max-minutes", "0").ok).to.equal(false);
    expect(parse("--max-minutes", "ten").ok).to.equal(false);
    expect(parse("--agent").ok).to.equal(false);
  });

  it("--parallel 1 is serial; more than one is refused, saying why — never silently serial", () => {
    expect(parse("--parallel", "1")).to.deep.equal({ ok: true, value: { dryRun: false } });
    const p = parse("--parallel", "3");
    expect(p.ok).to.equal(false);
    if (!p.ok) expect(p.message).to.match(/parallel/i);
    expect(parse("--parallel", "2", "--serial").ok).to.equal(false);
  });

  it("an unknown flag or a positional is a usage error", () => {
    expect(parse("--fast").ok).to.equal(false);
    expect(parse("03").ok).to.equal(false);
  });
});

describe("gov autorun — which agent (Q16)", () => {
  const approved = [{ id: "cursor", default: true }, { id: "claude-code" }];

  it("--agent naming an agent with a verified headless mode, approved by the org → that agent", () => {
    expect(resolveAgent("claude-code", approved, AGENT_CATALOG)).to.deep.equal({ id: "claude-code" });
  });

  it("--agent naming an agent with no headlessArgv → refused, with the reason", () => {
    const r = resolveAgent("cursor", approved, AGENT_CATALOG);
    expect(r).to.have.property("refused");
    if ("refused" in r) expect(r.refused).to.match(/headless/);
  });

  it("--agent naming an agent the org did not approve → refused", () => {
    const r = resolveAgent("claude-code", [{ id: "cursor", default: true }], AGENT_CATALOG);
    expect(r).to.have.property("refused");
    if ("refused" in r) expect(r.refused).to.match(/not approved|approved agents/i);
  });

  it("no --agent: the org's default when it can run headless, else the first approved one that can", () => {
    expect(resolveAgent(undefined, approved, AGENT_CATALOG)).to.deep.equal({ id: "claude-code" });
    expect(resolveAgent(undefined, [{ id: "claude-code", default: true }], AGENT_CATALOG)).to.deep.equal({ id: "claude-code" });
  });

  it("no approved agent can run headless → refused with the reason (the steps that need no agent still run)", () => {
    const r = resolveAgent(undefined, [{ id: "cursor", default: true }], AGENT_CATALOG);
    expect(r).to.have.property("refused");
    expect(resolveAgent(undefined, [], AGENT_CATALOG)).to.have.property("refused");
    expect(resolveAgent(undefined, null, AGENT_CATALOG)).to.have.property("refused");
  });
});

const CONFIG = {
  orgName: "A", orgShortName: "A", orgSlug: "ACME", orgSlugLower: "acme",
  githubOrg: "acme", workspaceRepo: "acme-gov", orgRepoUrl: "git@github.com:acme/acme-gov.git",
  defaultBranch: "main", defaultCodeBranch: "dev", agentWorkRoot: "/w", govWorkspace: "/gov", policyOwnerEmail: "a@x",
  orgTokens: {}, governancePosture: classifyPosture(""), adapters: DEFAULT_SELECTION,
} as unknown as OrgConfig;

function ctx(over: Record<string, unknown> = {}): { ctx: CliContext; ran: unknown[] } {
  const ran: unknown[] = [];
  const c = {
    config: CONFIG, home: "/w/PRJ-7-demo/acme-gov", today: "2026-10-13", seededBy: "ada", login: "ada",
    vcs: { currentBranch: () => "BRNCH-7-demo" }, fs: { readFile: () => null, pathExists: () => false, readdir: () => [] }, issues: {}, authorize: () => true, gate: () => ({ ok: true, failures: [] }),
    autorun: async (o: unknown) => { ran.push(o); return { code: 0, lines: ["ran"] }; },
    ...over,
  } as unknown as CliContext;
  return { ctx: c, ran };
}

describe("gov autorun — dispatch", () => {
  it("is in the command reference, with every flag", () => {
    const spec = COMMAND_SPECS.find((s) => s.name === "autorun");
    expect(spec, "help-spec entry").to.not.equal(undefined);
    for (const f of ["--intent", "--all", "--dry-run", "--agent", "--max-minutes", "--serial", "--parallel"]) expect(spec!.usage).to.contain(f);
  });

  it("is a mutating verb (closed while rule changes are pending)", () => {
    expect(isMutatingVerb("autorun")).to.equal(true);
  });

  it("routes a parsed run to the engine, for the project the workspace is on", async () => {
    const { ctx: c, ran } = ctx();
    const r = await routeAsync(parseArgv(["autorun", "--intent", "2", "--dry-run"]) as never, c);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(ran).to.deep.equal([{ intent: "02", dryRun: true }]);
  });

  it("not authorized on the project's board (C01) → refused before anything runs", async () => {
    const { ctx: c, ran } = ctx({ authorize: () => false });
    const r = await routeAsync(parseArgv(["autorun"]) as never, c);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/Not authorized/);
    expect(ran).to.deep.equal([]);
  });

  it("outside a project branch → refused", async () => {
    const { ctx: c, ran } = ctx({ vcs: { currentBranch: () => "main" } });
    const r = await routeAsync(parseArgv(["autorun"]) as never, c);
    expect(r.code).to.equal(1);
    expect(ran).to.deep.equal([]);
  });

  it("a usage error exits 2 and runs nothing", async () => {
    const { ctx: c, ran } = ctx();
    const r = await routeAsync(parseArgv(["autorun", "--parallel", "4"]) as never, c);
    expect(r.code).to.equal(2);
    expect(ran).to.deep.equal([]);
  });

  it("no engine wired → refused, never a silent skip", async () => {
    const { ctx: c } = ctx({ autorun: undefined });
    const r = await routeAsync(parseArgv(["autorun"]) as never, c);
    expect(r.code).to.equal(1);
  });
});
