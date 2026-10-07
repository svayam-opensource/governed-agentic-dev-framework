// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A CLIENT AND CONTENT FROM DIFFERENT BUILDS ARE NEVER COMBINED SILENTLY (adoption walk #9, 2026-10-07).
 *
 * `gov upgrade` fetched content from `main` while gov was built from a feature branch; "CLI 1.2.3 == content
 * 1.2.3" passed because neither side bumped its version, and the mismatch is what emptied an org's org-config
 * (#13). gov now records, at build time, the fingerprint of the content it was built with (and the commit), fetches
 * THAT commit by default, and refuses any content whose fingerprint differs.
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
import { fetchTemplateContent } from "../../src/maintain/upgrade-run.js";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };

function content(extra: Record<string, string> = {}): string {
  const c = tmp("bid-content-");
  write(c, "MANIFEST.yaml", "files:\n  - { src: VERSION, dst: VERSION, mode: scaffold-auto }\n");
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
  });

  it("content that IS the build passes", () => {
    const c = content();
    expect(checkContentIdentity(built(c), c, "--from").ok).to.equal(true);
  });

  it("content from another build — same VERSION — is REFUSED, naming both identities and both fixes", () => {
    const mine = content();
    const other = content({ "MANIFEST.yaml": "files:\n  - { src: org-config.example.yaml, dst: org-config.yaml, mode: overlay-schema }\n" });
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
    expect(out).to.match(/--from/);
    expect(out).to.match(/install the gov built from that content/);
  });

  it("a gov with no recorded identity refuses rather than guesses", () => {
    const r = checkContentIdentity(null, content(), "--from");
    expect(r.ok).to.equal(false);
    expect(r.ok ? "" : r.lines.join("\n")).to.match(/does not know which content it was built with/);
  });

  it("writeBuildIdentity records version, commit, dirtiness and fingerprint; readBuildIdentity reads it back", () => {
    const pkg = tmp("bid-pkg-");
    const c = content();
    writeBuildIdentity(pkg, c, { version: "1.2.3", commit: "abc", dirty: true });
    const id = readBuildIdentity(pkg);
    expect(id).to.deep.include({ version: "1.2.3", commit: "abc", dirty: true, source: "build", contentFingerprint: contentFingerprint(c) });
    expect(fs.existsSync(path.join(pkg, BUILD_IDENTITY_PATH))).to.equal(true);
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

  it("no flags, a built gov → fetches the commit it was built from", () => {
    const c = content();
    const r = selectUpgradeContent(built(c), {}, fakeFetch(c));
    expect(r.ok).to.equal(true);
    expect(fetched).to.deep.equal([{ url: "https://github.com/svayam-opensource/governed-agentic-dev-framework.git", ref: "0123456789abcdef0123456789abcdef01234567" }]);
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
    expect(selectUpgradeContent(built(mine), { from: content({ "x.md": "x" }) }, fakeFetch(mine)).ok).to.equal(false);
  });

  it("a built gov that recorded no commit and no --ref/--from → says what to pass", () => {
    const c = content();
    const r = selectUpgradeContent(built(c, null), {}, fakeFetch(c));
    expect(r.ok).to.equal(false);
    expect(r.ok ? "" : r.lines.join("\n")).to.match(/--ref <commit>.*--from <content dir>/);
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

describe("selectUpgradeContent — a default commit the remote lacks", () => {
  it("the fetch failure says the commit is this gov's own and what to pass instead", () => {
    const c = content();
    const id: BuildIdentity = { version: "1.2.3", commit: "0123456789abcdef0123456789abcdef01234567", dirty: false, contentFingerprint: contentFingerprint(c), source: "build" };
    expect(() => selectUpgradeContent(id, {}, () => { throw new Error("could not fetch content: fatal: not our ref"); }))
      .to.throw(/built from commit 0123456789abcdef0123456789abcdef01234567.*--from <its publish\/content>/s);
  });
});
