// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * THE OS KEYCHAIN (spec 02 §3.3, §5; plan 02 E05) — where a person's gov personal key, and the paid module's local
 * writer key, are kept. It implements the check seam's {@link KeychainPort}.
 *
 *   macOS     `security` (login keychain), service `gov`
 *   Linux     `secret-tool` (Secret Service: GNOME Keyring, KWallet), attributes service=gov account=<name>
 *   Windows   Credential Manager, generic credential `gov:<name>`, through PowerShell and advapi32 Cred*
 *   fallback  the environment: GOV_LICENCE_KEY, for the licence key only (CI, a headless box)
 *
 * NEVER A FILE. A machine with no store refuses to write, and says how to use the environment instead.
 *
 * THE SECRET GOES ON STDIN, NEVER ON ARGV. A process's arguments are visible to every user (`ps`), and gov's process
 * runner logs them; stdin is neither. macOS `security` takes no secret on stdin for `add-generic-password`, so the
 * command is sent through its interactive mode (`security -i`), which reads the command line from stdin.
 */
import type { KeychainPort } from "../check-seam/public.js";
import { runCapture } from "../run-process.js";

/** The keychain account of the person's gov personal key (the account gov-check reads, through the host). */
export const LICENCE_ACCOUNT = "gov-licence/personal-key";
/** The environment variable that stands in for the keychain (licence key only). */
export const LICENCE_KEY_ENV = "GOV_LICENCE_KEY";
export const KEYCHAIN_SERVICE = "gov";

/** Runs an OS tool. `input` goes to its stdin. `notFound` = the tool is not installed. */
export type KeychainRun = (cmd: string, args: readonly string[], input?: string) => { status: number | null; stdout: string; stderr: string; notFound: boolean };

/** {@link KeychainPort} plus where a secret came from (for `gov licence status`). */
export interface OsKeychain extends KeychainPort {
  lookup(account: string): Promise<{ secret: string; from: "keychain" | "env" } | null>;
}

/** `gov-licence/personal-key`, `gov-check/writer-key`: lower-case words, `-` and `/`. */
const ACCOUNT = /^[a-z0-9][a-z0-9/-]{0,63}$/;
/** What a stored secret may hold: base64url, JWS dots, PEM-free key text. Nothing that could end a quoted argument. */
const SAFE_SECRET = /^[A-Za-z0-9._~+/=-]{1,16384}$/;

const PS_PREAMBLE = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class GovCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWrite(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredDelete(string target, int type, int flags);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
}
"@
`;

const PS_ACTION = {
  get: `# action: get
$p = [IntPtr]::Zero
if (-not [GovCred]::CredRead($target, 1, 0, [ref]$p)) { exit 2 }
$c = [Runtime.InteropServices.Marshal]::PtrToStructure($p, [type][GovCred+CREDENTIAL])
$s = [Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob, $c.CredentialBlobSize / 2)
[GovCred]::CredFree($p)
[Console]::Out.Write($s)`,
  set: `# action: set
$s = [Console]::In.ReadToEnd()
$b = [Text.Encoding]::Unicode.GetBytes($s)
$c = New-Object GovCred+CREDENTIAL
$c.Type = 1; $c.TargetName = $target; $c.UserName = 'gov'; $c.Persist = 2
$c.CredentialBlobSize = $b.Length
$c.CredentialBlob = [Runtime.InteropServices.Marshal]::AllocHGlobal($b.Length)
[Runtime.InteropServices.Marshal]::Copy($b, 0, $c.CredentialBlob, $b.Length)
$ok = [GovCred]::CredWrite([ref]$c, 0)
[Runtime.InteropServices.Marshal]::FreeHGlobal($c.CredentialBlob)
if (-not $ok) { exit 1 }`,
  delete: `# action: delete
