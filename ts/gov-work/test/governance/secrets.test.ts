// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { checkSecrets } from "../../src/governance/secrets.js";
import type { ValidateContext } from "../../src/governance/validate.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

function ctx(files: Record<string, string>): ValidateContext {
  const at = (p: string) => files[p.replace(/^\/repo\//, "")] ?? null;
  const fs: Fs = {
    pathExists: (p) => at(p) !== null,
    readFile: (p) => at(p),
    mkdirp: () => {},
    writeFile: () => {},
    rm: () => {},
    readdir: () => [],
  };
  return { fs, repoRoot: "/repo", files: Object.keys(files) };
}

// A realistic (fake) GitHub token shape — 36+ chars after the prefix.
const GH_TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";

describe("prj-work Phase 3 — checkSecrets (port of check_secrets.py)", () => {
  it("passes a clean tree", () => {
    expect(checkSecrets(ctx({ "src/x.ts": "export const x = 1;\n" }))).to.deep.equal({
      name: "secrets",
      ok: true,
      errors: [],
    });
  });

  it("flags a GitHub token, AWS key, and private-key block with file:line", () => {
    const r = checkSecrets(
      ctx({
        "a.env": `TOKEN=${GH_TOKEN}\n`,
        "b.txt": "id = AKIAIOSFODNN7EXAMPLE\n",
        "c.pem": "-----BEGIN RSA PRIVATE KEY-----\n",
      }),
    );
    expect(r.ok).to.equal(false);
    expect(r.errors.some((e) => /a\.env:1: GitHub token/.test(e))).to.equal(true);
    expect(r.errors.some((e) => /b\.txt:1: AWS access key id/.test(e))).to.equal(true);
    expect(r.errors.some((e) => /c\.pem:1: private key block/.test(e))).to.equal(true);
  });

  it("flags a hardcoded credential assignment but ignores placeholders", () => {
    const r = checkSecrets(
      ctx({
        "config.yaml": 'password: "s3cr3t-real-value"\napi_key: "<your-token>"\nsecret_key: "${VAR}"\n',
      }),
    );
    expect(r.errors).to.have.lengthOf(1);
    expect(r.errors[0]).to.match(/config\.yaml:1: hardcoded credential/);
  });

  it("respects an inline allowlist pragma", () => {
    const r = checkSecrets(ctx({ "fixture.txt": `token = ${GH_TOKEN}  # pragma: allowlist secret\n` }));
    expect(r.ok).to.equal(true);
  });

  it("skips binary content (NUL byte)", () => {
    const r = checkSecrets(ctx({ "img.bin": `\0${GH_TOKEN}` }));
    expect(r.ok).to.equal(true);
  });
});
