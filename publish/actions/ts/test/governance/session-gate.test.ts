// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import {
  evaluateGate,
  isAckCommand,
  isIdentityProbe,
  preToolGateOutput,
  runPreToolGate,
  sessionStartOutput,
  markerPath,
  writeAck,
  clearAck,
  ackExists,
} from "../../src/governance/session-gate.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

describe("prj-work Phase 3 — session gate", () => {
  it("whitelists the ack command and identity probes", () => {
    expect(isAckCommand('bash "$X/session-ack.sh"')).to.equal(true);
    expect(isAckCommand("echo hi")).to.equal(false);
    expect(isIdentityProbe("gh api user --jq .login")).to.equal(true);
    expect(isIdentityProbe("gh auth status")).to.equal(true);
    expect(isIdentityProbe("gh repo delete x")).to.equal(false);
  });

  it("denies a mutating tool pre-ack, allows it once acknowledged", () => {
    const denied = evaluateGate({ toolName: "Write" }, false);
    expect(denied.decision).to.equal("deny");
    if (denied.decision === "deny") expect(denied.reason).to.match(/session-start/);
    expect(evaluateGate({ toolName: "Write" }, true).decision).to.equal("allow");
    expect(evaluateGate({ toolName: "Edit" }, false).decision).to.equal("deny");
    expect(evaluateGate({ toolName: "Bash", command: "make build" }, false).decision).to.equal("deny");
  });

  it("allows non-mutating tools, the ack Bash command, and probes pre-ack", () => {
    expect(evaluateGate({ toolName: "Read" }, false).decision).to.equal("allow");
    expect(evaluateGate({ toolName: "Bash", command: "bash session-ack.sh" }, false).decision).to.equal("allow");
    expect(evaluateGate({ toolName: "Bash", command: "gh api user" }, false).decision).to.equal("allow");
    expect(evaluateGate({ toolName: "Bash", command: "rm -rf /" }, false).decision).to.equal("deny");
  });

  it("preToolGateOutput emits deny JSON, or null to allow", () => {
    expect(preToolGateOutput({ decision: "allow" })).to.equal(null);
    const out = JSON.parse(preToolGateOutput({ decision: "deny", reason: "x" })!);
    expect(out.hookSpecificOutput).to.include({ hookEventName: "PreToolUse", permissionDecision: "deny" });
    expect(JSON.parse(sessionStartOutput()).hookSpecificOutput.hookEventName).to.equal("SessionStart");
  });

  it("runPreToolGate parses hook stdin and fails OPEN on bad input", () => {
    const denyJson = runPreToolGate(JSON.stringify({ tool_name: "Write", tool_input: {} }), false);
    expect(JSON.parse(denyJson!).hookSpecificOutput.permissionDecision).to.equal("deny");
    expect(runPreToolGate(JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh api user" } }), false)).to.equal(null);
    expect(runPreToolGate("not json", false)).to.equal(null); // fail-open
  });

  it("marker write / clear / exists round-trips over the Fs port", () => {
    const store = new Set<string>();
    const fs: Fs = {
      pathExists: (p) => store.has(p),
      writeFile: (p) => store.add(p),
      rm: (p) => store.delete(p),
      readFile: () => null,
      mkdirp: () => {},
      readdir: () => [],
    };
    expect(markerPath("/root")).to.equal("/root/.claude/.session-ack");
    expect(ackExists(fs, "/root")).to.equal(false);
    writeAck(fs, "/root", "2026-07-03T00:00:00Z");
    expect(ackExists(fs, "/root")).to.equal(true);
    clearAck(fs, "/root");
    expect(ackExists(fs, "/root")).to.equal(false);
  });
});
