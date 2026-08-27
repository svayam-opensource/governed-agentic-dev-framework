// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov doctor --fix` (#186) — turn the doctor's report into an ordered list of
 * commands that actually resolve it, instead of hints the reader must translate.
 *
 * WHY. Reporting a missing prerequisite and then leaving the reader to work out
 * the command is where three real adopters stalled: `deps` printed
 * `apt-get install -y git  (or: dnf install git)` on a machine with neither apt
 * nor dnf, and the GitHub CLI hint was a URL. The knowledge needed to act was one
 * `command -v` away from the tool that was reporting the problem.
 *
 * SCOPE — deliberately narrow. This fixes what a package manager can fix (`git`,
 * `gh`) and what a login command can fix (`gh auth`). It does NOT install Node:
 * `gov` runs on Node, so by the time this code executes Node is already correct.
 * The Node problem belongs to the bootstrap installer (`install.sh`), which needs
 * no Node to run. Neither half can do the other's job.
 *
 * PURE. Detection and planning are pure over injected facts; main() executes the
 * plan and does the asking. Everything here is therefore testable without a shell.
 */

/**
 * The token scopes gov actually needs, and why each one is on the list.
 *
 * `gh auth login` advertises "repo, read:org, admin:public_key" — gh's own minimum,
 * which knows nothing about what gov does with the token. The gap is not academic:
 * a GitHub Project board IS the project under this model (POL-044), and Projects
 * are behind their own `project` scope. A token that satisfies gh sails through the
 * sign-in and then fails at `gov seed`, several steps and some minutes later, on a
 * permission nobody mentioned.
 */
export const REQUIRED_SCOPES: readonly { readonly scope: string; readonly why: string }[] = [
  { scope: "repo", why: "read and write the governance repo, its issues and its pull requests" },
  { scope: "read:org", why: "see which organizations you belong to" },
  { scope: "project", why: "read and write Project boards — a board IS a project here, so gov seed needs this" },
];

/** Wanted, but gov works without it — so it is reported, never demanded. */
export const RECOMMENDED_SCOPES: readonly { readonly scope: string; readonly why: string }[] = [
  { scope: "workflow", why: "push changes that touch .github/workflows — GitHub rejects those without it" },
];

/**
 * Pull the granted scopes out of `gh auth status` output. Returns null when the
 * line is absent, which means "could not tell" — reported as unknown rather than
 * as missing, because a false alarm about permissions sends people to their
 * administrator for nothing.
 */
export function parseGrantedScopes(ghAuthStatus: string): readonly string[] | null {
  const m = /Token scopes:\s*(.+)/.exec(ghAuthStatus);
  if (!m?.[1]) return null;
  return m[1].split(",").map((x) => x.trim().replace(/^'|'$/g, "")).filter(Boolean);
}

/** Which required scopes are absent. `repo` implies its children, e.g. `public_repo`. */
export function missingScopes(granted: readonly string[]): readonly { readonly scope: string; readonly why: string }[] {
  return REQUIRED_SCOPES.filter((r) => !granted.includes(r.scope));
}

/** The system package managers we know how to drive. */
export type PackageManager = "brew" | "apt" | "dnf" | "yum" | "apk" | "pacman" | "zypper" | "winget";

/** One remediation: what it fixes, the exact command, and how it must be run. */
export interface FixStep {
  /** The diagnostic this step clears — matches the doctor's row name. */
  readonly fixes: string;
  /** One line a non-specialist can read before consenting. */
  readonly what: string;
  /**
   * What is missing and what it is FOR, in the reader's terms — not the command's.
   * Consent to "sudo dnf install -y gh" is not informed consent; consent to "you do
   * not have gh, and gov needs it to sign you in to GitHub" is.
   */
  readonly why: string;
  readonly command: readonly string[];
  /** True when the command needs elevation. We never add `sudo` ourselves — see planFixes. */
  readonly sudo: boolean;
  /** True when the command talks to the user (a browser login) and must inherit the terminal. */
  readonly interactive: boolean;
  /**
   * The `fixes` key of a step that must succeed first. A dependent step is skipped
   * when its prerequisite fails — otherwise `gh auth login` runs after the `gh`
   * install failed and reports `ENOENT`, which reads as a second, unrelated fault.
   */
  readonly dependsOn?: string;
}

export interface FixPlan {
  readonly steps: readonly FixStep[];
  /** Things that are wrong but that no command here can fix, each with what to do instead. */
  readonly manual: readonly string[];
}

