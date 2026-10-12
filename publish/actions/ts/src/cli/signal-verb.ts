// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov signal …` — the verb (plan 03 L07, spec 03 §4). Parsing and the person-sends rule (Q6) live here; what a
 * signal does lives in `src/signal/`. Pure apart from the injected deps, so it is tested with the memory tracker.
 *
 *   gov signal ask|depends|notice --to <PRJ> --title "…" [--body-file f] [--items a,b]
 *   gov signal list [--add]
 *   gov signal ack <signal-url> [--answer "…"]
 *   gov signal send <draft.md>
 */
import type { WorkTrackerPort } from "../ports/work-tracker.js";
import type { RepoRef } from "../ports/vcs.js";
import { sendSignal, type SignalEnv } from "../signal/send.js";
import { listSignals, addIncomingToBoard, manifestLines } from "../signal/list.js";
import { ackSignal } from "../signal/ack.js";
import { parseDraft } from "../signal/draft.js";
import { sendGuard, SIGNAL_KINDS, type SignalKind } from "../signal/model.js";

export interface SignalVerbDeps {
  readonly tracker: WorkTrackerPort;
  readonly govRepo: RepoRef;
  readonly owner: string;
  readonly login: string;
  /** The active project id, or null outside a project. */
  readonly project: string | null;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly interactive: boolean;
  readonly confirm: (question: string) => Promise<boolean>;
  readonly readFile: (p: string) => string | null;
}

type Flags = Readonly<Record<string, string | boolean>>;
const str = (f: Flags, k: string): string | undefined => (typeof f[k] === "string" ? (f[k] as string) : undefined);
const USAGE = [
  "usage: gov signal ask|depends|notice --to <PRJ-n-slug> --title \"…\" [--body-file f] [--items a,b]",
  "       gov signal list [--add] · gov signal ack <signal-url> [--answer \"…\"] · gov signal send <draft.md>",
];

export async function signalCommand(positionals: readonly string[], flags: Flags, d: SignalVerbDeps): Promise<{ code: number; lines: string[] }> {
  const sub = positionals[0];
  if (!sub) return { code: 2, lines: USAGE };
  if (!d.project) return { code: 1, lines: ["gov signal works inside a project — run it from the project's workspace (a BRNCH-<n>-… branch)."] };
  if (!d.login) return { code: 1, lines: ["gov cannot tell who you are on GitHub — `gov doctor` says why."] };
  const env: SignalEnv = { tracker: d.tracker, govRepo: d.govRepo, owner: d.owner, login: d.login, project: d.project };

  // A person acts (Q6): refused in an agent session or without a terminal; confirmed before anything is written.
  const personActs = async (what: string): Promise<string | null> => {
    const pre = sendGuard({ env: d.env, interactive: d.interactive, confirmed: true, project: d.project! });
    if (!pre.ok) return pre.reason;
    const g = sendGuard({ env: d.env, interactive: d.interactive, confirmed: await d.confirm(what), project: d.project! });
    return g.ok ? null : g.reason;
  };

  if (sub === "list") {
    const l = await listSignals(env);
    if (!l.ok) return { code: 1, lines: [`could not list signals: ${l.reason}`] };
    const lines = [...manifestLines(l)];
    if (l.notOnBoard.length) {
      if (flags.add === true) {
        const r = await addIncomingToBoard(env, l.notOnBoard);
        r.forEach((x, i) => lines.push(x.ok ? `  added to the board: ${l.notOnBoard[i]!.url}` : `  ✗ ${l.notOnBoard[i]!.url}: ${x.reason}`));
        return { code: r.every((x) => x.ok) ? 0 : 1, lines };
      }
      lines.push(`  ${l.notOnBoard.length} incoming signal(s) are not on this project's board — \`gov signal list --add\` puts them there.`);
    }
    return { code: 0, lines };
  }

  if (sub === "ack") {
    const url = positionals[1];
    if (!url) return { code: 2, lines: USAGE };
    const refused = await personActs(`Close ${url} as ${d.project}?`);
    if (refused) return { code: 1, lines: [refused] };
    const r = await ackSignal(env, url, str(flags, "answer"));
    return { code: r.ok ? 0 : 1, lines: r.lines };
  }

  let kind: SignalKind, to: string | undefined, title: string | undefined, body: string, items: string[];
  if (sub === "send") {
    const file = positionals[1];
    if (!file) return { code: 2, lines: USAGE };
    const text = d.readFile(file);
    if (text === null) return { code: 1, lines: [`no draft at ${file}`] };
    const dr = parseDraft(text);
    if (!dr.ok) return { code: 1, lines: [`${file}: ${dr.reason}`] };
    ({ kind, to, title, body, items } = dr.value);
  } else if ((SIGNAL_KINDS as readonly string[]).includes(sub)) {
    kind = sub as SignalKind;
    if (kind === "handover" || kind === "merge") return { code: 1, lines: [`gov signal ${kind} is not available in this build yet (plan 03 L08).`] };
    to = str(flags, "to"); title = str(flags, "title");
    const bf = str(flags, "body-file");
    body = bf ? (d.readFile(bf) ?? "") : (str(flags, "body") ?? "");
    items = (str(flags, "items") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    return { code: 2, lines: [`unknown signal '${sub}'.`, ...USAGE] };
  }
  if (!to || !title) return { code: 2, lines: ["a signal needs --to <PRJ-n-slug> and --title.", ...USAGE] };
  const refused = await personActs(`Send ${kind} "${title}" from ${d.project} to ${to}?`);
  if (refused) return { code: 1, lines: [refused] };
  const r = await sendSignal(env, { kind, to, title, body, items });
  return { code: r.ok ? 0 : 1, lines: r.lines };
}
