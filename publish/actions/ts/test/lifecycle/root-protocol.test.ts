// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE TWO DELIVERY DEFECTS WHOSE SYMPTOM WAS SILENCE (PRJ-121, 2026-09-28).
 *
 * Both were found by a person reading a real project directory, not by a test, and neither could have been:
 *
 *   1. `ensureRootProtocol` did `if (src == null) continue;`. An un-upgraded workspace with no
 *      `agent/harness/` mirrored NOTHING, and whatever was already at the destination survived. One live
 *      project's root `CLAUDE.md` was still the two-line `@`-import stub retired on 2026-09-11 — whose
 *      `@svm-prj-work/framework/agent.md` resolves to nothing in either layout — while `AGENTS.md` beside it
 *      carried the full 118-line protocol. Claude ran on the retired mechanism and nothing said so.
 *
 *   2. The mirror wrote to `<project>/<rel>` only. A developer who opens `<project>/910-GOV-CICD/` in their
 *      IDE is governed only if the vendor walks UP the tree — Claude Code does, Cursor/Cline/Continue/Bob
 *      do not. The guarantee held for one vendor out of nine, by accident.
 *
 * So these tests assert the two things whose ABSENCE is invisible: that a skip is SAID, and that a code-repo
 * clone is mirrored into. The pure string rules (`composeTeamFile`, `composeExclude`) are tested on their own,
 * because idempotence is the property that makes a per-launch rewrite safe and it cannot be eyeballed.
 */
import { expect } from "chai";
import * as path from "node:path";
import * as nodeFs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ROOT_HARNESS_FILES, HARNESS_SRC_DIR, ensureRootProtocol, mirrorWarnings, codeRepoDirs,
  composeTeamFile, verifyAgentContext,
  GOV_BLOCK_BEGIN, GOV_BLOCK_END, ADOPTER_MARKER, PROTOCOL_MARKER, ownsWholeFile,
} from "../../src/lifecycle/root-protocol.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px, pxAll } from "../helpers/paths.js";
import { harnessAtDefault } from "../helpers/harness-at-default.js";

/**
 * A filesystem in a map. `dirs` exists for one reason that is load-bearing rather than cosmetic:
 * `gitInfoExcludeFile` tells an ordinary clone from a worktree by whether `<repo>/.git` READS as null, which
 * is what the node adapter returns for a directory (`readFileSync` throws EISDIR, the adapter catches). A
 * double that answered a directory read with a string would test the wrong branch.
 */
function memFs(files: Record<string, string>, dirs: readonly string[] = []): Fs & { readonly files: Record<string, string> } {
  const f: Record<string, string> = Object.fromEntries(Object.entries(files).map(([k, v]) => [px(k), v]));
  const d = new Set(dirs.map(px));
  const isDir = (p: string): boolean => d.has(p) || Object.keys(f).some((k) => k.startsWith(`${p}/`));
  return {
    files: f,
    pathExists: (p) => px(p) in f || isDir(px(p)),
    readFile: (p) => (isDir(px(p)) ? null : f[px(p)] ?? null),
    writeFile: (p, c) => { f[px(p)] = c; },
    mkdirp: (p) => { d.add(px(p)); },
    rm: (p) => { delete f[px(p)]; },
    readdir: (p) => {
      const at = `${px(p)}/`;
      const names = new Set<string>();
      for (const k of [...Object.keys(f), ...d]) if (k.startsWith(at)) names.add(k.slice(at.length).split("/")[0]!);
      return [...names];
    },
  };
}

const WS = "acme-gov";
const PROJECT = "/work/PRJ-9";
const src = (rel: string): string => `${PROJECT}/${WS}/${px(HARNESS_SRC_DIR)}/${rel}`;
/** A rendered harness file, carrying the marker gov verifies so the fixtures are the real shape. */
const rendered = (rel: string): string => `<!-- ${PROTOCOL_MARKER}: 3 -->\n# session-start protocol (${rel})\n`;
/** Every harness file rendered in the workspace — the ordinary, healthy workspace. */
const fullWorkspace = (): Record<string, string> =>
  Object.fromEntries(ROOT_HARNESS_FILES.map((rel) => [src(rel), rendered(rel)]));
