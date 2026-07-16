/* --------------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 - Svayam Infoware Pvt. Ltd. All rights reserved.
 *  ------------------------------------------------------------------------------------------------*/
/** `gov creds` → Vault: jwt/login → token, KV v2 read/write via the `data/` infix, under the account. */
import { expect } from "chai";
import { vaultLogin, kvRead, kvWrite } from "../../src/security/vault.js";

type Call = { url: string; init?: { method?: string; body?: string; headers?: Record<string, string> } };

function stubFetch(routes: (c: Call) => { status: number; json: unknown }): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: Call["init"]) => {
    const call = { url: String(url), init };
    calls.push(call);
    const { status, json } = routes(call);
    return { ok: status >= 200 && status < 300, status, json: async () => json } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

describe("vault — gov creds sink", () => {
  it("vaultLogin trades the jwt for a client_token at auth/<mount>/login", async () => {
    const s = stubFetch(() => ({ status: 200, json: { auth: { client_token: "s.abc123" } } }));
    try {
      const tok = await vaultLogin({ addr: "https://bao:8200", jwtMount: "gov", role: "gov-admin" }, "the.jwt");
      expect(tok).to.equal("s.abc123");
      expect(s.calls[0].url).to.equal("https://bao:8200/v1/auth/gov/login");
      expect(JSON.parse(s.calls[0].init!.body!)).to.deep.equal({ role: "gov-admin", jwt: "the.jwt" });
    } finally { s.restore(); }
  });

  it("kvRead returns fields (empty on 404) via the kv/data path under the account", async () => {
    const s = stubFetch((c) => c.url.includes("/data/") ? { status: 200, json: { data: { data: { JENKINS_USER: "rk" } } } } : { status: 404, json: {} });
    try {
      const d = await kvRead("https://bao:8200", "s.t", "kv/gov/1000/creds");
      expect(d).to.deep.equal({ JENKINS_USER: "rk" });
      expect(s.calls[0].url).to.equal("https://bao:8200/v1/kv/data/gov/1000/creds");
    } finally { s.restore(); }
  });

  it("kvWrite posts the full field map wrapped in {data}", async () => {
    const s = stubFetch(() => ({ status: 200, json: {} }));
    try {
      await kvWrite("https://bao:8200", "s.t", "kv/gov/1000/creds", { JENKINS_USER: "rk", JENKINS_API_TOKEN: "x" });
      expect(s.calls[0].url).to.equal("https://bao:8200/v1/kv/data/gov/1000/creds");
      expect(JSON.parse(s.calls[0].init!.body!)).to.deep.equal({ data: { JENKINS_USER: "rk", JENKINS_API_TOKEN: "x" } });
    } finally { s.restore(); }
  });
});
