// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The agent catalog, and the guard that keeps it equal to the harness manifest (#195).
 *
 * A tool without a harness has no way to read the session protocol, so offering it
 * would launch someone into a governed project with the governance missing. The
 * manifest is therefore the list, and this compares the two rather than trusting
 * that a person will remember — the fourth copy-of-a-copy this project has had to
 * put a test around.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG, agentStatuses, approvedAgents, offerable, installable, menuLines, nothingInstalledLines,
  variantStatuses, runnableVariants,
} from "../../src/cli/agent-catalog.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

/**
 * The harnesses that EXIST — `active` (rendered today) and `registered` (a
 * convention we honour). `planned` is deliberately excluded: no rules file is
 * rendered for it, so the protocol has no way to reach that tool, and offering it
 * would launch someone into a governed project with the governance missing.
 */
function manifestIds(): readonly string[] {
  const text = fs.readFileSync(path.join(repoRoot, "agent", "harness-manifest.yaml"), "utf8");
  const blocks = text.split(/^ {2}- id:\s*/m).slice(1);
  return blocks
    .map((b) => ({ id: b.split(/\s/)[0]!, status: /^\s*status:\s*(\S+)/m.exec(b)?.[1] ?? "" }))
    .filter((h) => h.status === "active" || h.status === "registered")
    .map((h) => h.id);
}

describe("gov-work — the agent catalog is the harness manifest (#195)", () => {
  it("planned harnesses are not offerable — there is no rules file for them yet", () => {
    const text = fs.readFileSync(path.join(repoRoot, "agent", "harness-manifest.yaml"), "utf8");
    expect(text, "the manifest still carries planned entries").to.contain("status: planned");
    for (const planned of ["jetbrains-ai", "amazon-q", "sourcegraph-cody"]) {
      expect(AGENT_CATALOG.map((a) => a.id), planned).to.not.include(planned);
    }
  });

  it("every harness the framework renders is in the catalog, and nothing else is", () => {
    expect([...AGENT_CATALOG.map((a) => a.id)].sort()).to.deep.equal([...manifestIds()].sort());
  });

  it("a tool with no command is carried but never offered", () => {
    // ChatGPT-in-a-browser is governed — it has a harness — and has nothing to run.
    const web = AGENT_CATALOG.find((a) => a.id === "chatgpt-web")!;
    expect(web.launch).to.equal("none");
    const statuses = agentStatuses(AGENT_CATALOG, () => true, {});
    expect(offerable(statuses, AGENT_CATALOG.map((a) => a.id)).map((s) => s.candidate.id)).to.not.include("chatgpt-web");
  });
});

describe("gov-work — what the menu offers", () => {
  const has = (...cmds: string[]) => (c: string) => cmds.includes(c);

  it("offers only what is installed", () => {
    const st = agentStatuses(AGENT_CATALOG, has("claude"), {});
    const ids = offerable(st, AGENT_CATALOG.map((a) => a.id)).map((s) => s.candidate.id);
    expect(ids).to.deep.equal(["claude-code"]);
  });

  it("offers only what the organization approved", () => {
    const st = agentStatuses(AGENT_CATALOG, has("claude", "cursor-agent"), {});
    const ids = offerable(st, ["cursor"]).map((s) => s.candidate.id);
    expect(ids, "Claude is installed but not approved here").to.deep.equal(["cursor"]);
  });

  it("falls back to the framework's list when the org has not decided — and says so", () => {
    const empty = approvedAgents([]);
    expect(empty.usingDefaults).to.equal(true);
    expect(empty.ids).to.have.length(AGENT_CATALOG.length);
    expect(approvedAgents(["cursor"]).usingDefaults).to.equal(false);
  });

  it("says what each choice DOES, not just what it is called", () => {
    const st = agentStatuses(AGENT_CATALOG, has("claude", "windsurf"), {});
    const lines = menuLines(offerable(st, AGENT_CATALOG.map((a) => a.id))).join("\n");
    expect(lines, "a CLI agent runs here").to.contain("runs the agent here, with the rules loaded");
    expect(lines, "an editor is a different offer").to.contain("opens your editor here");
    // The option that always works was the one nobody could identify.
    expect(lines).to.contain("your normal command line, in the project folder. No AI involved.");
  });

  it("mentions a missing key without ever reading one", () => {
    const withKey = agentStatuses(AGENT_CATALOG, has("claude"), { ANTHROPIC_API_KEY: "sk-x" });
    const without = agentStatuses(AGENT_CATALOG, has("claude"), {});
    expect(menuLines(offerable(withKey, ["claude-code"])).join("\n")).to.not.contain("no API key");
    expect(menuLines(offerable(without, ["claude-code"])).join("\n")).to.contain("no API key set");
  });

  it("when nothing is installed, names what could be and how — and promises no account", () => {
    const st = agentStatuses(AGENT_CATALOG, () => false, {});
    const miss = installable(st, AGENT_CATALOG.map((a) => a.id));
    const lines = nothingInstalledLines(miss, true).join("\n");
    expect(lines).to.contain("No AI agent is installed");
    expect(lines).to.contain("has not approved any agents yet");
    expect(lines).to.contain("npm i -g @anthropic-ai/claude-code");
    expect(lines, "gov never creates an account or holds a key").to.contain("signing in stays yours");
    // And it does not claim to install anything, because nothing here does (#196).
    expect(lines).to.contain("it does not run it for you yet");
  });
});

