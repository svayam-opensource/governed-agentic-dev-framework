import type { Fs } from "../lifecycle/fs-io.js";
import { type OrgConfigValues } from "./setup.js";
export interface SetupIo {
    readonly fs: Fs;
    readonly cwd: string;
    readonly originUrl: string;
    readonly ghUser: string | null;
    readonly gitEmail: string | null;
    readonly today: string;
    readonly existing?: Partial<OrgConfigValues>;
    /** Ask a question with a default; return the answer (default if blank). Injected. */
    readonly prompt: (question: string, def: string) => Promise<string>;
    readonly print: (line: string) => void;
    /** Configure the origin remote (git remote set-url/add). Optional. */
    readonly setOriginRemote?: (url: string) => void;
}
export declare function runSetup(io: SetupIo, interactive: boolean): Promise<number>;
