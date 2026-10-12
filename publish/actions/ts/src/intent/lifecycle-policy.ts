// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The ADOPTED lifecycle, as gov reads it (spec 03 §2, contract X6/X7).
 *
 * One file drives `gov intent` and `gov autorun`: `policies/active/ai-sdlc-lifecycle.md`. Policies carry no front
 * matter and gov never edits their prose, so the machine-readable part is a CONVENTION in the prose itself (X7):
 *
 *     ## 3. Intent (phase: build)            ← the number is optional; the phase tag is not
 *     Template: `policies/reference/lifecycles/ai-sdlc/intent.md`
 *
 * gov parses headings and Template lines only. A section it cannot parse is a PROBLEM — reported by `gov doctor` as
 * an advisory — and never a guess: no step is produced from it. The templates live in `policies/reference/`, a
 * library that is never turned into rules (the policy gate skips it; see `policyDocPaths`).
 *
 * Pure: text in, data out.
 */
import type { Diagnostic } from "../maintain/doctor.js";

export const POLICY_ACTIVE_DIR = "policies/active";
export const POLICY_REFERENCE_DIR = "policies/reference";
export const LIFECYCLE_POLICY_PATH = `${POLICY_ACTIVE_DIR}/ai-sdlc-lifecycle.md`;
export const LIFECYCLE_TEMPLATE_DIR = `${POLICY_REFERENCE_DIR}/lifecycles/ai-sdlc`;

export type LifecyclePhase = "build" | "deploy" | "run";
export type ArtifactKind = "intent" | "spec" | "plan" | "build" | "deploy" | "run";

export interface LifecycleStep {
  readonly step: ArtifactKind;
  readonly phase: LifecyclePhase;
  /** The heading as written, for messages. */
  readonly heading: string;
  /** Repo-relative template path from the step's `Template:` line. */
  readonly template: string | null;
}

export interface ParsedLifecycle {
  readonly steps: readonly LifecycleStep[];
  readonly problems: readonly string[];
}

/** Sections each artifact must carry (spec 03 §2.3), in template order. */
export const ARTIFACT_SECTIONS: Readonly<Record<ArtifactKind, readonly string[]>> = {
  intent: ["Goal", "Why", "Board items", "Rulings it carries", "Affected units", "Interview decisions", "Out", "Done when"],
  spec: ["Scope recap", "Design", "Current state (file:line)", "Acceptance criteria", "Contradictions and open Q's", "Dependencies, risks, test strategy"],
  plan: ["Tasks", "Order", "Test plan", "Documentation plan", "Rollout"],
  build: ["Task → issue → CR → commit", "Deviations from plan", "Tests run and results", "Shipped in"],
  deploy: ["Unit", "From → to version", "Included intents", "Migration and rollback", "Approvals"],
  run: ["What changed for operators", "Monitoring and alerts", "Known issues", "Runbook pointers", "Hand-over sign-off"],
};

/** Heading words → step. "Release and deploy" is the deploy step's heading in the starter. */
const STEP_NAMES: Readonly<Record<string, ArtifactKind>> = {
  intent: "intent", spec: "spec", plan: "plan", build: "build",
  deploy: "deploy", release: "deploy", "release and deploy": "deploy", run: "run",
};
const PHASES: readonly string[] = ["build", "deploy", "run"];

const HEADING = /^##\s+(?:\d+(?:\.\d+)*\.?\s+)?(.*?)\s*$/;
const PHASE_TAG = /^(.*?)\s*\(phase:\s*([^)]*)\)$/i;
const TEMPLATE_LINE = /^Template:\s*`?([^`\s]+)`?/;

/** Split into `##` sections outside fenced code: [heading text, body lines]. */
function sections(text: string): { heading: string; body: string[] }[] {
  const out: { heading: string; body: string[] }[] = [];
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; if (out.length) out[out.length - 1].body.push(line); continue; }
    const m = !fence && line.startsWith("## ") ? HEADING.exec(line) : null;
    if (m) { out.push({ heading: m[1], body: [] }); continue; }
    if (out.length) out[out.length - 1].body.push(line);
  }
  return out;
}

