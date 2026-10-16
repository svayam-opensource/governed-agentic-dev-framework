// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * `gov evidence enable` — turn an organization's evidence ledger on (spec 02 §3.4; Policy Owner Q1, Q2). Once, by an
 * owner of the GitHub organization. Three things, each skipped when it is already there, so a second run changes
 * nothing:
 *
 *   1 BRANCH   `gov/evidence` in the gov repo, an ORPHAN (no shared history with the default branch, which is never
 *              touched — "no direct push to the default branch" stays intact, Q1) holding evidence/README.md and
 *              evidence/keys/roots.json.
 *   2 RULESET  on that branch: no force push, no deletion, and no one may bypass that. Pushes stay open — to the
 *              writer App and to org members with write access — because writers APPEND.
 *   3 APP      "<org> gov evidence": a customer-owned GitHub App (Q2 — Svayam never holds write access to a customer
 *              repository, and no human account writes evidence), `contents: write` and nothing else, installed on
 *              the gov repo only. Created with GitHub's App-manifest flow; its client id and private key go into
 *              org Actions secrets, the key on gh's STDIN only — never printed, logged or written to disk.
 *
 * Everything goes through the {@link VcsEvidencePort}; nothing here names `gh`.
 */
import type { StartLoopback } from "../cli/app-loopback.js";
import { CODE_SHAPE } from "../cli/app-loopback.js";
import { installUrl, newAppUrl } from "../cli/app-verb.js";
import { SHIPPED_ROOTS } from "../evidence/roots.js";
import type { BranchRuleset, RepoRef, VcsEvidencePort } from "../ports/vcs.js";

export const EVIDENCE_BRANCH = "gov/evidence";

export const EVIDENCE_RULESET: BranchRuleset = Object.freeze<BranchRuleset>({
  name: "gov evidence",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: [`refs/heads/${EVIDENCE_BRANCH}`], exclude: [] } },
  rules: [{ type: "non_fast_forward" }, { type: "deletion" }],
  bypass_actors: [],
});

/** The org secrets the CI evidence step reads to mint the App's token (plan 02 E08). */
export const EVIDENCE_APP_SECRETS = Object.freeze({ clientId: "GOV_EVIDENCE_APP_CLIENT_ID", privateKey: "GOV_EVIDENCE_APP_PRIVATE_KEY" });

export interface EvidenceSetupConfig {
  readonly githubOrg: string;
  /** The governance repository's name (`org_gov_repo`). */
  readonly workspaceRepo: string;
  readonly orgSlugLower: string;
}

export interface EvidenceSetupDeps {
  readonly vcs: VcsEvidencePort;
  readonly loopback: StartLoopback;
  /** An unguessable `state` for the manifest flow. */
  readonly newState: () => string;
  /** Print NOW — the person must see the URL before gov waits on the browser. */
  readonly say: (line: string) => void;
  readonly timeoutMs?: number;
}

export interface EvidenceManifest {
  readonly name: string;
  readonly url: string;
  readonly description: string;
  readonly hook_attributes: { readonly url: string; readonly active: false };
  readonly redirect_url: string;
  readonly public: false;
  readonly default_permissions: { readonly contents: "write" };
  readonly default_events: readonly string[];
}

/** GitHub caps an App's name at 34 characters. */
export function evidenceAppName(org: string): string {
  const tail = " gov evidence";
  return `${org.slice(0, 34 - tail.length)}${tail}`;
}

/** The slug GitHub derives from that name (lower case, runs of other characters to one hyphen). */
export const evidenceAppSlug = (org: string): string => evidenceAppName(org).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** contents: write — the only permission (metadata read comes with every App). No webhook. Private. Pure. */
export function evidenceAppManifest(cfg: EvidenceSetupConfig, redirectUrl: string): EvidenceManifest {
  const home = `https://github.com/${cfg.githubOrg}/${cfg.workspaceRepo}`;
  return {
    name: evidenceAppName(cfg.githubOrg),
    url: home,
    description: `Writes gov's signed evidence to the ${EVIDENCE_BRANCH} branch of ${cfg.githubOrg}/${cfg.workspaceRepo}. Install it on that repository only.`,
    hook_attributes: { url: home, active: false },
    redirect_url: redirectUrl,
    public: false,
    default_permissions: { contents: "write" },
    default_events: [],
  };
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);

