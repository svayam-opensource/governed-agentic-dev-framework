// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE STATUS CHECKS A HARD POSTURE MAKES REQUIRED, DERIVED FROM THE RULES IN FORCE (rule-model-design.md Q15, W2-Q6).
 *
 * A gate binding is only a gate if the platform waits for it. `gov check install` renders one job per rule · event
 * into `.github/workflows/gov-checks.yml`; a failing job on a pull request turns red, and that is all it does until
 * the branch protection lists it as REQUIRED. Then the merge is stopped — `prevented`. Without that, the same red job
 * is something a person may notice afterwards — `detected`.
 *
 * So this is the list `gov repo protect` adds: every in-force GATE binding on a `pull_request` event of the
 * repository's resource, named by the renderer's own {@link checkRunName}, so the name required is the name the
 * workflow reports. Pure.
 */
import { inForce } from "../rules/model/rule-row.js";
import type { RuleSet } from "../rules/model/contracts.js";
import { checkRunName, rendersAsPullRequestJob } from "../rules/checks/render-github.js";

/** Which kind of repository is being protected. Mirrors the resources `gov check install` renders for each. */
export type RepoKind = "governance" | "code";

/** The `vcs.*` resource a repository of this kind is, in the catalog. */
export const repoResource = (kind: RepoKind): string => (kind === "governance" ? "vcs.gov-repo" : "vcs.code-repo");

export interface RequiredRuleCheck {
  /** The rule's id — the row of the plan table that cites it. */
  readonly id: string;
  /** The check-run name GitHub shows, and the branch protection requires. */
  readonly name: string;
}

/** Sorted, one per rule: two gate bindings of one rule on one event are one rendered job, so one check. */
export function requiredRuleChecks(set: RuleSet, kind: RepoKind): readonly RequiredRuleCheck[] {
  const resource = repoResource(kind);
  const res = set.catalog.resources.find((r) => r.id === resource);
  // Nothing renders this resource's bindings → no job → nothing a branch could wait for.
  if (res?.renderer !== "github-actions") return [];
  const out = new Map<string, RequiredRuleCheck>();
  for (const row of inForce([...set.framework, ...set.org])) {
    for (const b of row.checks ?? []) {
      if (b.on.resource !== resource) continue;
      if (res.events.find((e) => e.name === b.on.event)?.mode !== "gate") continue;
      if (!rendersAsPullRequestJob(b.on.resource, b.on.event)) continue;
      const name = checkRunName(row.id, b.on.event);
      out.set(name, { id: row.id, name });
    }
  }
  return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