[void][GovCred]::CredDelete($target, 1, 0)`,
} as const;

/** The PowerShell for one action on `gov:<account>`, as -EncodedCommand (UTF-16LE base64: no quoting to get wrong). */
function psCommand(action: keyof typeof PS_ACTION, account: string): string[] {
  const script = `${PS_PREAMBLE}$target = 'gov:${account}'\n${PS_ACTION[action]}\n`;
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

interface Backend {
  readonly name: string;
  readonly tool: string;
  readonly missingHint: string;
  get(account: string): { status: number | null; stdout: string; notFound: boolean };
  set(account: string, secret: string): { status: number | null; stderr: string; notFound: boolean };
  delete(account: string): { status: number | null; notFound: boolean };
}

function backendFor(platform: NodeJS.Platform, run: KeychainRun): Backend | null {
  switch (platform) {
    case "darwin":
      return {
        name: "macOS keychain", tool: "security",
        missingHint: "the macOS `security` tool was not found",
        get: (a) => run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", a, "-w"]),
        set: (a, s) => run("security", ["-i"], `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${a} -w "${s}"\n`),
        delete: (a) => run("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", a]),
      };
    case "linux":
    case "freebsd":
    case "openbsd":
      return {
        name: "Secret Service (secret-tool)", tool: "secret-tool",
        missingHint: "secret-tool is not installed — install libsecret-tools (Debian, Ubuntu) or libsecret (Fedora, Arch), with a keyring such as GNOME Keyring running",
        get: (a) => run("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE, "account", a]),
        set: (a, s) => run("secret-tool", ["store", "--label", `gov ${a}`, "service", KEYCHAIN_SERVICE, "account", a], s),
        delete: (a) => run("secret-tool", ["clear", "service", KEYCHAIN_SERVICE, "account", a]),
      };
    case "win32":
      return {
        name: "Windows Credential Manager", tool: "powershell.exe",
        missingHint: "PowerShell (powershell.exe) was not found, so Windows Credential Manager cannot be reached",
        get: (a) => run("powershell.exe", psCommand("get", a)),
        set: (a, s) => run("powershell.exe", psCommand("set", a), s),
        delete: (a) => run("powershell.exe", psCommand("delete", a)),
      };
    default:
      return null;
  }
}

/** The real tool runner: gov's logged process runner (argv logged — which is why no secret is ever on it). */
export function keychainRunner(env: NodeJS.ProcessEnv = process.env): KeychainRun {
  return (cmd, args, input) => {
    const r = runCapture(cmd, args, { pgm: "gov-work:security:keychain", fn: cmd, env, timeoutMs: 30_000, ...(input !== undefined ? { input } : {}) });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, notFound: r.notFound };
  };
}

export function createKeychain(opts: { platform?: NodeJS.Platform; env?: Readonly<Record<string, string | undefined>>; run?: KeychainRun } = {}): OsKeychain {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const b = backendFor(platform, opts.run ?? keychainRunner());
  const envKey = (account: string): string | null => (account === LICENCE_ACCOUNT && env[LICENCE_KEY_ENV]?.trim()) || null;
  const checkAccount = (account: string): void => {
    if (!ACCOUNT.test(account)) throw new Error(`keychain: '${account}' is not a valid account name (lower-case letters, digits, '-', '/')`);
  };
  const envHint = `set ${LICENCE_KEY_ENV} in the environment instead (gov never writes the key to a file)`;

  const lookup = (account: string): Promise<{ secret: string; from: "keychain" | "env" } | null> => {
    checkAccount(account);
    if (b) {
      const r = b.get(account);
      const v = r.status === 0 ? r.stdout.replace(/\r?\n$/, "").trim() : "";
      if (v) return Promise.resolve({ secret: v, from: "keychain" });
    }
    const e = envKey(account);
    return Promise.resolve(e ? { secret: e, from: "env" } : null);
  };

  return {
    backend: b ? b.name : "env only",
    lookup,
    get: async (account) => (await lookup(account))?.secret ?? null,
    set: (account, secret) => {
      try {
        checkAccount(account);
        if (!SAFE_SECRET.test(secret)) throw new Error("keychain: the secret holds characters a gov key never has — nothing was stored");
        if (!b) throw new Error(`keychain: this system has no supported keychain — ${envHint}`);
        const r = b.set(account, secret);
        if (r.notFound) throw new Error(`keychain: ${b.missingHint} — or ${envHint}`);
        if (r.status !== 0) throw new Error(`keychain: could not store '${account}' in the ${b.name} (${b.tool} exited ${r.status ?? "on a signal"}${r.stderr.trim() ? `: ${r.stderr.trim().split("\n")[0]!.slice(0, 200)}` : ""}) — ${envHint}`);
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    delete: (account) => {
      checkAccount(account);
      if (b) b.delete(account);
      return Promise.resolve();
    },
  };
}
