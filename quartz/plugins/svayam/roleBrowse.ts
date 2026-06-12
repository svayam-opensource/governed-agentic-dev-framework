import { QuartzEmitterPlugin } from "../types"
import { QuartzComponentProps } from "../../components/types"
import HeaderConstructor from "../../components/Header"
import BodyConstructor from "../../components/Body"
import { pageResources, renderPage } from "../../components/renderPage"
import { ProcessedContent, defaultProcessedContent } from "../vfile"
import { FullPageLayout } from "../../cfg"
import { FilePath, FullSlug, joinSegments, pathToRoot, resolveRelative } from "../../util/path"
import { defaultListPageLayout, sharedPageComponents } from "../../../quartz.layout"
import { Content } from "../../components"
import { write } from "../emitters/helpers"
import { Root as HtmlRoot, Element } from "hast"
import { loadNavManifest, NavManifest, SeedJourney } from "./navManifest"

/**
 * RoleBrowse — Track A (PRJ-010 #39), renderer-decision §(c), nav-schema §1.3a.
 *
 * Quartz EMITTER. Emits the SUBJECT-LED hierarchical browse with ROLE as an
 * ORTHOGONAL LENS, read from the frozen nav manifest (knowledge/nav/). The
 * browse spine is:
 *     subject-dimension (internal-app | product | policy)
 *       → subject-value → activity → journey leaf
 * matching "Internal Application → IAM → development → Integrate with IAM".
 * ROLE is NOT a spine rung; it is a lens applied on top that selects/reorders/
 * filters the surfaced journeys and documents.
 *
 * Output pages (all LINK-ONLY — no content copied, POL-402 / C01):
 *   /browse/                       — index of the subject spines + role lenses
 *   /browse/<subject-dimension>/   — one page per subject spine head
 *   /browse/roles/<role-slug>/     — one page per Owner-role lens
 *
 * Sources:
 *   - subject placement + journey leaves: nav `journeys.seed.yaml` (the corpus
 *     carries no overlay front-matter yet — placement lives in the seed).
 *   - role-lens membership: each doc's required `owner` UNION any `roles[]`
 *     overlay (relevance, not just ownership), plus journeys whose `role_lens`
 *     names the role.
 *
 * GRACEFUL NO-OP: if the nav manifest is absent, the emitter logs a warning and
 * emits nothing — the site still builds before the nav track lands.
 */

// The build runs with the workspace root as cwd (`node ./quartz/bootstrap-cli.mjs
// ... --directory content`). Using cwd avoids the unreliable `import.meta.url`
// base that esbuild rewrites when it bundles the plugin. The nav-manifest path
// is further configurable via SVM_NAV_DIR / SVM_PRJ_WORK (see navManifest.ts).
const SITE_ROOT = process.cwd()

const SUBJECT_DIMS = ["internal-app", "product", "policy"]

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

function dimLabel(nav: NavManifest, dim: string, valueId: string): string {
  const v = nav.dimensions.get(dim)?.find((x) => x.id === valueId)
  return v?.label ?? valueId
}

function journeyHref(current: FullSlug, journeySlug: string): string {
  return resolveRelative(current, joinSegments("paths", journeySlug) as FullSlug)
}

