// eslint.config.ts
import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
// @ts-expect-error — a local rule, plain JS by design (no build step for lint)
import catchMustAccount from "./eslint-rules/catch-must-account.js";
// @ts-expect-error — a local rule, plain JS by design (no build step for lint)
import noDirectGh from "./eslint-rules/no-direct-gh.js";

// gov's local rules, ONE plugin object: flat config refuses a plugin name defined twice with different objects.
const gov = { rules: { "catch-must-account": catchMustAccount, "no-direct-gh": noDirectGh } };

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
    // EVERY EXTERNAL PROCESS GOES THROUGH src/run-process.ts, SO EVERY ONE IS LOGGED (PRJ-121, 2026-09-23).
    //
    // gov's work is mostly other programs, and until this rule landed none of those calls were recorded: the
    // walks of 2026-09-22 were diagnosed from pasted terminals because a `gh` call that failed after 11
    // seconds left no trace. Coverage by hand would drift on the next call site added; this makes the runner
    // the only door. `run-process.ts` itself is the exception, and `cli/main.ts` keeps `spawn` for the one
    // thing the runner cannot do: hand the terminal to an agent and walk away (detached / inherited stdin).
    files: ["src/**/*.ts"],
    plugins: { gov },
    ignores: ["src/run-process.ts", "src/cli/main.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{
        name: "node:child_process",
        message: "run a process through src/run-process.ts (run · tryRun · runResult · ok · runInteractive) so it is logged — GOV-FRM-423.",
      }, {
        name: "child_process",
        message: "run a process through src/run-process.ts so it is logged — GOV-FRM-423.",
      }] }],
      "gov/catch-must-account": "error",
    },
  },
  {
    // NEW MODULES REACH GITHUB ONLY THROUGH A PORT (PRJ-121 intent 03, D7, M4). The modules intent 03 adds call
    // src/ports/ — never `gh`, `gh-board` or a `runGh`. Existing code moves behind the ports when touched, so the
    // rule covers these directories only (test/eslint-rules/no-direct-gh.test.ts holds the scope).
    files: ["src/signal/**/*.ts", "src/autorun/**/*.ts", "src/intent/**/*.ts", "src/project/**/*.ts", "src/skills/**/*.ts"],
    plugins: { gov },
    rules: { "gov/no-direct-gh": "error" },
  },
  {
    // chai's fluent assertions (.to.be.empty, .to.exist, …) are getter expressions by design.
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-unused-expressions": "off" },
  },
);
