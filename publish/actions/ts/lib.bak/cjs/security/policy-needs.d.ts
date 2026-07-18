import type { Need } from "./needs.js";
/** One declared credential requirement (a `credentials:` list item in a policy). */
export interface PolicyCredDecl {
    /** the credential-store key (also the prompt subject). */
    readonly key: string;
    /** one-line human title shown in the NEED/GAP summary. */
    readonly title?: string;
    /** where/how to obtain it — shown when this is a GAP. */
    readonly where?: string;
    /** the env var a consumer materializes the value into (gov-cicd); default = the key. */
    readonly env?: string;
}
/** Parse the `credentials:` list from a policy YAML. Line-oriented, single-line values. Everything
 *  outside the block is ignored; a dedent to a top-level key ends it. */
export declare function parseCredentialDecls(text: string): PolicyCredDecl[];
/** Turn declarations into NEEDs (satisfied ⇔ the key is already in the credential store). */
export declare function policyCredNeeds(decls: readonly PolicyCredDecl[]): Need[];
/** The build + deploy policy files under the governance repo's `knowledge/deployment/`. */
export declare function policyPaths(govHome: string): string[];
/** Read + de-dupe the credential NEEDs declared across the org's build + deploy policies. First
 *  declaration of a key wins (build before deploy). */
export declare function readPolicyCredNeeds(readFile: (p: string) => string | null | undefined, govHome: string): Need[];
