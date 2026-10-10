import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

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
            if (typeof specifier === "string" && /^pg(?:$|\/|-)/iu.test(specifier)) {
              context.report({ node: source, messageId: "restrictedPg" });
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
      "next-env.d.ts",
      "node_modules/**",
      "public/**",
      "playwright-report/**",
      "test-results/**",
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
    rules: {
      "no-restricted-imports": "off",
      "database-boundary/no-restricted-dynamic-imports": "off",
    },
  },
];

export default eslintConfig;
