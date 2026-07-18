// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The writable CLI-local multi-home registry (SDD-041/042) — the READ side lives
 * in the resolver's `node-env`; this is the WRITE side used by `prj org …` (the
 * ONLY writer of the registry, per the model-A resolver decision). Files under
 * `${XDG_CONFIG_HOME:-~/.config}/prj/`: `gov-workspaces` + `active-org`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { formatGovWorkspaces, parseGovWorkspaces } from "./registry.js";
import { configDir } from "./node-env.js";
/** A node:fs-backed {@link RegistryStore}. */
export function createNodeRegistryStore(opts = {}) {
    const home = opts.home ?? os.homedir();
    const configDirPath = opts.configDir ?? configDir(process.env, process.platform, home);
    const govWorkspaces = path.join(configDirPath, "gov-workspaces");
    const activeOrgFile = path.join(configDirPath, "active-org");
    const readText = (file) => {
        try {
            return fs.readFileSync(file, "utf8");
        }
        catch {
            return null;
        }
    };
    const writeAtomic = (file, content) => {
        fs.mkdirSync(configDirPath, { recursive: true });
        const tmp = `${file}.tmp-${process.pid}`;
        fs.writeFileSync(tmp, content, "utf8");
        fs.renameSync(tmp, file);
    };
    return {
        readHomes() {
            const t = readText(govWorkspaces);
            return t ? parseGovWorkspaces(t) : [];
        },
        writeHomes(homes) {
            writeAtomic(govWorkspaces, formatGovWorkspaces(homes));
        },
        readActiveOrg() {
            const t = readText(activeOrgFile);
            return t ? t.split("\n")[0].trim() || null : null;
        },
        writeActiveOrg(org) {
            writeAtomic(activeOrgFile, `${org}\n`);
        },
        clearActiveOrg() {
            try {
                fs.rmSync(activeOrgFile, { force: true });
            }
            catch {
                /* already gone */
            }
        },
    };
}
