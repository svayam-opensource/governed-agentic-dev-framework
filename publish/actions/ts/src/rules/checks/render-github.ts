// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE `github-actions` RENDERER (rule-model-design.md Q14; W6).
 *
 * A binding is rendered into the resource's own automation — there is no central service. For GitHub that is ONE
 * workflow per repository, `.github/workflows/gov-checks.yml`, triggering on the union of the bound events, with
 * one job per rule · event that calls `gov check run <GOV-ID> --resource <r> --event <e>`. One job per rule makes
 * each rule its own status check, which is what a branch protection can require.
 *
 * BYTE-STABLE: triggers, issue types and jobs are sorted, and a rule bound twice on one event (two actions) is one
 * job — the runner runs every binding of that rule on that event. The same bindings in any order render the same
 * bytes, so a re-render that changes nothing produces no diff.
 *
 * An event GitHub Actions cannot trigger on is NOT dropped silently: it is named in a comment at the top, and the
 * rule stays `cannot-tell` for it.
 *
 * Pure.
 */
import type { CheckBinding } from "../model/catalog.js";
import type { BindingRenderer } from "../model/contracts.js";

export const WORKFLOW_PATH = ".github/workflows/gov-checks.yml";

export interface GithubRendererOptions {
  /** What `npm install -g` installs. Default: the published gov CLI, as `gov-validate.yml` installs it. */
  readonly govPackage?: string;
  /** The repository's default branch, for `$default` push filters. Unknown → those pushes are not filtered. */
  readonly defaultBranch?: string;
  /**
   * A CODE repository's workflow: the governance repository (`owner/name`) to check out beside it, because the rules
   * live there (read at ITS default branch). Absent → this IS the governance repository (`--gov-home .`), whose own
   * `GITHUB_TOKEN` reads it.
   *
   * GOV-REPO ACCESS IS A GITHUB APP (Policy Owner, 2026-10-06 — no stopgap). `GITHUB_TOKEN` is scoped to the one
   * repository running the workflow, by design, so a code repo's job mints a short-lived token per run with
   * {@link CREATE_APP_TOKEN} from the org's App (`GOV_APP_CLIENT_ID`, `GOV_APP_PRIVATE_KEY` org secrets), limited to the
   * governance repository and to reading its contents. No personal token, no long-lived secret that can write.
   */
  readonly govCheckout?: { readonly repository: string };
}

/**
 * `actions/create-github-app-token`, pinned to a full commit sha — a tag can be moved, a sha cannot. v3.2.0 is the
 * latest release (published 2026-05-12); the sha is its tag's commit, read from GitHub on 2026-10-06. Bump both
 * together.
 */
export const CREATE_APP_TOKEN = "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0";
/** The org Actions secrets the App's token is minted from (`gov check install` prints how to set them). */
export const GOV_APP_SECRETS = { clientId: "GOV_APP_CLIENT_ID", privateKey: "GOV_APP_PRIVATE_KEY" } as const;
/**
 * The org Actions secrets holding the model keys `gov rules propose` may use in CI (framework §9.3; the providers
 * that take a key — Policy Owner, 2026-10-07). LEAST PRIVILEGE: only the job that runs the rules-propose action gets
 * them; every other job runs without. A secret the org has not set renders as an empty variable, and propose then
 * refuses in plain words, naming it.
 */
export const MODEL_KEY_SECRETS = ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"] as const;

type Binding = { readonly id: string; readonly check: CheckBinding };
/** The GitHub trigger for a resource · event: the `on:` key, and for `issues` the activity type. */
type Trigger = { readonly on: string; readonly type?: string };

const ISSUE_TYPES = new Set(["opened", "closed", "edited"]);

/**
 * THE CHECK-RUN NAME GitHub shows for a rendered job — the job's `name:`, which is what a branch protection lists as
 * a required status check. ONE spelling, used by the renderer below and by `gov repo protect` (maintain/rule-checks.ts),
 * so the check gov makes required is the check the workflow actually reports.
 */
export const checkRunName = (id: string, event: string): string => `${id} · ${event}`;

/** Does a binding on this resource · event render to a GitHub `pull_request` job — one a branch can require? */
export const rendersAsPullRequestJob = (resource: string, event: string): boolean => triggerFor(resource, event)?.on === "pull_request";

