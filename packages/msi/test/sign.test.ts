// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The signing step is the caller's command (gov-cicd's key, never ours); this only fills in the file. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signerCommand } from "../scripts/sign.mjs";

test("the signer command gets the file, quoted, wherever {file} stands", () => {
  assert.equal(signerCommand("jsign --storetype X {file}", "C:\\out dir\\gov-1.2.3-x64.msi", "win32"),
    'jsign --storetype X "C:\\out dir\\gov-1.2.3-x64.msi"');
  assert.equal(signerCommand("osslsigncode sign -in {file} -out {file}.signed", "/o/gov.msi", "linux"),
    "osslsigncode sign -in '/o/gov.msi' -out '/o/gov.msi'.signed");
});

test("a signer command without {file} is refused — it would sign nothing, or the wrong thing", () => {
  assert.throws(() => signerCommand("signtool sign /a", "x.msi", "win32"), /\{file\}/);
});

test("a path that cannot be quoted safely is refused", () => {
  assert.throws(() => signerCommand("s {file}", 'a"b.msi', "win32"), /quote/);
  assert.throws(() => signerCommand("s {file}", "a'b.msi", "linux"), /quote/);
});
