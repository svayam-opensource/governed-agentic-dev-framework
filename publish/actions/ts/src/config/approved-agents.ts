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
/**
 * The key line, WITH whatever scalar follows it — because one of the two answers to this
 * question is a scalar. See {@link NO_AGENTS}.
 *
 * It used to be `/^authorized_agents:\s*$/m`, which matches the key only when nothing follows it.
 * That is why the regex had to change rather than gain a sibling: a reader that cannot see
 * `authorized_agents: none` reports "no block", i.e. "nobody has decided" — the one thing the
 * value exists to deny.
 */
const AUTHORIZED_BLOCK = /^authorized_agents:[ \t]*(.*)$/m;

/**
 * STRUCTURE-ONLY, WRITTEN DOWN: `authorized_agents: none` (Policy Owner, 2026-09-28).
 *
 * An organization may adopt this framework for the FIXED process alone — projects, tasks,
 * branches, knowledge, review — and never run an AI agent. The approval step used to refuse an
 * empty answer ("an organization with no approved agent cannot run any"), so such an org had to
 * approve a tool it would never use, and then found nine harness files in every project
 * directory with no explanation. Fixed behaviour must be complete on its own; agentic behaviour
 * is additive.
 *
 * WHY A SCALAR AND NOT AN EMPTY BLOCK. The block CAN be empty, in two ways that are not
 * decisions: the shipped `org-config.example.yaml` carries `authorized_agents:` with
 * `default: ""` under it, and an org mid-adoption has exactly that. If empty meant "none", every
 * unanswered setup would read as a considered choice to run no agents — and the difference
 * between a decision and an incomplete setup is the whole point of asking. So the decision gets
 * a word of its own, and `none` can never be an agent id.
 */
export const NO_AGENTS = "none";

/**
 * The three states of this key, kept apart on purpose.
 *
 *   unset   nobody has answered — the key is absent, or present with nothing usable under it.
 *           gov falls back to the framework's list and SAYS SO (the shipped comment in
 *           org-config.example.yaml promises exactly that).
 *   none    the org decided: no AI agents. Structure-only. Nothing agent-shaped may happen.
 *   agents  the org's list, first/`default` marked.
 *
 * `unset` and `none` must never collapse into one value: one is a gap to close, the other is a
 * rule to honour, and the remedies point in opposite directions.
 */
export type AuthorizedAgents =
  | { readonly kind: "unset" }
  | { readonly kind: "none" }
  | { readonly kind: "agents"; readonly agents: readonly ApprovedAgent[] };

/** Strip a trailing comment and surrounding quotes from a YAML scalar. */
const scalarOf = (raw: string): string => raw.replace(/\s+#.*$/, "").trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

/**
 * Read the key, keeping the three states apart. Pure over the file's text.
 *
 * A NON-`none` SCALAR IS TAKEN AS ONE AGENT ID. `authorized_agents: claude-code` is not a shape
 * gov writes, and it is the obvious thing a person types when they want one agent. Reading it as
 * "unset" would silently govern them by the framework's whole list instead; reading it as an id
 * they did not mean is reported where every other bad id is — `gov agent` names it as "approved
 * but unknown to this version of gov", which is the complaint the person can act on.
 */
export function readAuthorizedAgents(orgConfigText: string | null): AuthorizedAgents {
  if (!orgConfigText) return { kind: "unset" };
  const m = AUTHORIZED_BLOCK.exec(orgConfigText);
  if (!m || m.index === undefined) return { kind: "unset" };

  const scalar = scalarOf(m[1] ?? "");
  if (scalar.toLowerCase() === NO_AGENTS) return { kind: "none" };

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
  // `default: none` INSIDE THE BLOCK IS ALSO THE DECISION. gov writes the scalar form, but
  // `mergeOrgConfig` walks the TEMPLATE's keys and can re-introduce the template's
  // `  default: ""` line under an org's scalar on upgrade. Reading `none` wherever it appears
  // means an upgrade can reshape this key without changing what it says. `none` is not an
  // agent id, so there is no ambiguity to trade away.
  if (seenDefault?.toLowerCase() === NO_AGENTS && !out.length) return { kind: "none" };

  // A SCALAR THAT IS NEITHER `none` NOR EMPTY is one agent id — see above.
  if (scalar && !out.length) return { kind: "agents", agents: [{ id: scalar, default: true }] };
  if (!out.length && !seenDefault) return { kind: "unset" };               // `default: ""`, or an empty block
  if (seenDefault && !out.some((a) => a.id === seenDefault)) out.unshift({ id: seenDefault });
  return { kind: "agents", agents: out.map((a) => (a.id === seenDefault ? { ...a, default: true } : a)) };
}

/** Did this organization decide to run no AI agents at all? The one question every agent-shaped step asks. */
export function isStructureOnly(orgConfigText: string | null): boolean {
  return readAuthorizedAgents(orgConfigText).kind === "none";
}

/**
 * The org's list, in the shape every existing caller wants:
 *
 *   null  nobody has decided (`unset`) → the caller falls back to the framework's list, and says so.
 *   []    the org decided on NO agents (`none`) → structure-only; nothing agent-shaped may happen.
 *   […]   the list.
 *
 * THE EMPTY ARRAY CHANGED MEANING, deliberately. It used to be produced by an empty block, which
 * is the shipped template's own state — so "decided on nothing" and "has not answered yet" were
 * the same value and no caller could tell a rule from a gap. `[]` is now only ever the decision;
 * every unanswered shape is `null`. Callers that must distinguish the three read
 * {@link readAuthorizedAgents} instead.
 */
export function parseAuthorizedAgents(orgConfigText: string | null): readonly ApprovedAgent[] | null {
  const r = readAuthorizedAgents(orgConfigText);
  if (r.kind === "unset") return null;
  return r.kind === "none" ? [] : r.agents;
}

/**
 * Write the org's choice back, replacing an existing block or appending one. Null when nothing would change.
 *
 * An EMPTY list is not an empty block: it is the structure-only decision, and it is written as
 * `authorized_agents: none` so that reading it back cannot be mistaken for an unanswered setup.
 */
export function withAuthorizedAgents(orgConfigText: string, agents: readonly ApprovedAgent[]): string | null {
  const def = agents.find((a) => a.default)?.id ?? agents[0]?.id ?? null;
  const lines = agents.length === 0
    ? [`authorized_agents: ${NO_AGENTS}`]
    : [
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
  return `${head}\n# Which agents this organization authorizes, and which gov launches by default.\n# The framework publishes the master list (\`gov agent list\`); this says which of them are ours.\n# \`${NO_AGENTS}\` is a real answer: this organization uses gov for its process and runs no AI agents.\n# Turn them on later with \`gov agent approve <id>\`, which raises a pull request.\n${block}\n`;
}
