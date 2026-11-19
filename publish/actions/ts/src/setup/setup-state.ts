// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE SET-UP BREADCRUMB — `~/.gov/setup-state.json` (#391, Policy Owner ruling 2026-11-19).
 *
 * A new customer's "My Gov Journey" on gov web could never tick its second step, because nothing on the machine
 * ever told gov web that gov was set up. The ruling: gov web's Install page hands the person a ONE-TIME SET-UP CODE
 * (`GOV_SETUP_CODE`, with `GOV_SETUP_ISSUER` naming the IAM that minted it); the installer passes both to gov; gov
 * keeps a breadcrumb of the set-up steps and, once the client is installed, the governance repository is in place
 * and the machine environment is ready, sends the code to `POST <issuer>/ident/gov-setup/redeem` — once.
 *
 * ```mermaid
 * stateDiagram-v2
 *   [*] --> captured: GOV_SETUP_CODE in env (installer or any gov run)
 *   captured --> waiting: a required step is pending
 *   waiting --> captured: re-run gov — steps re-detected
 *   captured --> sent: client-installed + governance-repo + machine-env done
 *   sent --> [*]: {ok:true} — code removed, setup-signal done
 *   sent --> captured: refusal / network — code kept, one line says what to do
 *   captured --> [*]: issuer not https://*.svayamtech.com — dropped, never sent
 * ```
 *
 * THE FILE REFLECTS THE MACHINE, IT DOES NOT REPLACE IT. doctor's checklist warns that a progress file two processes
 * write will disagree, and a stale tick is worse than none. So every step but `setup-signal` is RE-DETECTED from the
 * machine whenever the file is brought up to date ({@link reconcile}): the file records when each fact became true,
 * and never claims one the machine no longer shows. `setup-signal` alone is remembered, because only gov web knows it.
 *
 * Everything here is PURE — no fs, no clock, no network: the caller injects them (setup-progress.ts holds the I/O).
 */

/** The steps, in the order a first run walks them. Re-running resumes at the first one still pending. */
export const SETUP_STEPS = ["client-installed", "prerequisites", "governance-repo", "machine-env", "setup-signal"] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

/** The ruling's (a), (b) and (d): all three done before the code is sent. `prerequisites` is folded into (d). */
export const REDEEM_REQUIRES: readonly SetupStepId[] = ["client-installed", "governance-repo", "machine-env"];

/** What each step means, for `gov doctor` and the resume line. Plain words; a step id is not a sentence. */
export const STEP_LABEL: Record<SetupStepId, string> = {
  "client-installed": "gov installed",
  "prerequisites": "git and gh installed",
  "governance-repo": "governance repository in place (created on adopt, cloned on join)",
  "machine-env": "workspace folders and environment ready",
  "setup-signal": "gov web told set-up is complete",
};

/**
 * WHERE A SET-UP CODE MAY BE SENT: `https://*.svayamtech.com` and nowhere else.
 *
 * The code arrives through the environment, which anything upstream of the installer can set. Sending it to
 * whatever host the environment names would let a tampered install command collect codes — and the request carries
 * the person's set-up trail. A domain SUFFIX matched on a label boundary (`.svayamtech.com`), so
 * `evilsvayamtech.com` and `svayamtech.com.example` are refused.
 */
export const SETUP_ISSUER_ALLOWED_DOMAINS: readonly string[] = ["svayamtech.com"];

export interface SetupStep {
  readonly id: SetupStepId;
  readonly status: "done" | "pending";
  /** ISO time the step reached this status. */
  readonly at: string;
}

export interface SetupState {
  readonly version: 1;
  readonly steps: readonly SetupStep[];
  /** The one-time code and its issuer — present ONLY until redeemed (or found unsendable). Never printed. */
  readonly setupCode?: { readonly code: string; readonly issuer: string; readonly receivedAt: string };
  /**
   * SHA-256 of the code last redeemed. Re-running the same install command (its env still carries the used code)
   * must not re-capture it and earn a "code refused" line on a set-up that already succeeded. A hash of a spent,
   * single-use code identifies nothing.
   */
  readonly redeemedCodeSha256?: string;
}

