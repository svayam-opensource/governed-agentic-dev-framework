// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// upgrade.sh / upgrade.ps1 (PRJ-121 F55, Policy Owner ruling A, 2026-11-12): one command brings gov AND the org's
// governance repository to the site's release — this site's own install.sh first (pinned, asks before installing),
// then `gov upgrade` (shown) and, if agreed, `gov upgrade --pr`. Hermetic: a local HTTP server plays the site, its
// install.sh installs a FAKE gov that records how it is called; HOME is a throwaway directory.
import { expect } from "chai";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../../../..");
const UPGRADE_SH = path.join(ROOT, "upgrade.sh");
const UPGRADE_PS1 = path.join(ROOT, "upgrade.ps1");

/** The site's install.sh, as the fake serves it: installs a recording `gov` into ~/.local/bin. */
const fakeInstall = (govUpgradeExit: number) => `#!/usr/bin/env bash
set -eu
echo "install.sh ran GOV_NO_FIX=\${GOV_NO_FIX:-unset}" >> "$HOME/calls.log"
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/gov" <<'GOV'
#!/usr/bin/env bash
echo "gov $*" >> "$HOME/calls.log"
case "$*" in
  "--version") echo "gov 2.0.0-next.3" ;;
  "upgrade") exit ${govUpgradeExit} ;;
  *) exit 0 ;;
esac
GOV
chmod +x "$HOME/.local/bin/gov"
`;

async function withSite<T>(installBody: string, fn: (url: string) => Promise<T>): Promise<T> {
  const server = http.createServer((req, res) => {
    if (req.url === "/install.sh") { res.writeHead(200, { "content-type": "text/plain" }); res.end(installBody); return; }
    res.writeHead(404); res.end("not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  try { return await fn(`http://127.0.0.1:${port}`); } finally { await new Promise<void>((r) => server.close(() => r())); }
}

/** ASYNC on purpose: a synchronous spawn would block the event loop, and the in-process site could never answer. */
function run(siteUrl: string, env: Record<string, string> = {}): Promise<{ code: number | null; out: string; calls: string[] }> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gov-upgrade-home-"));
  return new Promise((resolve) => {
    // detached: a new session with no controlling terminal, so /dev/tty prompts behave as "no terminal".
    const p = spawn("bash", [UPGRADE_SH], {
      stdio: ["ignore", "pipe", "pipe"], detached: true,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, GOV_SITE_URL: siteUrl, ...env },
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => {
      const log = path.join(home, "calls.log");
      resolve({ code, out, calls: fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [] });
    });
  });
}

(process.platform === "win32" ? describe.skip : describe)("upgrade.sh — the client, then the governance repository", function () {
  this.timeout(60_000);

  it("runs the site's own install.sh without the first-run flow, then shows `gov upgrade`, then opens the PR (GOV_YES)", async () => {
    const r = await withSite(fakeInstall(0), (u) => run(u, { GOV_YES: "1" }));
    expect(r.code, r.out).to.equal(0);
    expect(r.calls).to.deep.equal(["install.sh ran GOV_NO_FIX=1", "gov --version", "gov upgrade", "gov upgrade --pr"]);
    expect(r.out).to.include("gov is now gov 2.0.0-next.3").and.include("Review and merge the pull request");
  });

  it("asks before the pull request: no terminal and no GOV_YES → shown, not opened", async () => {
    const r = await withSite(fakeInstall(0), (u) => run(u));
    expect(r.code, r.out).to.equal(0);
    expect(r.calls).to.deep.equal(["install.sh ran GOV_NO_FIX=1", "gov --version", "gov upgrade"]);
    expect(r.out).to.include("No pull request opened").and.include("gov upgrade --pr");
  });

  it("GOV_UPGRADE_NO_PR=1 stops after showing the changes", async () => {
    const r = await withSite(fakeInstall(0), (u) => run(u, { GOV_YES: "1", GOV_UPGRADE_NO_PR: "1" }));
    expect(r.code, r.out).to.equal(0);
    expect(r.calls).to.not.include("gov upgrade --pr");
    expect(r.out).to.include("Stopped before the pull request");
  });

  it("no governance repository from here: the client is still upgraded, exit 0, and it says where to run the rest", async () => {
    const r = await withSite(fakeInstall(1), (u) => run(u, { GOV_YES: "1" }));
    expect(r.code, r.out).to.equal(0);
    expect(r.calls).to.deep.equal(["install.sh ran GOV_NO_FIX=1", "gov --version", "gov upgrade"]);
    expect(r.out).to.include("the client is upgraded").and.include("From your organization's governance repository");
  });

  it("a web page instead of a script → refused, nothing run", async () => {
    const r = await withSite("<!doctype html><p>not found</p>", (u) => run(u, { GOV_YES: "1" }));
    expect(r.code).to.equal(1);
    expect(r.calls).to.deep.equal([]);
    expect(r.out).to.include("is not a script — nothing was changed");
  });

  it("the site unreachable → refused, nothing run", async () => {
    const r = await run("http://127.0.0.1:9", { GOV_YES: "1" });
    expect(r.code).to.equal(1);
    expect(r.calls).to.deep.equal([]);
    expect(r.out).to.include("could not download");
  });

  it("is valid bash, and its site-URL line is the one shape site/build.mjs pins", () => {
    expect(spawnSync("bash", ["-n", UPGRADE_SH]).status).to.equal(0);
    const text = fs.readFileSync(UPGRADE_SH, "utf8");
    expect(text.match(/^GOV_SITE_URL="\$\{GOV_SITE_URL:-[^"]*\}"$/gm)).to.have.length(1);
  });
});

describe("upgrade.ps1 — shape (parsed by PowerShell where it exists)", () => {
  it("its site-URL and self-reference lines are the shapes site/build.mjs pins", () => {
    const text = fs.readFileSync(UPGRADE_PS1, "utf8");
    expect(text.match(/^\$SiteUrl = if \(\$env:GOV_SITE_URL\) \{ \$env:GOV_SITE_URL\.TrimEnd\('\/'\) \} else \{ '[^']*' \}$/gm)).to.have.length(1);
    expect(text.match(/^#\s+irm https:\/\/\S+upgrade\.ps1 \| iex$/gm)).to.have.length(1);
    expect(text).to.include("GOV_NO_FIX").and.include("gov upgrade --pr").and.include("-File $script");
  });

  const ps = ["pwsh", "powershell"].find((c) => spawnSync(c, ["-NoProfile", "-Command", "exit 0"]).status === 0);
  (ps ? it : it.skip)("parses without errors", () => {
    const cmd = `$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('${UPGRADE_PS1.replace(/'/g, "''")}', [ref]$null, [ref]$e) | Out-Null; if ($e.Count) { $e | % { $_.Message }; exit 1 }`;
    const r = spawnSync(ps!, ["-NoProfile", "-Command", cmd], { encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });
});
