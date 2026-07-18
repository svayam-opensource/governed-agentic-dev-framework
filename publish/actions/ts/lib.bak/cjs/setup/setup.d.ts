/**
 * `gov-work setup` (port of setup.sh) — the one-time workspace BOOTSTRAP: gather org
 * identity, generate `org-config.yaml` (the single source of truth), and point
 * `origin` at the org repo. Runs in the cloned framework repo, BEFORE resolution
 * (it's what makes a gov workspace exist). This module is the pure core (render +
 * defaults + URL parse); the interactive prompts + effects live in setup-run.ts.
 */
/** Every field written to org-config.yaml. */
export interface OrgConfigValues {
    readonly orgName: string;
    readonly orgShortName: string;
    readonly orgSlug: string;
    readonly orgSlugLower: string;
    readonly orgRepoUrl: string;
    readonly githubOrg: string;
    readonly workspaceRepo: string;
    readonly defaultBranch: string;
    readonly defaultCodeBranch: string;
    readonly agentWorkRoot: string;
    readonly govWorkspace: string;
    readonly policyOwnerEmail: string;
    readonly policyOwnerGithub: string;
    readonly legalOwnerGithub: string;
    readonly infraOwnerGithub: string;
    readonly systemArchOwnerGithub: string;
    readonly dataArchOwnerGithub: string;
    readonly policyEffectiveDate: string;
}
/** Parse a GitHub remote URL → owner/repo (ssh or https, optional .git). */
export declare function parseOriginOwnerRepo(url: string): {
    owner: string;
    repo: string;
} | null;
/** Context for filling defaults: what we can read from the environment. */
export interface SetupContext {
    readonly originUrl: string;
    readonly ghUser: string | null;
    readonly gitEmail: string | null;
    readonly today: string;
    readonly existing?: Partial<OrgConfigValues>;
}
/**
 * Fill every field from the user's answers + environment, applying setup.sh's
 * defaults (slug_lower derived; github_org/workspace_repo from origin; branch
 * defaults; canonical ~/.<slug>/… paths; owners default to the policy owner).
 */
export declare function deriveOrgConfig(answers: Partial<OrgConfigValues>, ctx: SetupContext): OrgConfigValues;
/** Render org-config.yaml (byte-compatible with setup.sh's template). */
export declare function renderOrgConfig(v: OrgConfigValues): string;
/** Read the scalar fields from an existing org-config.yaml (for re-run defaults). */
export declare function readExistingOrgConfig(text: string): Partial<OrgConfigValues>;
