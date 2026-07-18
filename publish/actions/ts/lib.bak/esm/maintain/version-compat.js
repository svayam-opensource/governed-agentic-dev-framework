function parse(v) {
    const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function cmp(a, b) {
    for (let i = 0; i < 3; i++)
        if (a[i] !== b[i])
            return a[i] < b[i] ? -1 : 1;
    return 0;
}
export function checkVersionCompat(cliVersion, contentVersion) {
    if (!contentVersion)
        return { status: "no-marker", ok: true, message: "no content VERSION marker — run `gov-work upgrade` to install one" };
    const cli = parse(cliVersion);
    const content = parse(contentVersion);
    const c = cmp(cli, content);
    if (c === 0)
        return { status: "ok", ok: true, message: `CLI ${cliVersion} == content ${contentVersion}` };
    if (c > 0)
        return { status: "content-behind", ok: true, message: `content ${contentVersion} is behind the CLI ${cliVersion} — run \`gov-work upgrade\` to sync the workspace` };
    if (cli[0] < content[0]) {
        return { status: "cli-behind-major", ok: false, message: `gov-work CLI ${cliVersion} is a MAJOR version behind this workspace's content ${contentVersion} — it may not understand the layout. Upgrade the CLI:\n  npm i -g @svayam-opensource/gov-work@${contentVersion}` };
    }
    return { status: "cli-behind", ok: true, message: `gov-work CLI ${cliVersion} is behind the content ${contentVersion} — consider \`npm i -g @svayam-opensource/gov-work@${contentVersion}\`` };
}