function manifestPage(m: EvidenceManifest, org: string, state: string): string {
  return [
    "<!doctype html><meta charset=utf-8><title>gov evidence enable</title>",
    `<form method="post" action="${esc(newAppUrl(org, state))}">`,
    `<input type="hidden" name="manifest" value="${esc(JSON.stringify(m))}">`,
    `<p>Taking you to GitHub to create <b>${esc(m.name)}</b> for ${esc(org)}…</p>`,
    "<noscript><button type=submit>Continue to GitHub</button></noscript></form>",
    "<script>document.forms[0].submit()</script>",
  ].join("\n");
}

export function evidenceReadme(cfg: EvidenceSetupConfig): string {
  return `# Evidence — ${cfg.githubOrg}

This branch holds gov's signed evidence: a record of every check, gate decision and governed session, written by
gov-check. It is never edited by hand. Force pushes and deletion are refused by the ruleset "gov evidence".

| Path | What |
|---|---|
| \`evidence/chain/<yyyy>-<mm>.jsonl\` | the chain: one signed entry per segment, each linked to the one before |
| \`evidence/<yyyy>/<mm>/<dd>/<segment>.jsonl\` | segments: records, then one signed seal |
| \`evidence/<yyyy>/<mm>/<dd>/gap-….jsonl\` | runs for which no evidence was written — never a pass |
| \`evidence/keys/roots.json\` | Svayam root keys (rotation) |
| \`evidence/keys/<kid>.json\` | each writer's public key and the lease that certifies it |

## Verify it

Anyone can, for free, offline — no licence needed:

\`\`\`bash
git clone --branch ${EVIDENCE_BRANCH} --single-branch https://github.com/${cfg.githubOrg}/${cfg.workspaceRepo}.git evidence-check
gov evidence verify --gov-home evidence-check
\`\`\`
`;
}

export function initialRoots(): string {
  return `${JSON.stringify({ roots: SHIPPED_ROOTS.map((k) => ({ ...k })) }, null, 2)}\n`;
}

export interface EvidenceEnableResult { readonly code: number; readonly lines: readonly string[] }

