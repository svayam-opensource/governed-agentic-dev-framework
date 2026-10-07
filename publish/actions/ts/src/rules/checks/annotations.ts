// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A CHECK'S FINDINGS AS GITHUB ACTIONS ANNOTATIONS.
 *
 * When `gov check run` runs inside GitHub Actions (`GITHUB_ACTIONS=true`) it prints, after its human output, one
 * workflow command per finding:
 *
 *   ::error title=<GOV-ID>[,file=<path>[,line=<n>]]::<finding>      the verdict is fail
 *   ::warning title=<GOV-ID>[,file=<path>[,line=<n>]]::<finding>    cannot-tell, or an `on_miss: warn` miss (`warn: …`)
 *
 * GitHub turns each into an annotation on the check run — shown on the pull request, inline on the file when one is
 * named, and readable through `GET /repos/{r}/check-runs/{id}/annotations`. That API is what a test reads to learn
 * what a check found: a job's log download can come back empty for minutes, its annotations do not.
 *
 * The message is escaped per GitHub's rules (`%` → `%25`, CR → `%0D`, LF → `%0A`); a property value also escapes
 * `:` and `,`, which would otherwise end it. Pure.
 */
import { headingSection } from "./sections.js";

export type AnnotationVerdict = { readonly verdict: "pass" | "fail" | "cannot-tell"; readonly findings: readonly string[] };

/** A workflow command's message. `%` first, so an escape is never escaped twice. */
export const escapeData = (s: string): string => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** A workflow command's property value: the message escapes, plus `:` and `,`. */
export const escapeProperty = (s: string): string => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/**
 * The first repository path a finding names (`policies/org-policy.md`, backticked or not) and the `§<n>` right after
 * it, if any. A path is relative — at least one `/`, an extension, starting a word — so a URL is never one.
 */
export function findingLocation(finding: string): { readonly file: string; readonly section?: string } | null {
  const m = /(?:^|[\s`(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z]+)`?(?:\s+§(\d+(?:\.\d+)*))?/.exec(finding);
  if (!m) return null;
  return m[2] ? { file: m[1]!, section: m[2] } : { file: m[1]! };
}

/** The 1-based line of the numbered heading that opens `section`, outside fenced code; undefined if none does. */
export function headingLine(text: string, section: string): number | undefined {
  let fence: string | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (m && fence === null) { fence = m[1]!; continue; }
    if (m && m[1]![0] === fence?.[0] && m[1]!.length >= fence.length) { fence = null; continue; }
    if (fence === null && headingSection(line) === section) return i + 1;
  }
  return undefined;
}

/**
 * One workflow command per finding. `read` (a repository-relative path → its text at the change's head, or null)
 * places a section finding on its heading's line; without it, or when the file or section is not there, the
 * annotation names the file only.
 */
export function annotationLines(id: string, verdict: AnnotationVerdict, read?: (file: string) => string | null): string[] {
  return verdict.findings.map((finding) => {
    const level = verdict.verdict === "fail" && !finding.startsWith("warn: ") ? "error" : "warning";
    const props = [`title=${escapeProperty(id)}`];
    const loc = findingLocation(finding);
    if (loc) {
      props.push(`file=${escapeProperty(loc.file)}`);
      const text = loc.section !== undefined && read ? read(loc.file) : null;
      const line = text === null ? undefined : headingLine(text, loc.section!);
      if (line !== undefined) props.push(`line=${line}`);
    }
    return `::${level} ${props.join(",")}::${escapeData(finding)}`;
  });
}
