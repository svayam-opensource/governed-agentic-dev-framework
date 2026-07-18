export interface UpgradeSyncResult {
    readonly code: number;
    readonly lines: readonly string[];
}
export declare function runUpgradeSync(contentDir: string, adopterDir: string, opts: {
    apply: boolean;
}): UpgradeSyncResult;
/** Create a gov-upgrade branch with the full plan applied, push it, open a PR. */
export declare function runUpgradePr(contentDir: string, adopterDir: string, opts?: {
    branch?: string;
}): UpgradeSyncResult;
/** The published framework repo — the default template source. */
export declare const DEFAULT_TEMPLATE = "https://github.com/svayam-opensource/governed-agentic-dev-framework.git";
/**
 * Fetch publish/content from the template remote into a temp dir (sparse, shallow
 * — only publish/content is materialized). Returns the content dir + a cleanup fn.
 * `templateUrl` may be a URL or a local path (for testing).
 */
export declare function fetchTemplateContent(templateUrl: string, ref: string): {
    contentDir: string;
    cleanup: () => void;
};
