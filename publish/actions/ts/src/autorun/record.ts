// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * What autorun leaves behind (spec 03 §3.4, §3.5, Q12): commit trailers that let the dogfood measure count what
 * autorun produced, and the run record — `projects/<PRJ>/autorun/<yyyy-mm-dd-hhmm>.md` plus one line for
 * `knowledge/decisions.md`. `Gov-Agent:` is added here because intent 02 had not defined it (plan 03 §7, decision 2).
 */
export interface Trailers { readonly runId: string; readonly agent: string }

const TRAILER_LINE = /^[A-Za-z][A-Za-z-]*: .+$/;

export function withTrailers(message: string, t: Trailers): string {
  const msg = message.replace(/\s+$/, "");
  const add = [`Gov-Autorun: ${t.runId}`, `Gov-Agent: ${t.agent}`].filter((l) => !msg.split("\n").includes(l));
  if (!add.length) return msg;
  const paras = msg.split(/\n\n/);
  const last = paras[paras.length - 1]!;
  const isTrailerBlock = paras.length > 1 && last.split("\n").every((l) => TRAILER_LINE.test(l));
  return isTrailerBlock ? `${msg}\n${add.join("\n")}` : `${msg}\n\n${add.join("\n")}`;
}

export function readTrailers(message: string): Partial<Trailers> {
  const run = /^Gov-Autorun: (.+)$/m.exec(message)?.[1];
  const agent = /^Gov-Agent: (.+)$/m.exec(message)?.[1];
  return { ...(run ? { runId: run } : {}), ...(agent ? { agent } : {}) };
}

/** `yyyy-mm-dd-hhmm` in UTC — the record's file name. */
export const recordStamp = (d: Date): string => d.toISOString().slice(0, 16).replace("T", "-").replace(":", "");

export const recordPath = (project: string, d: Date): string => `projects/${project}/autorun/${recordStamp(d)}.md`;
