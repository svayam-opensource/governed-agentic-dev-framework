#!/usr/bin/env node
// verify-build.mjs — acceptance checks for @svayam/knowledge-site (PRJ-010 #39).
//
// Runs AFTER `npm run build`. Asserts the build output meets the acceptance bar:
//   - public/index.html exists (home = knowledge/README.md)
//   - ~164 content pages rendered
//   - authority badges present
//   - per-domain generated indexes present (/domains/...)
//   - subject-led role-lens browse present (/browse/..., /browse/roles/...)
//   - graph + search assets emitted
// Internal-relative link integrity is checked separately (see README / CI).
//
// Non-zero exit on a hard failure; warnings are printed but do not fail here
// (the hard lint gate is deferred — debt A2).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve, extname } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PUBLIC = join(SITE, "public")

let failures = 0
const ok = (m) => console.log(`  PASS  ${m}`)
const warn = (m) => console.warn(`  WARN  ${m}`)
const fail = (m) => {
  console.error(`  FAIL  ${m}`)
  failures++
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

if (!existsSync(PUBLIC)) {
  fail(`public/ does not exist — did the build run?`)
  process.exit(1)
}

const allHtml = walk(PUBLIC).filter((f) => extname(f) === ".html")
const grepCount = (substr) =>
  allHtml.filter((f) => readFileSync(f, "utf8").includes(substr)).length

console.log("== acceptance checks ==")

// home
existsSync(join(PUBLIC, "index.html"))
  ? ok("public/index.html (site home) exists")
  : fail("public/index.html missing")

// page count
const total = allHtml.length
console.log(`  INFO  total .html pages emitted: ${total}`)
total >= 150 ? ok(`>=150 pages rendered (${total})`) : warn(`only ${total} pages rendered`)

// badges
const badged = grepCount('class="authority-badge')
badged > 0
  ? ok(`authority badges present on ${badged} pages`)
  : fail("no authority-badge markup found")

// per-domain indexes
existsSync(join(PUBLIC, "domains", "index.html"))
  ? ok("/domains roll-up index present")
  : fail("/domains/index.html missing")
const domainDirs = existsSync(join(PUBLIC, "domains"))
  ? readdirSync(join(PUBLIC, "domains"), { withFileTypes: true }).filter((e) => e.isDirectory())
      .length
  : 0
domainDirs >= 5
  ? ok(`per-domain index pages present (${domainDirs} domain dirs)`)
  : warn(`only ${domainDirs} domain index dirs`)

// subject-led role-lens browse
existsSync(join(PUBLIC, "browse", "index.html"))
  ? ok("/browse index present")
  : fail("/browse/index.html missing")
for (const dim of ["internal-app", "product", "policy"]) {
  existsSync(join(PUBLIC, "browse", dim, "index.html"))
    ? ok(`/browse/${dim} subject spine present`)
    : fail(`/browse/${dim}/index.html missing`)
}
const roleDir = join(PUBLIC, "browse", "roles")
const roleCount = existsSync(roleDir)
  ? readdirSync(roleDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length
  : 0
roleCount >= 1
  ? ok(`role-lens pages present (${roleCount} roles)`)
  : fail("no /browse/roles/<role> pages")

// graph + search
grepCount("graph") > 0 ? ok("graph view markup present") : warn("graph markup not detected")
existsSync(join(PUBLIC, "static")) || grepCount("flexsearch") > 0 || grepCount("search") > 0
  ? ok("search assets present")
  : warn("search assets not detected")

console.log("== summary ==")
if (failures > 0) {
  console.error(`${failures} hard check(s) FAILED.`)
  process.exit(1)
}
console.log("All hard acceptance checks passed.")
