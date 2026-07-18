export interface MenuContext {
    readonly orgName?: string;
    readonly githubOrg?: string;
    readonly branch?: string;
    readonly user?: string;
    readonly workspaceCount?: number;
    readonly cliVersion?: string;
}
export interface SubCommand {
    readonly cmd: string;
    readonly desc: string;
    readonly argHint?: string;
    readonly subs?: readonly SubCommand[];
}
export type MenuAction = {
    readonly kind: "guided";
    readonly key: "work";
    readonly label: string;
    readonly desc: string;
    readonly hint: string;
} | {
    readonly kind: "submenu";
    readonly key: "status" | "admin";
    readonly label: string;
    readonly desc: string;
    readonly commands: readonly SubCommand[];
} | {
    readonly kind: "help";
    readonly key: "help";
    readonly label: string;
    readonly desc: string;
    readonly hint: string;
};
/** The main-menu actions. */
export declare function mainActions(): MenuAction[];
export declare function formatMainMenu(ctx: MenuContext): string[];
export type TopChoice = {
    readonly kind: "action";
    readonly action: MenuAction;
} | {
    readonly kind: "org";
} | {
    readonly kind: "quit";
} | {
    readonly kind: "unknown";
};
export declare function resolveTopChoice(input: string, _ctx?: MenuContext): TopChoice;
/** The shared prompt/print the guided flows use (from runMenu's readline). */
export interface MenuIo {
    readonly prompt: (q: string) => Promise<string>;
    readonly print: (l: string) => void;
}
/** Handlers the readline loop delegates to (all injected → testable). */
export interface MenuHandlers {
    /** Run a command chosen from a submenu (delegates to the CLI). */
    readonly runCommand: (argv: readonly string[]) => Promise<number> | number;
    /** The guided Work flow (pick project → seed/continue → session-start). */
    readonly runWork: (io: MenuIo) => Promise<number>;
    /** Switch the active org. */
    readonly switchOrg: (org: string) => Promise<number> | number;
    /** Help lines — full reference when no command, else per-command help. */
    readonly help: (command?: string) => readonly string[];
}
export declare function runMenu(ctx: MenuContext, h: MenuHandlers): Promise<number>;
