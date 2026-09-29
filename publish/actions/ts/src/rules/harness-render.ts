// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * RENDERING THE NINE AGENT FILES — moved into gov so that an ADOPTER's policy can reach their agents.
 *
 * This lived in `agent/render-harness.mjs`, a script in the publisher's repository that gov does not carry and an
 * adopter never receives. The consequence was narrow and fatal: the framework's own cues could become resident
 * agent instructions, because we ran the script by hand, and **an organization's own cues could not, ever**.
 * "Write a policy and your agents will follow it" was true for us and false for every customer.
 *
 * Nine files, one text. Every approved agent reads its own conventional path — `CLAUDE.md`, `AGENTS.md`,
 * `.cursor/rules/agent.mdc`, and the rest — and none of them can follow a pointer, so the content is INLINED
 * rather than imported. `@`-imports were retired for exactly this reason: they worked for one vendor and made
 * that vendor the better-governed choice for a reason unrelated to its merits (gov-behaviour.md §8).
 *
 * Pure: text in, files out. No disk, no clock, no randomness — `--check` compares bytes, so a renderer whose
 * output varied would make the check meaningless and the guarantee unverifiable.
 */
import { parseCueBlocks, CUE_HEADER } from "./cue-block.js";
import type { PolicyDoc } from "./rules-build.js";

/** The marker `verifyAgentContext` looks for before it will launch an agent. */
export const PROTOCOL_MARKER = "gov-protocol-version";

/** The banner every generated file carries, so nobody edits the copy instead of the source. */
export const GENERATED_BANNER = "<!-- GENERATED from the framework harness source — do not edit by hand -->";

/** The placeholder in `session-protocol.md` that the resident block replaces. */
export const RESIDENT_PLACEHOLDER = "{{render.always_rules}}";

/**
 * The nine targets, and the two templates that exist.
 *
 * A TEST ASSERTS THIS COVERS `ROOT_HARNESS_FILES` EXACTLY, because these two lists have drifted before with no
 * symptom: `.clinerules` was rendered to a path no tool reads, so cline launched into a governed project with
 * nothing in context, and every assertion about the protocol being present passed. Nothing failed — that is what
 * makes a delivery defect different from a bug.
 */
export const HARNESS_TARGETS: readonly { readonly path: string; readonly template: "plain" | "cursor" }[] = [
  { path: "AGENTS.md", template: "plain" },                          // openai-codex, ibm-bob
  { path: "CLAUDE.md", template: "plain" },                          // claude-code — rendered text, not an @-import
  { path: "CONVENTIONS.md", template: "plain" },                     // aider (invoked with --read)
  { path: "GEMINI.md", template: "plain" },                          // gemini-code-assist
  { path: ".clinerules/agent.md", template: "plain" },               // cline — a DIRECTORY of rules
  { path: ".continue/rules/agent.md", template: "plain" },           // continue — a DIRECTORY it scans
  { path: ".windsurf/rules/agent.md", template: "plain" },           // windsurf
  { path: ".github/copilot-instructions.md", template: "plain" },    // github-copilot
  { path: ".cursor/rules/agent.mdc", template: "cursor" },           // cursor — needs front matter
];

/** Cursor only loads a rule on every turn when `alwaysApply` is set; without it the file is advisory. */
const CURSOR_FRONT_MATTER = [
  "---",
  'description: "Agentic Development Framework — session-start protocol and the resident rules"',
  'globs: ["**/*"]',
  "alwaysApply: true",
  "---",
  "",
].join("\n");

/** A failure the caller must surface, never throw past. */
export interface RenderFailure { readonly error: string }

/**
 * Assemble the resident block from every document's cue blocks.
 *
 * FRAMEWORK FIRST, then the organization — a reading convenience only. Position creates no precedence: a model
 * does not rank instructions by where they appear, so "framework rules win" is enforced at compile time and by
 * checks that run regardless of configuration, never by ordering (framework-policy.md §9.1, §10.1).
 */
export function assembleResidentBlock(docs: readonly PolicyDoc[]): string | RenderFailure {
  const cues: string[] = [];
  for (const doc of docs) {
    for (const block of parseCueBlocks(doc.path, doc.text).blocks) {
      // The `**Always in the agent's context**` label earns its place in the POLICY, where it tells a reader
      // which clauses are resident. Here it would be one copy per cue of a fact the file itself is — so the
      // clause's own citation becomes the heading, which is what a reader needs in order to look the rule up.
      const heading = `> **${block.cite} · ${block.level}**`;
      const body = block.cue.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n");
      cues.push(`${heading}\n${body}`);
    }
  }
  if (!cues.length) {
    return {
      error: "no `gov:cue` blocks found in any policy document — the resident block would render EMPTY, and a "
        + "harness file with an empty resident block looks governed and governs nothing. Every resident rule is a "
        + "cue block beside its clause; see framework-policy.md §1.4.",
    };
  }
  return [
    "**These rules bind every turn, not just the first. Each is compiled from the clause it names, and the",
    "clause is the authority — read it with `gov knowledge show <the document named>`.**",
    "",
    // BLANK LINES BETWEEN THEM. Markdown fuses adjacent blockquotes into one block, so without this the rules
    // arrive as a single wall of text — which is how a resident block stops being read.
    cues.join("\n\n"),
  ].join("\n");
}

/** One file's content: the banner, then the body in this target's template. */
export function renderHarnessFile(target: (typeof HARNESS_TARGETS)[number], body: string): string {
  const head = target.template === "cursor" ? `${CURSOR_FRONT_MATTER}${GENERATED_BANNER}` : GENERATED_BANNER;
  return `${head}\n\n${body.replace(/\n+$/, "")}\n`;
}

/**
 * Every file, from the protocol body and the policies.
 *
 * Fatal when the protocol carries no version marker: `verifyAgentContext` refuses to launch an agent whose
 * instructions file lacks it, so rendering without it would turn every agent unlaunchable in a way whose cause
 * is nowhere near its effect.
 */
export function renderAll(protocolBody: string, docs: readonly PolicyDoc[]): { readonly files: readonly { path: string; content: string }[] } | RenderFailure {
  if (!protocolBody.includes(PROTOCOL_MARKER)) {
    return {
      error: `the session protocol carries no '${PROTOCOL_MARKER}' line. gov verifies that marker before launching `
        + "any agent, so every rendered file would be rejected as 'not the protocol gov renders'.",
    };
  }
  const block = assembleResidentBlock(docs);
  if (typeof block !== "string") return block;
  const body = protocolBody.replace(/\n+$/, "").split(RESIDENT_PLACEHOLDER).join(block);
  return { files: HARNESS_TARGETS.map((t) => ({ path: t.path, content: renderHarnessFile(t, body) })) };
}

/** Did the assembled block actually make it in? A protocol missing the placeholder renders without the rules. */
export const carriesResidentBlock = (content: string): boolean =>
  content.includes("These rules bind every turn") && !content.includes(RESIDENT_PLACEHOLDER);

/** The cue header a policy uses, re-exported so a caller need not know which module defines it. */
export { CUE_HEADER };
