// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { checkProtocol } from "../../src/governance/protocol.js";
import type { ValidateContext } from "../../src/governance/validate.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";

function ctx(files: Record<string, string>): ValidateContext {
  const at = (p: string) => files[px(p).replace(/^\/repo\//, "")] ?? null;
  const fs: Fs = {
    pathExists: (p) => at(p) !== null,
    readFile: (p) => at(p),
    mkdirp: () => {},
    writeFile: () => {},
    rm: () => {},
    readdir: () => [],
  };
  return { fs, repoRoot: "/repo" };
}
// The fixture must quote the §0 the Policy Owner approved on 2026-09-11, not the pre-restructure
// wording. These two fixtures kept the old phrases alive after the protocol dropped them, which
// is half of why the anchors went stale unnoticed — the other half being that
// publish/content's copy had drifted to the old protocol too, so validator and fixture agreed
// with each other and neither agreed with the shipped source.
const GOOD_PROTOCOL = "## 0. Before any meaningful work — your first substantive reply must be the context manifest; until then you must refuse meaningful work.";

describe("prj-work Phase 3 — checkProtocol (port of check_protocol.py)", () => {
  it("passes when the protocol carries its §0 mandate and no gate is configured", () => {
    expect(checkProtocol(ctx({ "agent/session-protocol.md": GOOD_PROTOCOL })).ok).to.equal(true);
  });

  it("fails when the protocol file is missing", () => {
    const r = checkProtocol(ctx({}));
    expect(r.ok).to.equal(false);
    expect(r.errors[0]).to.match(/session-protocol\.md is missing/);
  });

  it("fails when the §0 mandate anchors were gutted", () => {
    const r = checkProtocol(ctx({ "agent/session-protocol.md": "just some other text" }));
    expect(r.ok).to.equal(false);
    expect(r.errors[0]).to.match(/no longer contains its §0 mandate/);
  });

  it("no longer polices a developer's own vendor hooks (Decision 4, 2026-09-14)", () => {
    // It used to assert that a `.claude/settings.json` mentioning a session-start hook implied
    // gov's three hook scripts and its command file all existed. gov ships none of them now —
    // they never fired, since every launch uses the project directory as cwd and the mirror
    // never carried them — and a developer's own settings file is theirs. Reporting their hooks
    // as "missing/empty" is gov policing a file it was specifically changed to stop writing.
    const files: Record<string, string> = {
      "agent/session-protocol.md": GOOD_PROTOCOL,
      ".claude/settings.json": '{"hooks":{"SessionStart":[{"matcher":"startup"}]}}',
      ".cursor/hooks.json": '{"session-gate":true}',
    };
    const r = checkProtocol(ctx(files));
    expect(r.ok, "a developer's own hooks are not gov's to validate").to.equal(true);
    expect(r.errors).to.deep.equal([]);
  });
});
