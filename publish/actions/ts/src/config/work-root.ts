// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * YOUR WORK ROOT — where YOUR project folders live (org-config split, Policy Owner 2026-10-06).
 *
 * `agent_work_root` was an org-config key: one value for everybody's disk. It is a per-developer setting now. It
 * cannot live in `preferences.json`, because that file lives INSIDE the work root
 * (`<work root>/preferences/<login>/preferences.json`) — a setting that says where it is itself kept. So it lives
 * beside the workspace registry, in `~/.gov/work-roots`, in the registry's own shape: one `<github_org>\t<path>`
 * line per organization.
 *
 * Nobody has to write it. Absent, the work root is `~/.gov/<slug>/projects` ({@link defaultWorkRoot}), which is
 * where `gov setup` has always put it.
 *
 * CARRIED FORWARD, NOT DROPPED. An organization that set `agent_work_root` to something other than the default
 * keeps it on every machine that runs gov before `gov upgrade` removes the key: {@link resolveWorkRoot} records the
 * org-config value in this person's file the first time it reads one, and the `org-config-split` migration records
 * it for the person who runs the upgrade.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { govRegistryDir, readTopLevelScalar } from "../resolve/node-env.js";
import { formatGovWorkspaces, homeForOrg, parseGovWorkspaces, upsertHome } from "../resolve/registry.js";
import { defaultWorkRoot, parseOrgConfig, type OrgConfig } from "./org-config.js";
import { log } from "../log.js";

/** `~/.gov/work-roots`. */
export function workRootsFile(home: string = os.homedir()): string {
  return path.join(govRegistryDir(home), "work-roots");
}

/** This person's recorded work root for an organization, or null. */
export function readWorkRoot(githubOrg: string, home: string = os.homedir()): string | null {
  if (!githubOrg) return null;
  try { return homeForOrg(parseGovWorkspaces(fs.readFileSync(workRootsFile(home), "utf8")), githubOrg); }
  catch { return null; /* no file: nobody chose, and the default applies */ }
}

/** Record this person's work root for an organization. Never throws — a setting that cannot be saved is said, not fatal. */
export function recordWorkRoot(githubOrg: string, root: string, home: string = os.homedir()): boolean {
  if (!githubOrg || !root) return false;
  try {
    const file = workRootsFile(home);
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { /* first entry */ }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, formatGovWorkspaces(upsertHome(parseGovWorkspaces(text), githubOrg, root)), "utf8");
    return true;
  } catch (e) {
    log("warn", "could not record a work root", "gov-work:config:work-root", "recordWorkRoot", { githubOrg, error: (e as Error).message });
    return false;
  }
}

/**
 * The work root to use for an org-config text: this person's recorded one, else an org-config `agent_work_root` that
 * differs from the default (recorded locally so the upgrade that removes the key cannot move anyone's folders),
 * else null — the default applies.
 */
export function resolveWorkRoot(orgConfigText: string, home: string = os.homedir()): string | null {
  const org = (readTopLevelScalar(orgConfigText, "github_org") ?? "").trim();
  const mine = readWorkRoot(org, home);
  if (mine) return mine;
  const legacy = (readTopLevelScalar(orgConfigText, "agent_work_root") ?? "").trim();
  const slug = (readTopLevelScalar(orgConfigText, "org_slug") ?? "").trim();
  if (legacy && legacy !== defaultWorkRoot(slug)) {
    recordWorkRoot(org, legacy, home);
    return legacy;
  }
  return null;
}

/** org-config.yaml's text, parsed with this person's own work root — what every command runs with. */
export function loadOrgConfigText(text: string, home: string = os.homedir()): OrgConfig {
  return parseOrgConfig(text, home, { workRoot: resolveWorkRoot(text, home) });
}
