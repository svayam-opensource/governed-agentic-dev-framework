// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * THE 2.0 ORG-REPO TREE, AS DATA — spec 01 §2, for the bridge (PRJ-121 intent 01).
 *
 * The bridge upgrade carries every org repo — Svayamtech's layout-1.0 tree, svm-geneva's flat 1.2.x tree — to ONE
 * final layout. The bridge's move tables and the upgrade fixtures' harness both need that layout's paths, and they need
 * them now, while the layout work (lane L) lands beside them. So the spec's §2 tree is copied here ONCE, as data, and
 * everything in the bridge reads it from here. When the layout code lands, its path constants and this table must
 * agree; the upgrade fixtures (test/maintain/upgrade-to-phase.test.ts) are what prove they do.
 *
 * Deleted with the rest of the bridge: after 2.0.0 the shipped MANIFEST is the only statement of the tree.
 */

/** Owner — F framework (gov upgrade writes it), O the org's, G gov writes it at run time (spec §2). */
export type PhaseOwner = "F" | "O" | "G";
/** auto = scaffold-auto · once = seed-once · new = seed-new (setup only) · gen = generated · reserved = named, never created. */
export type PhaseMode = "auto" | "once" | "new" | "gen" | "reserved";

export interface PhaseTreeRow {
  /** A file, or a directory ending `/` (some file under it). */
  readonly path: string;
  readonly owner: PhaseOwner;
  readonly mode: PhaseMode;
}

const F = (path: string): PhaseTreeRow => ({ path, owner: "F", mode: "auto" });
const O = (path: string, mode: PhaseMode = "once"): PhaseTreeRow => ({ path, owner: "O", mode });
const G = (path: string): PhaseTreeRow => ({ path, owner: "G", mode: "gen" });

const COMMON_GUIDES = ["setting-up-your-machine", "upgrading-the-framework", "path-adopter", "path-joiner", "path-reference", "when-something-goes-wrong", "evidence-and-auditor-reports"];
const BUILD_GUIDES = ["path-developer", "working-on-a-project", "closing-a-project", "running-parallel-tasks", "proposing-knowledge", "configuring-agent-harnesses"];
const HARNESS = ["AGENTS.md", "CLAUDE.md", "CONVENTIONS.md", "GEMINI.md", ".cursor/rules/agent.mdc", ".clinerules/agent.md", ".windsurf/rules/agent.md", ".github/copilot-instructions.md", ".continue/rules/agent.md", "rule-map.md"];

/** Spec 01 §2, row by row (intent 03's `policies/active/` and `policies/reference/` arrive with intent 03 and are not here). */
export const PHASE_TREE: readonly PhaseTreeRow[] = [
  F(".github/ISSUE_TEMPLATE/"),
  O(".github/pull_request_template.md"),
  O(".github/workflows/gov-validate.yml"),
  G(".github/workflows/approver-check.yml"),
  G(".github/workflows/gov-checks.yml"),
  O(".gitignore"), O("README.md"), O("org-config.yaml"),
  G("CODEOWNERS"),
  F("VERSION"),
  F("agent/agent.md"), F("agent/session-protocol.md"),
  ...HARNESS.map((h) => F(`agent/harness/${h}`)),
  F("framework/framework-specification.md"),
  G("framework/upgrade-moves.json"),
  F("framework/rules/rules.yaml"), F("framework/rules/checks-catalog.yaml"), F("framework/rules/pol-aliases.yaml"),
  F("framework/common/reference/org-config.schema.yaml"),
  F("framework/common/reference/gov-command-reference.md"),
  F("framework/common/reference/org_gov_repo_operations.md"),
  ...COMMON_GUIDES.map((g) => F(`framework/common/guides/${g}.md`)),
  F("framework/common/templates/exception-template.md"),
  F("framework/build/build-specification.md"),
  ...BUILD_GUIDES.map((g) => F(`framework/build/guides/${g}.md`)),
  ...["todo", "project-impact", "repo-agent", "preferences"].map((t) => F(`framework/build/templates/${t}-template.md`)),
  F("framework/build/templates/gov-validate.reference.yml"),
  F("framework/build/templates/workflows/approver-check.yml"),
  O("policies/org-policy.md"),
  O("policies/governance.yaml"),
  O("policies/ownership.yaml"), O("policies/VERSION"), O("policies/CHANGELOG.md"),
  O("policies/rules/rules.yaml"), O("policies/rules/checks-catalog.yaml"),
  O("policies/common/authorized-representatives.md"),
  O("policies/common/data-classification.md"),
  O("policies/common/policy-domains.md"),
  O("policies/build/policy.md", "new"),
  O("policies/build/approved-technologies.md"),
  O("policies/deploy/unit-catalog/", "reserved"),
  O("policies/run/fleet-catalog/", "reserved"),
  O("knowledge/.gitkeep"),
  F("projects/README.md"),
];

/**
 * The 1.x paths that §2 has no place for. After the bridge upgrade none of them is left in an org repo: a framework
 * one is retired, an org one has moved. (The three policies 2.0 stops seeding — knowledge-publication.md,
 * knowledge-organization-standard.md, compliance-review.md — are the org's and stay where they are, so they are not here.)
 */
export const OLD_LAYOUT_PATHS: readonly string[] = [
  "framework/docs/", "framework/config/", "framework/procedures/", "framework/templates/", "framework/policies/",
  "framework/rules/catalog.yaml", "framework/rules/W2-classification.md",
  ".gov-upgrade-moves.json",
  "policies/rules.yaml", "policies/catalog.yaml",
  "policies/authorized-representatives.md", "policies/data-classification.md", "policies/policy-domains.md",
  "policies/approved-technologies.md",
];

/** Is `p` (a file) at `row`? A directory row matches any file under it. */
const at = (row: string, p: string): boolean => (row.endsWith("/") ? p.startsWith(row) : p === row);

/**
 * What keeps `files` (every file of an org repo, relative) from being the §2 tree — empty when it is.
 *   · every framework row is there (`auto`), and every org `once` row;
 *   · `new` rows only when `seedNew` (the bridge seeds them for layout-1.0; a 1.2.x org keeps its own umbrella);
 *   · the move record only when `moved` (an org that never moved anything has none);
 *   · nothing at a reserved path, and nothing at an old-layout path.
 */
export function phaseTreeProblems(files: readonly string[], opts: { seedNew?: boolean; moved?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const row of PHASE_TREE) {
    const present = files.some((f) => at(row.path, f));
    const required = row.mode === "auto" || row.mode === "once" || (row.mode === "new" && !!opts.seedNew)
      || (row.path === "framework/upgrade-moves.json" && !!opts.moved);
    if (required && !present) out.push(`missing ${row.path}`);
    if (row.mode === "reserved" && present) out.push(`reserved path created: ${row.path}`);
  }
  for (const old of OLD_LAYOUT_PATHS) {
    const left = files.filter((f) => at(old, f));
    if (left.length) out.push(`old layout left: ${old}${old.endsWith("/") ? ` (${left.length} file(s))` : ""}`);
  }
  return out;
}
