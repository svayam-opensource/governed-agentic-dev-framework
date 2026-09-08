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
export interface SignInFacts {
  readonly tool: string;
  /** the vendor's own login command, when it has one (`claude setup-token`, …). */
  readonly loginCommand?: readonly string[] | null;
  /** it opens its own browser when it first needs to (#208). */
  readonly signsInItself?: boolean;
  /** the variable that holds a key, when gov knows which one it is. */
  readonly credentialEnv?: string | null;
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
  return out;
}

/**
 * The screen. Returns lines; the caller prints and asks.
 *
 * THE MACHINE IS NAMED, not detected. gov cannot know whether a browser is reachable —
 * $DISPLAY, xdg-open and $SSH_CONNECTION are each wrong somewhere — and a wrong guess here
 * silently removes the only route that works. Saying "gov cannot tell" is both true and more
 * useful than a guess: it tells the reader the choice is theirs because it genuinely is.
 */
export function signInPrompt(f: SignInFacts, options: readonly SignInOption[]): readonly string[] {
  const lines = ["", `  How would you like to sign ${f.tool} in?`, ""];
  const browserish = options.some((o) => o.method === "login-command" || o.method === "browser-at-start");
  if (browserish && options.some((o) => o.method === "api-key")) {
    lines.push("  This may want a browser, and gov cannot tell whether this machine has one.", "");
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
