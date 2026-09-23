// eslint.config.ts
import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
// @ts-expect-error — a local rule, plain JS by design (no build step for lint)
import catchMustAccount from "./eslint-rules/catch-must-account.js";

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
    plugins: { gov: { rules: { "catch-must-account": catchMustAccount } } },
    ignores: ["src/run-process.ts", "src/cli/main.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{
        name: "node:child_process",
        message: "run a process through src/run-process.ts (run · tryRun · runResult · ok · runInteractive) so it is logged — POL-423.",
      }, {
        name: "child_process",
        message: "run a process through src/run-process.ts so it is logged — POL-423.",
      }] }],
      "gov/catch-must-account": "error",
    },
  },
  {
    // chai's fluent assertions (.to.be.empty, .to.exist, …) are getter expressions by design.
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-unused-expressions": "off" },
  },
);
