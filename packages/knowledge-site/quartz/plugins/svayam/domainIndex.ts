import { QuartzEmitterPlugin } from "../types"
import { QuartzComponentProps } from "../../components/types"
import HeaderConstructor from "../../components/Header"
import BodyConstructor from "../../components/Body"
import { pageResources, renderPage } from "../../components/renderPage"
import { ProcessedContent, QuartzPluginData, defaultProcessedContent } from "../vfile"
import { FullPageLayout } from "../../cfg"
import { FilePath, FullSlug, joinSegments, pathToRoot, resolveRelative } from "../../util/path"
import { defaultListPageLayout, sharedPageComponents } from "../../../quartz.layout"
import { Content } from "../../components"
import { write } from "../emitters/helpers"
import { BuildCtx } from "../../util/ctx"
import { StaticResources } from "../../util/resources"
import { Root as HtmlRoot, Element } from "hast"

/**
 * DomainIndex — Track A (PRJ-010 #39), renderer-decision §(b).
 *
 * Quartz EMITTER. Groups EVERY parsed page by its `frontmatter.domain` FIELD
 * (the field, NOT the folder — a doc may carry `domain: architecture/system`
 * while physically living under any layer folder) and emits one generated index
 * page per domain at `/domains/<domain>/`, plus a `/domains/` roll-up.
 *
 * Rows are ordered by the layer NORMATIVITY GRADIENT
 *   mandate → procedure → pattern → use-case → spec → compliance → path → decision
 * (POL-405 extended with `path` + `decision`, nav-schema §3.3). Each row is a
 * LINK ONLY into the SoT page + the doc's badge text (POL-402 / C01 — no prose
 * copied).
 */

const LAYER_ORDER = [
  "mandate",
  "procedure",
  "pattern",
  "use-case",
  "spec",
  "compliance",
  "path",
  "decision",
]

const COMPLIANCE_SHORT: Record<string, string> = {
  C01: "C01 · Mandate",
  C02: "C02 · Required",
  C03: "C03 · Recommended",
  instructional: "Instructional",
  descriptive: "Descriptive",
  evidence: "Evidence",
}

function layerRank(layer: unknown): number {
  const i = LAYER_ORDER.indexOf(String(layer))
  return i === -1 ? LAYER_ORDER.length : i
}

function badgeText(fm: any): string {
  const parts: string[] = []
  if (fm?.layer) parts.push(String(fm.layer))
  if (fm?.compliance) parts.push(COMPLIANCE_SHORT[fm.compliance] ?? String(fm.compliance))
  if (fm?.status && fm.status !== "current") parts.push(String(fm.status))
  return parts.join(" · ")
}

function domainSegments(domain: string): string {
  // keep slashes (architecture/system) so URLs mirror the field; sanitise rest
  return domain
    .split("/")
    .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, "-"))
    .join("/")
}

// --- tiny hast builders ---
const t = (value: string) => ({ type: "text", value }) as any
const el = (tagName: string, properties: any, children: any[]): Element =>
  ({ type: "element", tagName, properties, children }) as Element

function makeProcessed(slug: FullSlug, title: string, tree: HtmlRoot): ProcessedContent {
  const [, file] = defaultProcessedContent({
    slug,
    frontmatter: { title, tags: [] },
    filePath: (slug + ".md") as FilePath,
  })
  return [tree, file]
}

async function renderOne(
  ctx: BuildCtx,
  slug: FullSlug,
  pc: ProcessedContent,
  allFiles: QuartzPluginData[],
  opts: FullPageLayout,
  resources: StaticResources,
): Promise<FilePath> {
  const [tree, file] = pc
  const cfg = ctx.cfg.configuration
  const externalResources = pageResources(pathToRoot(slug), resources)
  const componentData: QuartzComponentProps = {
    ctx,
    fileData: file.data,
    externalResources,
    cfg,
    children: [],
    tree,
    allFiles,
  }
  const content = renderPage(cfg, slug, componentData, opts, externalResources)
  return write({ ctx, content, slug, ext: ".html" })
}

