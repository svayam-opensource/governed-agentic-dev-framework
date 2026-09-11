// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Make an agent launched at the PROJECT ROOT (`<project>`, the dir that holds the gov workspace + all code
 * repos) run the session-start protocol. The harness is rendered into the workspace repo; this mirrors it to
 * the root so every agent picks it up from its own conventional path. Used by BOTH `seed` (every seeded
 * project gets it) and the interactive Work flow (before launching an agent).
 *
 * ONE MECHANISM FOR ALL AGENTS — copy the rendered file to the path that agent reads. No vendor has a
 * mechanism another lacks; see the ruling recorded at the removed Claude branches below.
 * Leaf module (Fs only) — no cli/lifecycle cycle.
 */
import path from "node:path";
import type { Fs } from "./fs-io.js";

/**
 * Every agent's own path, mirrored into the project — ALL of them.
 *
 * This list had four entries, so `gemini`, `github-copilot` and `continue` were rendered into
 * the workspace and then placed nowhere the agent looks. Three of nine approved agents had
 * NOTHING in context, which the guarantee "the governance requirements are in the agent's
 * context" cannot survive. They were missing because the list was written when those three were
 * not yet in the catalog, and nothing tied the two together.
 *
 * DERIVED WOULD BE BETTER THAN LISTED. The paths are already declared per harness in
 * `agent/harness-manifest.yaml`; this is a second copy, and a second copy is what drifted.
 * Reading the manifest at runtime would need it shipped and parsed, so the list stays for now —
 * with a test asserting it covers every active harness, which is the part that was absent.
 */
export const ROOT_HARNESS_FILES = [
  "AGENTS.md",                          // openai-codex, ibm-bob
  "CLAUDE.md",                          // claude-code — rendered text now, not an @-import
  "CONVENTIONS.md",                     // aider
  ".clinerules/agent.md",               // cline — a DIRECTORY of rules; the file is what renders
  ".cursor/rules/agent.mdc",            // cursor
  ".gemini/styleguide.md",              // gemini-code-assist
  ".github/copilot-instructions.md",    // github-copilot
  ".continue/rules.md",                 // continue
  ".windsurf/rules/agent.md",           // windsurf
] as const;

export function ensureRootProtocol(fs: Fs, projectDir: string, workspaceRepo: string): void {
  const ws = workspaceRepo;
  // CLAUDE.md IS NO LONGER SPECIAL (Policy Owner, 2026-09-11). It used to be written here as
  // two @-imports, and only when absent — so a damaged copy was never repaired, and a broken
  // workspace path gave Claude an empty context with no error. It is now mirrored verbatim with
  // every other agent's file, below, and refreshed on every launch like the rest.
  // THE CLAUDE-ONLY SessionStart HOOK IS GONE (Policy Owner, 2026-09-11).
  //
  // It worked, and that was the problem. A mechanism only one vendor has made that vendor
  // better-governed than the rest, which biases the agent choice at Q10 for a reason that has
  // nothing to do with the agent. Consistency was ruled to matter more than the marginal
  // capability, and the guarantee no longer needs it: the protocol is placed in every agent's
  // own file and handed to eight of ten as their first message, so the hook added nothing
  // except the appearance that Claude was the governed choice.
  //
  // A user's OWN .claude/settings.json is untouched — this only stops gov writing one.
  //
  // Mirror each self-contained rendered file to the project root, refreshed every call so it can never go
  // stale against the workspace. Files not rendered for this workspace are skipped.
  for (const rel of ROOT_HARNESS_FILES) {
    const src = fs.readFile(path.join(projectDir, ws, rel));
    if (src == null) continue;
    const dst = path.join(projectDir, rel);
    if (rel.includes("/")) fs.mkdirp(path.dirname(dst));
    fs.writeFile(dst, src);
  }
}

/**
 * Is the governance actually in this agent's context? — the check behind the guarantee.
 *
 * THE GUARANTEE IS ONLY WORTH THE VERIFICATION (Policy Owner, 2026-09-11, answering "1. should
 * be blocked"). gov promises the governance requirements are in the agent's context at launch
 * and on every turn, "from a file gov placed AND VERIFIED at the start of the session". Placing
 * it is `ensureRootProtocol`; this is the second half. Without it the promise rests on a copy
 * that may have been skipped — as `.clinerules` was, for as long as the mirror list named a
 * directory where the rendered file is `.clinerules/agent.md`. Nothing failed, and cline
 * launched into a governed project with no governance. That is the failure mode this exists for:
 * not a crash, a silence.
 *
 * Three ways the file can be there and not govern, all seen or reachable:
 *   missing  — never rendered for this workspace, or mirrored to the wrong path
 *   empty    — a truncated write, or a render that produced nothing
 *   unversioned — some other file of the same name, not gov's protocol
 *
 * The version marker is the discriminator. An adopter's own hand-written CLAUDE.md is a real
 * possibility, and overwriting it silently would be its own defect; refusing to launch names the
 * conflict instead.
 */
export type ContextVerdict =
  | { readonly ok: true; readonly at: string }
  | { readonly ok: false; readonly at: string; readonly why: string };

/** The marker the renderer stamps into every harness file. Kept here, asserted by test against
 *  what `render-harness.mjs` actually writes, so the two cannot drift apart unnoticed. */
export const PROTOCOL_MARKER = "gov-protocol-version";

export function verifyAgentContext(
  fs: Pick<Fs, "readFile">,
  projectDir: string,
  harnessRel: string,
): ContextVerdict {
  const at = path.join(projectDir, harnessRel);
  const text = fs.readFile(at);
  if (text == null) return { ok: false, at, why: "the file is not there" };
  if (text.trim() === "") return { ok: false, at, why: "the file is empty" };
  if (!text.includes(PROTOCOL_MARKER)) {
    return { ok: false, at, why: `it carries no ${PROTOCOL_MARKER} line, so it is not the protocol gov renders` };
  }
  return { ok: true, at };
}
