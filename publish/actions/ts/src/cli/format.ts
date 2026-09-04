// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * How a step reads while it runs (#204).
 *
 * Borrowed, deliberately, from IBM's Bob installer — which an adopter walking our path found
 * markedly easier to follow, and the difference was presentation rather than content:
 *
 *     Verifying Package Integrity          a NAMED PHASE, set off by blank lines
 *
 *     -> Fetching package checksum...      the arrow is under way, or informational
 *     ok Expected SHA256: ffaf815f...      the tick is a fact that is now true
 *
 * Two marks with two meanings is the whole idea. Ours used the tick for a finished step AND
 * for a heading, so the eye had nothing to sort by; and the output was dense enough that the
 * five-minute browser sign-in arrived with no visual break before it — which is how the PATH
 * reminder went unread in #186.
 *
 * The checklist (`checklist.ts`) answers "where am I in the whole run". This answers the same
 * question inside ONE step, and the two must not compete: no rules, no boxes, no second
 * numbering. A phase title and two marks.
 *
 * COLOUR IS THE SAME DISTINCTION, NOT DECORATION — and never the only carrier of meaning,
 * because it is the part most likely to be absent.
 */

/** Should this stream carry ANSI at all? */
export interface ColorFacts {
  /** is the destination a terminal? a pipe or a log file is not. */
  readonly isTty: boolean;
  /** the environment — `NO_COLOR`, `TERM`, `FORCE_COLOR` are read from it. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * `NO_COLOR` wins over everything except an explicit `FORCE_COLOR`, per no-color.org: it is
 * set by people who cannot read coloured output, and a tool that overrides it is not offering
 * a preference. `TERM=dumb` is the same answer from the terminal rather than the person.
 */
export function useColor(f: ColorFacts): boolean {
  if (f.env.FORCE_COLOR) return f.env.FORCE_COLOR !== "0";
  if (f.env.NO_COLOR !== undefined) return false;
  if (f.env.TERM === "dumb") return false;
  return f.isTty;
}

const ESC = "\u001b[";
const CODES = { reset: `${ESC}0m`, bold: `${ESC}1m`, dim: `${ESC}2m`, green: `${ESC}32m`, red: `${ESC}31m`, cyan: `${ESC}36m` } as const;
export type Ink = keyof Omit<typeof CODES, "reset">;

/** Wrap in an ANSI code, or return the text untouched. The only place a code is written. */
export function paint(text: string, ink: Ink, on: boolean): string {
  return on ? `${CODES[ink]}${text}${CODES.reset}` : text;
}

/**
 * The vocabulary. Each returns LINES, so a caller composes them without deciding where the
 * blank lines go — that decision is what makes the phases legible, and it belongs here.
 */
export interface Reporter {
  /** A named phase: blank line, title, blank line. The reader's "where am I". */
  phase(title: string): readonly string[];
  /** Under way, or something worth knowing while waiting. */
  step(text: string): string;
  /** True as of now. Say WHAT is true — "Bob Shell 2.0.2 installed" beats "installed". */
  ok(text: string): string;
  /** Did not happen. Colour is the least of what says so; the mark and the words carry it. */
  fail(text: string): string;
  /** The end of a phase that succeeded, when the phase deserves an ending. */
  complete(text: string): readonly string[];
}

/** Two spaces: everything gov prints inside a run is indented under its step banner. */
const PAD = "  ";

export function reporter(color: boolean): Reporter {
  return {
    phase: (title) => ["", paint(title, "bold", color), ""],
    step: (text) => `${PAD}${paint("\u2192", "cyan", color)} ${text}`,
    ok: (text) => `${PAD}${paint("\u2713", "green", color)} ${text}`,
    fail: (text) => `${PAD}${paint("\u2717", "red", color)} ${text}`,
    complete: (text) => ["", `${paint(text, "bold", color)} ${paint("\u2713", "green", color)}`, ""],
  };
}
