import type { Fs } from "../lifecycle/fs-io.js";
export type BumpResult = {
    readonly ok: true;
    readonly version: string;
    readonly written: readonly string[];
} | {
    readonly ok: false;
    readonly code: number;
    readonly error: string;
};
export declare function bumpVersion(fs: Fs, repoRoot: string, newVersion: string): BumpResult;
