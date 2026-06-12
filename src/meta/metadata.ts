import type { FrontMatter } from "./frontmatter.js";
import type { ChunkMetadata, NavFacets } from "../types.js";
import { DOMAIN_TO_OWNER, DOMAIN_OWNERS } from "../types.js";

// Build the doc-level ChunkMetadata from front-matter (POL-408 promotion).
// Self-describing fields ride along; missing/known-stray values are tolerated.

export function buildMetadata(
  repoRelPath: string,
  fm: FrontMatter,
  commitSha: string,
): ChunkMetadata {
  const domain = fm.domain ?? "navigation";

  // domainOwner: front-matter `owner` if it is one of the 9 real slugs; otherwise
  // derive from domain (compliance/navigation -> policy-owner per contract).
  let domainOwner = fm.owner ?? "";
  if (!DOMAIN_OWNERS.includes(domainOwner as any)) {
    domainOwner = DOMAIN_TO_OWNER[domain] ?? "policy-owner";
  }

  const project = deriveProject(repoRelPath, fm);

  const navFacets = buildNavFacets(domainOwner, fm);

  return {
    path: repoRelPath,
    heading: "(preamble)",
    headingSlug: "preamble",
    commitSha,
    domainOwner,
    domain,
    layer: fm.layer ?? "spec",
    compliance: fm.compliance,
    status: fm.status ?? "current",
    navFacets,
    project,
    lineStart: 1,
    lineEnd: 1,
  };
}

function deriveProject(repoRelPath: string, fm: FrontMatter): string | null {
  if (fm.project) return fm.project;
  const m = /^projects\/([^/]+)\//.exec(repoRelPath);
  return m ? m[1] : null;
}

// navFacets are modeled openly. The corpus has no facet/roles front-matter yet
// (overlay dimensions pending — nav manifest §dimensions), so:
//   - roleLenses: the accountable Owner lens of the doc's domain (always present,
//     derived from roles.generated.yaml domain->owner).
//   - dimensions: populated from `facets.*` front-matter if/when it appears.
//   - journeys: filled by the ingest pass that scans paths/*.md back-links.
function buildNavFacets(domainOwner: string, fm: FrontMatter): NavFacets {
  const facets: NavFacets = { roleLenses: [domainOwner] };
  const dims: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (k.startsWith("facets.") && v) {
      dims[k.slice("facets.".length)] = v.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (Object.keys(dims).length > 0) facets.dimensions = dims;
  return facets;
}
