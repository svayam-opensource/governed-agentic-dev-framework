// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Make an agent launched at the PROJECT ROOT (`<project>`, the dir that holds the gov workspace + all code
 * repos) run the session-start protocol. The harness is rendered into the workspace repo; this mirrors it to
 * the root so Claude / cursor / Codex / … pick it up. Used by BOTH `seed` (every seeded project gets it) and
 * the interactive Work flow (before launching an agent). Leaf module (Fs only) — no cli/lifecycle cycle.
 */
import path from "node:path";
import type { Fs } from "./fs-io.js";

/** Non-Claude harness entrypoints — rendered EXPANDED (self-contained) in the workspace repo, so any agent
 *  launched at the project root runs session-start. (Claude is handled via an @-import stub + a hook.) */
const ROOT_HARNESS_FILES = ["AGENTS.md", "CONVENTIONS.md", ".clinerules", ".cursor/rules/agent.mdc"] as const;

export function ensureRootProtocol(fs: Fs, projectDir: string, workspaceRepo: string): void {
  const ws = workspaceRepo;
  // Claude: import the protocol files DIRECTLY (single-level, resolved from <project>) — no reliance on nested
  // @-import resolution through the workspace's own CLAUDE.md.
  const claudeRoot = path.join(projectDir, "CLAUDE.md");
  if (!fs.pathExists(claudeRoot)) fs.writeFile(claudeRoot, `@${ws}/agent/session-protocol.md\n@${ws}/framework/agent.md\n`);
  // Claude belt-and-suspenders: a SessionStart hook so the protocol also fires on a BARE `claude` (opened
  // outside the Work flow, or after /clear). Write only if absent so a user's own settings are never clobbered.
  const settings = path.join(projectDir, ".claude", "settings.json");
  if (!fs.pathExists(settings)) {
    fs.mkdirp(path.join(projectDir, ".claude"));
    fs.writeFile(settings, JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: "command",
        command: "printf 'Run the session-start protocol now, before responding to anything else: read CLAUDE.md, post the context manifest, and wait for direction.'" }] }] },
    }, null, 2) + "\n");
  }
  // Other agents don't @-import → mirror the self-contained rendered file to the project root (refreshed each
  // call → never stale). Files not rendered for this workspace are skipped.
  for (const rel of ROOT_HARNESS_FILES) {
    const src = fs.readFile(path.join(projectDir, ws, rel));
    if (src == null) continue;
    const dst = path.join(projectDir, rel);
    if (rel.includes("/")) fs.mkdirp(path.dirname(dst));
    fs.writeFile(dst, src);
  }
}
