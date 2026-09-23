// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EVERY `catch` ACCOUNTS FOR ITSELF (PRJ-121, 2026-09-23).
 *
 * gov swallows a great many failures on purpose — a missing optional file, a probe that may fail, a best-effort
 * write. That is right, and it is also how a defect hides: the walks of 2026-09-22 turned up failures nobody
 * could see, because the code that handled them said nothing anywhere.
 *
 * So a catch must do ONE of three things:
 *   1. LOG — call `log(...)` / `decide(...)`, directly or as a member (`deps.log(...)`);
 *   2. RETHROW — `throw` (the caller accounts for it);
 *   3. SAY WHY NOT — a comment in the block. gov's house style already explains every silent catch
 *      ("/* best effort *​/", "/* the next run will ask again *​/"), so this is the rule meeting the style
 *      where it already is, rather than demanding a hundred new annotations.
 *
 * Returning a fallback VALUE is not enough on its own: `catch { return null; }` with no word about why is
 * exactly the shape that hid a defect for a month.
 */
export default {
  meta: {
    type: "problem",
    docs: { description: "a catch block must log, rethrow, or say in a comment why it is silent" },
    schema: [],
    messages: {
      silent: "this catch is silent: log it, rethrow it, or write one comment saying why neither is needed (POL-423).",
    },
  },
  create(context) {
    const source = context.sourceCode ?? context.getSourceCode();
    return {
      CatchClause(node) {
        const body = node.body;
        const text = source.getText(body);
        // A comment anywhere in the block — including an empty block's `{ /* why */ }` — is the explanation.
        if (source.getCommentsInside(body).length > 0) return;
        // A call to the logger, at any depth, in any spelling that ends in `log`/`decide`.
        if (/\b(log|decide|logFatal|logRun)\s*\(/.test(text)) return;
        if (/\bthrow\b/.test(text)) return;
        // THE ERROR IS USED — reported to the caller, wrapped, returned in a message. That is an account of
        // the failure, in the place the code already chose to give it, and demanding a comment as well would
        // only add noise. What this rule is for is the OTHER kind: `catch { return null; }`, which says
        // nothing to anyone.
        if (node.param && node.param.type === "Identifier") {
          const name = node.param.name;
          if (new RegExp(`\\b${name}\\b`).test(text)) return;
        }
        context.report({ node, messageId: "silent" });
      },
    };
  },
};
