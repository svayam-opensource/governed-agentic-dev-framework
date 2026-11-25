// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ONE PICKER FOR EVERY CHOICE gov OFFERS (PRJ-121 F158, Policy Owner ruling Q12 A, 2026-11-25).
 *
 *     Which AI agent would you like to use as the default in your organization?
 *     ❯ IBM Bob                      in the terminal · the editor
 *       Claude Code                  in the terminal
 *       …
 *     ↑/↓ move · Enter choose
 *
 * Two modes, one call. In a real terminal the arrow keys move, Space toggles (multi-select)
 * and Enter submits. Everywhere else — stdin piped, not a TTY, `CI` set, `TERM=dumb`, a
 * terminal that refuses raw mode, or `GOV_PLAIN_PROMPTS=1` — the SAME choice is asked as the
 * numbered prompt gov has always used: `Choose [1/2/3] :`, and `2,4` for a multi-select. The
 * numbered form is not a degraded copy; it is what every script, the e2e pty harness and a
 * screen reader answer, so it keeps today's words exactly.
 *
 * WHY THE TERMINAL IS BORROWED FOR THE LENGTH OF ONE CHOICE (ask.ts's rule, #213/#194). A
 * terminal has one owner at a time. The picker takes raw mode only while it is drawing, and
 * gives it back — raw mode off, cursor shown, stdin paused — on submit, on Ctrl-C, on an
 * error, and on process exit. A caller that holds a readline across the choice must not pass a
 * terminal: two readers on one stdin is the defect class ask.ts exists to remove.
 *
 * NO DEPENDENCY. gov's runtime dependencies are its logger and js-yaml; a prompt library for
 * one screen would be a third, and node:readline plus `setRawMode` is all this needs.
 */
import { paint } from "./format.js";

/** The input half of a terminal — `process.stdin`, or a fake in a test. */
export interface PickerInput {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: "data", fn: (chunk: Buffer | string) => void): unknown;
  on(event: "end" | "close", fn: () => void): unknown;
  removeListener(event: string, fn: (...args: never[]) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

/** The output half — `process.stderr` (where gov asks its questions), or a fake. */
export interface PickerOutput {
  readonly isTTY?: boolean;
  readonly columns?: number;
  write(s: string): unknown;
}

export interface PickerTerminal {
  readonly input: PickerInput;
  readonly output: PickerOutput;
}

export interface PickItem {
  readonly label: string;
  /** A second column — what the option is or does. */
  readonly detail?: string;
  /** The number shown in the numbered form; defaults to the position (1-based). */
  readonly number?: number;
  /** Words that also select it when typed in the numbered form (`none`, an agent id). */
  readonly aliases?: readonly string[];
  /** Lines printed under the row, indented. */
  readonly note?: readonly string[];
}

export interface PickSpec {
  /** The question, printed in bold above the list. Optional: a caller may have printed it. */
  readonly question?: string;
  /** Prose printed before the list, in both modes. */
  readonly lead?: readonly string[];
  readonly items: readonly PickItem[];
  /** Single-select: the item Enter means when nothing was typed (numbered) / where the cursor starts (arrows). */
  readonly defaultIndex?: number;
  /** Numbered form only: instructions printed after the list (arrows have their hint line instead). */
  readonly numberedHelp?: readonly string[];
  /** Numbered single-select: the message when Enter is pressed and there is no default. */
  readonly emptyError?: string;
  readonly color?: boolean;
}

export interface PickerIo {
  /** The numbered form's line reader — the caller's, so there is still one reader. */
  readonly prompt: (question: string, def: string) => Promise<string>;
  readonly print: (line: string) => void;
  /** A terminal the picker may take raw for the length of the choice. Absent = numbered. */
  readonly terminal?: PickerTerminal | null;
  /** Read for CI / TERM / GOV_PLAIN_PROMPTS. Defaults to process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Ctrl-C in the arrow form, AFTER the terminal is restored. Default: exit 130, the shell's
   * code for an interrupt. A test passes its own and the choice then resolves to null.
   */
  readonly onInterrupt?: () => void;
}

/** The environment variable that forces the numbered form everywhere. */
export const PLAIN_PROMPTS_ENV = "GOV_PLAIN_PROMPTS";

const truthy = (v: string | undefined): boolean => v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";

/**
 * May the arrow form run here? Every "no" falls back to the numbered prompt; none of them is an error.
 *
 * `CI` is honoured because a CI job that allocates a pty (expect, `script`) is still not a person.
 */
export function arrowsAvailable(t: PickerTerminal | null | undefined, env: Readonly<Record<string, string | undefined>>): boolean {
  if (!t) return false;
  if (truthy(env[PLAIN_PROMPTS_ENV])) return false;
  if (truthy(env.CI)) return false;
  if (env.TERM === "dumb") return false;
  if (t.input.isTTY !== true || t.output.isTTY !== true) return false;
  return typeof t.input.setRawMode === "function";
}

/** The real terminal, as gov's prompts use it: keys from stdin, drawing on stderr. */
export function processTerminal(): PickerTerminal {
  return { input: process.stdin as unknown as PickerInput, output: process.stderr };
}

/** Pick exactly one. Returns its index, or null when no usable answer arrived. */
export async function pickOne(io: PickerIo, spec: PickSpec): Promise<number | null> {
  const r = await pick(io, spec, false);
  return r === null ? null : (r[0] ?? null);
}

/** Pick any number, including none. Returns indices in list order, or null when no usable answer arrived. */
export async function pickMany(io: PickerIo, spec: PickSpec): Promise<readonly number[] | null> {
  return pick(io, spec, true);
}

async function pick(io: PickerIo, spec: PickSpec, multi: boolean): Promise<readonly number[] | null> {
  if (spec.items.length === 0) return multi ? [] : null;   // nothing to choose from is not a question
  const color = spec.color ?? false;
  if (spec.question) io.print(paint(spec.question, "bold", color));
  for (const l of spec.lead ?? []) io.print(l);
  if (arrowsAvailable(io.terminal, io.env ?? process.env)) {
    const r = await arrowPick(io.terminal!, spec, multi, io.onInterrupt ?? defaultInterrupt);
    if (r !== "unavailable") return r;
  }
  return numberedPick(io, spec, multi);
}

function defaultInterrupt(): void {
  process.exit(130);
}

// ── the numbered form ─────────────────────────────────────────────────────────────────────

const numberOf = (spec: PickSpec, i: number): number => spec.items[i]?.number ?? i + 1;

/** The rows as the numbered form prints them: `    1) IBM Bob                  in the terminal`. */
export function numberedRows(spec: PickSpec): readonly string[] {
  const out: string[] = [];
  spec.items.forEach((it, i) => {
    out.push(`    ${String(numberOf(spec, i)).padStart(2)}) ${it.detail ? `${it.label.padEnd(28)} ${it.detail}` : it.label}`);
    for (const n of it.note ?? []) out.push(`        ${n}`);
  });
  return out;
}

/** One typed token → an item index, by number or alias. */
function resolveToken(spec: PickSpec, token: string): number | null {
  const t = token.trim().toLowerCase();
  if (/^\d+$/.test(t)) {
    const i = spec.items.findIndex((_, k) => numberOf(spec, k) === Number(t));
    return i >= 0 ? i : null;
  }
  const i = spec.items.findIndex((it) => (it.aliases ?? []).some((a) => a.toLowerCase() === t));
  return i >= 0 ? i : null;
}

export type NumberedAnswer =
  | { readonly ok: true; readonly picks: readonly number[] }
  | { readonly ok: false; readonly message: string };

/** Read one numbered answer. Exposed so the parse is tested without a prompt. */
export function parseNumbered(spec: PickSpec, answer: string, multi: boolean): NumberedAnswer {
  const t = answer.trim();
  if (t === "") {
    if (multi) return { ok: true, picks: [] };
    if (spec.defaultIndex !== undefined) return { ok: true, picks: [spec.defaultIndex] };
    return { ok: false, message: spec.emptyError ?? "Choose one of the numbers above." };
  }
  const tokens = multi ? t.split(/[\s,]+/).filter(Boolean) : [t];
  const picks: number[] = [];
  for (const tok of tokens) {
    const i = resolveToken(spec, tok);
    if (i === null) return { ok: false, message: `'${tok}' is not one of the numbers above.` };
    if (!picks.includes(i)) picks.push(i);
  }
  return { ok: true, picks: multi ? [...picks].sort((a, b) => a - b) : picks };
}

/** The label: `Choose [1/2/3] : `, `Choose [1/2] (Enter = 1, main) : `, or the multi form. */
export function numberedLabel(spec: PickSpec, multi: boolean): string {
  const nums = spec.items.map((_, i) => numberOf(spec, i)).join("/");
  if (multi) return `  Choose [${nums}] — one or more, e.g. ${exampleList(spec)} (Enter = none) : `;
  const d = spec.defaultIndex;
  const enter = d !== undefined && spec.items[d] ? ` (Enter = ${numberOf(spec, d)}, ${spec.items[d]!.label})` : "";
  return `  Choose [${nums}]${enter} : `;
}

const exampleList = (spec: PickSpec): string =>
  spec.items.length >= 2 ? `${numberOf(spec, 0)},${numberOf(spec, Math.min(2, spec.items.length - 1))}` : String(numberOf(spec, 0));

async function numberedPick(io: PickerIo, spec: PickSpec, multi: boolean): Promise<readonly number[] | null> {
  io.print("");
  for (const r of numberedRows(spec)) io.print(r);
  for (const l of spec.numberedHelp ?? []) io.print(l);
  const MAX_ATTEMPTS = 10;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const r = parseNumbered(spec, (await io.prompt(numberedLabel(spec, multi), "")) ?? "", multi);
    if (r.ok) return r.picks;
    io.print(`  ✗ ${r.message}`);
  }
  return null;
}

// ── the arrow form ────────────────────────────────────────────────────────────────────────

const CSI = "\u001b[";

export type Key = "up" | "down" | "home" | "end" | "space" | "enter" | "interrupt" | "eof" | { readonly digit: number } | null;

/** Split one chunk of raw input into keys. A paste or a test may deliver several at once. */
export function readKeys(chunk: string): readonly Key[] {
  const keys: Key[] = [];
  let s = chunk;
  while (s.length) {
    const seq: [string, Key][] = [
      ["\u001b[A", "up"], ["\u001bOA", "up"], ["\u001b[B", "down"], ["\u001bOB", "down"],
      ["\u001b[H", "home"], ["\u001b[F", "end"], ["\u001b[1~", "home"], ["\u001b[4~", "end"],
    ];
    const hit = seq.find(([p]) => s.startsWith(p));
    if (hit) { keys.push(hit[1]); s = s.slice(hit[0].length); continue; }
    const c = s[0]!;
    s = s.slice(1);
    if (c === "\u0003") keys.push("interrupt");
    else if (c === "\u0004") keys.push("eof");          // Ctrl-D: no answer, as at a readline prompt — not an interrupt
    else if (c === "\r" || c === "\n") keys.push("enter");
    else if (c === " ") keys.push("space");
    else if (c === "k") keys.push("up");
    else if (c === "j") keys.push("down");
    else if (/[1-9]/.test(c)) keys.push({ digit: Number(c) });
    else if (c === "\u001b") {
      // An unrecognised escape sequence: drop the rest of it rather than read it as keys.
      const m = /^\[[0-9;]*[A-Za-z~]|^O[A-Za-z]/.exec(s);
      if (m) s = s.slice(m[0].length);
    }
  }
  return keys;
}

/** The hint line under the list. Named here so tests and docs quote one string. */
export const SINGLE_HINT = "↑/↓ move · Enter choose";
export const MULTI_HINT = "↑/↓ move · Space select · Enter done";

/** The lines of one frame. Pure, so a frame is tested as text. */
export function frame(spec: PickSpec, multi: boolean, cursor: number, selected: ReadonlySet<number>, columns: number): readonly string[] {
  const color = spec.color ?? false;
  const width = Math.max(20, columns - 1);
  const fit = (s: string): string => (s.length > width ? s.slice(0, width - 1) + "…" : s);
  const lines: string[] = [];
  spec.items.forEach((it, i) => {
    const here = i === cursor;
    const box = multi ? (selected.has(i) ? "[x] " : "[ ] ") : "";
    const text = fit(`  ${here ? "❯" : " "} ${box}${it.detail ? `${it.label.padEnd(28)} ${it.detail}` : it.label}`);
    lines.push(here ? paint(text, "cyan", color) : text);
    for (const n of it.note ?? []) lines.push(paint(fit(`        ${n}`), "dim", color));
  });
  lines.push(paint(`  ${multi ? MULTI_HINT : SINGLE_HINT}`, "dim", color));
  return lines;
}

/** What is left on screen once the choice is made — the answer, read back in one line. */
export function answerLine(spec: PickSpec, picks: readonly number[]): string {
  const names = picks.map((i) => spec.items[i]?.label ?? "").filter(Boolean);
  return `  ✓ ${names.length ? names.join(", ") : "(none)"}`;
}

function arrowPick(t: PickerTerminal, spec: PickSpec, multi: boolean, onInterrupt: () => void): Promise<readonly number[] | null | "unavailable"> {
  const { input, output } = t;
  const wasRaw = input.isRaw === true;
  try {
    input.setRawMode!(true);
  } catch {
    // A terminal that refuses raw mode (some Windows consoles, a pty without termios): the
    // numbered form asks the same question, so this is a fallback, not a failure.
    return Promise.resolve("unavailable");
  }
  const n = spec.items.length;
  let cursor = Math.min(Math.max(spec.defaultIndex ?? 0, 0), Math.max(n - 1, 0));
  const selected = new Set<number>();
  let drawn = 0;
  const columns = (): number => (output.columns && output.columns > 20 ? output.columns : 80);

  const draw = (): void => {
    const lines = frame(spec, multi, cursor, selected, columns());
    output.write((drawn ? `${CSI}${drawn}A\r${CSI}J` : "") + lines.join("\n") + "\n");
    drawn = lines.length;
  };

  return new Promise((resolve, reject) => {
    let done = false;
    const restore = (): void => {
      input.removeListener("data", onData as (...args: never[]) => void);
      input.removeListener("end", onEnd as (...args: never[]) => void);
      input.removeListener("close", onEnd as (...args: never[]) => void);
      process.removeListener("exit", onExit);
      try { input.setRawMode!(wasRaw); } catch { /* the terminal is going away; nothing left to restore */ }
      output.write(`${CSI}?25h`);
      input.pause();
    };
    const finish = (picks: readonly number[] | null): void => {
      if (done) return;
      done = true;
      if (drawn) output.write(`${CSI}${drawn}A\r${CSI}J`);
      if (picks) output.write(answerLine(spec, picks) + "\n");
      restore();
      resolve(picks);
    };
    const onExit = (): void => { if (!done) { try { input.setRawMode!(wasRaw); } catch { /* exiting */ } output.write(`${CSI}?25h`); } };
    const onEnd = (): void => finish(null);
    const onData = (chunk: Buffer | string): void => {
      try {
        for (const k of readKeys(typeof chunk === "string" ? chunk : chunk.toString("utf8"))) {
          if (done) return;
          if (k === "interrupt") {
            finish(null);
            output.write("\n");
            onInterrupt();
            return;
          }
          if (k === "eof") { finish(null); return; }
          if (k === "enter") {
            if (multi) { finish([...selected].sort((a, b) => a - b)); return; }
            finish(n ? [cursor] : null);
            return;
          }
          if (k === "up") cursor = (cursor - 1 + n) % n;
          else if (k === "down") cursor = (cursor + 1) % n;
          else if (k === "home") cursor = 0;
          else if (k === "end") cursor = n - 1;
          else if (k === "space") {
            if (!multi) continue;
            if (selected.has(cursor)) selected.delete(cursor); else selected.add(cursor);
          } else if (k && typeof k === "object") {
            const i = spec.items.findIndex((_, j) => numberOf(spec, j) === k.digit);
            if (i >= 0) cursor = i;
          }
          draw();
        }
      } catch (e) {
        if (!done) { done = true; restore(); }
        reject(e);
      }
    };
    try {
      process.on("exit", onExit);
      input.on("data", onData);
      input.on("end", onEnd);
      input.on("close", onEnd);
      output.write(`${CSI}?25l`);
      draw();
      input.resume();
    } catch (e) {
      done = true;
      restore();
      reject(e);
    }
  });
}