export async function evidenceEnable(deps: EvidenceSetupDeps, cfg: EvidenceSetupConfig): Promise<EvidenceEnableResult> {
  if (!cfg.githubOrg || !cfg.workspaceRepo || !cfg.orgSlugLower) {
    return { code: 1, lines: ["evidence enable: org-config.yaml must name `github_org`, `org_slug_lower` and `org_gov_repo` — set them (gov setup), then run this again. Nothing was asked of GitHub."] };
  }
  const org = cfg.githubOrg;
  const repo: RepoRef = { owner: org, name: cfg.workspaceRepo };
  const full = `${org}/${cfg.workspaceRepo}`;
  const lines: string[] = [];
  let failed = false;

  const info = await deps.vcs.repo(repo);
  if (!info.ok) return { code: 1, lines: [`evidence enable: ${info.reason}. Nothing was changed.`] };

  // 1 · THE BRANCH
  const br = await deps.vcs.branch(repo, EVIDENCE_BRANCH);
  if (!br.ok) return { code: 1, lines: [`evidence enable: ${br.reason}. Nothing was changed.`] };
  if (br.value) {
    lines.push(`✓ ${full} already has the branch ${EVIDENCE_BRANCH}.`);
  } else {
    const made = await deps.vcs.createOrphanBranch(repo, EVIDENCE_BRANCH, [
      { path: "evidence/README.md", text: evidenceReadme(cfg) },
      { path: "evidence/keys/roots.json", text: initialRoots() },
    ], "gov evidence enable: start the evidence ledger");
    if (!made.ok) return { code: 1, lines: [`evidence enable: ${made.reason}. Nothing else was changed.`] };
    lines.push(`✓ Created ${EVIDENCE_BRANCH} in ${full} — an orphan branch with evidence/README.md and evidence/keys/roots.json (${info.value.defaultBranch} untouched).`);
  }

  // 2 · THE RULESET
  const rs = await deps.vcs.rulesets(repo);
  if (!rs.ok) {
    failed = true;
    lines.push(`✗ could not read ${full}'s rulesets (${rs.reason}) — the branch is NOT protected yet. Rulesets on a private repository need GitHub Team or Enterprise; an owner can run this again once that holds.`);
  } else if (rs.value.some((x) => x.name === EVIDENCE_RULESET.name)) {
    lines.push(`✓ The ruleset "${EVIDENCE_RULESET.name}" already guards ${EVIDENCE_BRANCH}.`);
  } else {
    const made = await deps.vcs.createRuleset(repo, EVIDENCE_RULESET);
    if (made.ok) lines.push(`✓ Created the ruleset "${EVIDENCE_RULESET.name}": no force push and no deletion on ${EVIDENCE_BRANCH}, for anyone.`);
    else { failed = true; lines.push(`✗ could not create the ruleset "${EVIDENCE_RULESET.name}" (${made.reason}) — ${EVIDENCE_BRANCH} is NOT protected yet.`); }
  }

  // 3 · THE WRITER APP
  const slug = evidenceAppSlug(org);
  const exists = await deps.vcs.appExists(slug);
  const secrets = await deps.vcs.orgSecretNames(org);
  if (!exists.ok) return { code: 1, lines: [...lines, `✗ ${exists.reason}.`] };
  if (!secrets.ok) return { code: 1, lines: [...lines, `✗ ${secrets.reason}.`] };
  const haveSecrets = [EVIDENCE_APP_SECRETS.clientId, EVIDENCE_APP_SECRETS.privateKey].every((n) => secrets.value.includes(n));
  if (exists.value && haveSecrets) {
    lines.push(`✓ The writer App ${slug} exists and its secrets ${EVIDENCE_APP_SECRETS.clientId}, ${EVIDENCE_APP_SECRETS.privateKey} are set.`);
    lines.push(failed ? "evidence enable: not finished — fix the ✗ above and run it again." : "evidence enable: already on — nothing to do.");
    return { code: failed ? 1 : 0, lines };
  }
  if (exists.value) {
    lines.push(`✗ The App ${slug} exists but its org secrets are missing. GitHub shows a key only once: generate a new private key at https://github.com/organizations/${org}/settings/apps/${slug}, then set it with`,
      `    gh secret set ${EVIDENCE_APP_SECRETS.privateKey} --org ${org} --visibility all < <the .pem file>`,
      `    gh secret set ${EVIDENCE_APP_SECRETS.clientId} --org ${org} --visibility all   (the App's client id)`);
    return { code: 1, lines };
  }

  const state = deps.newState();
  let session;
  try {
    session = await deps.loopback({ page: (redirect) => manifestPage(evidenceAppManifest(cfg, redirect), org, state), state, timeoutMs: deps.timeoutMs ?? 10 * 60_000 });
  } catch (e) {
    return { code: 1, lines: [...lines, `✗ could not open a local listener for GitHub's redirect (${(e as Error).message}). The App was not created.`] };
  }
  deps.say(`Open this page in a browser ON THIS MACHINE, signed in to GitHub as an owner of ${org}:`);
  deps.say(`  ${session.url}`);
  deps.say(`It takes you to GitHub to create the App "${evidenceAppName(org)}" (repository contents: write — nothing else; no webhook). Keep this terminal open.`);
  let code: string;
  try {
    code = await session.code;
  } catch (e) {
    return { code: 1, lines: [...lines, `✗ ${(e as Error).message} — nothing came back from GitHub, so no App was recorded. Run \`gov evidence enable\` again.`] };
  } finally {
    session.close();
  }
  if (!CODE_SHAPE.test(code)) return { code: 1, lines: [...lines, "✗ GitHub's redirect carried no usable code. Run `gov evidence enable` again."] };

  const app = await deps.vcs.convertAppManifest(code);
  if (!app.ok) {
    return { code: 1, lines: [...lines, `✗ ${app.reason}. The code is single-use: if the App was created anyway, delete it at https://github.com/organizations/${org}/settings/apps and run this again.`] };
  }
  lines.push(`✓ Created the GitHub App ${app.value.slug} (client id ${app.value.clientId}).`);
  for (const [name, value] of [[EVIDENCE_APP_SECRETS.clientId, app.value.clientId], [EVIDENCE_APP_SECRETS.privateKey, app.value.pem]] as const) {
    const s = await deps.vcs.setOrgSecret(org, name, value);
    if (s.ok) lines.push(`✓ Stored ${name} as a ${org} organization Actions secret (visible to all its repositories).`);
    else { failed = true; lines.push(`✗ ${s.reason}.`); }
  }
  lines.push(
    "gov kept no copy of the key.",
    "",
    "Now install the App — one step only an owner can do in the browser:",
    `  ${installUrl(app.value.slug)}`,
    `  Choose ${org}, then "Only select repositories" → ${cfg.workspaceRepo}. It must have no other repository.`,
    "On GitHub Free, an organization secret does not reach a private repository: give each private code repository its own copy of both secrets.",
  );
  if (failed) lines.push("evidence enable: not finished — fix the ✗ above and run it again (finished steps are skipped).");
  return { code: failed ? 1 : 0, lines };
}
