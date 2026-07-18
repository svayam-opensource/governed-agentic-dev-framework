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
export declare function createNodeFs(): Fs;
