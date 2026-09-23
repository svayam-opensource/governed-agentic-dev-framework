// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Fs` write port (SDD Part B, seed) — mkdir/write/read/rm, with a node:fs
 * adapter. Kept behind a port so the seed orchestrator is testable without disk.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "../log.js";
import type { FsProbe } from "./vcs.js";

/** Filesystem writes seed needs (extends the read-only {@link FsProbe}). */
export interface Fs extends FsProbe {
  /** Create `dir` (and parents) if absent. */
  mkdirp(dir: string): void;
  /** Write `content` to `file`, creating parent dirs. */
  writeFile(file: string, content: string): void;
  /** Read `file` as UTF-8, or null if it doesn't exist. */
  readFile(file: string): string | null;
  /** Remove `target` recursively (best-effort; no error if absent). */
  rm(target: string): void;
  /** List entry names in `dir` (empty array if it doesn't exist). */
  readdir(dir: string): string[];
}

/** The real node:fs-backed writer. */
/**
 * THE WRITES ARE LOGGED, the reads are not (PRJ-121, 2026-09-23).
 *
 * What a run CHANGED on disk is the second question of every diagnosis ("what did it do?"), and it was
 * unanswerable. A read is not a change, and there are thousands of them; a write, a delete and a new directory
 * are the facts worth keeping. The CONTENT is never logged — it is often a policy, a key or someone's prose —
 * only the path and how many bytes.
 */
export function createNodeFs(): Fs {
  return {
    pathExists: (p) => fs.existsSync(p),
    mkdirp: (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      log("info", "made a directory", "gov-work:lifecycle:fs-io", "mkdirp", { dir });
    },
    writeFile: (file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
      log("info", "wrote a file", "gov-work:lifecycle:fs-io", "writeFile", { file, bytes: Buffer.byteLength(content, "utf8") });
    },
    readFile: (file) => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch { /* absent or unreadable is the ordinary answer here, not a failure */
        return null;
      }
    },
    rm: (target) => {
      const existed = fs.existsSync(target);
      fs.rmSync(target, { recursive: true, force: true });
      log(existed ? "info" : "debug", existed ? "removed" : "removed (nothing there)", "gov-work:lifecycle:fs-io", "rm", { target });
    },
    readdir: (dir) => {
      try {
        return fs.readdirSync(dir);
      } catch { /* absent or unreadable is the ordinary answer here, not a failure */
        return [];
      }
    },
  };
}
