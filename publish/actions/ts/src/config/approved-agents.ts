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
 * WHY NOT `org-config.yaml`. That file holds an organization's VALUES. This is a
 * governed decision with an owner and a review path, and it belongs where the
 * review path is.
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