/** What the planner needs to know about the machine. */
export interface EnvFacts {
  readonly gitPresent: boolean;
  readonly ghPresent: boolean;
  readonly ghAuthenticated: boolean;
  readonly platform: string;
  /**
   * The distribution id from /etc/os-release (`fedora`, `rocky`, `rhel`, `ubuntu`,
   * …), lowercased, or null off Linux. The package manager alone is not enough to
   * decide anything: Fedora and Rocky both use `dnf`, but Fedora ships the GitHub
   * CLI in its own repositories and Rocky does not.
   */
  readonly osId?: string | null;
  /**
   * Scopes on the current gh token, or null when `gh` is absent or the status
   * could not be read. Null is "unknown", not "none".
   */
  readonly ghScopes?: readonly string[] | null;
}

/** Distributions that carry `gh` in their own repositories — no extra source needed. */
const SHIPS_GH: ReadonlySet<string> = new Set(["fedora", "arch", "alpine", "opensuse", "opensuse-tumbleweed", "opensuse-leap", "debian", "ubuntu"]);

/** Order matters: the first package manager found wins, and `brew` wins on macOS. */
const PROBE_ORDER: readonly PackageManager[] = ["brew", "apt", "dnf", "yum", "zypper", "pacman", "apk", "winget"];

/** The binary to probe for each manager (apt is driven through `apt-get`). */
const PROBE_BIN: Readonly<Record<PackageManager, string>> = {
  brew: "brew", apt: "apt-get", dnf: "dnf", yum: "yum",
  apk: "apk", pacman: "pacman", zypper: "zypper", winget: "winget",
};

export function detectPackageManager(hasTool: (name: string) => boolean): PackageManager | null {
  return PROBE_ORDER.find((pm) => hasTool(PROBE_BIN[pm])) ?? null;
}

/** Install arguments per manager, keyed by the tool being installed. */
const INSTALL: Readonly<Record<PackageManager, Readonly<Record<"git" | "gh", readonly string[]>>>> = {
  brew:   { git: ["brew", "install", "git"],                        gh: ["brew", "install", "gh"] },
  apt:    { git: ["apt-get", "install", "-y", "git"],               gh: ["apt-get", "install", "-y", "gh"] },
  dnf:    { git: ["dnf", "install", "-y", "git"],                   gh: ["dnf", "install", "-y", "gh"] },
  yum:    { git: ["yum", "install", "-y", "git"],                   gh: ["yum", "install", "-y", "gh"] },
  apk:    { git: ["apk", "add", "git"],                             gh: ["apk", "add", "github-cli"] },
  pacman: { git: ["pacman", "-S", "--noconfirm", "git"],            gh: ["pacman", "-S", "--noconfirm", "github-cli"] },
  zypper: { git: ["zypper", "install", "-y", "git"],                gh: ["zypper", "install", "-y", "gh"] },
  winget: { git: ["winget", "install", "--id", "Git.Git", "-e"],    gh: ["winget", "install", "--id", "GitHub.cli", "-e"] },
};

/** GitHub's own RPM repository — the RHEL-family equivalent of the apt note below. */
const GH_RPM_REPO = "https://cli.github.com/packages/rpm/gh-cli.repo";

/** Managers that write outside the user's home and therefore need elevation. */
const NEEDS_SUDO: ReadonlySet<PackageManager> = new Set<PackageManager>(["apt", "dnf", "yum", "apk", "pacman", "zypper"]);

/**
 * Build the ordered plan. Order is not cosmetic: `gh` must exist before
 * `gh auth login` can run, so an unauthenticated-and-missing `gh` yields two
 * steps in that sequence.
 */
