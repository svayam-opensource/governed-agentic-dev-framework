// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { checkProtocol } from "../../src/governance/protocol.js";
import type { ValidateContext } from "../../src/governance/validate.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

function ctx(files: Record<string, string>): ValidateContext {
  const at = (p: string) => files[p.replace(/^\/repo\//, "")] ?? null;
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
const GOOD_PROTOCOL = "§0: the agent speaks first, posts the context manifest before you change any code.";

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

  it("flags a configured Claude gate whose hook parts are missing", () => {
    const r = checkProtocol(
      ctx({
        "agent/session-protocol.md": GOOD_PROTOCOL,
        ".claude/settings.json": '{"hooks":{"session-start":true}}',
        // hooks intentionally absent
      }),
    );
    expect(r.ok).to.equal(false);
    expect(r.errors.some((e) => /\.claude\/hooks\/session-start\.sh is missing/.test(e))).to.equal(true);
  });

  it("passes when a configured gate has all its parts", () => {
    const r = checkProtocol(
      ctx({
        "agent/session-protocol.md": GOOD_PROTOCOL,
        ".claude/settings.json": '{"session-start":1}',
        ".claude/hooks/session-start.sh": "#!/bin/bash\n",
        ".claude/hooks/pre-tool-gate.sh": "#!/bin/bash\n",
        ".claude/hooks/session-ack.sh": "#!/bin/bash\n",
        ".claude/commands/session-start.md": "# session start\n",
      }),
    );
    expect(r.ok).to.equal(true);
  });
});
