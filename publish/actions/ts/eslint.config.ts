// eslint.config.ts
import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
// @ts-expect-error — a local rule, plain JS by design (no build step for lint)
import catchMustAccount from "./eslint-rules/catch-must-account.js";

// NO MODULE INSIDE src/ IMPORTS A BARREL (PRJ-121 intent 05, Item 12). `maintain/upgrade.ts` imported PACKAGE_NAME
// from the package root barrel (src/index.ts), which re-exports maintain/: loading the published entry ran
// upgrade.ts before the barrel had defined the name and threw. Import the leaf module instead
// (src/package-identity.ts, or the file that defines the name). Matched by specifier, so it covers every depth.
const BARREL_IMPORTS = ["./index.js", "../index.js", "../../index.js", "../../../index.js", "../../../../index.js"].map((name) => ({
  name,
  message: "do not import a barrel (index.js) from inside src/ — it is a load-order cycle; import the leaf module that defines the name (e.g. src/package-identity.ts).",
}));
const PROCESS_IMPORTS = [{
  name: "node:child_process",
  message: "run a process through src/run-process.ts (run · tryRun · runResult · ok · runInteractive) so it is logged — GOV-FRM-423.",
}, {
  name: "child_process",
  message: "run a process through src/run-process.ts so it is logged — GOV-FRM-423.",
}];

export default defineConfig(
  globalIgnores(["lib/", "node_modules/"]),
  {
    files: ["**/*.ts"],
    extends: [eslint.configs.recommended, tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // The barrel rule for EVERY file in src/ — run-process.ts and cli/main.ts are exempt from the process rule
    // below, never from this one. (The block below repeats BARREL_IMPORTS: a later block's options replace these.)
    files: ["src/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { paths: BARREL_IMPORTS }] },
  },
  {
    // EVERY EXTERNAL PROCESS GOES THROUGH src/run-process.ts, SO EVERY ONE IS LOGGED (PRJ-121, 2026-09-23).
    //
    // gov's work is mostly other programs, and until this rule landed none of those calls were recorded: the
    // walks of 2026-09-22 were diagnosed from pasted terminals because a `gh` call that failed after 11
    // seconds left no trace. Coverage by hand would drift on the next call site added; this makes the runner
    // the only door. `run-process.ts` itself is the exception, and `cli/main.ts` keeps `spawn` for the one
    // thing the runner cannot do: hand the terminal to an agent and walk away (detached / inherited stdin).
    files: ["src/**/*.ts"],
    plugins: { gov: { rules: { "catch-must-account": catchMustAccount } } },
    ignores: ["src/run-process.ts", "src/cli/main.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [...PROCESS_IMPORTS, ...BARREL_IMPORTS] }],
      "gov/catch-must-account": "error",
    },
  },
  {
    // chai's fluent assertions (.to.be.empty, .to.exist, …) are getter expressions by design.
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-unused-expressions": "off" },
  },
);
