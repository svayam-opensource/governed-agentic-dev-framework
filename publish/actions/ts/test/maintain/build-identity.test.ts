// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A CLIENT AND CONTENT FROM DIFFERENT BUILDS ARE NEVER COMBINED SILENTLY (adoption walk #9, 2026-10-07).
 *
 * `gov upgrade` fetched content from `main` while gov was built from a feature branch; "CLI 1.2.3 == content
 * 1.2.3" passed because neither side bumped its version, and the mismatch is what emptied an org's org-config
 * (#13). gov now CARRIES the content it was built with (its bundle, fingerprinted at build time), uses it by
 * default with nothing to fetch, and refuses any content whose fingerprint differs.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  contentFingerprint, checkContentIdentity, readBuildIdentity, writeBuildIdentity, selectUpgradeContent,
  BUILD_IDENTITY_PATH, type BuildIdentity,
} from "../../src/maintain/build-identity.js";
import { CONTENT_BUNDLE_PATH } from "../../src/maintain/content-bundle.js";
import { fetchTemplateContent } from "../../src/maintain/upgrade-run.js";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };

function content(extra: Record<string, string> = {}): string {
  const c = tmp("bid-content-");
  write(c, "MANIFEST.yaml", "files:\n  - { src: VERSION, dst: VERSION, mode: scaffold-auto }\n  - { src: org-config.example.yaml, dst: org-config.example.yaml, mode: seed-once }\n  - { src: framework/, dst: framework/, mode: scaffold-auto }\n");
  write(c, "VERSION", "1.2.3\n");
  write(c, "org-config.example.yaml", 'org_name: ""\n');
  for (const [k, v] of Object.entries(extra)) write(c, k, v);
  return c;
}

const built = (dir: string, commit: string | null = "0123456789abcdef0123456789abcdef01234567"): BuildIdentity =>
  ({ version: "1.2.3", commit, dirty: false, contentFingerprint: contentFingerprint(dir), source: "build" });

describe("build identity — the content a gov was built with", () => {
  it("the fingerprint is stable, changes with any byte, ignores .git and line endings", () => {
    const a = content(), b = content();
    expect(contentFingerprint(a)).to.equal(contentFingerprint(b)).and.to.match(/^sha256:[0-9a-f]{64}$/);
    write(b, ".git/HEAD", "ref: x\n");
    expect(contentFingerprint(b), ".git is not content").to.equal(contentFingerprint(a));
    write(b, "VERSION", "1.2.3\r\n");
    expect(contentFingerprint(b), "a CRLF checkout is the same content").to.equal(contentFingerprint(a));
    write(b, "org-config.example.yaml", 'org_name: "x"\n');
    expect(contentFingerprint(b)).to.not.equal(contentFingerprint(a));
    write(a, "framework/new.md", "x\n");
    expect(contentFingerprint(a), "an added file changes it").to.not.equal(contentFingerprint(content()));
    const c = content();
    write(c, "notes-not-shipped.md", "x\n");
    write(c, "framework/.DS_Store", "x");
    expect(contentFingerprint(c), "a file the manifest does not ship, or OS litter, is not content").to.equal(contentFingerprint(content()));
  });

  it("content that IS the build passes", () => {
    const c = content();
    expect(checkContentIdentity(built(c), c, "--from").ok).to.equal(true);
  });

  it("content from another build — same VERSION — is REFUSED, naming both identities and both fixes", () => {
    const mine = content();
    const other = content({ "VERSION": "1.2.3\n# another build\n" });
    const r = checkContentIdentity(built(mine), other, "https://example.test/fw.git@main", "fedcba9876543210fedcba9876543210fedcba98");
    expect(r.ok).to.equal(false);
    const out = r.ok ? "" : r.lines.join("\n");
    expect(out).to.match(/refused/i);
    expect(out).to.match(/nothing was written/i);
    expect(out).to.include(contentFingerprint(mine).slice(7, 19));
    expect(out).to.include(contentFingerprint(other).slice(7, 19));
    expect(out).to.include("0123456789ab");                       // this gov's commit
    expect(out).to.include("fedcba987654");                       // the content's commit
    expect(out).to.match(/VERSION 1\.2\.3/);
    expect(out).to.include("gov upgrade --ref 0123456789abcdef0123456789abcdef01234567");
    expect(out).to.match(/install the gov built from that content/);
  });

  it("a gov with no recorded identity refuses rather than guesses", () => {
    const r = checkContentIdentity(null, content(), "--from");
    expect(r.ok).to.equal(false);
    expect(r.ok ? "" : r.lines.join("\n")).to.match(/does not know which content it was built with/);
  });

  it("writeBuildIdentity bundles the content and records version, commit, dirtiness and fingerprint; readBuildIdentity reads it back", () => {
    const pkg = tmp("bid-pkg-");
    const c = content();
    writeBuildIdentity(pkg, c, { version: "1.2.3", commit: "abc", dirty: true });
    const id = readBuildIdentity(pkg);
    expect(id).to.deep.include({ version: "1.2.3", commit: "abc", dirty: true, source: "build", contentFingerprint: contentFingerprint(c), bundle: path.join(pkg, CONTENT_BUNDLE_PATH) });
    expect(fs.existsSync(path.join(pkg, BUILD_IDENTITY_PATH))).to.equal(true);
  });

  it("a build OUTSIDE git (no commit) still carries its content — nothing on the default path needs the commit", () => {
    const pkg = tmp("bid-nogit-");
    const c = content();
    writeBuildIdentity(pkg, c, { version: "1.2.3", commit: null, dirty: false });
    const id = readBuildIdentity(pkg);
    expect(id?.commit).to.equal(null);
    const r = selectUpgradeContent(id, {}, () => { throw new Error("must not fetch"); });
    expect(r.ok).to.equal(true);
    if (r.ok) { expect(contentFingerprint(r.contentDir)).to.equal(contentFingerprint(c)); r.cleanup(); }
  });

  it("run from a source checkout (no build file), the identity is the checkout's own content", () => {
    const root = tmp("bid-src-");
    const pkg = path.join(root, "publish", "actions", "ts");
    fs.mkdirSync(pkg, { recursive: true });
    const c = path.join(root, "publish", "content");
    fs.cpSync(content(), c, { recursive: true });
    const id = readBuildIdentity(pkg);
    expect(id?.source).to.equal("checkout");
    expect(id?.contentDir).to.equal(c);
    expect(id?.contentFingerprint).to.equal(contentFingerprint(c));
  });

  it("neither a build file nor a checkout → null", () => {
    expect(readBuildIdentity(tmp("bid-none-"))).to.equal(null);
  });
});

