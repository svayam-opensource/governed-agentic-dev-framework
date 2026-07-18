/**
 * Minimal argv parsing for the `prj` dispatcher — `prj <command> [positionals]
 * [--flag[=value]]`. A `--flag value` form is supported (consume-next) unless the
 * next token is itself a flag, in which case `--flag` is a boolean.
 */
export interface ParsedArgs {
    readonly command: string;
    readonly positionals: readonly string[];
    readonly flags: Readonly<Record<string, string | boolean>>;
}
export declare function parseArgv(argv: readonly string[]): ParsedArgs | {
    error: string;
};
/** Read a flag as a string, or undefined if absent / boolean. */
export declare function flagStr(flags: Readonly<Record<string, string | boolean>>, name: string): string | undefined;
