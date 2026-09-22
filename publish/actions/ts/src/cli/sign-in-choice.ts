// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * HOW WOULD YOU LIKE TO SIGN IN? — the question, named after the one `gh` asks (#213).
 *
 *     How would you like to authenticate GitHub CLI?  [Use arrows to move, type to filter]
 *     > Login with a web browser
 *       Paste an authentication token
 *
 * Two routes, both named, neither hidden. gov's first attempt at #213 printed a paragraph
 * about the browser and then prompted for a key with "or press Enter to skip" — which makes
 * one route the question and the other an escape hatch. A person on a machine with no browser
 * had to infer that Enter was for them. `gh` does not make anybody infer.
 *
 * NUMBERED, NOT ARROW-DRIVEN. Arrows need raw mode and a redraw loop; every other choice in
 * gov — the role question, the agent menu, the project picker — is numbered, and one screen
 * that behaves differently from the rest is worse than one that is less pretty.
 *
 * The METHODS are derived, never assumed: an agent is offered a browser only if it has a way
 * to open one, and a key only if gov knows which variable holds it. That is the whole of
 * #213's rule — gov must never assume a browser exists, and must always be able to take a key
 * where a key is possible.
 */

export type SignInMethod = "login-command" | "browser-at-start" | "api-key" | "skip";

export interface SignInOption {
  readonly method: SignInMethod;
  readonly label: string;
}

/** What gov knows about one agent's sign-in surface. Facts, not preferences. */
import { type DesktopHint, browserCaveat, preferCli } from "./desktop.js";

export interface SignInFacts {
  readonly tool: string;
  /** the vendor's own login command, when it has one (`claude setup-token`, …). */
  readonly loginCommand?: readonly string[] | null;
  /** it opens its own browser when it first needs to (#208). */
  readonly signsInItself?: boolean;
  /** the variable that holds a key, when gov knows which one it is. */
  readonly credentialEnv?: string | null;
  /**
   * What gov concluded about this machine's desktop (#221) — used to ORDER and ANNOTATE only.
   *
   * Absent means "do not take a view", which is what every caller did before the probe existed.
   */
  readonly desktop?: DesktopHint | null;
}

/**
 * The routes actually open for this agent, in the order they should be offered.
 *
 * A vendor's own login command goes first where there is one: it is the route the vendor
 * supports best, and on a machine with a browser it is the least work. The key follows,
 * always, whenever gov knows the variable — that is the half #208 removed and #213 restores.
 * Skip is last and is always present: an adopter who wants to get on with installing is not
 * required to authenticate first.
 */
export function signInOptions(f: SignInFacts): readonly SignInOption[] {
  const out: SignInOption[] = [];
  if (f.loginCommand && f.loginCommand.length) {
    out.push({ method: "login-command", label: `Sign in with ${f.tool} (${f.loginCommand.join(" ")})` });
  } else if (f.signsInItself) {
    out.push({ method: "browser-at-start", label: `Let ${f.tool} sign you in when it starts (it opens a browser)` });
  }
  if (f.credentialEnv) {
    out.push({ method: "api-key", label: `Paste an API key now — gov will store it (${f.credentialEnv})` });
  }
  out.push({ method: "skip", label: "Skip for now" });

  // ORDER BY WHAT THE MACHINE CAN ACTUALLY DO (#221), and never by less than that.
  //
  // Three walks on 2026-09-13 ended the same way: a container with no browser, an adopter
  // picking option 1 because it is option 1, and a login flow waiting forever for a browser
  // that cannot open. Codex started a local login server; Claude sat at `/login` asking for a
  // code from a page nobody could reach. gov had already worked out there was no desktop and
  // said nothing with it.
  //
  // #221's ruling is the constraint: a desktop hint may REORDER and ANNOTATE, never withhold.
  // So every route is still offered, in the same words — the key-paste one is simply first
  // where a browser is not reachable, because defaults are what people press.
  if (f.desktop && preferCli(f.desktop) && out.some((o) => o.method === "api-key")) {
    const rank = (m: SignInOption["method"]): number =>
      m === "api-key" ? 0 : m === "skip" ? 2 : 1;
    out.sort((a, b) => rank(a.method) - rank(b.method));
  }
  return out;
}

