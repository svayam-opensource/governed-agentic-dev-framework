// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * `gov pack list | add <id>` — compliance packs (spec 02 §3.5, A9).
 *
 * A pack (SOC 2 CC8, RBI change management …) ships inside the paid module. Adopting one is a POLICY change, so
 * `add` never writes `policies/` in place: it proposes the pack's prose (`policies/common/packs/<id>.md`, Q7) and its
 * control map (`policies/packs/<id>.yaml`) in a pull request that the Policy Owner approves like any other.
 *
 * How, without touching anything of the person's: a NEW branch from `origin/<default>`, in a temporary git worktree
 * of the governance repo; the two files written there, committed, the branch pushed, one `gh pr create`; the
 * worktree removed. The person's own checkout and the default branch are never written.
 *
 * Without the paid module there are no packs — one plain line says where they come from.
 */
import path from "node:path";
import type { PackRegistry } from "../check-seam/public.js";
import type { CommandResult } from "./dispatch.js";

export interface PackDeps {
  /** The governance repo's working tree. */
  readonly home: string;
  readonly defaultBranch: string;
  /** YYYY-MM-DD. */
  readonly today: string;
  /** A fresh, non-existent directory for the temporary worktree. */
  readonly tmpDir: () => string;
  readonly git: (cwd: string, args: readonly string[]) => string | null;
  readonly gh: (cwd: string, args: readonly string[]) => string | null;
  readonly writeFile: (abs: string, text: string) => void;
  readonly removeDir: (abs: string) => void;
  /** The paid module's packs, or null when it is not running here. */
  readonly packs: () => Promise<PackRegistry | null>;
}

const NO_MODULE = "Compliance packs come with gov-check, which is not installed here — they are part of a subscription (https://portal.svayamtech.com).";
const USAGE = "usage: gov pack [list | add <id>]";

export async function packCommand(positionals: readonly string[], deps: PackDeps): Promise<CommandResult> {
  const sub = positionals[0] ?? "list";
  if (sub !== "list" && sub !== "add") return { code: 2, lines: [USAGE] };
  const reg = await deps.packs();
  if (!reg) return { code: sub === "list" ? 0 : 1, lines: [NO_MODULE] };

  if (sub === "list") {
    const packs = reg.list();
    if (!packs.length) return { code: 0, lines: ["No packs are available."] };
    return {
      code: 0,
      lines: packs.map((p) => `  ${p.id.padEnd(12)} ${p.version.padEnd(8)} ${p.title}${p.mappingStatus === "not-audited" ? "  (mapping not audited)" : ""}`),
    };
  }

  const id = positionals[1];
  if (!id) return { code: 2, lines: ["usage: gov pack add <id>"] };
  const info = reg.list().find((p) => p.id === id);
  const proposal = reg.proposal(id);
  if (!info || !proposal) return { code: 1, lines: [`No pack "${id}". Available: ${reg.list().map((p) => p.id).join(", ") || "none"}.`] };
  const allowed = (p: string): boolean => p === `policies/common/packs/${id}.md` || p === `policies/packs/${id}.yaml`;
  const stray = proposal.files.filter((f) => !allowed(f.path));
  if (stray.length) return { code: 1, lines: [`The pack proposes files outside its two places (${stray.map((f) => f.path).join(", ")}) — nothing was written.`] };

  let branch = `gov-pack-${id}-${deps.today}`;
  for (let n = 2; deps.git(deps.home, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]) !== null && n < 100; n++) branch = `gov-pack-${id}-${deps.today}-${n}`;
  const base = deps.defaultBranch;
  const manual = (why: string): CommandResult => ({
    code: 1,
    lines: [
      `gov pack add: ${why}. Nothing reached the default branch. To finish by hand, from ${deps.home}:`,
      `  git fetch origin ${base} && git switch -c ${branch} origin/${base}`,
      `  gov pack add ${id}   (or add ${proposal.files.map((f) => f.path).join(" and ")} yourself)`,
      `  git push origin ${branch} && gh pr create --base ${base} --head ${branch}`,
    ],
  });

  if (deps.git(deps.home, ["fetch", "origin", base]) === null) return manual(`could not fetch origin/${base}`);
  const wt = deps.tmpDir();
  if (deps.git(deps.home, ["worktree", "add", "-b", branch, wt, `origin/${base}`]) === null) return manual("could not create a branch for the proposal");
  try {
    for (const f of proposal.files) deps.writeFile(path.join(wt, f.path), f.text);
    const label = info.mappingStatus === "not-audited" ? " (mapping not audited)" : "";
    const title = `Adopt the ${info.title} pack (${id} ${info.version})${label}`;
    if (deps.git(wt, ["add", "--", ...proposal.files.map((f) => f.path)]) === null) return manual("could not stage the pack's files");
    if (deps.git(wt, ["commit", "-q", "-m", `${title}\n\nProposed by \`gov pack add ${id}\`.`]) === null) return manual("could not commit the pack's files");
    if (deps.git(wt, ["push", "-q", "-u", "origin", `${branch}:${branch}`]) === null) return manual("could not push the proposal branch");
    const body = [
      `Adopts the **${info.title}** compliance pack (\`${id}\` ${info.version}).`,
      "",
      `- \`policies/common/packs/${id}.md\` — the policy text the organization adopts.`,
      `- \`policies/packs/${id}.yaml\` — which of the organization's rules evidence each control.`,
      "",
      info.mappingStatus === "not-audited"
        ? "**Mapping not audited.** The control mapping has not yet been signed off by a compliance reviewer; reports say so until it is."
        : "The control mapping has been reviewed.",
      "",
      "This is a policy change: it lands only when the Policy Owner approves it.",
    ].join("\n");
    const url = deps.gh(wt, ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body]);
    if (url === null) return manual("the branch is pushed, but the pull request could not be opened");
    return { code: 0, lines: [`Proposed ${id} as a policy pull request: ${url.trim()}`, "  It changes nothing until the Policy Owner approves and merges it."] };
  } finally {
    deps.git(deps.home, ["worktree", "remove", "--force", wt]);
    deps.removeDir(wt);
  }
}
