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
import type { GovHome } from "./types.js";
import { formatGovWorkspaces, parseGovWorkspaces } from "./registry.js";

/** Read/write access to the multi-home registry. */
export interface RegistryStore {
  readHomes(): GovHome[];
  writeHomes(homes: readonly GovHome[]): void;
  readActiveOrg(): string | null;
  writeActiveOrg(org: string): void;
  clearActiveOrg(): void;
}

export interface RegistryStoreOptions {
  readonly configDir?: string;
  readonly home?: string;
}

/** A node:fs-backed {@link RegistryStore}. */
export function createNodeRegistryStore(opts: RegistryStoreOptions = {}): RegistryStore {
  const home = opts.home ?? os.homedir();
  const configDir =
    opts.configDir ?? path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "prj");
  const govWorkspaces = path.join(configDir, "gov-workspaces");
  const activeOrgFile = path.join(configDir, "active-org");

  const readText = (file: string): string | null => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  };
  const writeAtomic = (file: string, content: string): void => {
    fs.mkdirSync(configDir, { recursive: true });
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
      } catch {
        /* already gone */
      }
    },
  };
}
