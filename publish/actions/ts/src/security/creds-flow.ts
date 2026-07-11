// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * `gov-work creds` — the interactive GAP-filler (SDD credential-seam, client half). It NEVER
 * acquires anything itself: for each unmet NEED it prints WHERE to go and WHAT to bring
 * back, takes what the user pastes, and PLACES it in the per-user store — the user does
 * the acquisition in the real tool (Authentik, npmjs, …).
 *
 * This is the PURE flow: prompt, probes, store-writer and print are all injected, so it's
 * fully testable. The readline + real git/gh/store wiring is a thin shell (cli/main.ts).
 */
import { type Need, type NeedProbes, computeGap } from "./needs.js";

export interface CredsFlowDeps {
  readonly defaultIdentity: string;
  readonly needs: readonly Need[];
  /** prompt with an optional default; returns the (trimmed) answer or the default. */
  readonly prompt: (question: string, def?: string) => Promise<string>;
  readonly print: (line: string) => void;
  readonly listIdentities: () => string[];
  readonly identityExists: (identity: string) => boolean;
  /** probes bound to a given identity's store (so the GAP is per-identity). */
  readonly makeProbes: (identity: string) => NeedProbes;
  /** place a pasted value under the chosen identity (store is line-preserving). */
  readonly setCred: (identity: string, key: string, value: string) => void;
  /** is stdin a REAL interactive TTY? Secrets are only accepted when true — a piped /
   *  agent-driven session cannot provide a credential (it's the human's to enter). */
  readonly interactive: boolean;
}

export interface CredsFlowResult {
  readonly identity: string;
  /** stored-cred NEEDs filled this run (ids). */
  readonly filled: readonly string[];
  /** NEEDs still unmet after this run (ids) — e.g. environment fixes the user must run. */
  readonly stillMissing: readonly string[];
}

/**
 * Select the identity. The default is ALWAYS the logged-in user. If MULTIPLE personas are
 * already configured under the preferences dir, offer a numbered menu — Enter keeps the
 * default, a number picks an alternate persona, or a typed name selects/creates one.
 */
export async function selectIdentity(d: CredsFlowDeps): Promise<{ identity: string; isNew: boolean }> {
  const personas = d.listIdentities();
  let identity: string;
  if (personas.length > 1) {
    d.print(`You have credentials configured for multiple user-ids/personas.`);
    d.print(`Press Enter to use the default (${d.defaultIdentity}), or choose a number to use an alternate persona:`);
    personas.forEach((id, i) => d.print(`  (${i + 1}) ${id}`));
    const ans = (await d.prompt("Persona", d.defaultIdentity)).trim();
    const n = Number(ans);
    identity = (ans === "" || ans === d.defaultIdentity) ? d.defaultIdentity
      : (Number.isInteger(n) && n >= 1 && n <= personas.length) ? personas[n - 1]
      : ans; // a typed name — an alternate/new persona
  } else {
    identity = (await d.prompt("Identity", d.defaultIdentity)) || d.defaultIdentity;
  }
  const isNew = !d.identityExists(identity);
  d.print(isNew ? `→ new identity '${identity}' — its credentials will be created here.` : `→ using identity '${identity}'.`);
  return { identity, isNew };
}

/** Run the full flow: pick identity, compute GAP, walk each unmet NEED, re-probe, report. */
export async function runCreds(d: CredsFlowDeps): Promise<CredsFlowResult> {
  const { identity } = await selectIdentity(d);

  const gap = computeGap(d.needs, d.makeProbes(identity));
  if (gap.length === 0) {
    d.print("✓ All NEEDs already satisfied — nothing to do.");
    return { identity, filled: [], stillMissing: [] };
  }

  d.print(`\n${gap.length} unmet NEED(s) for identity '${identity}':`);
  const filled: string[] = [];
  for (const need of gap) {
    d.print(`\n• ${need.title}`);
    for (const line of need.instructions.split("\n")) d.print(`    ${line}`);
    if (need.credKey) {
      // a stored credential — ONLY accepted from a real interactive terminal. A piped or
      // agent-driven session must not (and cannot) provide a secret; the human enters it.
      if (!d.interactive) {
        d.print("  ⚠ credentials must be entered at an interactive terminal (a real TTY).");
        d.print("     Run `gov-work creds` yourself — a piped or agent-driven session cannot provide them.");
        continue;
      }
      const value = (await d.prompt(`  Paste the value (blank to skip)`, "")).trim();
      if (value) { d.setCred(identity, need.credKey, value); filled.push(need.id); d.print("  ✓ stored (per-user, 0600)."); }
    } else {
      // an environment fix (git config / gh auth): the user runs it themselves, then re-checks
      d.print("  (run the above in a terminal, then re-run `gov-work creds`)");
    }
  }

  // re-probe so the report reflects what's now in place
  const stillMissing = computeGap(d.needs, d.makeProbes(identity)).map((n) => n.id);
  d.print(stillMissing.length
    ? `\n${stillMissing.length} still unmet: ${stillMissing.join(", ")}`
    : "\n✓ All NEEDs satisfied.");
  return { identity, filled, stillMissing };
}