/** The `.git` of a gov code repo: a WORKTREE of a shared base clone, so a file, not a directory. */
const worktreeGit = (repo: string, base: string): Record<string, string> => ({
  [`${repo}/.git`]: `gitdir: ${base}/.git/worktrees/${path.basename(repo)}\n`,
  [`${base}/.git/worktrees/${path.basename(repo)}/commondir`]: "../..\n",
});

describe("root-protocol — defect 1: a source gov cannot read is REPORTED, never skipped in silence", () => {
  it("names every harness path it could not refresh, and how to fix it", () => {
    // An un-upgraded workspace: the clone is there, `agent/harness/` is not.
    const fs = memFs({ [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n" });
    const r = ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));

    expect(r.placed, "nothing could be mirrored").to.have.length(0);
    expect(r.skipped.map((s) => s.rel), "and all nine are named").to.have.members([...ROOT_HARNESS_FILES]);
    const warnings = mirrorWarnings(r).join("\n");
    expect(warnings, "the count is said out loud").to.contain("9 harness file(s) could not be refreshed");
    expect(warnings, "with the command that fixes it").to.contain("gov upgrade");
  });

  it("THE LIVE CASE: a stub CLAUDE.md beside a full AGENTS.md is reported STALE, by name", () => {
    // The exact shape found in a real project on 2026-09-28. Before the fix this produced no output at all.
    const fs = memFs({
      [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n",
      [`${PROJECT}/CLAUDE.md`]: "@svm-prj-work/agent/session-protocol.md\n@svm-prj-work/framework/agent.md\n",
      [`${PROJECT}/AGENTS.md`]: rendered("AGENTS.md"),
    });
    const r = ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));

    const claude = r.skipped.find((s) => s.rel === "CLAUDE.md")!;
    expect(px(claude.at)).to.equal(`${PROJECT}/CLAUDE.md`);
    expect(claude.stale, "the retired mechanism, identified as such").to.equal("the retired two-line @-import stub");
    const warnings = pxAll(mirrorWarnings(r)).join("\n");
    expect(warnings, "the path a person can go and look at").to.contain(`${PROJECT}/CLAUDE.md`);
    expect(warnings, "and where the copy should have come from — the default branch").to.contain("main:agent/harness/CLAUDE.md");

    // AND IT IS STILL A WARNING. `verifyAgentContext` permits the old stub deliberately — for an org that
    // adopted before the version marker it IS valid ratified governance, and refusing bricked the entire
    // installed base twice. Reporting the skip must not turn a working adopter into a blocked one.
    const verdict = verifyAgentContext(fs, PROJECT, "CLAUDE.md");
    expect(verdict.ok, "the session still launches").to.equal(true);
  });

  it("tells STALE from merely ABSENT — a destination with nothing at it is not a stale file", () => {
    const fs = memFs({
      [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n",
      [`${PROJECT}/CONVENTIONS.md`]: "# aider notes someone left\n",
    });
    const r = ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));

    expect(r.skipped.find((s) => s.rel === "CONVENTIONS.md")!.stale, "present, so gov would have replaced it")
      .to.equal("content gov did not write");
    expect(r.skipped.find((s) => s.rel === "GEMINI.md")!.stale, "nothing there to be stale").to.equal(null);
    const warnings = mirrorWarnings(r).join("\n");
    expect(warnings, "the stale one is flagged").to.match(/STALE\s+\S*CONVENTIONS\.md/);
    // COMPACTED 2026-09-28: absent sources are COUNTED, with two named. An un-upgraded workspace is missing all
    // nine, and nine identical "no source" lines made `gov sync`'s ordinary output twelve lines long — a warning
    // that long is one nobody reads, which defeats having stopped being silent. STALE stays per-file, because
    // something IS at that path and gov can no longer vouch for it.
    expect(warnings, "the absent ones are counted").to.match(/\d+ absent:/);
    expect(warnings, "and named, up to two").to.match(/absent: [A-Za-z.]+/);
    expect(warnings, "with the remainder summarised rather than listed").to.contain("more — no rendered source");
  });

  it("says NOTHING when every source was there — a warning nobody can silence is a warning nobody reads", () => {
    const fs = memFs({ ...fullWorkspace(), [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n" });
    const r = ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));
    expect(r.placed, "all nine mirrored").to.have.length(ROOT_HARNESS_FILES.length);
    expect(r.skipped).to.have.length(0);
    expect(mirrorWarnings(r)).to.deep.equal([]);
  });

  it("an org that runs no agents reports nothing at all — there is no guarantee to keep", () => {
    const fs = memFs({ [`${PROJECT}/${WS}/org-config.yaml`]: "authorized_agents: none\n" });
    const r = ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));
    expect(r.structureOnly).to.equal(true);
    expect(mirrorWarnings(r), "structure-only is a decision, not a defect").to.deep.equal([]);
  });
});