export const emptySetupState = (): SetupState => ({ version: 1, steps: [] });

const isStepId = (s: unknown): s is SetupStepId => typeof s === "string" && (SETUP_STEPS as readonly string[]).includes(s);

/** Read the file's text. Anything unreadable is an empty trail — the machine is re-detected anyway. */
export function parseSetupState(text: string | null): SetupState {
  if (!text) return emptySetupState();
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const steps: SetupStep[] = [];
    for (const s of Array.isArray(raw.steps) ? raw.steps : []) {
      const o = s as Record<string, unknown>;
      if (!isStepId(o.id) || (o.status !== "done" && o.status !== "pending") || typeof o.at !== "string") continue;
      if (steps.some((x) => x.id === o.id)) continue;
      steps.push({ id: o.id, status: o.status, at: o.at });
    }
    const sc = raw.setupCode as Record<string, unknown> | undefined;
    const setupCode = sc && typeof sc.code === "string" && sc.code && typeof sc.issuer === "string"
      ? { code: sc.code, issuer: sc.issuer, receivedAt: typeof sc.receivedAt === "string" ? sc.receivedAt : "" }
      : undefined;
    const redeemed = typeof raw.redeemedCodeSha256 === "string" ? raw.redeemedCodeSha256 : undefined;
    return { version: 1, steps: orderSteps(steps), ...(setupCode ? { setupCode } : {}), ...(redeemed ? { redeemedCodeSha256: redeemed } : {}) };
  } catch {
    return emptySetupState();   // a corrupt file is an empty trail: every step but the signal is re-detected
  }
}

export function serializeSetupState(s: SetupState): string {
  return `${JSON.stringify(s, null, 2)}\n`;
}

const orderSteps = (steps: readonly SetupStep[]): SetupStep[] =>
  SETUP_STEPS.flatMap((id) => steps.filter((s) => s.id === id));

/** One step's status, or undefined when the trail has never recorded it. */
export const stepStatus = (s: SetupState, id: SetupStepId): SetupStep["status"] | undefined => s.steps.find((x) => x.id === id)?.status;

/** Set one step. The time moves only when the status does — `at` says when it became true, not when it was last seen. */
export function markStep(s: SetupState, id: SetupStepId, status: SetupStep["status"], now: string): SetupState {
  const cur = s.steps.find((x) => x.id === id);
  if (cur && cur.status === status) return s;
  return { ...s, steps: orderSteps([...s.steps.filter((x) => x.id !== id), { id, status, at: now }]) };
}

/**
 * Bring the trail up to what the machine shows. `probe` holds the steps the caller could DETECT; a step it did not
 * probe keeps whatever the file says. `setup-signal` is never probed: it is gov web's fact, recorded on redeem.
 */
export function reconcile(s: SetupState, probe: Partial<Record<Exclude<SetupStepId, "setup-signal">, boolean>>, now: string): SetupState {
  let out = s;
  for (const id of SETUP_STEPS) {
    if (id === "setup-signal") continue;
    const v = probe[id];
    if (v !== undefined) out = markStep(out, id, v ? "done" : "pending", now);
  }
  return out;
}

/** The first step still to do, in walking order — what a re-run resumes at. null when every recorded step is done. */
export function firstPending(s: SetupState): SetupStepId | null {
  for (const id of SETUP_STEPS) {
    const st = stepStatus(s, id);
    if (st === "pending" || (st === undefined && id !== "setup-signal")) return id;
  }
  return null;
}

/** Is the trail complete enough to stop probing the machine on every run? Every step done, and no code waiting. */
export function settled(s: SetupState): boolean {
  return !s.setupCode && SETUP_STEPS.filter((id) => id !== "setup-signal").every((id) => stepStatus(s, id) === "done");
}

