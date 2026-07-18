export function parseArgv(argv) {
    if (argv.length === 0)
        return { error: "no command given (try: gov-work <command>)" };
    const [command, ...rest] = argv;
    const positionals = [];
    const flags = {};
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a.startsWith("--")) {
            const body = a.slice(2);
            const eq = body.indexOf("=");
            if (eq >= 0) {
                flags[body.slice(0, eq)] = body.slice(eq + 1);
            }
            else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) {
                flags[body] = rest[++i];
            }
            else {
                flags[body] = true;
            }
        }
        else {
            positionals.push(a);
        }
    }
    return { command, positionals, flags };
}
/** Read a flag as a string, or undefined if absent / boolean. */
export function flagStr(flags, name) {
    const v = flags[name];
    return typeof v === "string" ? v : undefined;
}