describe("root-protocol — defect 2: the harness reaches every cloned code repo, not only the project root", () => {
  const API = `${PROJECT}/api`;
  const CICD = `${PROJECT}/910-GOV-CICD`;
  const BASES = "/work/.bases";

  const seededProject = (): Fs => memFs({
    ...fullWorkspace(),
    [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n",
    ...worktreeGit(API, `${BASES}/api`),
    ...worktreeGit(CICD, `${BASES}/910-GOV-CICD`),
  }, [`${PROJECT}/${WS}/.git`]);

  it("codeRepoDirs = the clones on disk, with the workspace repo left out", () => {
    // ON DISK, NOT FROM THE BOARD — see the comment on `codeRepoDirs`. A directory that is not a clone
    // (someone's notes, a build output) is not a repo, and the workspace repo is gov's own, not a code repo.
    const fs = memFs({
      ...worktreeGit(API, `${BASES}/api`),
      ...worktreeGit(CICD, `${BASES}/910-GOV-CICD`),
      [`${PROJECT}/${WS}/.git/HEAD`]: "ref: refs/heads/main\n",
      [`${PROJECT}/notes.md`]: "not a repo\n",
    });
    expect(pxAll([...codeRepoDirs(fs, PROJECT, WS)])).to.deep.equal([CICD, API]);
  });

  it("every agent's file lands in every clone — the case the defect was actually about", () => {
    const fs = seededProject();
    const r = ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));

    expect(pxAll([...r.targets]), "the project root AND both clones").to.deep.equal([PROJECT, CICD, API]);
    for (const dir of [PROJECT, API, CICD]) {
      for (const rel of ROOT_HARNESS_FILES) {
        expect(fs.files[`${dir}/${rel}`], `${rel} missing in ${dir}`).to.be.a("string");
        expect(fs.files[`${dir}/${rel}`], `${rel} in ${dir} must carry the marker gov verifies`).to.contain(PROTOCOL_MARKER);
      }
    }
  });

  it("verbatim at the project root, FENCED in a code repo — gov owns one directory and one block", () => {
    const fs = seededProject();
    ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));
    expect(fs.files[`${PROJECT}/CLAUDE.md`], "gov's own directory: the rendered file, byte for byte")
      .to.equal(rendered("CLAUDE.md"));
    expect(fs.files[`${API}/CLAUDE.md`], "the team's repo: gov's block, delimited").to.contain(GOV_BLOCK_BEGIN);
    expect(fs.files[`${API}/CLAUDE.md`]).to.contain(GOV_BLOCK_END);
  });

  it("a team's own CLAUDE.md survives — gov replaces its fence and nothing else", () => {
    const team = "# api\n\nRun `make test`. Never commit to `main`.\n";
    const fs = memFs({
      ...fullWorkspace(),
      [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n",
      ...worktreeGit(API, `${BASES}/api`),
      [`${API}/CLAUDE.md`]: team,
    });
    ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));
    const after = fs.files[`${API}/CLAUDE.md`]!;
    expect(after, "their words, kept").to.contain("Run `make test`");
    expect(after, "gov's protocol, added").to.contain(PROTOCOL_MARKER);
    expect(after.indexOf(GOV_BLOCK_END), "and theirs is below the adopter marker")
      .to.be.lessThan(after.indexOf(ADOPTER_MARKER));
  });

  it("gov's copies stay VISIBLE in each clone — no exclude entry is written", () => {
    // REVERSED BY RULING (Policy Owner, 2026-09-28). gov used to fence these into `.git/info/exclude`, because
    // `cleanup.ts` reads untracked files as "dirty" and would refuse to remove a work root on account of gov's own
    // output. But the commit that puts these files under version control belongs to ORDINARY PROJECT WORK — the
    // developer's or their agent's — and a file hidden from `git status` can never be part of that commit. So
    // hiding them prevented the one thing they were meant to enable.
    //
    // The cleanup problem moved to where it belongs: `dirtyIgnoringGovsOwnFiles` discounts gov's harness when
    // judging whether a deletion would lose somebody's work.
    const fs = seededProject();
    ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));
    expect(fs.files[`${BASES}/api/.git/info/exclude`], "gov does not hide its own governance").to.equal(undefined);
    expect(Object.keys(fs.files).some((f) => f.endsWith("/api/AGENTS.md")), "but it did place the file").to.equal(true);
  });

  it("a project with no clones yet behaves exactly as before — the root, and only the root", () => {
    const fs = memFs({ ...fullWorkspace(), [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n" }, [`${PROJECT}/${WS}/.git`]);
    const r = ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));
    expect(pxAll([...r.targets])).to.deep.equal([PROJECT]);
  });

  it("running twice changes nothing — the mirror runs on EVERY launch", () => {
    const fs = seededProject();
    ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));
    const first = { ...fs.files };
    ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));
    expect(fs.files, "a per-launch rewrite that grew the files would be its own silent defect").to.deep.equal(first);
  });
});

