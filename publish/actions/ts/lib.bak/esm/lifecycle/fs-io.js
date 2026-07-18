// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Fs` write port (SDD Part B, seed) — mkdir/write/read/rm, with a node:fs
 * adapter. Kept behind a port so the seed orchestrator is testable without disk.
 */
import * as fs from "node:fs";
import * as path from "node:path";
/** The real node:fs-backed writer. */
export function createNodeFs() {
    return {
        pathExists: (p) => fs.existsSync(p),
        mkdirp: (dir) => {
            fs.mkdirSync(dir, { recursive: true });
        },
        writeFile: (file, content) => {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content, "utf8");
        },
        readFile: (file) => {
            try {
                return fs.readFileSync(file, "utf8");
            }
            catch {
                return null;
            }
        },
        rm: (target) => {
            fs.rmSync(target, { recursive: true, force: true });
        },
        readdir: (dir) => {
            try {
                return fs.readdirSync(dir);
            }
            catch {
                return [];
            }
        },
    };
}