/**
 * The screen. Returns lines; the caller prints and asks.
 *
 * IT USED TO SAY "gov cannot tell whether this machine has one". That was true when it was
 * written and stopped being true when #221 landed a desktop probe — and it kept being printed,
 * so gov was disclaiming knowledge it had. Three walks lost to browser sign-in on a container
 * is what that cost.
 *
 * A wrong guess must still never remove the only route that works, which is why this only ever
 * REORDERS and ANNOTATES. When gov has no view, it says so exactly as before.
 */
export function signInPrompt(f: SignInFacts, options: readonly SignInOption[]): readonly string[] {
  const lines = ["", `  How would you like to sign ${f.tool} in?`, ""];
  const browserish = options.some((o) => o.method === "login-command" || o.method === "browser-at-start");
  if (browserish && options.some((o) => o.method === "api-key")) {
    const caveat = f.desktop ? browserCaveat(f.desktop) : null;
    if (caveat) {
      // What gov OBSERVED, in its own words, so a reader who knows better can disagree with it.
      lines.push(`  One of these wants a browser — ${caveat}.`, "");
    } else if (f.desktop && f.desktop.verdict === "yes") {
      lines.push("  One of these wants a browser; this machine appears to have one.", "");
    } else {
      lines.push("  This may want a browser, and gov cannot tell whether this machine has one.", "");
    }
  }
  options.forEach((o, i) => lines.push(`    ${i + 1}. ${o.label}`));
  lines.push("");
  return lines;
}

/** A typed answer, or null when it names nothing — which asks again rather than guessing. */
export function parseSignInChoice(answer: string, options: readonly SignInOption[]): SignInMethod | null {
  const n = Number(answer.trim());
  if (!Number.isInteger(n) || n < 1 || n > options.length) return null;
  return options[n - 1]!.method;
}

/**
 * What to say after a skip. It differs by what was skipped, and reporting them alike is how
 * #208 happened in reverse: an agent that can still sign itself in IS usable, and one that
 * had only a key is not.
 */
export function afterSkip(f: SignInFacts, method: "browser-at-start" | "login-command" | "none"): readonly string[] {
  const lines: string[] = [""];
  if (method === "browser-at-start") {
    lines.push(`  Nothing saved. ${f.tool} will ask you to sign in when it starts.`);
  } else if (method === "login-command") {
    lines.push(`  Nothing saved. Sign in when you are ready:  ${(f.loginCommand ?? []).join(" ")}`);
  } else {
    lines.push(`  Nothing saved. ${f.tool} is installed but cannot run until it has a key.`);
  }
  return lines;
}

/**
 * What to say just before asking for the key — AFTER the person chose "paste an API key" (PRJ-121, 2026-09-22).
 *
 * This runs only once that choice is made: `captureAgentKey` has one caller, and it is the menu's `api-key`
 * branch. It used to open, for an agent that signs itself in, with
 *
 *     IBM Bob signs in through a browser. gov cannot tell whether this machine has one …
 *       · paste an API key now and gov will store it
 *       · or press Enter, and sign in when IBM Bob starts
 *
 * — the old disclaimer the menu had already replaced (#213/#221), CONTRADICTING the menu line printed seconds
 * earlier ("gov sees no desktop here"), and offering again the choice just made. Found on a walk.
 *
 * So: nothing for an agent that signs itself in — the menu has said everything. For an agent that ONLY takes a
 * key, say where it will go, because the menu does not.
 */
export function apiKeyIntro(tool: string, signsInItself: boolean, envVar: string): readonly string[] {
  if (signsInItself) return [];
  return [
    "",
    `  ${tool} signs in with an API key rather than a browser.`,
    `  gov does not know where ${tool} keeps its config, so it will not guess:`,
    `  the key goes in your environment as ${envVar}.`,
    "",
  ];
}
