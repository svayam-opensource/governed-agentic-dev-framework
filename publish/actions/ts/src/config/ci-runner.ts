// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHERE GOV'S GITHUB WORKFLOWS RUN — `ci.runs_on` in policies/governance.yaml (Policy Owner, 2026-10-17).
 *
 * Every workflow gov writes asks GitHub for a runner (`runs-on:`). It used to be hard-coded to GitHub's hosted
 * `ubuntu-latest`, which an organization that runs all of its CI on its own machines (an Actions spending limit of
 * $0, self-hosted runners) cannot use: the job waits for a runner that will never be granted, and the check never
 * reports. The organization names its runner once, and gov uses it in every workflow it writes:
 *
 *   ci:
 *     runs_on: ubuntu-latest              one label — GitHub's hosted runner, the DEFAULT when the key is absent
 *     runs_on: [self-hosted, linux]       a list — a runner that carries every one of these labels
 *
 * ABSENT IS THE DEFAULT, AND NOT A CHOICE (`chosen: false`): gov then writes `ubuntu-latest`, exactly as before, and
 * never overwrites a runner an organization put into one of gov's workflows by hand. Only an explicit `ci.runs_on`
 * replaces one.
 *
 * Pure.
 */

/** The value of `runs-on:` — one label, or a list a runner must carry every one of. */
export type RunsOn = string | readonly string[];

/** The key, as a person would look for it in policies/governance.yaml. */
export const RUNS_ON_KEY = "ci.runs_on";
/** GitHub's hosted runner — what gov wrote before an organization could choose. */
export const DEFAULT_RUNS_ON = "ubuntu-latest";

/** What governance.yaml says about the runner. `problem` names the key when the value cannot be used. */
export interface RunnerChoice {
  readonly runsOn: RunsOn;
  /** The organization wrote a usable `ci.runs_on`. false: absent, empty, or unusable — the default applies. */
  readonly chosen: boolean;
  readonly problem: string | null;
}

export const DEFAULT_RUNNER: RunnerChoice = { runsOn: DEFAULT_RUNS_ON, chosen: false, problem: null };

/**
 * A runner label gov will write. GitHub's labels are words such as `self-hosted`, `linux`, `X64`, `ubuntu-24.04`:
 * letters, digits, `.`, `_`, `-`. Anything else (a space, a comma, `${{ … }}`, a quote) is refused rather than
 * written into a workflow where it would break the YAML or match no runner.
 */
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const EXAMPLE = "one runner label such as ubuntu-latest, or a list such as [self-hosted, linux]";
const unusable = (why: string): RunnerChoice => ({ ...DEFAULT_RUNNER, problem: `${RUNS_ON_KEY}: ${why} — expected ${EXAMPLE}` });
const shown = (v: unknown): string => {
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); /* not serialisable (a cycle): only shown in a message */ }
};

/** Classify a raw `ci.runs_on` value (as YAML loaded it). Absent, null or "" → the default, not a choice. Pure. */
export function classifyRunsOn(raw: unknown): RunnerChoice {
  if (raw === undefined || raw === null) return DEFAULT_RUNNER;
  if (typeof raw === "string") {
    const label = raw.trim();
    if (!label) return DEFAULT_RUNNER;
    return LABEL.test(label) ? { runsOn: label, chosen: true, problem: null } : unusable(`${shown(raw)} is not a runner label`);
  }
  if (Array.isArray(raw)) {
    if (!raw.length) return unusable("the list is empty");
    const labels: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string" || !LABEL.test(item.trim())) return unusable(`${shown(item)} in the list is not a runner label`);
      const label = item.trim();
      if (labels.includes(label)) return unusable(`${label} is listed twice`);
      labels.push(label);
    }
    return { runsOn: labels, chosen: true, problem: null };
  }
  return unusable(`${shown(raw)} is not a label or a list of labels`);
}

/** `runs-on:`'s value as YAML text: `ubuntu-latest` or `[self-hosted, linux]`. Labels need no quoting (see LABEL). */
export function runsOnYaml(r: RunsOn): string {
  return typeof r === "string" ? r : `[${r.join(", ")}]`;
}

/**
 * A job's `runs-on:` line, in a workflow laid out as GitHub's examples are (jobs at 2 spaces, their keys at 4):
 * the key, the value, and a trailing ` # comment`, which is the organization's and is kept.
 */
const JOB_RUNS_ON = /^( {4}runs-on:[ \t]*)(.*?)((?:[ \t]+#.*?)?)[ \t]*$/gm;
/** A value computed by GitHub (a matrix, an input) is the workflow's own logic, never replaced. */
const isExpression = (v: string): boolean => v.includes("${{");

/** `text` with every job's `runs-on:` set to `value` (YAML text, from {@link runsOnYaml}). An expression is kept. */
export function withRunsOn(text: string, value: string): string {
  return text.replace(JOB_RUNS_ON, (line, head: string, v: string, comment: string) => (isExpression(v) ? line : `${head}${value}${comment}`));
}

/** Each job `runs-on:` line {@link withRunsOn} would change: its 1-based line number, the value it had, the new one. */
export function runsOnEdits(text: string, value: string): { line: number; was: string; now: string }[] {
  const out: { line: number; was: string; now: string }[] = [];
  for (const m of text.matchAll(JOB_RUNS_ON)) {
    const was = m[2]!;
    if (isExpression(was) || m[0] === `${m[1]}${value}${m[3]}`) continue;
    out.push({ line: text.slice(0, m.index).split("\n").length, was, now: value });
  }
  return out;
}

/** The first job's `runs-on:` value as written, or null when no job names one. */
export function runsOnOf(text: string): string | null {
  for (const m of text.matchAll(JOB_RUNS_ON)) if (!isExpression(m[2]!)) return m[2]!;
  return null;
}

/** The two workflows are the same but for the runner their jobs ask for. */
export function sameButRunner(a: string, b: string): boolean {
  return withRunsOn(a, "\u0000") === withRunsOn(b, "\u0000");
}

/** The runner text to write into a gov workflow: the organization's choice, else what `current` already asks for. */
export function runnerFor(choice: RunnerChoice, current: string | null): string {
  if (choice.chosen) return runsOnYaml(choice.runsOn);
  return (current === null ? null : runsOnOf(current)) ?? runsOnYaml(DEFAULT_RUNS_ON);
}