describe("root-protocol — the coexistence rule, as a pure string transform", () => {
  const body = "# protocol\nbe governed\n";

  it("an absent or empty file becomes gov's block alone", () => {
    expect(composeTeamFile(body, null)).to.equal(`${GOV_BLOCK_BEGIN}\n${body.trimEnd()}\n${GOV_BLOCK_END}\n`);
    expect(composeTeamFile(body, "\n  \n")).to.equal(composeTeamFile(body, null));
  });

  it("first contact puts gov above the adopter marker and the team's file below it", () => {
    const out = composeTeamFile(body, "# team rules\nuse tabs\n");
    expect(out.indexOf(GOV_BLOCK_BEGIN)).to.equal(0);
    expect(out.indexOf(ADOPTER_MARKER)).to.be.greaterThan(out.indexOf(GOV_BLOCK_END));
    expect(out.indexOf("use tabs")).to.be.greaterThan(out.indexOf(ADOPTER_MARKER));
  });

  it("IDEMPOTENT — feeding its own output back in returns it unchanged", () => {
    const once = composeTeamFile(body, "# team rules\nuse tabs\n");
    expect(composeTeamFile(body, once)).to.equal(once);
    expect(composeTeamFile(body, composeTeamFile(body, null))).to.equal(composeTeamFile(body, null));
  });

  it("a NEW protocol replaces only the fence — text above and below it is carried over byte for byte", () => {
    const existing = `ours above\n\n${GOV_BLOCK_BEGIN}\n# old protocol\n${GOV_BLOCK_END}\n\nours below\n`;
    const out = composeTeamFile("# new protocol\n", existing);
    expect(out).to.equal(`ours above\n\n${GOV_BLOCK_BEGIN}\n# new protocol\n${GOV_BLOCK_END}\n\nours below\n`);
  });

  it("recognises the WORKSPACE-PREFIXED stub the live project was found holding", () => {
    const v = verifyAgentContext(
      { readFile: () => "@svm-prj-work/agent/session-protocol.md\n@svm-prj-work/framework/agent.md\n" },
      PROJECT, "CLAUDE.md",
    );
    expect(v.ok, "it is still governance — Claude resolves the import").to.equal(true);
    if (!v.ok || v.current) return;
    expect(v.why, "and gov names the mechanism").to.contain("@-import");
  });

  it("still recognises the unprefixed template form, which `main` ships today", () => {
    const v = verifyAgentContext({ readFile: () => "@agent/session-protocol.md\n@agent.md\n" }, PROJECT, "CLAUDE.md");
    expect(v.ok).to.equal(true);
    if (!v.ok || v.current) return;
    expect(v.why).to.contain("@-import");
  });

  it("and does not mistake an org's own prose for one", () => {
    const v = verifyAgentContext({ readFile: () => "# our rules\nask @rk before touching agent.md\n" }, PROJECT, "CLAUDE.md");
    expect(v.ok).to.equal(true);
    if (!v.ok || v.current) return;
    expect(v.why).to.contain("gov did not render it");
  });
});

