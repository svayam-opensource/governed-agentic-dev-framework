// eslint.config.ts
import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

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
    // chai's fluent assertions (.to.be.empty, .to.exist, …) are getter expressions by design.
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-unused-expressions": "off" },
  },
);
