import js from "@eslint/js";
import globals from "globals";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["**/node_modules/**", "**/.next/**", "**/.turbo/**", "**/coverage/**", "apps/api/drizzle/**"] },
  {
    files: ["apps/web/**/*.{js,jsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules
    }
  },
  {
    files: ["apps/api/**/*.js", "scripts/**/*.mjs", "*.mjs", "apps/web/tests/*.js", "apps/web/next.config.js"],
    languageOptions: { globals: globals.node },
    rules: js.configs.recommended.rules
  }
];