describe("root-protocol — which files gov owns outright inside a team's repository", () => {
  it("every path on the whole-file list is a real harness path", () => {
    // A SECOND HAND-KEPT LIST IS WHAT DRIFTED LAST TIME (`.clinerules` as a file). One that named a path the
    // renderer does not write would silently stop fencing nothing at all, or stop fencing the wrong thing.
    for (const rel of ROOT_HARNESS_FILES) expect(ownsWholeFile(rel)).to.be.a("boolean");
    const owned = ROOT_HARNESS_FILES.filter(ownsWholeFile);
    expect(owned, "the four vendor rule DIRECTORIES, and only those").to.have.members([
      ".clinerules/agent.md", ".cursor/rules/agent.mdc", ".continue/rules/agent.md", ".windsurf/rules/agent.md",
    ]);
  });

  it("A FILE WITH YAML FRONT MATTER IS NEVER FENCED — an HTML comment above it un-governs Cursor", () => {
    // `.cursor/rules/agent.mdc` carries `alwaysApply: true` in front matter, which must be line 1. Fencing it
    // would leave a governed project holding a file full of protocol that Cursor no longer injects: this
    // module's signature failure, manufactured fresh by the fix for it.
    const mdc = `---\nalwaysApply: true\n---\n\n# protocol\n`;
    const API = "/work/PRJ-9/api";
    const fs = memFs({
      [src(".cursor/rules/agent.mdc")]: mdc,
      [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n",
      ...worktreeGit(API, "/work/.bases/api"),
    });
    ensureRootProtocol(fs, PROJECT, WS, harnessAtDefault(fs));
    expect(fs.files[`${API}/.cursor/rules/agent.mdc`], "byte for byte, front matter first").to.equal(mdc);

  });

  it("and no file gov DOES fence carries front matter — checked against what the renderer actually shipped", () => {
    // The rule above is only safe while it agrees with the renders. `renderHarnessFile` gives front matter to
    // the `cursor` template alone today, but that is a fact about the renderer, not a law — so it is asserted
    // against the shipped bytes rather than trusted.
    const shipped = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..", "publish", "content", "agent", "harness");
    for (const rel of ROOT_HARNESS_FILES.filter((r) => !ownsWholeFile(r))) {
      const at = path.join(shipped, rel);
      if (!nodeFs.existsSync(at)) continue;                       // not rendered in this checkout
      expect(nodeFs.readFileSync(at, "utf8").startsWith("---"), `${rel} is fenced but opens with front matter`)
        .to.equal(false);
    }
  });

  it("but a single fixed filename in a code repo IS fenced — that is the one a team may already own", () => {
    for (const rel of ["CLAUDE.md", "AGENTS.md", "CONVENTIONS.md", "GEMINI.md", ".github/copilot-instructions.md"]) {
      expect(ownsWholeFile(rel), `${rel} is a name a team may already be using`).to.equal(false);
    }
  });
});

describe("root-protocol — a launch that changes nothing writes nothing", () => {
  // WHY: this ran on EVERY agent launch and wrote unconditionally — nine files at the project root and nine in
  // every cloned code repo, so a three-repo project rewrote thirty-six identical files each time somebody started
  // an agent. Git never noticed, because the content is idempotent. mtime did, and mtime is what file watchers,
  // IDE reload prompts and timestamp-based rebuilds key on; the Fs port also logged every write, so a launch left
  // thirty-six "wrote a file" lines that meant nothing had happened.
  const PROJ = "/work/PRJ-9";
  const WSP = "acme-gov";
  /** A workspace with one rendered harness file and one clone. */
  const world = (): Record<string, string> => ({
    [`${PROJ}/${WSP}/org-config.yaml`]: "org_name: Acme\n",
    [`${PROJ}/${WSP}/agent/harness/AGENTS.md`]: "# the protocol\n",
  });

  function tracking(files: Record<string, string>): { fs: Fs; writes: string[] } {
    const writes: string[] = [];
    const fs: Fs = {
      pathExists: (p) => Object.keys(files).some((f) => f === p || f.startsWith(`${p}/`)),
      readFile: (f) => files[f] ?? null,
      writeFile: (f, c) => { files[f] = c; writes.push(f); },
      mkdirp: () => {},
      rm: () => {},
      readdir: (d) => {
        const names = new Set<string>();
        for (const f of Object.keys(files)) if (f.startsWith(`${d}/`)) names.add(f.slice(d.length + 1).split("/")[0]!);
        return [...names];
      },
    };
    return { fs, writes };
  }

  it("writes on the FIRST launch, and reports how many", () => {
    const { fs, writes } = tracking(world());
    const r = ensureRootProtocol(fs, PROJ, WSP, harnessAtDefault(fs));
    expect(writes.length, "the first launch places what is there to place").to.be.greaterThan(0);
    expect(r.written).to.equal(writes.length);
  });

  it("writes NOTHING on the second launch — same policy, same bytes", () => {
    const files = world();
    const { fs } = tracking(files);
    ensureRootProtocol(fs, PROJ, WSP, harnessAtDefault(fs));
    const second = tracking(files);
    const r = ensureRootProtocol(second.fs, PROJ, WSP, harnessAtDefault(second.fs));
    expect(second.writes, "nothing changed, so nothing is rewritten").to.deep.equal([]);
    expect(r.written).to.equal(0);
    expect(r.placed, "but gov is still responsible for the same paths").to.not.be.empty;
  });

  it("writes again the moment the POLICY changes — which is the only time a diff should appear", () => {
    const files = world();
    ensureRootProtocol(tracking(files).fs, PROJ, WSP, harnessAtDefault(tracking(files).fs));
    files[`${PROJ}/${WSP}/agent/harness/AGENTS.md`] = "# the protocol, revised\n";
    const after = tracking(files);
    const r = ensureRootProtocol(after.fs, PROJ, WSP, harnessAtDefault(after.fs));
    expect(r.written, "a governance change reaches every target").to.be.greaterThan(0);
    expect(files[`${PROJ}/AGENTS.md`]).to.contain("revised");
  });
});

/**
 * GOV-FRM-456 — THE HARNESS IS MIRRORED FROM THE DEFAULT BRANCH, NEVER THE PROJECT BRANCH.
 *
 * The worktree at `<project>/<ws>` is on the project branch. A harness file edited there is a proposal, and
 * mirroring it would let a branch rewrite the rules its own agent is launched under. The governance snapshot and
 * the session prompt already read the default branch; the mirror read the worktree.
 */
describe("root-protocol — GOV-FRM-456: read from the default branch", () => {
  /** A default branch whose harness differs from the worktree's — the case the promise is about. */
  const twoBranches = (atDefault: Record<string, string>, opts: { resolves?: string[]; listFails?: boolean; showFails?: boolean } = {}) => {
    const calls: string[][] = [];
    const git = (_repo: string, args: readonly string[]): string | null => {
      calls.push([...args]);
      if (args[0] === "rev-parse") return (opts.resolves ?? ["main"]).some((r) => args[3] === `${r}^{commit}`) ? "abc1234" : null;
      if (args[0] === "ls-tree") return opts.listFails ? null : Object.keys(atDefault).map((rel) => `agent/harness/${rel}`).join("\n");
      if (args[0] === "show") {
        if (opts.showFails) return null;
        const rel = args[1]!.replace(/^[^:]+:agent\/harness\//, "");
        return atDefault[rel]?.trimEnd() ?? null;        // gov's git ports trim stdout
      }
      return null;
    };
    return { source: { git, defaultBranch: "main" }, calls };
  };
  const projectBranchEdit = "<!-- edited on the project branch -->\n# a weaker protocol\n";

  it("GOV-FRM-456: mirrors the default branch's harness, not the project-branch worktree's", () => {
    const fs = memFs({
      [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n",
      ...Object.fromEntries(ROOT_HARNESS_FILES.map((rel) => [src(rel), projectBranchEdit])),
    });
    const { source, calls } = twoBranches(Object.fromEntries(ROOT_HARNESS_FILES.map((rel) => [rel, rendered(rel)])));
    const r = ensureRootProtocol(fs, PROJECT, WS, source);

    expect(r.placed).to.have.members([...ROOT_HARNESS_FILES]);
    expect(fs.files[px(`${PROJECT}/AGENTS.md`)], "the ratified copy, byte for byte").to.equal(rendered("AGENTS.md"));
    expect(Object.entries(fs.files).filter(([k, v]) => !k.includes("/agent/harness/") && v === projectBranchEdit),
      "nothing from the project branch reached an agent's file").to.deep.equal([]);
    expect(calls.filter((c) => c[0] === "show").every((c) => c[1]!.startsWith("main:")), "every read is at the default branch").to.equal(true);
  });

  it("GOV-FRM-456: falls back to the remote-tracking default branch, as the snapshot does — still never the worktree", () => {
    const fs = memFs({ [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n" });
    const { source, calls } = twoBranches({ "AGENTS.md": rendered("AGENTS.md") }, { resolves: ["origin/main"] });
    const r = ensureRootProtocol(fs, PROJECT, WS, source);
    expect(r.placed).to.deep.equal(["AGENTS.md"]);
    expect(calls.filter((c) => c[0] === "show").map((c) => c[1])).to.deep.equal(["origin/main:agent/harness/AGENTS.md"]);
  });

  it("GOV-FRM-456: git that cannot read the default branch is a NOTED absence, never a silent read of the worktree", () => {
    for (const opts of [{ resolves: [] as string[] }, { listFails: true }, { showFails: true }]) {
      const fs = memFs({
        [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n",
        ...Object.fromEntries(ROOT_HARNESS_FILES.map((rel) => [src(rel), projectBranchEdit])),
      });
      const { source } = twoBranches(Object.fromEntries(ROOT_HARNESS_FILES.map((rel) => [rel, rendered(rel)])), opts);
      const r = ensureRootProtocol(fs, PROJECT, WS, source);
      expect(r.placed, JSON.stringify(opts)).to.deep.equal([]);
      expect(r.unreadable, "the reason is recorded").to.be.a("string");
      expect(fs.files[px(`${PROJECT}/AGENTS.md`)], "and the worktree's copy was NOT used instead").to.equal(undefined);
      const warnings = mirrorWarnings(r).join("\n");
      expect(warnings).to.contain("read only from the default branch").and.contain("GOV-FRM-456");
    }
  });

  it("restores the one trailing newline a trimming git port drops, so a launch rewrites nothing", () => {
    const fs = memFs({ [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n" });
    const { source } = twoBranches({ "AGENTS.md": rendered("AGENTS.md") });
    ensureRootProtocol(fs, PROJECT, WS, source);
    expect(fs.files[px(`${PROJECT}/AGENTS.md`)]).to.equal(rendered("AGENTS.md"));
    expect(ensureRootProtocol(fs, PROJECT, WS, source).written, "second launch: already current").to.equal(0);
  });
});
