// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * APPROVED EXCEPTIONS, COMPILED INTO WHAT THE AGENT CARRIES (design §6).
 *
 * A cue says *"not on the approved list? STOP and ask"*. The organization then approves an exception for one
 * repository — and unless the agent is told, it stops anyway. Two things follow, and the second is the reason
 * this module exists: the work halts for no reason, and people learn that cues are obstacles to be talked around.
 * A governance mechanism that trains people to ignore it is worse than none.
 *
 * So an approved, unexpired exception becomes a line in the project's resident block, scoped to what it names:
 *
 *     GOV-SVM-210 · C02 — EXCEPTION EX-14 permits `redis` in 910-GOV-CICD until 2026-12-31 (approved: policy-owner).
 *
 * EXPIRY IS ENFORCED HERE, NOT TRUSTED. An expiry field nobody checks is a permanent exemption with a date
 * printed on it — which is how most of them end up. A lapsed exception simply stops being compiled, so the cue
 * it was suspending speaks again at the next build, and the check it was excusing fails again.
 *
 * Pure: front matter in, lines out. Reading `policies/exceptions/**` is the caller's, and it reads from the
 * DEFAULT branch, because an exception a developer wrote on their own branch is a request, not a permission.
 */

/** The front matter the framework requires of an exception (GOV-FRM-156). */
export interface ExceptionDoc {
  /** Workspace-relative path, for the message when something is wrong with it. */
  readonly path: string;
  readonly text: string;
}

export interface Exception {
  readonly path: string;
  /** The identifier, from `id:` or the file name — what a person cites in a conversation. */
  readonly id: string;
  /** The rule being excepted, e.g. `GOV-SVM-210` (a POL number is still read until P3 retires the old compiler). */
  readonly clause: string;
  /** ISO date. An exception with none is not compiled; see `problems`. */
  readonly expires: string;
  readonly approvedBy: string;
  /** What it covers: repository names, paths, or a project id. Empty means the whole organization. */
  readonly scope: readonly string[];
  readonly why: string;
}

export interface ExceptionProblem {
  readonly path: string;
  readonly why: string;
}

const field = (fm: string, key: string): string =>
  new RegExp(`^${key}:\\s*(.+)$`, "m").exec(fm)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";

/** Read one exception's front matter. */
export function parseException(doc: ExceptionDoc): { exception?: Exception; problem?: ExceptionProblem } {
  const fm = /^---\n([\s\S]*?)\n---/.exec(doc.text)?.[1];
  if (!fm) return { problem: { path: doc.path, why: "no front matter — an exception is machine-read, so its terms cannot be prose" } };

  const clause = /GOV-[A-Z][A-Z0-9]{1,5}-\d{3,}|POL-\d{3}[a-z]?/.exec(field(fm, "clause"))?.[0] ?? "";
  const expires = field(fm, "expires");
  const approvedBy = field(fm, "approved_by");
  const missing = [
    !clause && "clause (which rule is being excepted: its GOV id)",
    !expires && "expires",
    !approvedBy && "approved_by",
  ].filter(Boolean) as string[];
  if (missing.length) return { problem: { path: doc.path, why: `missing ${missing.join(", ")}` } };

  // A DATE THAT IS NOT A DATE IS NOT AN EXPIRY. `new Date("soon")` is Invalid Date, and every comparison against
  // it is false — so an unparseable expiry would read as "not yet expired" and the exception would never lapse.
  if (Number.isNaN(Date.parse(expires))) {
    return { problem: { path: doc.path, why: `expires: ${expires} is not a date gov can read (use YYYY-MM-DD)` } };
  }

  return {
    exception: {
      path: doc.path,
      id: field(fm, "id") || (doc.path.split("/").pop() ?? doc.path).replace(/\.md$/, ""),
      clause, expires, approvedBy,
      scope: field(fm, "scope").split(",").map((s) => s.trim()).filter(Boolean),
      why: field(fm, "reason") || field(fm, "why"),
    },
  };
}

/** Is this exception in force on `today`, and does it cover `project`? */
export function applies(e: Exception, today: string, project?: string): boolean {
  if (Date.parse(e.expires) < Date.parse(today)) return false;
  if (!e.scope.length) return true;                        // org-wide, by not naming a scope
  if (!project) return true;                               // no project context: show it, let the reader judge
  return e.scope.some((s) => s === project || project.includes(s) || s.includes(project));
}

/**
 * The lines that go into the project's resident block.
 *
 * Each names the clause it suspends, the scope, the date it lapses and who approved it — because an agent reading
 * "you may use redis" without those four facts cannot tell a permission from a rumour, and neither can the person
 * reviewing what the agent did.
 */
export function exceptionLines(
  exceptions: readonly Exception[],
  today: string,
  project?: string,
): readonly string[] {
  const live = exceptions.filter((e) => applies(e, today, project));
  if (!live.length) return [];
  return [
    "**Approved exceptions in force here.** Each suspends the clause it names, for the scope it names, until it",
    "lapses. When one lapses the rule speaks again — nothing else has to happen.",
    "",
    ...live.map((e) => {
      const scope = e.scope.length ? e.scope.join(", ") : "this organization";
      return `> **${e.clause} — EXCEPTION ${e.id}** permits ${e.why || "a documented deviation"} in ${scope} `
        + `until ${e.expires} (approved: ${e.approvedBy}).`;
    }),
  ];
}

/** Exceptions that have lapsed — worth reporting, because the clause they suspended is now in force again. */
export const lapsed = (exceptions: readonly Exception[], today: string): readonly Exception[] =>
  exceptions.filter((e) => Date.parse(e.expires) < Date.parse(today));
