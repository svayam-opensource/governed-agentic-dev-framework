import { QuartzTransformerPlugin } from "../types"
import { FullSlug } from "../../util/path"
import { visit } from "unist-util-visit"

/**
 * ReadmeAsIndex — Track A (PRJ-010 #39).
 *
 * The corpus uses `README.md` as the folder index in every domain (POL-405 stub
 * indexes) and as the site home (`knowledge/README.md`). Quartz v4 only treats
 * `index` / `_index` as a folder index, so a bare `README` would emit as
 * `.../README.html` instead of the folder/home index.
 *
 * Two coordinated rewrites:
 *
 *  1. SLUG (markdownPlugins, after `file.data.slug` is assigned): map any
 *     `README` page to its folder `index`:
 *       README                     -> index               (site home)
 *       architecture/system/README -> architecture/system/index
 *     so the hand-written README becomes the folder/home index (FolderPage then
 *     only synthesises indexes for folders that lack one).
 *
 *  2. HREF (htmlPlugins, AFTER CrawlLinks): the corpus links to those READMEs
 *     explicitly as `./README.md` / `../specs/README.md`; CrawlLinks resolves
 *     those to `.../README`, which no longer exists once (1) moved them to
 *     `index`. So rewrite any internal anchor whose path component ends in
 *     `README` to the `index` equivalent, preserving any `#anchor`/query. This
 *     keeps internal relative links resolving (acceptance: 0 broken links).
 */
function rewriteReadmeHref(href: string): string {
  // only touch relative/internal hrefs
  if (/^(https?:|mailto:|tel:|#|data:|javascript:|\/\/)/i.test(href)) return href
  // split off fragment/query
  const m = href.match(/^([^#?]*)([#?].*)?$/)
  if (!m) return href
  let path = m[1]
  const rest = m[2] ?? ""
  if (path === "README" || path.endsWith("/README")) {
    path = path.slice(0, -"README".length) + "index"
    return path + rest
  }
  return href
}

export const ReadmeAsIndex: QuartzTransformerPlugin = () => ({
  name: "ReadmeAsIndex",
  markdownPlugins() {
    return [
      () => (_tree, file: any) => {
        const slug: string | undefined = file.data?.slug
        if (!slug) return
        if (slug === "README") {
          file.data.slug = "index" as FullSlug
        } else if (slug.endsWith("/README")) {
          file.data.slug = (slug.slice(0, -"/README".length) + "/index") as FullSlug
        }
      },
    ]
  },
  htmlPlugins() {
    return [
      () => (tree: any) => {
        visit(tree, "element", (node: any) => {
          if (node.tagName !== "a") return
          const href = node.properties?.href
          if (typeof href === "string") {
            node.properties.href = rewriteReadmeHref(href)
          }
        })
      },
    ]
  },
})
