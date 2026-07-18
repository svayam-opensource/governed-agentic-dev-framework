export interface OrgConfig {
    readonly orgName: string;
    readonly orgShortName: string;
    readonly orgSlug: string;
    readonly orgSlugLower: string;
    readonly githubOrg: string;
    readonly workspaceRepo: string;
    /** `org_repo_url` — the gov repo clone URL (used by join). */
    readonly orgRepoUrl: string;
    readonly defaultBranch: string;
    readonly defaultCodeBranch: string;
    /** `agent_work_root`, expanded to an absolute path. */
    readonly agentWorkRoot: string;
    /** `gov_workspace`, expanded to an absolute path. */
    readonly govWorkspace: string;
    readonly policyOwnerEmail: string;
    /** Token → value for tool-file substitution (seed phase B.1). */
    readonly orgTokens: Readonly<Record<string, string>>;
}
/** Parse `org-config.yaml` text into a typed {@link OrgConfig}. Pure. */
export declare function parseOrgConfig(text: string, home?: string): OrgConfig;
