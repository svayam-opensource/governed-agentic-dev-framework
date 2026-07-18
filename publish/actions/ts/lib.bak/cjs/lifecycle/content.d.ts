/**
 * Pure content generators for seed (SDD Part B, phase B.1) — the *authored
 * content* scaffold: agent.md (the project entrypoint), todo.md, and tool-file
 * token substitution. Replaces the bash heredocs + `perl` pass with typed Node.
 *
 * NOTE (SDD-012, model A): there is **no `project.yaml`** — GitHub is the sole
 * source of truth (board + anchor issue + linked items). We only generate
 * repo-committed *content*, never machine state.
 */
/** Inputs for the project agent.md entrypoint. */
export interface AgentMdParams {
    readonly title: string;
    readonly projectId: string;
    readonly branch: string;
    readonly projectWorkRoot: string;
    readonly workspaceRepo: string;
    readonly agentWorkRoot: string;
    readonly githubProjectUrl: string;
    readonly defaultBranch: string;
    /** Linked code repos: {name, url}. */
    readonly repos: ReadonlyArray<{
        name: string;
        url: string;
    }>;
}
/** Render the project-specific agent.md entrypoint (faithful to seed.sh). */
export declare function renderAgentMd(p: AgentMdParams): string;
/** Substitute a todo.md template's `PRJ-NNN-<slug>` header placeholder. */
export declare function renderTodoMd(template: string, projectId: string): string;
/**
 * Substitute `<TOKEN>` placeholders in a tool file's text (replaces the bash
 * `perl` pass). Each key maps a token name to its value; e.g. `{ ORG_NAME: "Svayam" }`
 * replaces every `<ORG_NAME>`. Longer token names are applied first so a token
 * that is a prefix of another can't partially match.
 */
export declare function substituteTokens(text: string, tokens: Readonly<Record<string, string>>): string;
