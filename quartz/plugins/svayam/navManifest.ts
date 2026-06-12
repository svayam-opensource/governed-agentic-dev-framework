import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { load as parseYaml } from "js-yaml"

/**
 * navManifest — shared loader for the frozen nav manifest (knowledge/nav/).
 *
 * The manifest PATH is a CONFIG value (default: this project's checkout; it will
 * move to the org `knowledge/nav/` at project close). Resolution order:
 *   1. SVM_NAV_DIR env (absolute path to a `nav/` dir)
 *   2. <SVM_PRJ_WORK>/projects/PRJ-010-practice-knowledge/knowledge/nav
 *   3. default project checkout relative to this workspace
 *
 * If the manifest is absent, loaders return `null` and the consuming emitter
 * (roleBrowse) NO-OPS GRACEFULLY with a warning — the site still builds before
 * the nav track lands.
 */

export interface NavLens {
  id: string
  label: string
  accountable_domain?: string
}

export interface NavDimensionValue {
  id: string
  label?: string
  runbook?: string
  related_journeys?: string[]
}

export interface JourneyPlacement {
  "subject-dimension": string
  "subject-value": string
  activity?: string
}

export interface SeedJourney {
  slug: string
  nav_title?: string
  placement?: JourneyPlacement[]
  role_lens?: string[]
  facets?: Record<string, any>
}

export interface NavManifest {
  navDir: string
  manifest: any
  lenses: NavLens[]
  dimensions: Map<string, NavDimensionValue[]>
  journeys: SeedJourney[]
}

function defaultNavDir(siteRoot: string): string {
  if (process.env.SVM_NAV_DIR) return resolve(process.env.SVM_NAV_DIR)
  const prjWork = process.env.SVM_PRJ_WORK ?? resolve(siteRoot, "../../../../svm-prj-work")
  return resolve(prjWork, "projects/PRJ-010-practice-knowledge/knowledge/nav")
}

function safeYaml(path: string): any | null {
  try {
    if (!existsSync(path)) return null
    return parseYaml(readFileSync(path, "utf8"))
  } catch (e) {
    console.warn(`[navManifest] failed to parse ${path}: ${(e as Error).message}`)
    return null
  }
}

export function loadNavManifest(siteRoot: string): NavManifest | null {
  const navDir = defaultNavDir(siteRoot)
  const manifestPath = join(navDir, "manifest.yaml")
  if (!existsSync(manifestPath)) {
    console.warn(
      `[navManifest] no manifest at ${manifestPath} — roleBrowse will no-op (site still builds).`,
    )
    return null
  }

  const manifest = safeYaml(manifestPath) ?? {}

  // lenses (the 9 Owner roles)
  const lensesDoc = safeYaml(join(navDir, "lenses", "roles.generated.yaml"))
  const lenses: NavLens[] = Array.isArray(lensesDoc?.lenses) ? lensesDoc.lenses : []

  // dimension value lists
  const dimensions = new Map<string, NavDimensionValue[]>()
  const dimsDir = join(navDir, "dimensions")
  if (existsSync(dimsDir)) {
    for (const f of readdirSync(dimsDir)) {
      if (!f.endsWith(".yaml")) continue
      const doc = safeYaml(join(dimsDir, f))
      if (doc?.dimension && Array.isArray(doc.values)) {
        dimensions.set(String(doc.dimension), doc.values)
      }
    }
  }

  // seed journeys (placement records — the only source of subject placement,
  // since the corpus carries no overlay front-matter yet)
  const seedDoc = safeYaml(join(navDir, "journeys.seed.yaml"))
  const journeys: SeedJourney[] = Array.isArray(seedDoc?.journeys) ? seedDoc.journeys : []

  console.log(
    `[navManifest] loaded ${navDir} (lenses=${lenses.length}, dimensions=${dimensions.size}, journeys=${journeys.length}).`,
  )
  return { navDir, manifest, lenses, dimensions, journeys }
}