export const RoleBrowse: QuartzEmitterPlugin = () => {
  const nav = loadNavManifest(SITE_ROOT)

  const opts: FullPageLayout = {
    ...sharedPageComponents,
    ...defaultListPageLayout,
    pageBody: Content(),
  }
  const { head: Head, header, beforeBody, pageBody, afterBody, left, right, footer: Footer } = opts
  const Header = HeaderConstructor()
  const Body = BodyConstructor()

  return {
    name: "RoleBrowse",
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
      if (!nav) {
        return // already warned in loader; no-op so the build still succeeds
      }
      const allFiles = content.map((c) => c[1].data)

      const renderOne = (slug: FullSlug, title: string, tree: HtmlRoot): Promise<FilePath> => {
        const [, file] = makeProcessed(slug, title, tree)
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
        const rendered = renderPage(cfg, slug, componentData, opts, externalResources)
        return write({ ctx, content: rendered, slug, ext: ".html" })
      }

      // ---------- index of every subject spine + every role lens ----------
      {
        const slug = joinSegments("browse", "index") as FullSlug
        const tree: HtmlRoot = {
          type: "root",
          children: [
            el("h1", {}, [t("Browse")]),
            el("p", {}, [
              t(
                "Subject-led browse. Pick a subject spine (the head of the hierarchy), then drill subject-value → activity → journey. Role is an orthogonal lens applied on top.",
              ),
            ]),
            el("h2", {}, [t("By subject")]),
            el(
              "ul",
              {},
              SUBJECT_DIMS.map((dim) =>
                el("li", {}, [
                  el(
                    "a",
                    {
                      href: resolveRelative(slug, joinSegments("browse", dim, "index") as FullSlug),
                      className: ["internal"],
                    },
                    [t(dim)],
                  ),
                ]),
              ),
            ),
            el("h2", {}, [t("Role lenses (orthogonal)")]),
            el(
              "ul",
              {},
              nav.lenses.map((lens) =>
                el("li", {}, [
                  el(
                    "a",
                    {
                      href: resolveRelative(
                        slug,
                        joinSegments("browse", "roles", lens.id, "index") as FullSlug,
                      ),
                      className: ["internal"],
                    },
                    [t(lens.label ?? lens.id)],
                  ),
                  t(` (${lens.id})`),
                ]),
              ),
            ),
          ],
        }
        yield renderOne(slug, "Browse", tree)
      }

      // ---------- one page per subject spine head ----------
      for (const dim of SUBJECT_DIMS) {
        const slug = joinSegments("browse", dim, "index") as FullSlug
        // subject-value -> activity -> journey leaves, from seed placements
        const spine = new Map<string, Map<string, Set<string>>>()
        for (const j of nav.journeys) {
          for (const p of j.placement ?? []) {
            if (p["subject-dimension"] !== dim) continue
            const sv = p["subject-value"]
            const act = p.activity ?? "(unspecified)"
            if (!spine.has(sv)) spine.set(sv, new Map())
            const acts = spine.get(sv)!
            if (!acts.has(act)) acts.set(act, new Set())
            acts.get(act)!.add(j.slug)
          }
        }

        const children: any[] = []
        children.push(el("h1", {}, [t(`Browse by ${dim}`)]))
        children.push(
          el("p", {}, [
            t(
              `Subject spine: ${dim} → subject-value → activity → journey. Leaves are journey links only (POL-402).`,
            ),
          ]),
        )
        if (spine.size === 0) {
          children.push(
            el("p", { className: ["browse__empty"] }, [
              t(`No journeys are placed on the ${dim} spine in the seed manifest yet.`),
            ]),
          )
        }
        for (const [sv, acts] of [...spine.entries()].sort()) {
          children.push(el("h2", { id: sv }, [t(dimLabel(nav, dim, sv))]))
          for (const [act, journeys] of [...acts.entries()].sort()) {
            children.push(el("h3", {}, [t(`activity: ${act}`)]))
            children.push(
              el(
                "ul",
                {},
                [...journeys].sort().map((jslug) => {
                  const j = nav.journeys.find((x) => x.slug === jslug)
                  return el("li", {}, [
                    el("a", { href: journeyHref(slug, jslug), className: ["internal"] }, [
                      t(j?.nav_title ?? jslug),
                    ]),
                    t(` (journey: ${jslug})`),
                  ])
                }),
              ),
            )
          }
        }
        yield renderOne(slug, `Browse by ${dim}`, { type: "root", children })
      }

      // ---------- one page per role lens (orthogonal) ----------
      for (const lens of nav.lenses) {
        const slug = joinSegments("browse", "roles", lens.id, "index") as FullSlug

        const docs = allFiles.filter((d) => {
          const fm: any = d.frontmatter
          if (!fm) return false
          if (fm.owner === lens.id) return true
          const roles = fm.roles
          return Array.isArray(roles) && roles.includes(lens.id)
        })
        docs.sort((a, b) => {
          const da = String(a.frontmatter?.domain ?? "")
          const db = String(b.frontmatter?.domain ?? "")
          if (da !== db) return da.localeCompare(db)
          return String(a.frontmatter?.title ?? a.slug).localeCompare(
            String(b.frontmatter?.title ?? b.slug),
          )
        })

        const lensJourneys: SeedJourney[] = nav.journeys.filter((j) =>
          (j.role_lens ?? []).includes(lens.id),
        )

        const children: any[] = []
        children.push(el("h1", {}, [t(`${lens.label ?? lens.id} lens`)]))
        children.push(
          el("p", {}, [
            t(
              `Role lens (orthogonal): documents and journeys relevant to ${lens.id}. Relevance = owner OR roles[] membership, not ownership alone (nav-schema §2.5).`,
            ),
          ]),
        )

        children.push(el("h2", {}, [t("Journeys surfaced for this role")]))
        if (lensJourneys.length === 0) {
          children.push(
            el("p", {}, [t("None placed for this role in the seed manifest yet.")]),
          )
        } else {
          children.push(
            el(
              "ul",
              {},
              lensJourneys.map((j) =>
                el("li", {}, [
                  el("a", { href: journeyHref(slug, j.slug), className: ["internal"] }, [
                    t(j.nav_title ?? j.slug),
                  ]),
                  t(` (journey: ${j.slug})`),
                ]),
              ),
            ),
          )
        }

        children.push(el("h2", {}, [t(`Documents (${docs.length})`)]))
        children.push(
          el(
            "ul",
            {},
            docs.map((d) => {
              const title = String(d.frontmatter?.title ?? d.slug)
              const domain = String(d.frontmatter?.domain ?? "")
              return el("li", {}, [
                el("a", { href: resolveRelative(slug, d.slug as FullSlug), className: ["internal"] }, [
                  t(title),
                ]),
                t(domain ? ` — ${domain}` : ""),
              ])
            }),
          ),
        )

        yield renderOne(slug, `${lens.label ?? lens.id} lens`, { type: "root", children })
      }
    },
  }
}
