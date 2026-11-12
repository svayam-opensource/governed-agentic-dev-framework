// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * THE GOV REPO'S NUMERIC GITHUB ORG ID — for evidence records and for the licence calls that name the repo's org
 * (MO1 Q3). CI has it in the environment (`GITHUB_REPOSITORY_OWNER_ID`); locally `gh api orgs/<org>` is asked, at
 * most once per process. Never throws: null when it cannot be learnt.
 */
import { tryRun as tryRunProcess } from "../run-process.js";

type Env = Readonly<Record<string, string | undefined>>;
export type GhLookup = (githubOrg: string) => string | null | undefined;

const ghOrgId: GhLookup = (githubOrg) =>
  tryRunProcess("gh", ["api", `orgs/${githubOrg}`, "--jq", ".id"], { pgm: "gov-work:cli:org-id", fn: "githubOrgId" });

const positive = (v: string | null | undefined): number | null => {
  const n = Number((v ?? "").trim());
  return v && Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** A lazy, memoised org-id provider. `githubOrg` is the gov repo's org name (org-config.yaml `github_org`). */
export function githubOrgIdProvider(githubOrg: string, env: Env = process.env, gh: GhLookup = ghOrgId): () => Promise<number | null> {
  let memo: Promise<number | null> | null = null;
  return () => {
    memo ??= Promise.resolve().then(() => {
      const fromEnv = positive(env.GITHUB_REPOSITORY_OWNER_ID);
      if (fromEnv) return fromEnv;
      return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(githubOrg) ? positive(gh(githubOrg)) : null;
    });
    return memo;
  };
}
