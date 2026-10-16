// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EVERY REFUSAL OFFERS ONLY WHAT THE COMMAND ACCEPTS (F21).
 *
 * `gov setup` refused with "Pass --ref <commit>" — and setup did not accept `--ref`. Advice a person cannot type is
 * a dead end dressed as a fix. Here every refusal the content selection can produce, for `gov setup` and
 * `gov upgrade`, is collected; every `gov <verb> …` it suggests is parsed with gov's argv parser, and every flag in
 * it — and every `--flag` the refusal mentions at all — must be one that verb's spec declares.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgv } from "../../src/cli/args.js";
import { COMMAND_SPECS } from "../../src/cli/help-spec.js";
import { contentFingerprint, selectContent, UPGRADE, type BuildIdentity, type ContentFlags, type Invocation } from "../../src/maintain/build-identity.js";
import { selectSetupContent } from "../../src/setup/create.js";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
function content(v: string): string {
  const c = tmp("advice-");
  fs.writeFileSync(path.join(c, "MANIFEST.yaml"), "files:\n  - { src: VERSION, dst: VERSION, mode: scaffold-auto }\n");
  fs.writeFileSync(path.join(c, "VERSION"), `${v}\n`);
  return c;
}
const accepted = (verb: string): Set<string> =>
  new Set((COMMAND_SPECS.find((s) => s.name === verb)?.flags ?? []).map((f) => f.name.split(" ")[0]!.replace(/^--/, "")));

const SETUP: Invocation = { verb: "setup", line: "gov setup acme/acme-gov" };

/** Every refusal reachable from content selection, for one invocation. */
function refusals(inv: Invocation): string[][] {
  const mine = content("1.2.3"), other = content("1.2.3-other");
  const fp = contentFingerprint(mine);
  const ids: (BuildIdentity | null)[] = [
    null,
    { version: "checkout", commit: null, dirty: false, contentFingerprint: fp, source: "checkout", contentDir: mine },
    { version: "1.2.3", commit: null, dirty: false, contentFingerprint: fp, source: "build", bundle: path.join(tmp("nb-"), "missing.json") },
    { version: "1.2.3", commit: "0123456789abcdef0123456789abcdef01234567", dirty: false, contentFingerprint: fp, source: "build" },
    { version: "1.2.3", commit: "0123456789abcdef0123456789abcdef01234567", dirty: true, contentFingerprint: fp, source: "build" },
    { version: "1.2.3", commit: null, dirty: false, contentFingerprint: fp, source: "build" },
  ];
  const flagSets: ContentFlags[] = [{}, { from: other }, { ref: "main" }, ...(inv.verb === "upgrade" ? [{ template: "file:///x" }] : [])];
  const fetch = (): { contentDir: string; cleanup: () => void; commit: string } => ({ contentDir: other, cleanup: () => {}, commit: "fedcba9876543210fedcba9876543210fedcba98" });
  const out: string[][] = [];
  for (const id of ids) for (const flags of flagSets) {
    const r = inv.verb === "setup" ? selectSetupContent(id, flags, fetch, inv) : selectContent(id, flags, fetch, inv);
    if (!r.ok) out.push([...r.lines]); else r.cleanup();
  }
  return out;
}

describe("content refusals advise only flags the command accepts (F21)", () => {
  for (const inv of [UPGRADE, SETUP]) {
    it(`${inv.line}: every suggested command parses, and names only ${inv.verb}'s flags`, () => {
      const ok = accepted(inv.verb);
      const all = refusals(inv);
      expect(all.length, "the scenarios do produce refusals").to.be.greaterThan(5);
      let suggestions = 0;
      for (const lines of all) {
        const text = lines.join("\n");
        for (const m of text.matchAll(/--([a-z][a-z-]*)/g)) expect(ok.has(m[1]!), `${inv.verb} does not accept --${m[1]} — advised in:\n${text}`).to.equal(true);
        for (const m of text.matchAll(/\bgov (setup|upgrade)((?: (?:--[a-z-]+|<[^>]+>|[A-Za-z0-9_./:@-]+))*)/g)) {
          suggestions++;
          expect(m[1], `refusal for ${inv.verb} suggests another command:\n${text}`).to.equal(inv.verb);
          const argv = [m[1]!, ...m[2]!.trim().split(/\s+/).filter(Boolean)];
          const parsed = parseArgv(argv);
          expect(parsed).to.not.have.property("error");
          if (!("error" in parsed)) for (const k of Object.keys(parsed.flags)) expect(ok.has(k), `--${k} in "${argv.join(" ")}"`).to.equal(true);
        }
      }
      expect(suggestions, "refusals name the command to re-type").to.be.greaterThan(0);
    });
  }

  it("both specs declare --ref and --from", () => {
    for (const v of ["setup", "upgrade"]) { expect(accepted(v).has("ref")).to.equal(true); expect(accepted(v).has("from")).to.equal(true); }
  });
});
