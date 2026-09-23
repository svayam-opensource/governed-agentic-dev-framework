// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The approved-agent list, read from and written to `llm-governance.md` (#196).
 *
 * WHY A FENCED BLOCK AND NOT THE PROSE TABLE. The policy shipped as a markdown
 * table maintained by hand, and gov read it with a forgiving parser — which means
 * "sometimes wrong", about a C01 list. A heading someone rewords, or a provider
 * named in a passing sentence, and gov silently governs by a different set than the
 * one the Infrastructure Owner approved.
 *
 * WHY INSIDE THE POLICY AND NOT BESIDE IT. A separate `approved-agents.yaml` parses
 * more cleanly and is a second copy of one fact — the shape this project has now
 * written four guards against (registry.yaml against GitHub, ADOPTER_DIRS against
 * MANIFEST.yaml, package.json against content/VERSION, the itinerary against the
 * checklist). One document: the table stays for humans, the block is what gov reads,
 * and both are approved together by the owner CODEOWNERS names.
 *
 * SUPERSEDED 2026-09-23 (Policy Owner). The list moves INTO `org-config.yaml`, and this reasoning — "that
 * file holds an organization's VALUES; this is a governed decision with a review path" — gives way to a
 * sharper split of the same idea:
 *
 *   the FRAMEWORK publishes the master list of agents an org may adopt (gov's catalog, one stable key each);
 *   the ORG records WHICH of them it authorizes, and which is its default. That IS a value.
 *
 * The review path is not lost: `org-config.yaml` is as owned and as reviewed as the policy was, and
 * `gov agent approve` still raises the pull request. What is gained is that there is no second document to
 * keep in step with the catalog, and that `org-config.yaml` is merged KEY BY KEY on upgrade — so numbered
 * entries survive an upgrade, which a YAML list would not.
 *
 * The fenced-block reader below stays for ONE purpose: the migration that lifts an existing org's list out of
 * llm-governance.md (upgrade `approved-agents-to-org-config`). New reads and writes use the org-config block.
 */

/** One approved agent. `id` matches the harness manifest, which is what makes it checkable. */
export interface ApprovedAgent {
  readonly id: string;
  readonly default?: boolean;
}

const FENCE = /```yaml\s*\n(approved_agents:[\s\S]*?)\n```/;

/**
 * Read the block. Null means "no block" — distinct from an empty list, because one
 * says the org has not decided and the other says it decided on nothing.
 */
export function parseApprovedAgents(policyText: string | null): readonly ApprovedAgent[] | null {
  if (!policyText) return null;
  const body = FENCE.exec(policyText)?.[1];
  if (!body) return null;

  const out: ApprovedAgent[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const id = /^\s*-\s+id:\s*(\S+)/.exec(raw)?.[1];
    if (id) { out.push({ id }); continue; }
    const isDefault = /^\s+default:\s*true\s*$/.test(raw);
    if (isDefault && out.length) out[out.length - 1] = { ...out[out.length - 1]!, default: true };
  }
  return out;
}

/**
 * The agent to use without asking: the one marked `default`, or the only one there
 * is. More than one and none marked → null, and the caller asks.
 */
export function defaultAgent(approved: readonly ApprovedAgent[] | null): string | null {
  if (!approved?.length) return null;
  const marked = approved.find((a) => a.default);
  if (marked) return marked.id;
  return approved.length === 1 ? approved[0]!.id : null;
}

/** Render the block. Kept minimal — a human reads the table above it, not this. */
export function renderApprovedAgents(agents: readonly ApprovedAgent[]): string {
  const lines = agents.flatMap((a) => [`  - id: ${a.id}`, ...(a.default ? ["    default: true"] : [])]);
  return ["```yaml", "approved_agents:", ...lines, "```"].join("\n");
}

/**
 * Write the block into the policy, replacing an existing one or inserting it under
 * the Approved heading. Returns the new text, or null when nothing would change.
 *
 * Never appended blindly: a second block would be a second answer, and the parser
 * would take whichever came first.
 */
export function withApprovedAgents(policyText: string, agents: readonly ApprovedAgent[]): string | null {
  const block = renderApprovedAgents(agents);
  if (FENCE.test(policyText)) {
    const replaced = policyText.replace(FENCE, block);
    return replaced === policyText ? null : replaced;
  }

  const heading = /^###\s+Approved\s*$/m.exec(policyText);
  const intro = [
    "",
    "<!-- gov reads the block below. The table above is for people; keep them in step.",
    "     Add or remove an agent with `gov agent approve <id>`, which raises a pull",
    "     request to the owner CODEOWNERS names — this list is C01 (POL-136). -->",
    "",
    block,
    "",
  ].join("\n");

  if (!heading || heading.index === undefined) {
    // No Approved heading to anchor to. Appending is worse than refusing: the block
    // would sit outside the section it governs, where a reader would not look for it.
    return null;
  }
  const at = heading.index + heading[0].length;
  return policyText.slice(0, at) + intro + policyText.slice(at);
}


/**
 * THE ORG'S CHOICE, IN `org-config.yaml` (Policy Owner, 2026-09-23):
 *
 *   authorized_agents:
 *     default: "ibm-bob"
 *     agent1: "claude-code"
 *     agent2: "openai-codex"
 *
 * Numbered keys rather than a YAML list, because that file is merged key by key on upgrade (`mergeOrgConfig`):
 * every entry an org wrote survives, and a value gov did not write is never modified.
 */
const AUTHORIZED_BLOCK = /^authorized_agents:\s*$/m;

export function parseAuthorizedAgents(orgConfigText: string | null): readonly ApprovedAgent[] | null {
  if (!orgConfigText) return null;
  const m = AUTHORIZED_BLOCK.exec(orgConfigText);
  if (!m || m.index === undefined) return null;
  const out: ApprovedAgent[] = [];
  let seenDefault: string | null = null;
  for (const raw of orgConfigText.slice(m.index + m[0].length).split(/\r?\n/).slice(1)) {
    if (/^\S/.test(raw) && raw.trim() !== "") break;                       // the block ended
    const kv = /^\s+([a-z_][a-z0-9_]*):\s*"?([^"#\s]+)"?/i.exec(raw);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key!.toLowerCase() === "default") { seenDefault = value!; continue; }
    out.push({ id: value! });
  }
  if (seenDefault && !out.some((a) => a.id === seenDefault)) out.unshift({ id: seenDefault });
  return out.map((a) => (a.id === seenDefault ? { ...a, default: true } : a));
}

/** Write the org's choice back, replacing an existing block or appending one. Null when nothing would change. */
export function withAuthorizedAgents(orgConfigText: string, agents: readonly ApprovedAgent[]): string | null {
  const def = agents.find((a) => a.default)?.id ?? agents[0]?.id ?? null;
  const lines = [
    "authorized_agents:",
    ...(def ? [`  default: "${def}"`] : []),
    ...agents.filter((a) => a.id !== def).map((a, i) => `  agent${i + 1}: "${a.id}"`),
  ];
  const block = lines.join("\n");

  const m = AUTHORIZED_BLOCK.exec(orgConfigText);
  if (m && m.index !== undefined) {
    const after = orgConfigText.slice(m.index + m[0].length);
    const rest = after.split(/\r?\n/);
    let i = 1;
    while (i < rest.length && (rest[i] === "" || /^\s/.test(rest[i]!))) i++;
    const replaced = orgConfigText.slice(0, m.index) + block + "\n" + rest.slice(i).join("\n");
    return replaced === orgConfigText ? null : replaced;
  }
  const head = orgConfigText.endsWith("\n") ? orgConfigText : `${orgConfigText}\n`;
  return `${head}\n# Which agents this organization authorizes, and which gov launches by default.\n# The framework publishes the master list (\`gov agent list\`); this says which of them are ours.\n${block}\n`;
}