describe("gov-work — every agent's real variants (#196)", () => {
  it("names the VS Code extension for the agents that have one", () => {
    // Only Claude carried an extension at first, so the adoption menu implied that
    // Copilot, Gemini, Codex, Cline and Continue were terminal-only or editor-only.
    // All of them run inside VS Code, and most people meet them that way.
    for (const id of ["claude-code", "openai-codex", "gemini-code-assist", "github-copilot", "cline", "continue"]) {
      const a = AGENT_CATALOG.find((x) => x.id === id)!;
      const ext = a.variants?.find((v) => v.kind === "extension");
      expect(ext, `${id} has no extension variant`).to.not.equal(undefined);
      expect(ext!.extensionId, `${id} extension id`).to.be.a("string");
      expect(ext!.hosts, `${id} hosts`).to.include("code");
    }
  });

  it("a standalone editor has no extension — the editor IS the agent", () => {
    for (const id of ["cursor", "windsurf"]) {
      const a = AGENT_CATALOG.find((x) => x.id === id)!;
      expect(a.variants!.some((v) => v.kind === "editor"), id).to.equal(true);
      expect(a.variants!.some((v) => v.kind === "extension"), `${id} needs no host`).to.equal(false);
    }
  });

  it("an extension-only agent is unrunnable without a host, and says so", () => {
    // Cline has no CLI. On a machine with no editor there is nothing to launch, and
    // gov will not install an editor to create one.
    const cline = AGENT_CATALOG.find((x) => x.id === "cline")!;
    expect(cline.variants!.every((v) => v.kind === "extension")).to.equal(true);
    expect(runnableVariants(variantStatuses(cline, () => false))).to.have.length(0);
    expect(runnableVariants(variantStatuses(cline, (c) => c === "code"))).to.have.length(1);
  });
});

describe("gov-work — IBM Bob (#196)", () => {
  it("is in the catalog, because it reads a harness the framework already renders", () => {
    // Bob reads AGENTS.md — the same file Codex uses — so it needed no new template
    // and no new path. One manifest entry, and it is governed like the rest.
    const bob = AGENT_CATALOG.find((a) => a.id === "ibm-bob");
    expect(bob, "IBM was the only major vendor missing").to.not.equal(undefined);
    expect(bob!.cmd).to.equal("bob");
    expect(bob!.credentialEnv).to.equal("BOB_API_KEY");
  });

  it("has a CLI and a STANDALONE IDE — not a VS Code extension", () => {
    // IBM's own quickstart: "Bob is a standalone IDE application and not an
    // extension." The distinction matters: gov installs a standalone editor, and
    // installs an extension only into a host that already exists.
    const bob = AGENT_CATALOG.find((a) => a.id === "ibm-bob")!;
    expect(bob.variants!.map((v) => v.kind)).to.deep.equal(["cli", "editor"]);
    expect(bob.variants!.some((v) => v.kind === "extension")).to.equal(false);
  });

  it("has no login command, because Bob opens the browser itself", () => {
    // Tier 1 working as intended: the vendor authenticates, gov never goes near the
    // credential, and there is nothing for it to run.
    const cli = AGENT_CATALOG.find((a) => a.id === "ibm-bob")!.variants!.find((v) => v.kind === "cli")!;
    expect(cli.login).to.equal(undefined);
    expect(cli.install!.npm).to.equal("@bobsworkshop/cli");
  });

  it("watsonx Code Assistant is deliberately absent — it reads no rules file", () => {
    // A different IBM product, verified against three sources. Listing it would mean
    // launching someone into a governed project with the governance missing.
    expect(AGENT_CATALOG.map((a) => a.id)).to.not.include("watsonx-code-assistant");
  });
});
