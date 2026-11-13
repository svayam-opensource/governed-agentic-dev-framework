// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * THE MAJOR-VERSION GUARD (gov 1.2.4; PRJ-121 F55, Policy Owner ruling A, 2026-11-12).
 *
 * gov 1.x's `gov upgrade` fetches the framework's content from the template's `main` and applies it with ITS OWN
 * logic. Once gov 2.0's content is on `main`, a 1.x client would write 2.0 files without the 2.0 migration that
 * moves the org's own files — a broken governance repo. So a gov refuses content of a NEWER MAJOR version than its
 * own, before planning anything, and says how to upgrade gov and the repo together. Older or equal content is
 * unchanged behaviour; content whose version cannot be read is let through, as before (no new failure mode).
 */

/** The major number of a version (`2.0.0-next.3` → 2), or null when it is not one. */
export function majorOf(version: string | null | undefined): number | null {
  const m = /^\s*v?(\d+)\.\d+\.\d+/.exec(version ?? "");
  return m ? Number(m[1]) : null;
}

/** The refusal's lines when `contentVersion` is a newer major than `cliVersion`; null when it may be applied. */
export function contentTooNew(cliVersion: string, contentVersion: string | null): string[] | null {
  const cli = majorOf(cliVersion);
  const content = majorOf(contentVersion);
  if (cli === null || content === null || content <= cli) return null;
  return [
    `gov upgrade: this content is gov ${contentVersion!.trim()}, and this gov is ${cliVersion}.`,
    `  gov ${cli}.x cannot apply gov ${content}.x content: the layout changed, and only gov ${content} knows how to move your`,
    "  organization's own files. Nothing was changed.",
    "",
    `  Upgrade gov and this governance repository together (it opens a pull request for you to review):`,
    "    macOS / Linux:         curl -fsSL https://gov.svayamtech.com/upgrade.sh -o upgrade.sh && bash upgrade.sh",
    "    Windows (PowerShell):  irm https://gov.svayamtech.com/upgrade.ps1 | iex",
    "",
    `  To stay on gov ${cli}.x content for now:  gov upgrade --ref gov-work-${cliVersion}`,
  ];
}
