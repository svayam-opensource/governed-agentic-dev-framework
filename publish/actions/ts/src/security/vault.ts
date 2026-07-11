// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * Minimal OpenBao/Vault client for `gov creds` → Vault (dependency-free; global fetch).
 *
 * After `gov auth login`, the svayam_jwt is exchanged for a short-lived, account-scoped Vault token
 * (`auth/<mount>/login`), and common secrets are written under the token's account context
 * (`kv/gov/<account_ctx>/creds`). Vault enforces who may write (the account-templated policy), so only
 * a gov-admin in that account can seed them; everyone authorized reads them at build/deploy.
 */
export interface VaultCfg {
  readonly addr: string;      // e.g. https://10.139.144.209:8200
  readonly jwtMount: string;  // the jwt auth mount, default "gov"
  readonly role: string;      // the Vault jwt role to log in as (matches a gov role, e.g. "gov-admin")
}

const trim = (s: string): string => s.replace(/\/+$/, "");
// kv v2 read/write go through the `data/` infix: "kv/gov/1000/creds" → "kv/data/gov/1000/creds"
const kvData = (path: string): string => { const [mount, ...rest] = path.split("/"); return `${mount}/data/${rest.join("/")}`; };

/** Trade the svayam_jwt for a scoped Vault token (roles + account_ctx → policy). */
export async function vaultLogin(cfg: VaultCfg, jwt: string): Promise<string> {
  const res = await fetch(`${trim(cfg.addr)}/v1/auth/${cfg.jwtMount}/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: cfg.role, jwt }),
  });
  if (!res.ok) throw new Error(`Vault login failed (${res.status}) — check the jwt role '${cfg.role}' and that your token has it`);
  const j = (await res.json()) as { auth?: { client_token?: string } };
  if (!j.auth?.client_token) throw new Error("Vault login: no client_token in response");
  return j.auth.client_token;
}

/** Read a KV v2 secret's fields (empty object if absent). */
export async function kvRead(addr: string, token: string, path: string): Promise<Record<string, string>> {
  const res = await fetch(`${trim(addr)}/v1/${kvData(path)}`, { headers: { "x-vault-token": token } });
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`Vault read ${path} failed (${res.status})`);
  const j = (await res.json()) as { data?: { data?: Record<string, string> } };
  return j.data?.data ?? {};
}

/** Write the full field map to a KV v2 secret (caller merges — v2 put replaces). */
export async function kvWrite(addr: string, token: string, path: string, data: Record<string, string>): Promise<void> {
  const res = await fetch(`${trim(addr)}/v1/${kvData(path)}`, {
    method: "POST", headers: { "x-vault-token": token, "content-type": "application/json" }, body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`Vault write ${path} failed (${res.status}) — do you have write on kv/gov/<account>/* (gov-admin)?`);
}
