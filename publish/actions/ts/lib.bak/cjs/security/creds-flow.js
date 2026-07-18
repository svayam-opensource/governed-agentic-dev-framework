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
import { computeGap, displayName, deriveSteps } from "./needs.js";
/**
 * Select the identity. The default is ALWAYS the logged-in user. If MULTIPLE personas are
 * already configured under the preferences dir, offer a numbered menu — Enter keeps the
 * default, a number picks an alternate persona, or a typed name selects/creates one.
 */
export async function selectIdentity(d) {
    const personas = d.listIdentities();
    let identity;
    if (personas.length > 1) {
        d.print(`You have credentials configured for multiple user-ids/personas.`);
        d.print(`Press Enter to use the default (${d.defaultIdentity}), or choose a number to use an alternate persona:`);
        personas.forEach((id, i) => d.print(`  (${i + 1}) ${id}`));
        const ans = (await d.prompt("Persona", d.defaultIdentity)).trim();
        const n = Number(ans);
        identity = (ans === "" || ans === d.defaultIdentity) ? d.defaultIdentity
            : (Number.isInteger(n) && n >= 1 && n <= personas.length) ? personas[n - 1]
                : ans; // a typed name — an alternate/new persona
    }
    else {
        identity = (await d.prompt("Identity", d.defaultIdentity)) || d.defaultIdentity;
    }
    const isNew = !d.identityExists(identity);
    d.print(isNew ? `→ new identity '${identity}' — its credentials will be created here.` : `→ using identity '${identity}'.`);
    return { identity, isNew };
}
/** Run the full flow: pick identity, compute GAP, walk each unmet NEED, re-probe, report. */
export async function runCreds(d) {
    const { identity } = await selectIdentity(d);
    const gap = computeGap(d.needs, d.makeProbes(identity));
    if (gap.length === 0) {
        d.print("✓ All NEEDs already satisfied — nothing to do.");
        return { identity, filled: [], stillMissing: [] };
    }
    d.print(`\nWe need ${gap.length} value(s) for '${identity}'. For each one below: how to get it, then enter it.`);
    const filled = [];
    for (let i = 0; i < gap.length; i++) {
        const need = gap[i];
        const name = displayName(need);
        d.print(`\n─── Item ${i + 1} of ${gap.length} : Provide '${name}' value ───`);
        const steps = deriveSteps(need);
        if (steps.length) {
            d.print(`  - How to get this value?`);
            steps.forEach((s, n) => d.print(`      Step ${n + 1} - ${s}`));
        }
        if (need.credKey) {
            // a stored credential — ONLY accepted from a real interactive terminal. A piped or
            // agent-driven session must not (and cannot) provide a secret; the human enters it.
            if (!d.interactive) {
                d.print("  - Enter this at an interactive terminal — run `gov-work creds` yourself (a piped/agent session cannot).");
                continue;
            }
            const value = (await d.prompt(`  - Enter value for '${name}' (or press Enter to skip)`, "")).trim();
            if (value) {
                d.setCred(identity, need.credKey, value);
                filled.push(need.id);
                d.print("  ✓ Saved.");
            }
            else
                d.print("  — skipped.");
        }
        else {
            // an environment fix (git config / gh auth): the user runs it themselves, then re-checks
            d.print("  - Run the step(s) above in a terminal, then re-run `gov-work creds`.");
        }
    }
    // re-probe so the report reflects what's now in place
    const stillMissing = computeGap(d.needs, d.makeProbes(identity)).map((n) => n.id);
    d.print(stillMissing.length
        ? `\n${stillMissing.length} still unmet: ${stillMissing.join(", ")}`
        : "\n✓ All NEEDs satisfied.");
    return { identity, filled, stillMissing };
}
