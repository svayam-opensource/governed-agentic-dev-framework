// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE POLICY DOCUMENT'S OWN TEXT (F127, Policy Owner 2026-11-20; intent I2, I3, I4).
 *
 * The Policies page reads like a policy on paper: a title page, eight chapters, a glossary and an index. Each clause
 * is a rule row (its `statement` and `chapter`, rule-row.ts); what is NOT a rule lives in two files of one shape,
 * each with one writer, like the two rule stores:
 *
 *   framework/policy-document.yaml   the framework's chapter titles, introductions and glossary — `gov upgrade` only
 *   policies/policy-document.yaml    the organization's title page, its own introductions and glossary — seeded
 *                                    once, then the organization's (gov never rewrites it)
 *
 * The framework's file names all eight seeded chapters ({@link CHAPTERS}), each once, under its seeded title. The
 * organization's may introduce any of them, rename one (`title`), or add its own from 9 up (a title then required).
 *
 * Pure: text in, the document and its problems out.
 */
import yaml from "js-yaml";
import { CHAPTERS } from "./rule-row.js";

export const POLICY_DOCUMENT_PATHS = {
  framework: "framework/policy-document.yaml",
  org: "policies/policy-document.yaml",
} as const;

export type PolicyDocumentOwner = keyof typeof POLICY_DOCUMENT_PATHS;

export interface ChapterText {
  readonly number: number;
  readonly title?: string;
  readonly intro?: string;
}
export interface GlossaryEntry {
  readonly term: string;
  readonly definition: string;
}
/** The title page: free text values, empty = left out. Only the organization's file has one. */
export type TitlePage = Readonly<Record<string, string>>;

export interface PolicyDocument {
  readonly title_page?: TitlePage;
  readonly chapters: readonly ChapterText[];
  readonly glossary: readonly GlossaryEntry[];
}

export interface ParsedPolicyDocument {
  readonly doc: PolicyDocument;
  /** Empty = valid. */
  readonly problems: readonly string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Parse and check one policy-document file. `owner` says which file it is, and so what it may hold. */
export function parsePolicyDocument(text: string, owner: PolicyDocumentOwner): ParsedPolicyDocument {
  const problems: string[] = [];
  let raw: unknown;
  try { raw = yaml.load(text, { schema: yaml.JSON_SCHEMA }) ?? {}; } catch (e) {
    return { doc: { chapters: [], glossary: [] }, problems: [`does not parse: ${(e as Error).message}`] };
  }
  if (!isObj(raw)) return { doc: { chapters: [], glossary: [] }, problems: ["expected a mapping with chapters and glossary"] };
  const known = owner === "org" ? ["title_page", "chapters", "glossary"] : ["chapters", "glossary"];
  for (const k of Object.keys(raw)) if (!known.includes(k)) problems.push(`unknown key "${k}" (expected ${known.join(", ")})`);

  let title_page: TitlePage | undefined;
  if (owner === "org" && raw.title_page !== undefined) {
    if (!isObj(raw.title_page)) problems.push("title_page is a mapping of text values");
    else {
      const bad = Object.entries(raw.title_page).filter(([, v]) => typeof v !== "string").map(([k]) => k);
      if (bad.length) problems.push(`title_page: ${bad.join(", ")} must be text (quote it; empty means left out)`);
      title_page = Object.fromEntries(Object.entries(raw.title_page).map(([k, v]) => [k, String(v ?? "")]));
    }
  }

  const chapters: ChapterText[] = [];
  const rawChapters = raw.chapters ?? [];
  if (!Array.isArray(rawChapters)) problems.push("chapters is a list of { number, title, intro }");
  else rawChapters.forEach((c, i) => {
    if (!isObj(c) || !Number.isInteger(c.number) || (c.number as number) < 1) { problems.push(`chapters[${i}]: number is a whole number from 1`); return; }
    const n = c.number as number;
    if (c.title !== undefined && !isText(c.title)) problems.push(`chapter ${n}: a title is text, not empty`);
    if (c.intro !== undefined && typeof c.intro !== "string") problems.push(`chapter ${n}: an intro is text`);
    if (owner === "framework" && n > 8) problems.push(`chapter ${n}: the framework's chapters are 1 to 8`);
    if (owner === "framework" && c.title !== CHAPTERS[n as keyof typeof CHAPTERS]) problems.push(`chapter ${n}: the framework's title is "${CHAPTERS[n as keyof typeof CHAPTERS]}"`);
    if (owner === "org" && n > 8 && !isText(c.title)) problems.push(`chapter ${n}: a chapter the organization adds needs a title`);
    if (chapters.some((x) => x.number === n)) problems.push(`chapter ${n} is listed twice`);
    chapters.push({ number: n, ...(isText(c.title) ? { title: c.title } : {}), ...(typeof c.intro === "string" ? { intro: c.intro } : {}) });
  });
  if (owner === "framework") {
    for (const n of Object.keys(CHAPTERS).map(Number)) if (!chapters.some((c) => c.number === n)) problems.push(`chapter ${n} (${CHAPTERS[n as keyof typeof CHAPTERS]}) is missing`);
  }

  const glossary: GlossaryEntry[] = [];
  const rawGlossary = raw.glossary ?? [];
  if (!Array.isArray(rawGlossary)) problems.push("glossary is a list of { term, definition }");
  else rawGlossary.forEach((g, i) => {
    if (!isObj(g) || !isText(g.term) || !isText(g.definition)) { problems.push(`glossary[${i}]: needs a term and a definition, each as text`); return; }
    if (glossary.some((x) => x.term.toLowerCase() === (g.term as string).toLowerCase())) problems.push(`glossary: "${g.term}" is defined twice`);
    glossary.push({ term: g.term, definition: g.definition });
  });

  return { doc: { ...(title_page ? { title_page } : {}), chapters, glossary }, problems };
}

/**
 * The document's chapters and glossary as a reader sees them: the eight seeded chapters (renamed where the
 * organization renamed one) plus any it added, each with the framework's introduction and then the organization's;
 * the glossary merged and sorted, the organization's definition shown where a term is in both.
 */
export function mergePolicyDocuments(framework: PolicyDocument, org: PolicyDocument): {
  readonly title_page: TitlePage;
  readonly chapters: readonly { readonly number: number; readonly title: string; readonly frameworkIntro: string; readonly orgIntro: string }[];
  readonly glossary: readonly (GlossaryEntry & { readonly from: PolicyDocumentOwner })[];
} {
  const numbers = [...new Set([...Object.keys(CHAPTERS).map(Number), ...framework.chapters.map((c) => c.number), ...org.chapters.map((c) => c.number)])].sort((a, b) => a - b);
  const chapters = numbers.map((n) => {
    const f = framework.chapters.find((c) => c.number === n), o = org.chapters.find((c) => c.number === n);
    return { number: n, title: o?.title ?? f?.title ?? CHAPTERS[n as keyof typeof CHAPTERS] ?? `Chapter ${n}`, frameworkIntro: f?.intro ?? "", orgIntro: o?.intro ?? "" };
  });
  const byTerm = new Map<string, GlossaryEntry & { from: PolicyDocumentOwner }>();
  for (const g of framework.glossary) byTerm.set(g.term.toLowerCase(), { ...g, from: "framework" });
  for (const g of org.glossary) byTerm.set(g.term.toLowerCase(), { ...g, from: "org" });
  const glossary = [...byTerm.values()].sort((a, b) => a.term.localeCompare(b.term));
  return { title_page: org.title_page ?? {}, chapters, glossary };
}
