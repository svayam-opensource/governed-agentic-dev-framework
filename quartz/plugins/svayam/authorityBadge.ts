import { QuartzTransformerPlugin } from "../types"
import { Root } from "hast"

/**
 * AuthorityBadge — Track A (PRJ-010 #39), nav-schema Part 3.
 *
 * A Quartz TRANSFORMER plugin that runs AFTER FrontMatter(), so
 * `file.data.frontmatter` is populated. It injects an authority badge HTML node
 * at the top of every page body, computed purely from the required front-matter
 * fields `compliance` + `status` (+ neutral `layer` + `owner`).
 *
 * Single authority for the mapping: knowledge/nav/manifest.yaml#badges
 * (mirrored here). badge = f(compliance) [+ overlay(status)].
 *
 * GRACEFUL DEGRADATION (acceptance bar — MUST NOT hard-fail the build):
 *   - The frozen layer enum adds `path` + `decision`; an unknown layer is shown
 *     by its literal value, never rejected.
 *   - The stray status value `active` and any other unrecognised status is
 *     badged NON-CURRENT, never a hard-fail.
 *   - A doc with NO front-matter at all (the corpus has exactly one:
 *     infrastructure/specs/svayam-infra-posture.md) produces no badge and the
 *     build survives. (The hard lint gate that would reject this is deferred —
 *     debt A2.)
 */

// compliance -> badge label (mirrors nav/manifest.yaml#badges.by_compliance)
const COMPLIANCE_LABEL: Record<string, string> = {
  C01: "C01 · Mandate",
  C02: "C02 · Required",
  C03: "C03 · Recommended",
  instructional: "Instructional",
  descriptive: "Descriptive",
  evidence: "Evidence",
}

// frozen layer enum (nav-schema §1.3 / §3.3) — adds `path` + `decision`.
const LAYERS = new Set([
  "mandate",
  "procedure",
  "pattern",
  "use-case",
  "spec",
  "compliance",
  "path",
  "decision",
])

// status overlay (mirrors nav/manifest.yaml#badges.status_overlay).
// `active` is a stray corpus value: tolerated (badged non-current), NOT rejected.
const NON_CURRENT_STATUS: Record<string, string> = {
  draft: "Draft",
  superseded: "Superseded",
  active: "Active (non-current)",
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export const AuthorityBadge: QuartzTransformerPlugin = () => ({
  name: "AuthorityBadge",
  htmlPlugins() {
    return [
      () => (tree: Root, file: any) => {
        const fm = file.data?.frontmatter ?? {}
        const compliance = asString(fm.compliance)
        const layer = asString(fm.layer)
        const status = asString(fm.status)
        const owner = asString(fm.owner)

        const spans: any[] = []
        const push = (cls: string, text: string) =>
          spans.push({
            type: "element",
            tagName: "span",
            properties: { className: ["authority-badge__chip", cls] },
            children: [{ type: "text", value: text }],
          })

        // compliance chip (known -> label; unknown but present -> show raw + '?')
        if (compliance) {
          push(`compliance-${compliance}`, COMPLIANCE_LABEL[compliance] ?? `${compliance}?`)
        }
        // layer chip: known layer neutral; unknown layer shown by value (graceful)
        if (layer) {
          push(`layer-${layer}`, LAYERS.has(layer) ? `layer: ${layer}` : `layer: ${layer}?`)
        }
        // status chip: only when NOT current. tolerate `active` and unknowns.
        if (status && status !== "current") {
          push(`status-${status}`, NON_CURRENT_STATUS[status] ?? `Status: ${status}?`)
        }
        // owner chip (relevance affordance; always last)
        if (owner) {
          push(`owner-${owner}`, `owner: ${owner}`)
        }

        // No front-matter / no usable fields -> emit nothing, build survives.
        if (spans.length === 0) return

        const badge = {
          type: "element",
          tagName: "div",
          properties: {
            className: [
              "authority-badge",
              compliance ? `is-${compliance}` : "is-unbadged",
              status && status !== "current" ? "is-non-current" : "is-current",
            ],
            "data-compliance": compliance ?? "",
            "data-status": status ?? "",
            "data-layer": layer ?? "",
          },
          children: spans,
        }

        // Insert at the top of the body so it sits above the first heading.
        ;(tree.children as any[]).unshift(badge)
      },
    ]
  },
})
