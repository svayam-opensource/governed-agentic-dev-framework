// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// #192 — A WRONG ANSWER NEVER ENDS THE RUN, asserted PER QUESTION of the founding interview.
//
// The acceptance is "unit tests per prompt": every question that can refuse an answer must say what was wrong
// and ask the SAME question again, and the interview must then carry on to the end with the corrected answer.
// One table row per refusable question, so a question added later without a re-ask path has an obvious home.
//
// Q1 and Q2 have no row because they cannot refuse: Q1's only empty answer is the documented clean stop
// (Enter at the first question, #192 kept) and Q2 always has a default (the legal name), which Enter accepts.
// Q12's agent selection has its own loop and tests (agent-selection.test.ts).
import { expect } from "chai";
import { askOrgInterview } from "../../src/setup/interview.js";
import { deriveOrgConfig } from "../../src/setup/setup.js";

const CTX = { originUrl: "", ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04" };

/** The answer an adopter gives at each question when nothing goes wrong. */
const GOOD: ReadonlyArray<[RegExp, string]> = [
  [/^Q1 /, "Acme Inc"],
  [/^Q2 /, ""],
  [/^Q3 /, "acme"],
  [/^Q4 /, "acme-gov"],
  [/^Q5 /, "ACME"],
  [/^Q6 /, "1"],
  [/^Q7 /, "dev"],
  [/^Q8 /, "rk"],
  [/^Q9 /, "dave"],
  [/^Q10 /, "rk@acme.io"],
  [/^Q11 /, "1"],
];

interface Row {
  readonly q: number;
  readonly bad: string;
  /** Words the refusal must contain — it is about the VALUE typed, not the field. */
  readonly says: RegExp;
  /** Where the corrected answer lands. */
  readonly check: (r: NonNullable<Awaited<ReturnType<typeof askOrgInterview>>>) => void;
}

const ROWS: readonly Row[] = [
  { q: 3, bad: "acme/acme-gov", says: /Just the organization/, check: (r) => expect(r.org).to.equal("acme") },
  { q: 4, bad: "acme gov!", says: /not a repository name/, check: (r) => expect(r.repo).to.equal("acme-gov") },
  { q: 5, bad: "FRM", says: /reserved for the framework/, check: (r) => expect(r.answers.orgSlug).to.equal("ACME") },
  { q: 6, bad: "3", says: /./, check: (r) => expect(r.answers.defaultBranch).to.equal("main") },
  { q: 7, bad: "bad..branch", says: /./, check: (r) => expect(r.answers.defaultCodeBranch).to.equal("dev") },
  { q: 8, bad: "not a handle!", says: /not a GitHub handle/, check: (r) => expect(r.answers.policyOwnerGithub).to.match(/rk$/) },
  { q: 9, bad: "-dave-", says: /not a GitHub handle/, check: (r) => expect(r.answers.checkOwnerGithub).to.match(/dave$/) },
  { q: 10, bad: "rk-at-acme", says: /does not look like an email/, check: (r) => expect(r.answers.policyOwnerEmail).to.equal("rk@acme.io") },
  { q: 11, bad: "7", says: /./, check: (r) => expect(r.answers.governancePosture).to.equal("soft") },
];

describe("gov-work — the founding interview re-asks every refusable question (#192)", () => {
  for (const row of ROWS) {
    it(`Q${row.q}: '${row.bad}' is explained, the same question is asked again, and the interview finishes`, async () => {
      const asked: string[] = [];
      const printed: string[] = [];
      let refusedOnce = false;
      const target = new RegExp(`^Q${row.q} `);
      const r = await askOrgInterview({
        prompt: async (q) => {
          asked.push(q);
          if (target.test(q) && !refusedOnce) { refusedOnce = true; return row.bad; }
          return GOOD.find(([re]) => re.test(q))?.[1] ?? "";
        },
        print: (l) => printed.push(l),
        derive: (partial) => deriveOrgConfig(partial, CTX),
      });

      expect(r, "the run did not end on a wrong answer").to.not.equal(null);
      const times = asked.filter((q) => target.test(q));
      expect(times, `Q${row.q} was asked again`).to.have.length(2);
      expect(times[1], "the SAME question, word for word").to.equal(times[0]);
      const refusal = printed.find((l) => l.startsWith("  ✗ "));
      expect(refusal, "and the reason was shown").to.not.equal(undefined);
      expect(refusal).to.match(row.says);
      // It carried on to the last question rather than stopping at the corrected one.
      expect(asked.some((q) => /^Q11 /.test(q)), "the interview reached Q11").to.equal(true);
      row.check(r!);
    });
  }
});
