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
  composeTeamFile, composeExclude, gitInfoExcludeFile, verifyAgentContext,
  GOV_BLOCK_BEGIN, GOV_BLOCK_END, ADOPTER_MARKER, PROTOCOL_MARKER, ownsWholeFile,
} from "../../src/lifecycle/root-protocol.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px, pxAll } from "../helpers/paths.js";

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
    const r = ensureRootProtocol(fs, PROJECT, WS);

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
    const r = ensureRootProtocol(fs, PROJECT, WS);

    const claude = r.skipped.find((s) => s.rel === "CLAUDE.md")!;
    expect(px(claude.at)).to.equal(`${PROJECT}/CLAUDE.md`);
    expect(claude.stale, "the retired mechanism, identified as such").to.equal("the retired two-line @-import stub");
    const warnings = pxAll(mirrorWarnings(r)).join("\n");
    expect(warnings, "the path a person can go and look at").to.contain(`${PROJECT}/CLAUDE.md`);
    expect(warnings, "and where the copy should have come from").to.contain(src("CLAUDE.md"));

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
    const r = ensureRootProtocol(fs, PROJECT, WS);

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
    const r = ensureRootProtocol(fs, PROJECT, WS);
    expect(r.placed, "all nine mirrored").to.have.length(ROOT_HARNESS_FILES.length);
    expect(r.skipped).to.have.length(0);
    expect(mirrorWarnings(r)).to.deep.equal([]);
  });

  it("an org that runs no agents reports nothing at all — there is no guarantee to keep", () => {
    const fs = memFs({ [`${PROJECT}/${WS}/org-config.yaml`]: "authorized_agents: none\n" });
    const r = ensureRootProtocol(fs, PROJECT, WS);
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
    const r = ensureRootProtocol(fs, PROJECT, WS);

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
    ensureRootProtocol(fs, PROJECT, WS);
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
    ensureRootProtocol(fs, PROJECT, WS);
    const after = fs.files[`${API}/CLAUDE.md`]!;
    expect(after, "their words, kept").to.contain("Run `make test`");
    expect(after, "gov's protocol, added").to.contain(PROTOCOL_MARKER);
    expect(after.indexOf(GOV_BLOCK_END), "and theirs is below the adopter marker")
      .to.be.lessThan(after.indexOf(ADOPTER_MARKER));
  });

  it("gov's copies are fenced into each clone's exclude list, so they never dirty `git status`", () => {
    // NOT COSMETIC: `cleanup.ts::dirtyReposUnder` uses `git status --porcelain`, which counts untracked
    // files, and REFUSES to remove a work root when any repo under it is dirty. Nine untracked files per
    // clone would have made gov brick its own cleanup with its own files.
    const fs = seededProject();
    ensureRootProtocol(fs, PROJECT, WS);
    const exclude = fs.files[`${BASES}/api/.git/info/exclude`];
    expect(exclude, "written to the COMMON git dir a worktree shares").to.be.a("string");
    expect(exclude, "anchored, so a team's docs/AGENTS.md is untouched").to.contain("/AGENTS.md");
    expect(exclude).to.contain("/.cursor/rules/agent.mdc");
  });

  it("a project with no clones yet behaves exactly as before — the root, and only the root", () => {
    const fs = memFs({ ...fullWorkspace(), [`${PROJECT}/${WS}/org-config.yaml`]: "org_name: Acme\n" }, [`${PROJECT}/${WS}/.git`]);
    const r = ensureRootProtocol(fs, PROJECT, WS);
    expect(pxAll([...r.targets])).to.deep.equal([PROJECT]);
  });

  it("running twice changes nothing — the mirror runs on EVERY launch", () => {
    const fs = seededProject();
    ensureRootProtocol(fs, PROJECT, WS);
    const first = { ...fs.files };
    ensureRootProtocol(fs, PROJECT, WS);
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

  it("composeExclude fences its entries and is idempotent too", () => {
    const once = composeExclude("*.log\n", ["AGENTS.md", ".clinerules/agent.md"]);
    expect(once, "what was there first, kept").to.contain("*.log");
    expect(once, "anchored to the repo root").to.contain("/AGENTS.md");
    expect(composeExclude(once, ["AGENTS.md", ".clinerules/agent.md"])).to.equal(once);
    expect(composeExclude(once, ["AGENTS.md"]), "and the list is gov's to shrink").to.not.contain("/.clinerules/agent.md");
  });
});

describe("root-protocol — where git actually reads a repo's exclude list", () => {
  it("a WORKTREE resolves through `commondir`, not just the `gitdir:` line", () => {
    // Following `gitdir:` alone writes an exclude list git never reads — and the nine files go on showing as
    // untracked while the code claims to have hidden them. That is this file's whole failure mode, again.
    const fs = memFs(worktreeGit("/work/PRJ-9/api", "/work/.bases/api"));
    expect(px(gitInfoExcludeFile(fs, "/work/PRJ-9/api")!)).to.equal("/work/.bases/api/.git/info/exclude");
  });

  it("an ordinary clone — `.git` is a DIRECTORY — uses its own info/exclude", () => {
    const fs = memFs({ "/repo/.git/HEAD": "ref: refs/heads/main\n" });
    expect(px(gitInfoExcludeFile(fs, "/repo")!)).to.equal("/repo/.git/info/exclude");
  });

  it("a `.git` file of an unknown shape answers null rather than guessing a path", () => {
    const fs = memFs({ "/repo/.git": "something else entirely\n" });
    expect(gitInfoExcludeFile(fs, "/repo")).to.equal(null);
  });
});

describe("root-protocol — the @-import stub, as it actually appears on disk", () => {
  /**
   * The pattern was written from the manifest's unprefixed template and so missed every stub in the wild: one
   * placed at a PROJECT root must reach into the workspace clone. The consequence was mild but exactly backwards
   * — gov held a name for the mechanism it had retired, and reported "gov did not render it" instead.
   */
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
    ensureRootProtocol(fs, PROJECT, WS);
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
    const r = ensureRootProtocol(fs, PROJ, WSP);
    expect(writes.length, "the first launch places what is there to place").to.be.greaterThan(0);
    expect(r.written).to.equal(writes.length);
  });

  it("writes NOTHING on the second launch — same policy, same bytes", () => {
    const files = world();
    const { fs } = tracking(files);
    ensureRootProtocol(fs, PROJ, WSP);
    const second = tracking(files);
    const r = ensureRootProtocol(second.fs, PROJ, WSP);
    expect(second.writes, "nothing changed, so nothing is rewritten").to.deep.equal([]);
    expect(r.written).to.equal(0);
    expect(r.placed, "but gov is still responsible for the same paths").to.not.be.empty;
  });

  it("writes again the moment the POLICY changes — which is the only time a diff should appear", () => {
    const files = world();
    ensureRootProtocol(tracking(files).fs, PROJ, WSP);
    files[`${PROJ}/${WSP}/agent/harness/AGENTS.md`] = "# the protocol, revised\n";
    const after = tracking(files);
    const r = ensureRootProtocol(after.fs, PROJ, WSP);
    expect(r.written, "a governance change reaches every target").to.be.greaterThan(0);
    expect(files[`${PROJ}/AGENTS.md`]).to.contain("revised");
  });
});
