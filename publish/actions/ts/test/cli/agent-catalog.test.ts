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
  variantStatuses, runnableVariants, harnessFileFor,
} from "../../src/cli/agent-catalog.js";
import { ROOT_HARNESS_FILES, verifyAgentContext, PROTOCOL_MARKER, RENDERED_BANNER } from "../../src/lifecycle/root-protocol.js";

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
    // NOT THE WHOLE CATALOG. A walk saw all ten proposed as an org's defaults, Windsurf
    // included — gov suggesting agents its own adoption menu declines to offer. `deferred`
    // means "not offered", and that has to hold on every path that shows a list.
    expect(empty.ids).to.have.length(AGENT_CATALOG.filter((a) => !a.deferred).length);
    expect(empty.ids, "a deferred agent is never proposed as a default").to.not.include("windsurf");
    expect(empty.ids, "and `launch: none` entries were already excluded elsewhere").to.include("claude-code");
    expect(approvedAgents(["cursor"]).usingDefaults).to.equal(false);
    // AN ORG'S OWN LIST IS HONOURED VERBATIM, deferred or not: upgrading gov must never take
    // an agent away from an organization that approved it.
    expect(approvedAgents(["windsurf"]).ids).to.deep.equal(["windsurf"]);
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

  it("an agent with a CLI variant is runnable with no editor at all", () => {
    // THIS TEST USED TO BE ABOUT CLINE, on the grounds that "Cline has no CLI". Cline shipped
    // one (npm `cline`), so the example was asserting a fact about the vendor that had stopped
    // being true — and freezing gov into offering an agent it could not install.
    //
    // The shape worth testing is unchanged: a CLI variant needs no host, an extension variant
    // needs one. Cline now has both, which makes it the better example rather than a worse one.
    const cline = AGENT_CATALOG.find((x) => x.id === "cline")!;
    expect(cline.variants!.some((v) => v.kind === "cli"), "cline has a terminal route now").to.equal(true);
    // `hasTool` answers "is this present", so nothing is RUNNABLE on a bare machine — a CLI
    // included. That is the honest reading and the distinction that matters: installable is
    // not the same as runnable, and this agent is now the former without an editor.
    expect(runnableVariants(variantStatuses(cline, () => false)), "a bare machine can run nothing")
      .to.have.length(0);
    expect(runnableVariants(variantStatuses(cline, (c) => c === "cline")), "its own binary, no editor")
      .to.have.length(1);
    // With an editor and no CLI, only the extension route is offered — which is what the
    // previous version of this test was really checking.
    expect(runnableVariants(variantStatuses(cline, (c) => c === "code")), "editor only")
      .to.have.length(1);
  });

  it("an EXTENSION-ONLY agent is still unrunnable without a host, and says so", () => {
    // The case cline used to demonstrate, kept alive with an agent that genuinely has no
    // binary. `windsurf`'s only route is its own editor; `chatgpt-web` has no route at all.
    const ws = AGENT_CATALOG.find((x) => x.id === "windsurf")!;
    expect(ws.variants!.every((v) => v.kind === "editor" || v.kind === "extension")).to.equal(true);
    expect(ws.install?.npm, "and gov must not claim to install it from npm").to.equal(undefined);
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
    // It said `@bobsworkshop/cli` here. That package is not IBM's (#201) — see the
    // vendor-scope tests below for the rule that now holds this.
    expect(cli.install!.script).to.match(/https:\/\/bob\.ibm\.com\//);
  });

  it("watsonx Code Assistant is deliberately absent — it reads no rules file", () => {
    // A different IBM product, verified against three sources. Listing it would mean
    // launching someone into a governed project with the governance missing.
    expect(AGENT_CATALOG.map((a) => a.id)).to.not.include("watsonx-code-assistant");
  });
});

/**
 * WHERE AN INSTALL COMES FROM (#201).
 *
 * `ibm-bob` shipped with `npm: "@bobsworkshop/cli"` — a package by one unaffiliated
 * maintainer, not IBM. `planAgentInstall` prefers npm over a vendor script, so the wrong
 * one was not merely reachable, it was always chosen; and per #196 Q2 approval IS the trust
 * decision, so an Infrastructure Owner who approved IBM's agent consented to a stranger's.
 *
 * A hand-check does not survive the next agent added at midnight, so the rule is a test:
 * every npm coordinate sits in a scope the named vendor owns.
 */
