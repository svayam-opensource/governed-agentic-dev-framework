// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The GitHub adapter of the {@link WorkTrackerPort} (gadf#225).
 *
 * setStatus is ONE query and ONE mutation. The query starts from the ISSUE (`resource(url:)`) and reads its
 * project items, each with its project's number, owner and `Status` field — so the item id, project id, field id
 * and option ids all arrive together, and the owner's kind (organization or user) never has to be known. The
 * mutation is `updateProjectV2ItemFieldValue`. `gh project item-edit --url … --field … --value …` does not exist
 * in that form; that is what the old stub's comment found.
 *
 * Values travel as GraphQL VARIABLES (`-f name=value`), never spliced into the query text.
 */
import type { RunGh } from "../../lifecycle/gh-board.js";
import type { BoardRef } from "../../lifecycle/identity.js";
import type { BoardCloseResult, BoardStatusResult, WorkTrackerPort } from "../../ports/work-tracker.js";

const ITEMS_QUERY = `query($url: URI!) {
  resource(url: $url) {
    __typename
    ... on Issue { id projectItems(first: 50) { nodes { ...item } } }
    ... on PullRequest { id projectItems(first: 50) { nodes { ...item } } }
  }
}
fragment item on ProjectV2Item {
  id
  project {
    id number
    owner { ... on Organization { login } ... on User { login } }
    field(name: "Status") { __typename ... on ProjectV2SingleSelectField { id options { id name } } }
  }
}`;

const SET_MUTATION = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) {
    projectV2Item { id }
  }
}`;

interface ItemNode {
  readonly id?: string;
  readonly project?: {
    readonly id?: string;
    readonly number?: number;
    readonly owner?: { readonly login?: string } | null;
    readonly field?: { readonly __typename?: string; readonly id?: string; readonly options?: readonly { id: string; name: string }[] } | null;
  } | null;
}

/** Permission refusals, as gh and the GraphQL API word them. Everything else is `unreachable`. */
const DENIED = /Resource not accessible|FORBIDDEN|INSUFFICIENT_SCOPES|not been granted the required scopes|HTTP 40[13]|Bad credentials|must have .*(?:access|permission)|does not have permission/i;

function failureText(e: unknown): string {
  const x = e as { message?: string; stderr?: string | Buffer };
  const stderr = x?.stderr?.toString().trim();
  const text = stderr || (x?.message ?? String(e));
  return text.replace(/^Command failed:[^\n]*\n?/, "").trim().split("\n").filter(Boolean).slice(-1)[0] ?? "gh failed";
}
function classify(e: unknown): { ok: false; why: "denied" | "unreachable"; detail: string } {
  const x = e as { message?: string; stderr?: string | Buffer };
  const all = `${x?.message ?? ""}\n${x?.stderr?.toString() ?? ""}`;
  return { ok: false, why: DENIED.test(all) ? "denied" : "unreachable", detail: failureText(e) };
}

/** A {@link WorkTrackerPort} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGithubWorkTracker(runGh: RunGh): WorkTrackerPort {
  return {
    setStatus(ref: BoardRef, issueUrl: string, status: string): BoardStatusResult {
      let out: string;
      try {
        out = runGh(["api", "graphql", "-f", `query=${ITEMS_QUERY}`, "-f", `url=${issueUrl}`]);
      } catch (e) {
        if (/Could not resolve to a/i.test(`${(e as Error)?.message ?? ""}${(e as { stderr?: string })?.stderr ?? ""}`)) {
          return { ok: false, why: "not-on-board", detail: `${issueUrl} could not be resolved` };
        }
        return classify(e);
      }
      let nodes: readonly ItemNode[] | null;
      try {
        const j = JSON.parse(out) as { data?: { resource?: { projectItems?: { nodes?: ItemNode[] } } | null } };
        if (!j.data) return { ok: false, why: "unreachable", detail: "GitHub's answer carried no data" };
        nodes = j.data.resource ? (j.data.resource.projectItems?.nodes ?? []) : null;
      } catch { /* not JSON — reported to the caller as `unreachable`, which is the account of it */
        return { ok: false, why: "unreachable", detail: "GitHub's answer was not JSON" };
      }
      if (nodes === null) return { ok: false, why: "not-on-board", detail: `${issueUrl} could not be resolved (not found, or not readable with this token)` };

      const owner = ref.owner.toLowerCase();
      const item = nodes.find((n) => n?.project?.number === ref.number && (n.project.owner?.login ?? "").toLowerCase() === owner);
      if (!item?.id || !item.project?.id) {
        return { ok: false, why: "not-on-board", detail: `${issueUrl} is not an item of board ${ref.owner}#${ref.number}` };
      }
      const field = item.project.field;
      if (!field?.id || field.__typename !== "ProjectV2SingleSelectField") {
        return { ok: false, why: "no-field", detail: `board #${ref.number} has no single-select field named Status` };
      }
      const options = field.options ?? [];
      const option = options.find((o) => o.name.trim().toLowerCase() === status.trim().toLowerCase());
      if (!option) {
        return { ok: false, why: "no-option", detail: `Status on board #${ref.number} has no option "${status}" (options: ${options.map((o) => o.name).join(", ") || "none"})` };
      }

      try {
        runGh(["api", "graphql", "-f", `query=${SET_MUTATION}`,
          "-f", `project=${item.project.id}`, "-f", `item=${item.id}`, "-f", `field=${field.id}`, "-f", `option=${option.id}`]);
      } catch (e) {
        return classify(e);
      }
      return { ok: true };
    },

    closeProject(ref: BoardRef): BoardCloseResult {
      try {
        runGh(["project", "close", String(ref.number), "--owner", ref.owner]);
        return { ok: true };
      } catch (e) {
        return classify(e);
      }
    },
  };
}
