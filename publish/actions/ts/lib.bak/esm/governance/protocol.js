// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Session-start protocol integrity check (SDD-030/032, #54) — port of
 * check_protocol.py. Gates that the protocol is DELIVERED: the canonical file
 * exists, still carries its §0 mandate, and the configured client gates have all
 * their hook parts present.
 *
 * NOTE: the render-harness `--check` (generated copies match the canonical) is
 * DEFERRED — it needs the Node harness renderer (no shelling to bash). Tracked.
 */
import * as path from "node:path";
/** Stable §0 anchors — if any disappears, the core mandate was gutted. */
const MANDATE_ANCHORS = ["agent speaks first", "context manifest", "before you change any code"];
const CLAUDE_GATE_PARTS = [
    ".claude/hooks/session-start.sh",
    ".claude/hooks/pre-tool-gate.sh",
    ".claude/hooks/session-ack.sh",
    ".claude/commands/session-start.md",
];
const CURSOR_GATE_PARTS = [
    ".cursor/hooks/session-start.sh",
    ".cursor/hooks/session-gate.sh",
    ".cursor/hooks/session-ack.sh",
];
export function checkProtocol(ctx) {
    const errors = [];
    const read = (rel) => ctx.fs.readFile(path.join(ctx.repoRoot, rel));
    const presentNonEmpty = (rel) => {
        const t = read(rel);
        return t !== null && t.trim() !== "";
    };
    const protocol = read("agent/session-protocol.md");
    if (protocol === null) {
        return { name: "protocol", ok: false, errors: ["agent/session-protocol.md is missing — the session-start protocol is undelivered"] };
    }
    if (protocol.trim() === "") {
        errors.push("agent/session-protocol.md is empty");
    }
    else {
        const low = protocol.toLowerCase();
        const missing = MANDATE_ANCHORS.filter((a) => !low.includes(a));
        if (missing.length)
            errors.push(`agent/session-protocol.md no longer contains its §0 mandate (missing: ${missing.join(", ")})`);
    }
    // Client gates: if configured, every hook part must be present + non-empty.
    const settings = read(".claude/settings.json");
    if (settings !== null && settings.includes("session-start")) {
        for (const rel of CLAUDE_GATE_PARTS) {
            if (!presentNonEmpty(rel))
                errors.push(`session-start gate is configured but ${rel} is missing/empty`);
        }
    }
    const cursorHooks = read(".cursor/hooks.json");
    if (cursorHooks !== null && cursorHooks.includes("session-gate")) {
        for (const rel of CURSOR_GATE_PARTS) {
            if (!presentNonEmpty(rel))
                errors.push(`Cursor session-start gate is configured but ${rel} is missing/empty`);
        }
    }
    return { name: "protocol", ok: errors.length === 0, errors };
}
