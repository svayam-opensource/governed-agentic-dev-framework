// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE AGENT PICKER — every agent the organization approved, installed or not (Policy Owner, 2026-10-08).
 *
 * svm-geneva approved IBM Bob (default), OpenAI Codex and Claude Code. Only Bob was installed in the container, and
 * `gov work` printed "Using IBM Bob — the only approved agent installed here" and launched it: two approved choices
 * hidden because they cost an install. That cost is the person's to weigh, so every approved agent is listed with
 * what choosing it means, and Enter takes the default.
 *
 * THE LIST IS SHOWN ONLY WHEN THERE IS A CHOICE (Policy Owner, 2026-10-12): an organization approving more than one
 * agent. With exactly one approved and installed, work-flow.ts opens it and says so in one line. Enter is the agent
 * this person used LAST TIME on this project when resuming it, else the organization's default (seeding from
 * scratch, or the last one no longer approved or installed) — see last-agent.ts.
 *
 *     Agent for PRJ-31 (approved by Geneva ERS):
 *       1) IBM Bob        installed · organization default
 *       2) OpenAI Codex   not installed — choose it to install now
 *       3) Claude Code    not installed — choose it to install now
 *     Choose [1/2/3] (Enter = 1, IBM Bob) :
 *
 * The prompt is the setup questions' own shape (setup/interview.ts): `Choose [..] (Enter = n, name)`.
 *
 * Pure: rows, the default, the lines and the answer. The asking, installing and launching are work-flow.ts's.
 */
import type { ApprovedAgent } from "../config/approved-agents.js";
import { CURSOR_GUI, type AgentStatus } from "./agent-catalog.js";

export interface PickerRow {
  /** The approved id. */
  readonly id: string;
  /** What to launch: the catalog id, or "cursor-gui" for the Cursor editor. */
  readonly launch: string;
  /** The catalog's display name. */
  readonly name: string;
  /**
   * installed     ready to start
   * installable   gov can install it, through the same path as `gov agent install`
   * manual        not here, and gov has no installer for it — the vendor's page says how
   * unlaunchable  approved, but gov has no command to start (a browser tool, or an id gov does not know)
   */
  readonly state: "installed" | "installable" | "manual" | "unlaunchable";
  readonly orgDefault: boolean;
  /** The agent this person opened last time on this project. */
  readonly lastUsed: boolean;
  readonly url?: string;
}

/**
 * One row per approved agent, in the organization's order, less any `exclude`d (an agent that just failed on its
 * account). `lastUsed` is the launch kind recorded for this project (`cursor-gui` for the editor). `cursorGui`: the Cursor editor is on this machine, so Cursor gets a second row for it.
 */
export function pickerRows(
  approved: readonly ApprovedAgent[], statuses: readonly AgentStatus[], lastUsed: string | null,
  exclude: readonly string[] = [], cursorGui = false,
): PickerRow[] {
  const orgDefault = approved.find((a) => a.default)?.id ?? null;
  const rows: PickerRow[] = [];
  for (const a of approved) {
    if (exclude.includes(a.id)) continue;
    const s = statuses.find((x) => x.candidate.id === a.id);
    const c = s?.candidate;
    const state: PickerRow["state"] = !c || !c.cmd || c.launch === "none" ? "unlaunchable"
      : s.installed ? "installed"
        : c.install && (c.install.npm || c.install.script || c.install.pip || c.install.brew) ? "installable"
          : "manual";
    rows.push({
      id: a.id, launch: a.id, name: c?.tool ?? a.id, state,
      orgDefault: a.id === orgDefault, lastUsed: a.id === lastUsed,
      ...(c?.install?.url ? { url: c.install.url } : {}),
    });
    if (a.id === "cursor" && cursorGui && !exclude.includes("cursor-gui")) {
      rows.push({ id: "cursor", launch: "cursor-gui", name: CURSOR_GUI.tool, state: "installed", orgDefault: false, lastUsed: lastUsed === "cursor-gui" });
    }
  }
  return rows;
}

/**
 * The row Enter chooses (0-based): the agent used last time on this project, else the org default — or null, and
 * Enter is no answer. A last-used agent that is no longer listed (the org withdrew it) or is not installed here
 * falls through to the org default. Matched by LAUNCH kind, so the Cursor editor is remembered apart from its CLI.
 */
export function pickerDefault(rows: readonly PickerRow[], lastUsed: string | null, orgDefault: string | null): number | null {
  if (lastUsed) {
    // Last time's agent must still be HERE: one since uninstalled is not offered as Enter (the ruling's fallback).
    const i = rows.findIndex((r) => r.launch === lastUsed && r.state === "installed");
    if (i >= 0) return i;
  }
  if (orgDefault) {
    // The org default may still need installing — Enter then offers the install, as before.
    const i = rows.findIndex((r) => r.launch === orgDefault && r.state !== "unlaunchable");
    if (i >= 0) return i;
  }
  return null;
}

function status(r: PickerRow): string {
  const tags = [r.lastUsed ? "used last time" : "", r.orgDefault ? "organization default" : ""].filter(Boolean);
  const head = r.state === "installed" ? "installed"
    : r.state === "installable" ? "not installed — choose it to install now"
      : r.state === "manual" ? `not installed — install it from ${r.url ?? "the vendor's site"}`
        : "gov cannot start it from here";
  return [head, ...tags].join(" · ");
}

/** The heading and one line per row. `label` is e.g. "PRJ-31 (approved by Geneva ERS)". */
export function pickerLines(rows: readonly PickerRow[], label: string): string[] {
  const w = Math.max(...rows.map((r) => r.name.length), 0);
  return [
    `  Agent for ${label}:`,
    ...rows.map((r, i) => `    ${i + 1}) ${r.name.padEnd(w)}   ${status(r)}`),
  ];
}

/** `  Choose [1/2/3] (Enter = 1, IBM Bob) : ` — the setup questions' shape. */
export function pickerPrompt(rows: readonly PickerRow[], def: number | null): string {
  const nums = rows.map((_, i) => String(i + 1)).join("/");
  const enter = def === null ? "" : ` (Enter = ${def + 1}, ${rows[def]!.name})`;
  return `  Choose [${nums}]${enter} : `;
}

/** A number, Enter (the default), or an agent's id → the row (0-based); anything else → null. */
export function resolvePickerAnswer(raw: string, rows: readonly PickerRow[], def: number | null): number | null {
  const a = raw.trim();
  if (a === "") return def;
  if (/^\d+$/.test(a)) {
    const n = Number(a);
    return n >= 1 && n <= rows.length ? n - 1 : null;
  }
  const i = rows.findIndex((r) => r.launch === a.toLowerCase() || r.id === a.toLowerCase());
  return i >= 0 ? i : null;
}
