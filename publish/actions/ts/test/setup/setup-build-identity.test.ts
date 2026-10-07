// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov setup <org>/<repo>` SEEDS FROM THE CONTENT THIS GOV CARRIES (Policy Owner, 2026-10-07, option B).
 *
 * Setup used to fetch the template at the commit gov was built from, and a gov built without `.git` (the local
 * install site's image) recorded no commit, so setup refused to seed — advising `--ref`, which setup did not accept
 * (F21). It now seeds from its bundle (or a source checkout's own content) with no fetch, and takes `--ref`/`--from`
 * as deliberate overrides, checked against its build as `gov upgrade` checks them.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { contentFingerprint, readBuildIdentity, writeBuildIdentity, type BuildIdentity, type Invocation } from "../../src/maintain/build-identity.js";
import { selectSetupContent } from "../../src/setup/create.js";
import { setupContentFlags } from "../../src/cli/main.js";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
function content(version = "1.2.3"): string {
  const c = tmp("setup-bid-");
  fs.writeFileSync(path.join(c, "MANIFEST.yaml"), "files:\n  - { src: VERSION, dst: VERSION, mode: scaffold-auto }\n");
  fs.writeFileSync(path.join(c, "VERSION"), `${version}\n`);
  return c;
}
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const INV: Invocation = { verb: "setup", line: "gov setup acme/acme-gov" };
const noFetch = (): never => { throw new Error("must not fetch"); };

describe("gov setup — seeds from the content this gov carries", () => {
  it("a built gov seeds from its bundle — no fetch, and no commit needed (a build outside git)", () => {
    const own = content(), pkg = tmp("setup-pkg-");
    writeBuildIdentity(pkg, own, { version: "1.2.3", commit: null, dirty: false });
    const r = selectSetupContent(readBuildIdentity(pkg), {}, noFetch, INV);
    expect(r.ok).to.equal(true);
    if (r.ok) { expect(contentFingerprint(r.contentDir)).to.equal(contentFingerprint(own)); r.cleanup(); }
  });

  it("a source checkout seeds from its own content — no fetch", () => {
    const own = content();
    const id: BuildIdentity = { version: "checkout", commit: null, dirty: false, contentFingerprint: contentFingerprint(own), source: "checkout", contentDir: own };
    const r = selectSetupContent(id, {}, noFetch, INV);
    expect(r.ok && r.contentDir).to.equal(own);
  });

  it("--ref fetches that ref and checks it; content from another build is refused and nothing is seeded", () => {
    const own = content(), other = content("1.2.3-other");
    const id: BuildIdentity = { version: "1.2.3", commit: COMMIT, dirty: false, contentFingerprint: contentFingerprint(own), source: "build" };
    let cleaned = false;
    const refs: string[] = [];
    const r = selectSetupContent(id, { ref: "main" }, (_t, ref) => { refs.push(ref); return { contentDir: other, cleanup: () => { cleaned = true; }, commit: COMMIT }; }, INV);
    expect(refs).to.deep.equal(["main"]);
    expect(r.ok).to.equal(false);
    if (!r.ok) {
      expect(r.lines[0]).to.match(/^gov setup: refused/);
      expect(r.lines.join("\n")).to.match(/Nothing was seeded/);
      expect(r.lines.join("\n")).to.include("gov setup acme/acme-gov --ref " + COMMIT);
    }
    expect(cleaned, "the fetched copy is removed").to.equal(true);
  });

  it("--from a directory that is this build is used", () => {
    const own = content();
    const id: BuildIdentity = { version: "1.2.3", commit: null, dirty: false, contentFingerprint: contentFingerprint(own), source: "build" };
    const r = selectSetupContent(id, { from: own }, noFetch, INV);
    expect(r.ok && r.contentDir).to.equal(own);
  });

  it("a gov that carries no content and is given none seeds nothing", () => {
    const r = selectSetupContent(null, {}, noFetch, INV);
    expect(r.ok).to.equal(false);
  });

  it("a fetch that fails is a refusal with the reason, not a throw", () => {
    const id: BuildIdentity = { version: "1.2.3", commit: COMMIT, dirty: false, contentFingerprint: "sha256:x", source: "build" };
    const r = selectSetupContent(id, { ref: "v9" }, () => { throw new Error("could not fetch"); }, INV);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.lines.join("\n")).to.contain("could not fetch");
  });
});

describe("gov setup --ref / --from (F21)", () => {
  it("parses each, and forwards it to the old-layout upgrade setup runs first", () => {
    expect(setupContentFlags({ ref: "v1.2.3" })).to.deep.equal({ flags: { ref: "v1.2.3" }, argv: ["--ref", "v1.2.3"] });
    const r = setupContentFlags({ from: "/x/content" });
    expect(r).to.deep.equal({ flags: { from: "/x/content" }, argv: ["--from", "/x/content"] });
    expect(setupContentFlags({})).to.deep.equal({ flags: {}, argv: [] });
  });
  it("refuses a flag with no value, and both together", () => {
    expect(setupContentFlags({ ref: true })).to.have.property("error").that.match(/--ref needs a value/);
    expect(setupContentFlags({ ref: "a", from: "/b" })).to.have.property("error").that.match(/not both/);
  });
});
