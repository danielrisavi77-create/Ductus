import { dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

// The pg family by package name (pg, pg/lib/..., pg-cursor, pg-boss), or a
// static path into an installed copy of it (../../node_modules/pg, the pnpm
// store node_modules/.pnpm/pg@x/..., either slash), DAN-50. Not relative paths
// like ./pg-like. Both rules below use this one pattern, case-insensitively.
const PG_SPECIFIER = String.raw`^pg(?:$|/|-)|(?:^|[\\/])node_modules[\\/](?:\.pnpm[\\/])?pg(?:$|[\\/@+-])`;
const PG_SPECIFIER_RE = new RegExp(PG_SPECIFIER, "iu");
// A path with an empty, "." or "x/.." segment, or with backslashes, reaches the
// same file (review of #1172): node_modules//pg, node_modules/./pg,
// node_modules/x/../pg. The custom rule tests the normalized form.
// Only the node_modules part is tested on it: normalizing "./pg-like" gives
// "pg-like", which is not the package.
const PG_PATH_RE = /(?:^|\/)node_modules\/(?:\.pnpm\/)?pg(?:$|[/@+-])/iu;
const normalized = (specifier) => posix.normalize(specifier.replace(/\\/g, "/"));
const isPg = (specifier) => PG_SPECIFIER_RE.test(specifier) || PG_PATH_RE.test(normalized(specifier));

const databaseBoundaryPlugin = {
  rules: {
    "no-restricted-dynamic-imports": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          restrictedPg: "Database access goes through src/server/db only.",
        },
      },
      create(context) {
        return {
          ImportExpression(node) {
            let source = node.source;
            // These TypeScript wrappers disappear at emit time. Only unwrap
            // type-only syntax; do not evaluate any remaining runtime expression.
            while (
              source.type === "TSAsExpression" ||
              source.type === "TSTypeAssertion" ||
              source.type === "TSNonNullExpression" ||
              source.type === "TSSatisfiesExpression"
            ) {
              source = source.expression;
            }
            const specifier =
              source.type === "Literal"
                ? source.value
                : source.type === "TemplateLiteral" && source.expressions.length === 0
                  ? source.quasis[0].value.cooked
                  : undefined;

            // Arbitrary computed specifiers cannot be resolved by this static
            // guard. Variables and interpolated templates are not inspected.
            // Match the static rule's default case-insensitive Unicode semantics.
            if (typeof specifier === "string" && isPg(specifier)) {
              context.report({ node: source, messageId: "restrictedPg" });
            }
          },
          // Static imports and re-exports: no-restricted-imports reads the raw
          // text, so this rule reports only the forms it cannot see, those
          // that are the driver only after normalization.
          "ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration"(node) {
            const specifier = node.source?.value;
            if (typeof specifier === "string" && !PG_SPECIFIER_RE.test(specifier) && isPg(specifier)) {
              context.report({ node: node.source, messageId: "restrictedPg" });
            }
          },
        };
      },
    },
  },
};

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".claude/worktrees/**",
      "next-env.d.ts",
      "node_modules/**",
      "public/**",
      "playwright-report/**",
      "playwright-report-login/**",
      "test-results/**",
      "test-results-login/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Keep direct driver imports behind src/server/db (withActor, BACKEND 4.3).
  // This development guard covers static and dynamic literal module imports;
  // it does not enforce every possible JavaScript module-loading operation.
  {
    plugins: { "database-boundary": databaseBoundaryPlugin },
    rules: {
      "database-boundary/no-restricted-dynamic-imports": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: PG_SPECIFIER,
              message: "Database access goes through src/server/db only.",
            },
          ],
        },
      ],
    },
  },
  {
    // Integration tests and the full login E2E check the compose stack directly.
    files: ["src/server/db/**", "tests/integration/**", "e2e/login/**"],
    rules: {
      "no-restricted-imports": "off",
      "database-boundary/no-restricted-dynamic-imports": "off",
    },
  },
];

export default eslintConfig;