export function planFixes(facts: EnvFacts, pm: PackageManager | null): FixPlan {
  const steps: FixStep[] = [];
  const manual: string[] = [];

  const wantInstall = (tool: "git" | "gh", label: string): void => {
    if (!pm) {
      manual.push(
        `${label} is missing and no package manager was found on this machine. ` +
        `Install it by hand: ${tool === "git" ? "https://git-scm.com/downloads" : "https://cli.github.com"}`,
      );
      return;
    }
    // RHEL, Rocky and Alma do not carry `gh` in their own repositories — `dnf
    // install gh` answers "No match for argument: gh", which reads as a broken
    // machine rather than a missing source. Fedora DOES carry it, and adding the
    // extra source there is both pointless and a real change to someone's system.
    //
    // The repository is installed by DROPPING THE FILE, not via `config-manager`:
    // that command is a plugin (absent from minimal images) and dnf5 renamed its
    // syntax, so the plugin route needs two extra steps and still breaks on
    // Fedora 41+. `curl -o` needs neither a plugin nor a shell redirect and behaves
    // identically on dnf4, dnf5 and yum.
    const needsGhRepo = tool === "gh" && (pm === "dnf" || pm === "yum") && !SHIPS_GH.has(facts.osId ?? "");
    if (needsGhRepo) {
      steps.push({
        fixes: "gh repo",
        what: "Add GitHub's package repository (this system does not ship the GitHub CLI)",
        why: "This system's own software sources do not carry `gh`, so GitHub's has to be added before it can be installed.",
        command: ["curl", "-fsSL", GH_RPM_REPO, "-o", "/etc/yum.repos.d/gh-cli.repo"],
        sudo: true,
        interactive: false,
      });
    }
    steps.push({
      fixes: tool,
      what: `Install ${label} using ${pm}`,
      why: tool === "git"
        ? "You do not have `git` installed. It is required — it is how repositories are cloned, pulled and pushed."
        : "You do not have `gh` (the GitHub CLI) installed. It is required — it is how gov signs you in to GitHub and acts on your behalf.",
      command: INSTALL[pm][tool],
      sudo: NEEDS_SUDO.has(pm),
      interactive: false,
      ...(needsGhRepo ? { dependsOn: "gh repo" } : {}),
    });
  };

  if (!facts.gitPresent) wantInstall("git", "Git");
  if (!facts.ghPresent) wantInstall("gh", "the GitHub CLI");

  // Authentication is a separate failure from absence, and the commoner one: the
  // tool installs fine and the person forgets to sign in. Plan the login whenever
  // it is not confirmed — including right after an install, when it cannot be.
  if (!facts.ghAuthenticated) {
    steps.push({
      fixes: "gh auth",
      what: "Sign in to GitHub (opens your browser)",
      why: "You are not signed in to GitHub. Governance work happens on GitHub, so gov needs your authorization to act as you.",
      command: ["gh", "auth", "login"],
      sudo: false,
      interactive: true,
      ...(facts.ghPresent ? {} : { dependsOn: "gh" }),
    });
  }

  // A signed-in token with too few scopes is its own state: `gh auth status` says
  // "Logged in", every gov command that touches a board fails, and nothing connects
  // the two. `gh auth refresh` adds scopes to the existing login — it does not sign
  // you out — but it opens a browser, so it is an interactive step like the login.
  if (facts.ghAuthenticated && facts.ghScopes) {
    const missing = missingScopes(facts.ghScopes);
    if (missing.length) {
      steps.push({
        fixes: "gh scopes",
        what: `Grant gov the GitHub permissions it needs (${missing.map((m) => m.scope).join(", ")})`,
        why: `You are signed in, but the sign-in did not grant everything gov needs: ${missing.map((m) => `\`${m.scope}\` (${m.why})`).join("; ")}.`,
        command: ["gh", "auth", "refresh", "-s", missing.map((m) => m.scope).join(",")],
        sudo: false,
        interactive: true,
      });
    }
  }

  // Debian and Ubuntu older than 24.04 do not carry `gh` in their own archives.
  // Say so up front rather than letting `apt-get install gh` fail with "no
  // installation candidate" — an error that reads as a broken machine.
  if (!facts.ghPresent && pm === "apt") {
    manual.push(
      "If apt reports no installation candidate for `gh`, your distribution predates it in the archive. " +
      "Add GitHub's repository first: https://github.com/cli/cli/blob/trunk/docs/install_linux.md",
    );
  }

  return { steps, manual };
}

/** Render a step the way it must be typed, so consent is informed. */
export function renderCommand(step: FixStep): string {
  return `${step.sudo ? "sudo " : ""}${step.command.join(" ")}`;
}

/**
 * The consent screen: what is missing, in the reader's terms, before a single
 * command is named.
 *
 * The first version led with the commands — "These commands will fix what is
 * missing:" followed by four `sudo` lines. A reader who does not already know what
 * `gh` is cannot consent to installing it; they can only agree or give up. State
 * the gap and its purpose first; the commands are the appendix, not the argument.
 */
export function formatPlanNarrative(plan: FixPlan): string[] {
  if (!plan.steps.length && !plan.manual.length) return [];
  const lines: string[] = [];
  if (plan.steps.length) {
    lines.push("gov has checked this machine and found the following missing:");
    lines.push("");
    plan.steps.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s.why}`);
    });
    lines.push("");
    lines.push("To put that right, gov will run:");
    lines.push("");
    plan.steps.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${renderCommand(s)}`);
    });
  }
  if (plan.manual.length) {
    lines.push("");
    lines.push("Needs your attention (no command can do these for you):");
    for (const m of plan.manual) lines.push(`  · ${m}`);
  }
  return lines;
}

export function formatPlan(plan: FixPlan): string[] {
  if (!plan.steps.length && !plan.manual.length) return ["doctor --fix: nothing to fix"];
  const lines: string[] = [];
  if (plan.steps.length) {
    lines.push("These commands will fix what is missing:");
    plan.steps.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s.what}`);
      lines.push(`     ${renderCommand(s)}`);
    });
  }
  if (plan.manual.length) {
    lines.push("");
    lines.push("Needs your attention (no command can do these for you):");
    for (const m of plan.manual) lines.push(`  · ${m}`);
  }
  return lines;
}