describe("selectUpgradeContent — the default content is the client's own build, not main", () => {
  const fetched: { url: string; ref: string }[] = [];
  const fakeFetch = (dir: string) => (url: string, ref: string) => { fetched.push({ url, ref }); return { contentDir: dir, cleanup: () => {}, commit: ref }; };
  beforeEach(() => { fetched.length = 0; });

  it("no flags, a built gov → the content it carries (its bundle), no fetch, cleaned up after", () => {
    const pkg = tmp("bid-sel-");
    const c = content();
    writeBuildIdentity(pkg, c, { version: "1.2.3", commit: "0123456789abcdef0123456789abcdef01234567", dirty: false });
    const r = selectUpgradeContent(readBuildIdentity(pkg), {}, fakeFetch(c));
    expect(r.ok).to.equal(true);
    expect(fetched).to.deep.equal([]);
    if (r.ok) {
      expect(fs.readFileSync(path.join(r.contentDir, "VERSION"), "utf8")).to.equal("1.2.3\n");
      r.cleanup();
      expect(fs.existsSync(r.contentDir)).to.equal(false);
    }
  });

  it("an explicit --ref with no --template fetches the published template", () => {
    const c = content();
    const r = selectUpgradeContent(built(c), { ref: "v1.2.3" }, fakeFetch(c));
    expect(r.ok).to.equal(true);
    expect(fetched).to.deep.equal([{ url: "https://github.com/svayam-opensource/governed-agentic-dev-framework.git", ref: "v1.2.3" }]);
  });

  it("no flags, a source checkout → its own working-tree content, no fetch", () => {
    const c = content();
    const r = selectUpgradeContent({ ...built(c, null), source: "checkout", contentDir: c }, {}, fakeFetch(c));
    expect(r.ok && r.contentDir).to.equal(c);
    expect(fetched).to.deep.equal([]);
  });

  it("an explicit --ref is fetched — and then checked like any other content", () => {
    const mine = content(), theirs = content({ "VERSION": "1.2.3 \n" });
    const r = selectUpgradeContent(built(mine), { ref: "main" }, fakeFetch(theirs));
    expect(fetched[0]?.ref).to.equal("main");
    expect(r.ok).to.equal(false);
    expect(r.ok ? "" : r.lines.join("\n")).to.match(/@main/);
  });

  it("--from a directory that is the build → ok; that is not → refused", () => {
    const mine = content();
    expect(selectUpgradeContent(built(mine), { from: mine }, fakeFetch(mine)).ok).to.equal(true);
    expect(selectUpgradeContent(built(mine), { from: content({ "framework/x.md": "x" }) }, fakeFetch(mine)).ok).to.equal(false);
  });

  it("a built gov whose package lacks its bundle → refuses, naming only flags gov upgrade accepts", () => {
    const c = content();
    const r = selectUpgradeContent(built(c, null), {}, fakeFetch(c));
    expect(r.ok).to.equal(false);
    expect(fetched).to.deep.equal([]);
    expect(r.ok ? "" : r.lines.join("\n")).to.match(/does not carry its framework content[\s\S]*gov upgrade --ref <commit\|tag\|branch>, or gov upgrade --from <dir>/);
  });
});

(gitOk() ? describe : describe.skip)("fetchTemplateContent — by commit", () => {
  it("fetches a full commit sha (not only a branch) and reports the commit it got", () => {
    const repo = tmp("bid-repo-");
    const g = (...a: string[]): string => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
    g("init", "-q", "-b", "main"); g("config", "user.email", "t@example.com"); g("config", "user.name", "t");
    write(repo, "publish/content/MANIFEST.yaml", "files:\n");
    write(repo, "publish/content/VERSION", "1.0.0\n");
    g("add", "-A"); g("commit", "-qm", "one");
    const first = g("rev-parse", "HEAD");
    write(repo, "publish/content/VERSION", "2.0.0\n");
    g("commit", "-qam", "two");
    const f = fetchTemplateContent(repo, first);
    try {
      expect(fs.readFileSync(path.join(f.contentDir, "VERSION"), "utf8")).to.equal("1.0.0\n");
      expect(f.commit).to.equal(first);
    } finally { f.cleanup(); }
    const b = fetchTemplateContent(repo, "main");
    try { expect(fs.readFileSync(path.join(b.contentDir, "VERSION"), "utf8")).to.equal("2.0.0\n"); } finally { b.cleanup(); }
  });
});