function triggerFor(resource: string, event: string): Trigger | null {
  if (resource.startsWith("vcs.") && (event === "pull_request" || event === "push")) return { on: event };
  if (resource === "pms.issue" && ISSUE_TYPES.has(event)) return { on: "issues", type: event };
  return null;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** A GitHub job id: letters, digits, `_` and `-`, starting with a letter or `_`. */
const jobId = (s: string): string => {
  const t = s.replace(/[^A-Za-z0-9_-]/g, "_");
  return /^[A-Za-z_]/.test(t) ? t : `_${t}`;
};

/** The branches a push binding is judged on: explicit `branches=`, else the action's default, else every branch. */
const PUSH_DEFAULT_BRANCHES: Readonly<Record<string, readonly string[]>> = {
  "gh-action/landed-by-pr": ["$default"],
  "gov-builtin/forbid-forced-push": ["BRNCH-*"],
};

function pushBranches(check: CheckBinding, defaultBranch: string | undefined): string[] | null {
  const raw = check.with?.branches;
  const given = raw === undefined ? [] : (Array.isArray(raw) ? raw.map(String) : String(raw).split(",")).map((x) => x.trim()).filter(Boolean);
  const patterns = given.length ? given : [...(PUSH_DEFAULT_BRANCHES[check.action] ?? [])];
  if (!patterns.length) return null;
  const out: string[] = [];
  for (const p of patterns) {
    if (p !== "$default") out.push(p);
    else if (defaultBranch) out.push(defaultBranch);
    else return null; // unknown default: do not filter — the runner still scopes the check
  }
  return out;
}

/**
 * LEAST PRIVILEGE, PER JOB. Every job reads the repository. A job on an OBSERVE event (push, issues) may open a
 * violation record or reopen an issue: `issues: write`. `landed-by-pr` lists a commit's pull requests:
 * `pull-requests: read`. `section-owner-approval` reads reviews and requests them: `pull-requests: write`.
 */
function permissionsFor(trigger: Trigger, actions: ReadonlySet<string>): Record<string, string> {
  const p: Record<string, string> = {};
  if (trigger.on === "push" || trigger.on === "issues") p.issues = "write";
  if (actions.has("gov-builtin/section-owner-approval")) p["pull-requests"] = "write";
  // The propose fallback commits its rows to the PR branch with the built-in token (the App stays read-only —
  // Policy Owner, option B) and comments its questions: contents and pull requests, write, on THIS job only.
  if (actions.has("gov-builtin/rules-propose")) { p.contents = "write"; p["pull-requests"] = "write"; }
  else if (actions.has("gh-action/landed-by-pr")) p["pull-requests"] = "read";
  return p;
}

/**
 * One workflow for every github-actions binding of one repository, across its resources (a gov repo is both
 * `vcs.gov-repo` and where `pms.issue` events fire). Returns [] when nothing is bound.
 */
export function renderWorkflow(bindings: readonly Binding[], opts: GithubRendererOptions = {}): { path: string; text: string }[] {
  const pkg = opts.govPackage ?? "@svayam-opensource/gov";
  type Job = { id: string; resource: string; event: string; trigger: Trigger; actions: Set<string>; branches: Set<string> | null };
  const jobs = new Map<string, Job>();
  const skipped = new Set<string>();
  for (const { id, check } of bindings) {
    const { resource, event } = check.on;
    const trigger = triggerFor(resource, event);
    if (!trigger) {
      skipped.add(`# not rendered: ${id} on ${resource} · ${event} — GitHub Actions has no trigger for it (cannot-tell)`);
      continue;
    }
    const key = `${id}\u0000${resource}\u0000${event}`;
    const branches = trigger.on === "push" ? pushBranches(check, opts.defaultBranch) : null;
    const job = jobs.get(key);
    if (!job) {
      jobs.set(key, { id, resource, event, trigger, actions: new Set([check.action]), branches: branches ? new Set(branches) : null });
    } else {
      job.actions.add(check.action);
      // One unfiltered binding makes the job unfiltered.
      if (job.branches && branches) for (const b of branches) job.branches.add(b);
      else job.branches = null;
    }
  }
  // Nothing GitHub can trigger on: no workflow (an `on:` with no events is not a valid one).
  if (!jobs.size) return [];

  const sorted = [...jobs.entries()].sort(([a], [b]) => cmp(a, b)).map(([, j]) => j);
  const on = new Map<string, Set<string>>();
  for (const j of sorted) {
    const types = on.get(j.trigger.on) ?? new Set<string>();
    if (j.trigger.type) types.add(j.trigger.type);
    on.set(j.trigger.on, types);
  }
  const pushJobs = sorted.filter((j) => j.trigger.on === "push");
  const pushFilter = pushJobs.length && pushJobs.every((j) => j.branches)
    ? [...new Set(pushJobs.flatMap((j) => [...j.branches!]))].sort(cmp)
    : null;

  const lines: string[] = [
    "# GENERATED by gov from the rule stores — do not edit; re-render instead.",
    "# Each job runs one rule's checks for one event through `gov check run <GOV-ID>`. Rules are read from the",
    "# default branch, never from the branch under review.",
    "name: gov-checks",
    ...[...skipped].sort(cmp),
    "",
    "on:",
  ];
  for (const name of [...on.keys()].sort(cmp)) {
    lines.push(`  ${name}:`);
    const types = [...on.get(name)!].sort(cmp);
    if (types.length) lines.push(`    types: [${types.join(", ")}]`);
    if (name === "push" && pushFilter) lines.push(`    branches: [${pushFilter.map((b) => JSON.stringify(b)).join(", ")}]`);
  }
  lines.push("", "permissions:", "  contents: read", "", "jobs:");
  for (const j of sorted) {
    let cond = j.trigger.type
      ? `github.event_name == '${j.trigger.on}' && github.event.action == '${j.trigger.type}'`
      : `github.event_name == '${j.trigger.on}'`;
    // A rule whose every push check is about force-pushes runs only on a forced push.
    if (j.trigger.on === "push" && [...j.actions].every((a) => a === "gov-builtin/forbid-forced-push")) cond += " && github.event.forced";
    const perms = permissionsFor(j.trigger, j.actions);
    const keys = Object.keys(perms).filter((k) => k !== "contents").sort(cmp);
    // Two resources of one repo bound on the same event name would share a job id; the resource keeps them apart.
    const sameName = sorted.filter((k) => k.id === j.id && k.event === j.event).length > 1;
    lines.push(
      `  ${jobId(sameName ? `${j.id}_${j.resource}_${j.event}` : `${j.id}_${j.event}`)}:`,
      `    name: ${checkRunName(j.id, j.event)}`,
      `    if: ${cond}`,
      ...(keys.length || perms.contents ? ["    permissions:", `      contents: ${perms.contents ?? "read"}`, ...keys.map((k) => `      ${k}: ${perms[k]}`)] : []),
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 10",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "        with:",
      "          fetch-depth: 0",
      ...(opts.govCheckout ? govCheckoutSteps(opts.govCheckout.repository) : []),
      "      - uses: actions/setup-node@v4",
      "        with:",
      '          node-version: "24"',
      "      - name: Install the gov CLI",
      `        run: npm install -g ${pkg}`,
      `      - name: gov check run ${j.id}`,
      // The token only where the job was granted more than reading the repository.
      ...(keys.length ? ["        env:", "          GH_TOKEN: ${{ github.token }}"] : []),
      ...(j.actions.has("gov-builtin/rules-propose") ? MODEL_KEY_SECRETS.map((k) => `          ${k}: \${{ secrets.${k} }}`) : []),
      `        run: gov check run ${j.id} --resource ${j.resource} --event ${j.event} ${opts.govCheckout ? "--gov-home .gov --repo-dir ." : "--gov-home ."}`,
    );
  }
  return [{ path: WORKFLOW_PATH, text: lines.join("\n") + "\n" }];
}

/** Mint the App's read-only token for the governance repository, then check that repository out with it. */
function govCheckoutSteps(repository: string): string[] {
  const [owner = "", name = ""] = repository.split("/");
  return [
    "      - name: Mint a read-only token for the governance repository",
    "        id: gov-token",
    `        uses: ${CREATE_APP_TOKEN}`,
    "        with:",
    // `client-id`, not `app-id`: v3 deprecates `app-id`, and every run would warn.
    `          client-id: \${{ secrets.${GOV_APP_SECRETS.clientId} }}`,
    `          private-key: \${{ secrets.${GOV_APP_SECRETS.privateKey} }}`,
    `          owner: ${owner}`,
    `          repositories: ${name}`,
    "          permission-contents: read",
    "      - uses: actions/checkout@v4",
    "        with:",
    `          repository: ${repository}`,
    "          path: .gov",
    "          fetch-depth: 0",
    "          token: ${{ steps.gov-token.outputs.token }}",
    "          persist-credentials: false",
  ];
}

export function githubActionsRenderer(opts: GithubRendererOptions = {}): BindingRenderer {
  return {
    renderer: "github-actions",
    render: (bindings) => renderWorkflow(bindings, opts),
  };
}
