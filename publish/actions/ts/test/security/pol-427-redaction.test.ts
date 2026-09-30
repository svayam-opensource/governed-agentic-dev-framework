// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * POL-427 IS C01: restricted data never reaches a log, at any level, through any transport, structured fields too.
 *
 * An audit on 2026-09-30 found four ways past it. Three are fixed here and asserted below; the fourth is a
 * deliberate trade-off with a guard. Each test names the concrete thing that leaked, because "redaction works" is
 * not a property anyone can check and "a GitHub token in a git error message reaches the run log" is.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { redactArgv, redactText, CREDENTIAL_SHAPES } from "../../src/state-paths.js";

const GH_TOKEN = `ghp_${"a".repeat(36)}`;

describe("POL-427 — a credential in free TEXT never reaches a log", () => {
  /**
   * THE LEAK THAT WAS REAL. Every failed process wrote the tail of its stderr to the log verbatim, at `warn`, and
   * `git`/`gh` echo the remote URL in an error — carrying the token they were handed.
   */
  it("masks a credential embedded in a URL, which is how git and gh are handed one", () => {
    const stderr = `fatal: unable to access 'https://svayam-rkant:${GH_TOKEN}@github.com/o/r.git/': 403`;
    const out = redactText(stderr);
    expect(out, "the token is gone").to.not.contain(GH_TOKEN);
    expect(out, "and so is any part of it").to.not.contain("aaaaaaaa");
    expect(out, "the user survives — knowing WHO failed is the diagnostic").to.contain("svayam-rkant");
    expect(out).to.contain("***@github.com");
    expect(out, "and the actual error is still readable").to.contain("403");
  });

  it("masks a bare token anywhere in the text, with no URL around it", () => {
    expect(redactText(`error: bad credentials for ${GH_TOKEN}`)).to.not.contain(GH_TOKEN);
  });

  it("masks every shape it claims to", () => {
    const samples = [
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
      GH_TOKEN,
      `github_pat_${"b".repeat(60)}`,
      "AKIAIOSFODNN7EXAMPLE",
      `xoxb-${"1".repeat(12)}`,
    ];
    for (const s of samples) {
      expect(redactText(`prefix ${s} suffix`), s.slice(0, 20)).to.not.contain(s);
    }
  });

  it("leaves ordinary text completely alone — a redactor that mangles logs stops being read", () => {
    const ordinary = "fatal: couldn't find remote ref refs/heads/BRNCH-43-billing · exit 128";
    expect(redactText(ordinary)).to.equal(ordinary);
  });

  it("uses the SAME credential shapes the file scanner does", () => {
    // One vocabulary for "this looks like a credential", so improving the scanner improves the logger. Asserted
    // rather than trusted: two copies of a pattern list drift, and the drift is silent in both directions.
    const src = fs.readFileSync(new URL("../../src/governance/secrets.ts", import.meta.url), "utf8");
    for (const re of CREDENTIAL_SHAPES) {
      // The scanner's copies carry no /g; compare the bodies.
      const body = re.source.replace(/\[\\s\\S\]\*\?\(\?:-----END\[\^-\]\*-----\|\$\)/, "");
      const head = body.slice(0, 40);
      expect(src, `secrets.ts no longer scans for ${head}`).to.contain(head);
    }
  });
});

describe("POL-427 — secret-shaped FLAGS", () => {
  it("redacts an UNDERSCORED name, the commonest spelling there is", () => {
    // `[A-Za-z0-9-]` had no underscore, so `--api-key` was redacted and `--api_key` was not.
    expect(redactArgv(["--api_key=abc123"])).to.deep.equal(["--api_key=***"]);
    expect(redactArgv(["--auth_token", "abc123"])).to.deep.equal(["--auth_token", "***"]);
  });

  it("redacts the flags that carry a credential without saying so", () => {
    for (const flag of ["--auth", "--bearer", "--cookie", "--credential"]) {
      expect(redactArgv([flag, "abc123"]), flag).to.deep.equal([flag, "***"]);
    }
  });

  it("redacts `-H` and `-u`, which name nothing and carry everything", () => {
    expect(redactArgv(["-u", "user:hunter2"])).to.deep.equal(["-u", "***"]);
    expect(redactArgv(["-H", "Authorization: Bearer abc"])).to.deep.equal(["-H", "***"]);
  });

  it("redacts a POSITIONAL URL credential — no flag in front of it at all", () => {
    // How `git remote add` and `git clone` are handed a token. Positionals were never redacted.
    const out = redactArgv(["clone", `https://x:${GH_TOKEN}@github.com/o/r.git`]);
    expect(out.join(" ")).to.not.contain(GH_TOKEN);
    expect(out[1]).to.contain("***@github.com");
  });

  it("still never eats the next FLAG — the regression a test already guarded", () => {
    expect(redactArgv(["--token", "--verbose"])).to.deep.equal(["--token", "--verbose"]);
  });
});

describe("POL-427 — every prompt answer that could be a secret uses the hidden path", () => {
  /**
   * THE FOURTH PATH, AND THE TRADE-OFF. `ask.line()` logs the question AND the answer verbatim at `info`, and its
   * comment defends that: "what was it asked, and what did the person say?" was unanswerable after the fact, which
   * is why an earlier incident needed a screen recording. `ask.secret()` records the answer's LENGTH and nothing
   * else, and the choice between them is made per call site with nothing enforcing it.
   *
   * The Policy Owner kept the diagnostic and asked for a guard. This is it: a call site whose QUESTION reads like
   * it is asking for a credential must use `secret`. That is checkable, it is where the mistake would be made, and
   * it costs nothing at run time.
   */
  const SRC = path.join(fileURLToPath(new URL("../../src", import.meta.url)));
  const SECRET_WORDS = /(api[\s_-]?key|token|secret|password|passphrase|credential|private key)/i;

  const sources = (dir: string, out: string[] = []): string[] => {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (fs.statSync(p).isDirectory()) sources(p, out);
      else if (n.endsWith(".ts")) out.push(p);
    }
    return out;
  };

  it("no `.line(` call asks a credential-shaped question", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      // `ask.line("…")` / `asker.line(`…`)` — the question is the first literal argument.
      for (const m of text.matchAll(/\.line\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
        if (SECRET_WORDS.test(m[2]!)) {
          const line = text.slice(0, m.index).split("\n").length;
          offenders.push(`${path.relative(SRC, file)}:${line} — ${m[2]!.slice(0, 60)}`);
        }
      }
    }
    expect(
      offenders,
      "`line()` writes the answer to the run log verbatim. A question that asks for a credential must use "
        + "`secret()`, which records only its length. If the wording is a false positive, reword the prompt — "
        + "the guard reads what the person is asked, which is the only signal available.",
    ).to.deep.equal([]);
  });

  it("the guard can actually see a `.line(` call — otherwise it passes over nothing", () => {
    // The shape that made `shipped-knowledge.test.ts` vacuous. If the call form ever changes, this fails loudly
    // instead of the test above quietly finding zero of zero.
    const all = sources(SRC).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    expect([...all.matchAll(/\.line\(\s*(["'`])/g)].length, "`.line(` call sites found").to.be.greaterThan(0);
  });
});
