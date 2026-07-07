// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { runCreds, type CredsFlowDeps } from "../../src/security/creds-flow.js";
import { gitIdentityNeed, registryTokenNeed, type Need } from "../../src/security/needs.js";

// A scripted, in-memory harness: `answers` feed the prompt in order; `store` is the
// per-identity credential store setCred writes to and makeProbes reads back.
function harness(opts: {
  needs: readonly Need[];
  answers: readonly string[];
  defaultIdentity?: string;
  store?: Record<string, Record<string, string>>;
  git?: Record<string, string>;
  ghAuthOk?: boolean;
  interactive?: boolean;
}) {
  const store: Record<string, Record<string, string>> = JSON.parse(JSON.stringify(opts.store ?? {}));
  const out: string[] = [];
  let i = 0;
  const deps: CredsFlowDeps = {
    defaultIdentity: opts.defaultIdentity ?? "rkant",
    needs: opts.needs,
    interactive: opts.interactive ?? true,
    prompt: async (_q, def) => { const a = opts.answers[i++] ?? ""; return a.trim() || (def ?? ""); },
    print: (l) => out.push(l),
    listIdentities: () => Object.keys(store),
    identityExists: (id) => id in store,
    makeProbes: (id) => ({
      gitConfig: (k) => opts.git?.[k],
      ghAuthOk: () => opts.ghAuthOk ?? true,
      hasCred: (k) => store[id]?.[k] !== undefined,
    }),
    setCred: (id, key, value) => { (store[id] ??= {})[key] = value; },
  };
  return { deps, out, store };
}

describe("security — gov creds flow", () => {
  it("all satisfied → nothing to do", async () => {
    const { deps, out } = harness({ needs: [gitIdentityNeed], answers: [""], store: { rkant: {} }, git: { "user.name": "R", "user.email": "r@o" } });
    const r = await runCreds(deps);
    expect(r).to.deep.include({ identity: "rkant", filled: [], stillMissing: [] });
    expect(out.join("\n")).to.match(/nothing to do/);
  });

  it("stored-cred GAP: prints where/how, takes the paste, PLACES it, re-probe clears the gap", async () => {
    const need = registryTokenNeed("https://npm.svayamtech.com", "oidc", "AUTHENTIK_UAT_API_TOKEN");
    const { deps, out, store } = harness({ needs: [need], answers: ["", "brr.oidc.token"], store: { rkant: {} } });
    const r = await runCreds(deps);
    expect(out.join("\n")).to.match(/OIDC-fronted/);          // instructions shown
    expect(store.rkant[need.credKey!]).to.equal("brr.oidc.token"); // placed
    expect(r.filled).to.deep.equal([need.id]);
    expect(r.stillMissing).to.deep.equal([]);                 // re-probe: satisfied
  });

  it("NON-interactive (piped/agent) REFUSES to accept a secret — never places it", async () => {
    const need = registryTokenNeed("https://npm.svayamtech.com", "oidc", "AUTHENTIK_UAT_API_TOKEN");
    const { deps, out, store } = harness({ needs: [need], answers: ["", "a-token-an-agent-tried-to-paste"], store: { rkant: {} }, interactive: false });
    const r = await runCreds(deps);
    expect(store.rkant[need.credKey!]).to.equal(undefined);          // NOT stored
    expect(out.join("\n")).to.match(/interactive terminal \(a real TTY\)/);
    expect(out.join("\n")).to.match(/agent-driven session cannot provide/);
    expect(r.stillMissing).to.deep.equal([need.id]);
  });

  it("blank paste SKIPS a stored-cred need → still missing", async () => {
    const need = registryTokenNeed("https://registry.npmjs.org", "token", "NPMJS_ACCESS_TOKEN");
    const { deps, store } = harness({ needs: [need], answers: ["", ""], store: { rkant: {} } });
    const r = await runCreds(deps);
    expect(store.rkant[need.credKey!]).to.equal(undefined);
    expect(r.filled).to.deep.equal([]);
    expect(r.stillMissing).to.deep.equal([need.id]);
  });

  it("environment need (git identity) is INSTRUCTED, not placeable → still missing", async () => {
    const { deps, out } = harness({ needs: [gitIdentityNeed], answers: [""], store: { rkant: {} }, git: {} });
    const r = await runCreds(deps);
    expect(out.join("\n")).to.match(/git config --global/);
    expect(out.join("\n")).to.match(/re-run `gov creds`/);
    expect(r.stillMissing).to.deep.equal(["git-identity"]);
  });

  it("identity (0/1 persona): default prompt, Enter accepts the logged-in user", async () => {
    const one = harness({ needs: [], answers: [""], store: { "svayam-rkant": {} }, defaultIdentity: "rkant" });
    expect((await runCreds(one.deps)).identity).to.equal("rkant");
  });

  it("identity (multiple personas): numbered menu — Enter=default, number picks, name creates", async () => {
    const store = { gyan: {}, "svayam-rkant": {} };
    // Enter → the default (logged-in user), even though it's not one of the listed personas
    const def = harness({ needs: [], answers: [""], store, defaultIdentity: "rkant" });
    expect((await runCreds(def.deps)).identity).to.equal("rkant");
    expect(def.out.join("\n")).to.match(/multiple user-ids\/personas/);
    expect(def.out.join("\n")).to.match(/\(1\) gyan[\s\S]*\(2\) svayam-rkant/);
    // a number selects that alternate persona
    const pick = harness({ needs: [], answers: ["2"], store, defaultIdentity: "rkant" });
    expect((await runCreds(pick.deps)).identity).to.equal("svayam-rkant");
    // a typed name → a new persona
    const typed = harness({ needs: [], answers: ["contractor"], store, defaultIdentity: "rkant" });
    const rt = await runCreds(typed.deps);
    expect(rt.identity).to.equal("contractor");
    expect(typed.out.join("\n")).to.match(/new identity 'contractor'/);
  });
});
