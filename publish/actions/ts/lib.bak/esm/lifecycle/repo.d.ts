/** The repo name from a clone URL: last path segment, minus a trailing `.git`. */
export declare function repoNameFromUrl(url: string): string;
/** The shared base-clone dir for a repo: `<agentWorkRoot>/.bases/<repoName>`. */
export declare function baseCloneDir(agentWorkRoot: string, url: string): string;
