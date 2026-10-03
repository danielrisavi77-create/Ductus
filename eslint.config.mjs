import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "node_modules/**",
      "public/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // The database driver stays behind src/server/db (withActor, BACKEND 4.3):
  // no other module opens a connection or builds SQL on its own.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // pg, pg/lib/..., pg-cursor, pg-boss; not relative paths like ./pg-like.
              regex: "^pg(?:$|/|-)",
              message: "Database access goes through src/server/db only.",
            },
          ],
        },
      ],
    },
  },
  {
    // Integration tests check the compose stack directly.
    files: ["src/server/db/**", "tests/integration/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default eslintConfig;
