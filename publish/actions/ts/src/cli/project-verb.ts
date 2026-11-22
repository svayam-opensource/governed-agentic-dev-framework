// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov project <name> [--repo r[,r…]] [--seed]` — the verb (plan 03 L06, gadf#182). Parsing and the hand-off to
 * `gov seed` live here; what a project is made of lives in `src/project/create.ts`. Pure apart from the injected
 * deps, so it is tested with the memory ports.
 */
import { createGovProject, type ProjectEnv } from "../project/create.js";
import { boardListsAnchor } from "../project/board-wait.js";

export interface ProjectVerbDeps extends ProjectEnv {
  readonly print: (line: string) => void;
  /** `gov seed <board-url>` — its exit code. */
  readonly seed: (boardUrl: string) => Promise<number> | number;
  /** How long `--seed` waits for the board to list its new anchor (default 90 s), and how it waits (tests: no-op). */
  readonly boardWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

type Flags = Readonly<Record<string, string | boolean>>;
export const PROJECT_USAGE = "usage: gov project <name> [--repo <owner/name>[,<owner/name>…]] [--seed]";

export async function projectCommand(positionals: readonly string[], flags: Flags, d: ProjectVerbDeps): Promise<number> {
  // `--seed` is a switch; the shared parser hands it the next word (`gov project --seed "Invoice API"`), which is the name.
  const seedWord = typeof flags.seed === "string" ? [flags.seed] : [];
  const seed = flags.seed !== undefined && flags.seed !== false;
  const name = [...positionals, ...seedWord].join(" ").trim();
  if (!name) { d.print(PROJECT_USAGE); return 2; }
  const repoFlag = typeof flags.repo === "string" ? flags.repo : "";
  const repos = repoFlag.split(",").map((s) => s.trim()).filter(Boolean);

  const r = await createGovProject(d, { name, repos });
  for (const line of r.lines) d.print(line);
  if (!r.ok) return 1;
  if (!seed) return 0;

  d.print("");
  if (!(await boardListsAnchor(d, r.created))) {
    d.print(`The board does not list its anchor yet — GitHub's project index can lag a minute behind. Nothing is wrong with what`);
    d.print(`was created; seed it when the board shows the anchor:  gov seed ${r.boardUrl}`);
    return 1;
  }
  d.print(`Handing to gov seed ${r.boardUrl}`);
  const code = await d.seed(r.boardUrl);
  if (code !== 0) d.print(`  gov seed did not finish — the board and its anchor exist; fix what it said and run: gov seed ${r.boardUrl}`);
  return code;
}