/**
 * Take a set-up code from the environment. A new code replaces an older one (the person fetched another from the
 * Install page); the code already redeemed is ignored. `sha256` is injected so this stays pure.
 */
export function captureSetupCode(
  s: SetupState,
  env: Readonly<Record<string, string | undefined>>,
  now: string,
  sha256: (text: string) => string,
): SetupState {
  const code = (env.GOV_SETUP_CODE ?? "").trim();
  if (!code) return s;
  const issuer = (env.GOV_SETUP_ISSUER ?? "").trim();
  if (s.redeemedCodeSha256 && s.redeemedCodeSha256 === sha256(code)) return s;
  if (s.setupCode && s.setupCode.code === code && s.setupCode.issuer === issuer) return s;
  return markStep({ ...s, setupCode: { code, issuer, receivedAt: now } }, "setup-signal", "pending", now);
}

/** Is this issuer one a set-up code may be sent to? https, no credentials in the URL, a host under an allowed domain. */
export function issuerAllowed(issuer: string, allowed: readonly string[] = SETUP_ISSUER_ALLOWED_DOMAINS): boolean {
  let u: URL;
  try { u = new URL(issuer); } catch { return false; /* not a URL is not an allowed issuer */ }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  return allowed.some((d) => host.endsWith(`.${d.toLowerCase()}`));
}

/**
 * The redeem endpoint for an issuer, as IAM built it (911#424): `<issuer>/ident/gov-setup/redeem`. The issuer is the
 * IAM base URL with no trailing slash (`https://security-dev.svayamtech.com`); one is tolerated, and its path is kept.
 */
