// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 §4 — the session manifest gains "Incoming / Outgoing signals" after "Open todos", in every rendered harness. */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const HARNESS = ["CLAUDE.md", "AGENTS.md", "GEMINI.md", "CONVENTIONS.md", ".cursor/rules/agent.mdc", ".github/copilot-instructions.md", ".clinerules/agent.md", ".continue/rules/agent.md", ".windsurf/rules/agent.md"];

describe("session protocol — signal lines in the context manifest", () => {
  for (const f of ["agent/session-protocol.md", ...HARNESS.map((h) => `agent/harness/${h}`)]) {
    it(`${f}: Incoming then Outgoing signals, right after Open todos`, () => {
      const t = fs.readFileSync(path.join(CONTENT, f), "utf8");
      const todos = t.indexOf("- **Open todos:**");
      const inc = t.indexOf("- **Incoming signals:**"), out = t.indexOf("- **Outgoing signals:**");
      expect(todos, "Open todos").to.be.greaterThan(-1);
      expect(inc).to.be.greaterThan(todos);
      expect(out).to.be.greaterThan(inc);
      expect(t.slice(todos, out).split("\n")).to.have.lengthOf(3);
    });
  }
});