export function parseLifecycle(text: string): ParsedLifecycle {
  const steps: LifecycleStep[] = [];
  const problems: string[] = [];
  for (const s of sections(text)) {
    const tagged = PHASE_TAG.exec(s.heading);
    const name = (tagged ? tagged[1] : s.heading).trim();
    const step = STEP_NAMES[name.toLowerCase()];
    if (!tagged) {
      if (step) problems.push(`"## ${s.heading}" looks like a lifecycle step but has no "(phase: build|deploy|run)" tag`);
      continue;
    }
    const phase = tagged[2].trim().toLowerCase();
    if (!PHASES.includes(phase)) { problems.push(`"## ${s.heading}": phase must be build|deploy|run`); continue; }
    if (!step) { problems.push(`"## ${s.heading}": "${name}" is not a lifecycle step gov knows (intent, spec, plan, build, deploy, run)`); continue; }
    let template: string | null = null;
    for (const l of s.body) { const t = TEMPLATE_LINE.exec(l.trim()); if (t) { template = t[1]; break; } }
    if (template === null) problems.push(`"## ${s.heading}": no "Template: \`${POLICY_REFERENCE_DIR}/…\`" line`);
    else if (!template.startsWith(`${POLICY_REFERENCE_DIR}/`)) problems.push(`"## ${s.heading}": its template must be under ${POLICY_REFERENCE_DIR}/ (found ${template})`);
    steps.push({ step, phase: phase as LifecyclePhase, heading: s.heading, template });
  }
  return { steps: problems.length ? steps.filter((s) => s.template?.startsWith(`${POLICY_REFERENCE_DIR}/`)) : steps, problems };
}

/**
 * The body of the first `##` section whose heading (number dropped) is `heading` — a step's own prose, as the org
 * wrote it — trimmed of blank lines at both ends; null when there is no such section. The lifecycle skills (L15)
 * carry it verbatim.
 */
export function sectionBody(text: string, heading: string): string | null {
  const s = sections(text).find((x) => x.heading === heading);
  return s ? s.body.join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "") : null;
}

/** Required sections (§2.3) absent from an artifact's `##` headings. */
export function missingSections(kind: ArtifactKind, text: string): string[] {
  const have = new Set(sections(text).map((s) => s.heading.trim()));
  return ARTIFACT_SECTIONS[kind].filter((h) => !have.has(h));
}

export type ArtifactStatus =
  | { readonly kind: "draft" }
  | { readonly kind: "approved"; readonly text: string }
  | { readonly kind: "stale"; readonly text: string };

/** The artifact's Status line (`**Status:** DRAFT`, `**Status: APPROVED by …**`, `STALE (…)`), or null when none. */
export function statusOf(text: string): ArtifactStatus | null {
  const m = /\*\*Status:?\*{0,2}:?\s*(DRAFT|APPROVED|STALE)\b\s*([^\n]*)/.exec(text);
  if (!m) return null;
  const rest = m[2].replace(/\*\*\s*$/, "").trim();
  if (m[1] === "DRAFT") return { kind: "draft" };
  return m[1] === "APPROVED" ? { kind: "approved", text: rest } : { kind: "stale", text: rest };
}

/**
 * The `gov doctor` row. undefined = not read → no row. null = no lifecycle adopted: a choice, so `ok`, saying what it
 * means. Problems are an ADVISORY (warn) — the commands skip what they cannot parse; nothing else is affected.
 */
export function lifecycleDiagnostic(text: string | null | undefined): Diagnostic | null {
  if (text === undefined) return null;
  if (text === null) return { name: "lifecycle", status: "ok", detail: `none adopted (${LIFECYCLE_POLICY_PATH}) — gov intent and gov autorun do nothing` };
  const r = parseLifecycle(text);
  if (r.problems.length) {
    return { name: "lifecycle", status: "warn", detail: `${LIFECYCLE_POLICY_PATH}: ${r.problems.length} section(s) gov cannot read, skipped — ${r.problems.join("; ")}` };
  }
  return { name: "lifecycle", status: "ok", detail: `${LIFECYCLE_POLICY_PATH}: ${r.steps.length} steps (${r.steps.map((s) => s.step).join(" → ")})` };
}