describe("gov-work — an install must come from the vendor it names (#201)", () => {
  /** npm scopes each vendor publishes under. Adding an agent means adding its scope here. */
  const VENDOR_SCOPES: Readonly<Record<string, readonly string[]>> = {
    "claude-code": ["@anthropic-ai"],
    "openai-codex": ["@openai"],
    "gemini-code-assist": ["@google"],
    "github-copilot": ["@github"],
    aider: ["@aider"],
    continue: ["@continuedev"],
  };

  /**
   * UNSCOPED packages a human has checked, with the evidence written down.
   *
   * The scope test is a MECHANISM for the real rule — "a person confirmed this package is the
   * vendor's" — and it only works for scoped names. `cline` is unscoped, so it can never start
   * with `@vendor/` and the guard would have refused it forever, pushing the entry back to a
   * url-only state that is now simply wrong.
   *
   * This does not prove provenance; nothing in a unit test can. It records that the check was
   * made, which is exactly what the scope list records for the scoped ones.
   */
  const UNSCOPED_VERIFIED: Record<string, { readonly pkg: string; readonly evidence: string }> = {
    // npm `cline` v3.0.61 — repository github.com/cline/cline; maintainers john@cline.bot,
    // saoud@cline.bot, beatrix@cline.bot. Checked 2026-09-10.
    cline: { pkg: "cline", evidence: "repo cline/cline, maintainers @cline.bot, checked 2026-09-10" },
  };

  const npmInstalls = (): Array<{ id: string; pkg: string }> => {
    const out: Array<{ id: string; pkg: string }> = [];
    for (const a of AGENT_CATALOG) {
      if (a.install?.npm) out.push({ id: a.id, pkg: a.install.npm });
      for (const v of a.variants ?? []) if (v.install?.npm) out.push({ id: a.id, pkg: v.install.npm });
    }
    return out;
  };

  it("every npm package is in a scope the vendor owns", () => {
    for (const { id, pkg } of npmInstalls()) {
      const unscoped = UNSCOPED_VERIFIED[id];
      if (unscoped) {
        expect(pkg, `${id}: '${pkg}' is not the unscoped package that was verified (${unscoped.evidence})`)
          .to.equal(unscoped.pkg);
        continue;
      }
      const scopes = VENDOR_SCOPES[id];
      expect(scopes, `${id} installs '${pkg}' from npm and no vendor scope is declared for it — ` +
        "add one only after checking the package's maintainers, or install from the vendor's own URL").to.not.equal(undefined);
      expect(scopes!.some((s) => pkg.startsWith(`${s}/`)), `${id}: '${pkg}' is outside ${scopes!.join(", ")}`).to.equal(true);
    }
  });

  it("ibm-bob installs from IBM's own channel, never npm", () => {
    const bob = AGENT_CATALOG.find((a) => a.id === "ibm-bob")!;
    const everyInstall = [bob.install, ...(bob.variants ?? []).map((v) => v.install)].filter(Boolean);
    for (const i of everyInstall) {
      expect(i!.npm, "no npm coordinate — the one that was here was not IBM's").to.equal(undefined);
      expect(i!.url).to.match(/^https:\/\/bob\.ibm\.com/);
    }
    expect(bob.install?.script, "IBM's script is the channel").to.match(/^curl -fsSL https:\/\/bob\.ibm\.com\//);
  });

  it("every install names where it comes from, runnable or not", () => {
    // `url` is required even where gov cannot install the thing — windsurf, cline and
    // continue are downloads or extensions, and the URL is what the menu shows instead of
    // silently offering nothing.
    for (const a of AGENT_CATALOG) {
      if (!a.install) continue;
      expect(a.install.url, `${a.id} must name where it comes from`).to.match(/^https:\/\//);
    }
  });
});

/**
 * THE ASSERTION WHOSE ABSENCE COST CLINE ITS GOVERNANCE.
 *
 * `agent-catalog` already checked that every rendered harness is in the catalog — by ID. Both
 * of the places that name a harness PATH went unchecked, and both drifted: `ROOT_HARNESS_FILES`
 * said `.clinerules` where the manifest renders `.clinerules/agent.md`, so the mirror loop read
 * a directory, got null, and skipped it without a word. Cline launched into governed projects
 * with an empty context for as long as that stood.
 *
 * Three copies of the same fact is the real defect and it stays for now (the manifest is not
 * shipped at runtime, so neither source can read it). What must not stay is three copies with
 * nothing comparing them.
 */
describe("gov-work — harness PATHS agree with the manifest, not just ids", () => {
  function manifestPaths(): Map<string, string> {
    const text = fs.readFileSync(path.join(repoRoot, "agent", "harness-manifest.yaml"), "utf8");
    const out = new Map<string, string>();
    for (const b of text.split(/^ {2}- id:\s*/m).slice(1)) {
      const id = b.split(/\s/)[0]!;
      const status = /^\s*status:\s*(\S+)/m.exec(b)?.[1] ?? "";
      const p = /^\s*path:\s*(\S+)/m.exec(b)?.[1] ?? "";
      // `publish/content/<rel>` is what the renderer writes; <rel> is what the agent reads.
      const rel = p.replace(/^publish\/content\//, "");
      if (status === "active" && rel && rel !== p) out.set(id, rel);
    }
    return out;
  }

  it("harnessFileFor returns the path the renderer actually writes", () => {
    for (const [id, rel] of manifestPaths()) {
      if (!AGENT_CATALOG.some((a) => a.id === id)) continue;
      expect(harnessFileFor(id), `${id}: harnessFileFor vs harness-manifest.yaml`).to.equal(rel);
    }
  });

  it("the project-root mirror list covers every rendered harness path", () => {
    const mirrored = new Set<string>(ROOT_HARNESS_FILES);
    for (const [id, rel] of manifestPaths()) {
      if (!AGENT_CATALOG.some((a) => a.id === id)) continue;
      expect(mirrored.has(rel), `${id}: '${rel}' is rendered but never mirrored to the project root`).to.equal(true);
    }
  });

  it("and mirrors nothing that is not a rendered harness", () => {
    const rendered = new Set([...manifestPaths().values()]);
    for (const rel of ROOT_HARNESS_FILES) {
      expect(rendered.has(rel), `'${rel}' is mirrored but no active harness renders it`).to.equal(true);
    }
  });

  it("every mirrored file exists in the shipped content — the render really happened", () => {
    for (const rel of ROOT_HARNESS_FILES) {
      const at = path.join(repoRoot, "publish", "content", rel);
      expect(fs.existsSync(at), `${rel} is mirrored but not rendered into publish/content`).to.equal(true);
      expect(fs.readFileSync(at, "utf8"), `${rel} carries the version marker gov verifies`).to.contain(PROTOCOL_MARKER);
    }
  });
});

describe("gov-work — gov verifies the context before it launches (the guarantee's teeth)", () => {
  // Windows CI has failed a correct answer here before (logDirFor, 2026-09): compare separators
  // as posix, because what is being asserted is the PATH, not the platform.
  const px = (p: string) => p.split(path.sep).join("/");
  const at = (rel: string) => `/work/PRJ-9/${rel}`;
  const fsOf = (files: Record<string, string>) => ({ readFile: (f: string) => files[px(f)] ?? null });

  it("passes when the placed file is gov's protocol", () => {
    const v = verifyAgentContext(fsOf({ [at("CLAUDE.md")]: "<!-- gov-protocol-version: 2 -->\n# protocol" }), "/work/PRJ-9", "CLAUDE.md");
    expect(v.ok).to.equal(true);
  });

  it("blocks when the file was never placed — the .clinerules case, now named out loud", () => {
    const v = verifyAgentContext(fsOf({}), "/work/PRJ-9", ".clinerules/agent.md");
    expect(v.ok).to.equal(false);
    if (v.ok) return;
    expect(v.why).to.contain("not there");
    expect(px(v.at), "says WHICH path, so it can be checked").to.equal(at(".clinerules/agent.md"));
  });

  it("blocks on an empty file — a truncated write is not a governed session", () => {
    const v = verifyAgentContext(fsOf({ [at("AGENTS.md")]: "   \n\n" }), "/work/PRJ-9", "AGENTS.md");
    expect(v.ok).to.equal(false);
    if (!v.ok) expect(v.why).to.contain("empty");
  });

  it("blocks on someone else's file of the same name, rather than overwriting it", () => {
    // An adopter's own CLAUDE.md is a real possibility. Silently replacing it would be its own
    // defect, so the refusal names the conflict — and it is told apart from gov's own older
    // renders by the absence of the renderer's banner, not by the version marker alone.
    const v = verifyAgentContext(fsOf({ [at("CLAUDE.md")]: "# my own house rules\nuse tabs" }), "/work/PRJ-9", "CLAUDE.md");
    expect(v.ok).to.equal(false);
    if (!v.ok) expect(v.why).to.contain("not a file gov rendered");
  });

  it("an OLDER gov protocol still governs — it warns, it does not refuse", () => {
    // THE DEFECT A WALK FOUND, and it was mine. The first version of this gate refused anything
    // without a `gov-protocol-version` line. That line was added on 2026-09-11; the content
    // every organization adopted before then was seeded from predates it — the 118-line protocol
    // on `main` carries the renderer's banner and no marker. So the gate blocked every agent
    // launch in every existing organization, on content that is perfectly valid governance.
    //
    // Refusing there inverts the guarantee's purpose: it exists so nobody is handed an
    // UNGOVERNED session, and an org running last month's protocol is governed, just not current.
    const old118 = [
      "<!-- GENERATED from the framework harness source — do not edit by hand -->",
      "",
      "# Agent Session-Start Protocol — <ORG_NAME>",
      "## Context manifest",
    ].join("\n");
    const v = verifyAgentContext(fsOf({ [at("AGENTS.md")]: old118 }), "/work/PRJ-9", "AGENTS.md");
    expect(v.ok, "it must LAUNCH").to.equal(true);
    if (!v.ok) return;
    expect(v.current, "but it is not the current protocol").to.equal(false);
    if (v.current) return;
    expect(v.why, "and says why, so the warning is actionable").to.contain("earlier framework version");
  });

  it("the banner is what separates gov's older render from a stranger's file", () => {
    // Same absence of a marker, opposite verdicts. If this ever collapses to one answer, the
    // gate is either bricking existing orgs again or silently accepting anyone's CLAUDE.md.
    const banner = "<!-- GENERATED from the framework harness source — do not edit by hand -->";
    expect(RENDERED_BANNER, "the constant must match the manifest's banner").to.be.a("string");
    expect(banner).to.contain(RENDERED_BANNER);
    const govs = verifyAgentContext(fsOf({ [at("AGENTS.md")]: `${banner}\n# protocol` }), "/work/PRJ-9", "AGENTS.md");
    const mine = verifyAgentContext(fsOf({ [at("AGENTS.md")]: "# protocol" }), "/work/PRJ-9", "AGENTS.md");
    expect(govs.ok, "gov's own older file: launch").to.equal(true);
    expect(mine.ok, "a file gov never wrote: refuse").to.equal(false);
  });

  it("the banner it looks for is the one the manifest defines", () => {
    // Asserted against the manifest, because that is where the renderer reads it from. A
    // reworded banner would otherwise turn every existing org's protocol into "a stranger's
    // file" and start refusing launches again — the exact failure this pair of branches fixed.
    const m = fs.readFileSync(path.join(repoRoot, "agent", "harness-manifest.yaml"), "utf8");
    const line = /^generated_banner:\s*"(.+)"\s*$/m.exec(m);
    expect(line, "harness-manifest.yaml must define generated_banner").to.not.equal(null);
    expect(line![1], "and verifyAgentContext must look for a substring of it").to.contain(RENDERED_BANNER);
  });

  it("the marker it looks for is the one the protocol source carries", () => {
    // Asserted at the SOURCE, not the render output — the block above already checks the output.
    // A source edit that drops the line would otherwise pass every test and make every agent
    // unlaunchable, with the cause nowhere near the effect. The renderer now hard-fails on it
    // too; this is the same fact asserted where it is cheapest to see.
    const src = fs.readFileSync(path.join(repoRoot, "agent", "session-protocol.md"), "utf8");
    expect(src, "session-protocol.md must carry the marker verifyAgentContext requires").to.contain(PROTOCOL_MARKER);
    const r = fs.readFileSync(path.join(repoRoot, "agent", "render-harness.mjs"), "utf8");
    expect(r, "and the renderer must refuse to render without it").to.contain(PROTOCOL_MARKER);
  });
});