export function redeemUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/ident/gov-setup/redeem`;
}

/** IAM accepts `client_version` as printable ASCII, at most 64 characters: anything else is dropped, never sent. */
export function clientVersionField(v: string): string | undefined {
  const t = v.trim();
  return t && t.length <= 64 && /^[\x20-\x7e]+$/.test(t) ? t : undefined;
}

/** The fetch this module needs — the global one fits; a test passes a stub. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export type RedeemOutcome = "not-ready" | "no-code" | "not-allowed" | "redeemed" | "refused" | "rate-limited" | "unreachable";

export interface RedeemResult {
  readonly state: SetupState;
  readonly outcome: RedeemOutcome;
  /** The ONE line to show the person, when there is one. Never contains the code. */
  readonly line: string | null;
}

export const REDEEM_LINES = {
  redeemed: "Your gov web set-up step is complete.",
  refused: "gov web did not accept your set-up code (it may have expired or been used) — get a new code on the Install page and re-run `gov`.",
  tooMany: "gov web has had too many set-up attempts from this network — wait a few minutes and re-run `gov`.",
  unreachable: "Could not reach gov web to finish your set-up step — re-run `gov` later; if the code has expired, get a new one on the Install page.",
  notAllowed: "Your set-up code names an issuer that is not a Svayam address (https://*.svayamtech.com), so gov did not send it — get a new code on the Install page and re-run the install command.",
} as const;

/**
 * Send the code, when — and only when — the trail says (a), (b) and (d) are done. NEVER THROWS and never fails the
 * run: every outcome is a state and at most one line. Re-sending is harmless (the endpoint is idempotent per code).
 */
export async function redeemSetupCode(
  s: SetupState,
  deps: { readonly fetch: FetchLike; readonly clientVersion: string; readonly now: string; readonly sha256: (t: string) => string; readonly timeoutMs?: number },
): Promise<RedeemResult> {
  const sc = s.setupCode;
  if (!sc) return { state: s, outcome: "no-code", line: null };
  if (!REDEEM_REQUIRES.every((id) => stepStatus(s, id) === "done")) return { state: s, outcome: "not-ready", line: null };
  if (!issuerAllowed(sc.issuer)) {
    // Never sendable, so not kept: holding it would repeat this line on every run with nothing the person can fix
    // except fetching a new code — which is exactly what the line tells them.
    const { setupCode: _dropped, ...rest } = s;
    return { state: markStep(rest, "setup-signal", "pending", deps.now), outcome: "not-allowed", line: REDEEM_LINES.notAllowed };
  }
  const steps = s.steps.filter((x) => x.id !== "setup-signal").map(({ id, status, at }) => ({ id, status, at }));
  try {
    const res = await deps.fetch(redeemUrl(sc.issuer), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      // IAM's contract (911#424): only `code` is required; `steps` is kept when ≤ 8 KB (five entries are well under);
      // `client_version` must be printable ASCII ≤ 64 chars, so a version that is not is left out rather than refused.
      body: JSON.stringify({ code: sc.code, steps, ...(clientVersionField(deps.clientVersion) ? { client_version: clientVersionField(deps.clientVersion) } : {}) }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* a refusal need not be JSON */ }
    if (res.ok && (body as { ok?: unknown } | null)?.ok === true) {
      const { setupCode: _spent, ...rest } = s;
      return {
        state: markStep({ ...rest, redeemedCodeSha256: deps.sha256(sc.code) }, "setup-signal", "done", deps.now),
        outcome: "redeemed",
        line: REDEEM_LINES.redeemed,
      };
    }
    // 429 {error:{kind:"too_many_attempts"}}: the code may be fine — wait and re-run. A 5xx is the service, not the
    // code: try later. Every other answer (IAM sends 400 {error:{kind:"invalid_code"}} for a bad, used, superseded or
    // expired code) means this code will never work: get a new one.
    if (res.status === 429) return { state: s, outcome: "rate-limited", line: REDEEM_LINES.tooMany };
    if (res.status >= 500) return { state: s, outcome: "unreachable", line: REDEEM_LINES.unreachable };
    return { state: s, outcome: "refused", line: REDEEM_LINES.refused };
  } catch {
    // Offline, DNS, TLS or the timeout: the code is kept and the one line says what to do. Never fails the run.
    return { state: s, outcome: "unreachable", line: REDEEM_LINES.unreachable };
  }
}

/** The trail as `gov doctor` shows it: one row, a warning while anything is pending. Never the code. */
export function setupTrailDiagnostic(s: SetupState): { readonly name: string; readonly status: "ok" | "warn"; readonly detail: string } | null {
  if (s.steps.length === 0 && !s.setupCode) return null;
  const parts = SETUP_STEPS
    .filter((id) => id !== "setup-signal" || stepStatus(s, id) !== undefined)
    .map((id) => `${id} ${stepStatus(s, id) === "done" ? "done" : "pending"}`);
  const signal = s.setupCode
    ? REDEEM_REQUIRES.every((id) => stepStatus(s, id) === "done")
      ? "a set-up signal for gov web is pending — run `gov` to send it"
      : "a set-up signal for gov web is pending — it is sent once the steps above are done"
    : stepStatus(s, "setup-signal") === "done" ? "gov web has been told" : null;
  const pending = firstPending(s);
  return {
    name: "set-up",
    status: pending === null && !s.setupCode ? "ok" : "warn",
    detail: [parts.join(" · "), ...(signal ? [signal] : [])].join("; "),
  };
}

/**
 * The line a re-run prints when it picks up an unfinished set-up: what is already done, and where it resumes. Only
 * when an EARLIER run left a trail with something done — a first run has nothing to resume, and a finished one
 * nothing to say.
 */
export function resumeLine(previous: SetupState): string | null {
  const next = firstPending(previous);
  if (next === null || next === "setup-signal" || next === "client-installed") return null;
  const done = SETUP_STEPS.filter((id) => stepStatus(previous, id) === "done");
  if (done.length === 0) return null;
  return `Resuming set-up — already done: ${done.map((id) => STEP_LABEL[id]).join(", ")}. Next: ${STEP_LABEL[next]}.`;
}
