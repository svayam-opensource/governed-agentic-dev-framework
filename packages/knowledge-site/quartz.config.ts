import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"
import { AuthorityBadge } from "./quartz/plugins/svayam/authorityBadge"
import { DomainIndex } from "./quartz/plugins/svayam/domainIndex"
import { RoleBrowse } from "./quartz/plugins/svayam/roleBrowse"
import { ReadmeAsIndex } from "./quartz/plugins/svayam/readmeAsIndex"

/**
 * @svayam/knowledge-site — Quartz v4 configuration (PRJ-010 #39, Form 1).
 *
 * Renders the org knowledge corpus (svm-prj-work/knowledge, 164 docs) as a
 * static site — a pure GENERATED FACE over the single source of truth
 * (POL-402 / C01). Content is a build-time symlink/rsync, never committed.
 *
 * Binds the three frozen contracts (renderer-decision.md + nav-schema.md):
 *   - AuthorityBadge   transformer — front-matter {compliance,status,owner,layer} → badge
 *   - DomainIndex      emitter     — per-`domain`-FIELD generated indexes
 *   - RoleBrowse       emitter     — subject-led browse + role-as-lens, from the nav manifest
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "Svayam Knowledge",
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,
    // POL-101 internal-only: NO external analytics.
    analytics: null,
    locale: "en-US",
    // Behind gomtinagar Apache + Authentik OIDC (Auth decision).
    baseUrl: "knowledge.svayamtech.com",
    // Hide the nav manifest dir if it is ever symlinked under content/.
    ignorePatterns: ["private", "templates", ".obsidian", "nav"],
    defaultDateType: "modified",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Schibsted Grotesk",
        body: "Source Sans Pro",
        code: "IBM Plex Mono",
      },
      colors: {
        lightMode: {
          light: "#faf8f8",
          lightgray: "#e5e5e5",
          gray: "#b8b8b8",
          darkgray: "#4e4e4e",
          dark: "#2b2b2b",
          secondary: "#284b63",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#fff23688",
        },
        darkMode: {
          light: "#161618",
          lightgray: "#393639",
          gray: "#646464",
          darkgray: "#d4d4d4",
          dark: "#ebebec",
          secondary: "#7b97aa",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "#b3aa0288",
        },
      },
    },
  },
  plugins: {
    transformers: [
      // parses domain/layer/owner/compliance/status into file.data.frontmatter
      Plugin.FrontMatter(),
      // (a) OUR transform — consumes FrontMatter output, injects the authority badge.
      AuthorityBadge(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: { light: "github-light", dark: "github-dark" },
        keepBackground: false,
      }),
      // Mermaid fences (2 corpus docs) ship via Obsidian-flavoured markdown.
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      // relative-link fidelity: ./x.md / ../y.md#anchor -> site-relative, validated.
      Plugin.CrawlLinks({ markdownLinkResolution: "relative" }),
      // README.md -> folder/home index (corpus uses README as the index everywhere).
      // Its slug rewrite runs in the markdown phase; its href fixer (htmlPlugins)
      // MUST run AFTER CrawlLinks, hence it is positioned here, so it repairs the
      // links CrawlLinks resolved to the old `README` slug. (0 broken links.)
      ReadmeAsIndex(),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    // hide status: draft from the human site (RemoveDrafts keys off frontmatter.draft;
    // see quartz.layout / status handling note in README).
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      // (b) generated per-domain index pages (grouped by the `domain` FIELD).
      DomainIndex(),
      // (c) subject-led browse + role-as-lens from the nav manifest (no-ops if absent).
      RoleBrowse(),
      // README.md -> folder index (POL-405 stub indexes).
      Plugin.FolderPage(),
      Plugin.TagPage(),
      // backlinks/graph data + FlexSearch index + sitemap.
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
    ],
  },
}

export default config