export const DomainIndex: QuartzEmitterPlugin = () => {
  const opts: FullPageLayout = {
    ...sharedPageComponents,
    ...defaultListPageLayout,
    pageBody: Content(),
  }
  const { head: Head, header, beforeBody, pageBody, afterBody, left, right, footer: Footer } = opts
  const Header = HeaderConstructor()
  const Body = BodyConstructor()

  return {
    name: "DomainIndex",
    getQuartzComponents() {
      return [
        Head,
        Header,
        Body,
        ...header,
        ...beforeBody,
        pageBody,
        ...afterBody,
        ...left,
        ...right,
        Footer,
      ]
    },
    async *emit(ctx, content, resources) {
      const allFiles = content.map((c) => c[1].data)

      // Group by the front-matter `domain` FIELD.
      const byDomain = new Map<string, QuartzPluginData[]>()
      for (const [, file] of content) {
        const fm: any = file.data.frontmatter
        const domain = fm?.domain
        if (!domain) continue // unbadged / no-front-matter doc -> skipped gracefully
        const key = String(domain).trim()
        if (!byDomain.has(key)) byDomain.set(key, [])
        byDomain.get(key)!.push(file.data)
      }

      const sortedDomains = [...byDomain.keys()].sort()

      // ---- per-domain index pages ----
      for (const domain of sortedDomains) {
        const docs = [...byDomain.get(domain)!]
        docs.sort((a, b) => {
          const lr = layerRank(a.frontmatter?.layer) - layerRank(b.frontmatter?.layer)
          if (lr !== 0) return lr
          return String(a.frontmatter?.title ?? a.slug).localeCompare(
            String(b.frontmatter?.title ?? b.slug),
          )
        })

        const slug = joinSegments("domains", domainSegments(domain), "index") as FullSlug
        const root: any[] = []
        root.push(el("h1", {}, [t(`Domain: ${domain}`)]))
        root.push(
          el("p", { className: ["domain-index__note"] }, [
            t(
              "Generated index — grouped by the domain front-matter field, ordered by the layer normativity gradient. Links only (POL-402).",
            ),
          ]),
        )
        root.push(el("p", {}, [t(`${docs.length} document(s).`)]))

        let currentLayer: string | null = null
        let list: Element | null = null
        for (const d of docs) {
          const layer = String(d.frontmatter?.layer ?? "(unspecified)")
          if (layer !== currentLayer) {
            root.push(el("h2", { id: layer }, [t(layer)]))
            list = el("ul", {}, [])
            root.push(list)
            currentLayer = layer
          }
          const title = String(d.frontmatter?.title ?? d.slug)
          const href = resolveRelative(slug, d.slug as FullSlug)
          const bt = badgeText(d.frontmatter)
          list!.children.push(
            el("li", {}, [
              el("a", { href, className: ["internal"] }, [t(title)]),
              ...(bt ? [t(` — ${bt}`)] : []),
            ]),
          )
        }
        const tree: HtmlRoot = { type: "root", children: root }
        yield renderOne(
          ctx,
          slug,
          makeProcessed(slug, `Domain: ${domain}`, tree),
          allFiles,
          opts,
          resources,
        )
      }

      // ---- /domains roll-up ----
      {
        const slug = joinSegments("domains", "index") as FullSlug
        const counts = sortedDomains
          .map((d) => [d, byDomain.get(d)!.length] as const)
          .sort((a, b) => b[1] - a[1])
        const root: any[] = []
        root.push(el("h1", {}, [t("Domains — generated indexes")]))
        root.push(
          el("p", {}, [
            t("One always-current index per domain value, derived from front-matter (POL-402)."),
          ]),
        )
        const ul = el("ul", {}, [])
        for (const [d, n] of counts) {
          const href = resolveRelative(
            slug,
            joinSegments("domains", domainSegments(d), "index") as FullSlug,
          )
          ul.children.push(
            el("li", {}, [el("a", { href, className: ["internal"] }, [t(d)]), t(` — ${n} doc(s)`)]),
          )
        }
        root.push(ul)
        const tree: HtmlRoot = { type: "root", children: root }
        yield renderOne(ctx, slug, makeProcessed(slug, "Domains", tree), allFiles, opts, resources)
      }
    },
  }
}
