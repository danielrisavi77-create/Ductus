import { dirname, isAbsolute, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// The database drivers: the pg family by package name (pg, pg/lib/...,
// pg-cursor, pg-boss) and postgres (postgres, postgres/cjs/...), or a static
// path into an installed copy of either (../../node_modules/pg, the pnpm store
// node_modules/.pnpm/pg@x/..., either slash), DAN-50, F-019. Not relative
// paths like ./pg-like, nor other packages (pgx, postgres-array). Both rules
// below use this one pattern, case-insensitively.
const PG_SPECIFIER = String.raw`^(?:pg(?:$|/|-)|postgres(?:$|/))|(?:^|[\\/])node_modules[\\/](?:\.pnpm[\\/])?(?:pg(?:$|[\\/@+-])|postgres(?:$|[\\/@+]))`;
const PG_SPECIFIER_RE = new RegExp(PG_SPECIFIER, "iu");
// A path with an empty, "." or "x/.." segment, or with backslashes, reaches the
// same file (review of #1172): node_modules//pg, node_modules/./pg,
// node_modules/x/../pg. The custom rule tests the normalized form.
// Only the node_modules part is tested on it: normalizing "./pg-like" gives
// "pg-like", which is not the package.
const PG_PATH_RE = /(?:^|\/)node_modules\/(?:\.pnpm\/)?(?:pg(?:$|[/@+-])|postgres(?:$|[/@+]))/iu;
const normalized = (specifier) => posix.normalize(specifier.replace(/\\/g, "/"));
// A query or fragment suffix ("?", "#") does not change the module that is
// loaded (DAN-448, F-033). Test what comes before the first of them as well as
// the whole text, so the cut only ever adds reports. The trimmed text is tested
// too, because no-restricted-imports trims the source before matching.
const matchesPg = (path) => PG_SPECIFIER_RE.test(path) || PG_PATH_RE.test(normalized(path));
const isPg = (specifier) =>
  [specifier, specifier.trim()].some((text) => matchesPg(text) || matchesPg(text.replace(/[?#].*$/su, "")));

// The text of a module specifier when it is a literal: a string or a template
// without interpolation, behind type-only TypeScript wrappers that disappear at
// emit time. Only type-only syntax is unwrapped; no remaining runtime
// expression is evaluated, so variables and interpolated templates give
// undefined and are not inspected.
function staticSpecifier(node) {
  let source = node;
  while (
    source?.type === "TSAsExpression" ||
    source?.type === "TSTypeAssertion" ||
    source?.type === "TSNonNullExpression" ||
    source?.type === "TSSatisfiesExpression"
  ) {
    source = source.expression;
  }
  if (source?.type === "Literal" && typeof source.value === "string") return source.value;
  if (source?.type === "TemplateLiteral" && source.expressions.length === 0) return source.quasis[0].value.cooked;
  return undefined;
}

// A module of src/server/db other than its entry: @/server/db/with-actor,
// ../../src/server/db/index (F-019). Tested on the normalized text, with and
// without a query or fragment suffix, like the driver pattern.
const DEEP_DB_RE = /(?:^@\/|(?:^|\/)src\/)server\/db\/./u;
const isDeepDb = (specifier) =>
  [specifier.trim(), specifier.trim().replace(/[?#].*$/su, "")].some((text) => DEEP_DB_RE.test(normalized(text)));

// The binding a name refers to in the scope of node, or undefined.
function binding(context, node, name) {
  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) return variable.defs[0];
  }
  return undefined;
}

// createRequire from node:module, under any local name, or module.createRequire.
function isCreateRequire(context, callee) {
  if (callee.type === "MemberExpression") return !callee.computed && callee.property.name === "createRequire";
  if (callee.type !== "Identifier") return false;
  if (callee.name === "createRequire") return true;
  const def = binding(context, callee, callee.name);
  return def?.type === "ImportBinding" && def.node.imported?.name === "createRequire";
}

// A function that loads a module by specifier: require, module.require,
// createRequire(...) and a name bound to its result.
function isRequire(context, node) {
  if (node.type === "CallExpression") return isCreateRequire(context, node.callee);
  if (node.type === "MemberExpression") {
    return !node.computed && node.object.type === "Identifier" && node.object.name === "module" && node.property.name === "require";
  }
  if (node.type !== "Identifier") return false;
  const def = binding(context, node, node.name);
  if (def === undefined) return node.name === "require";
  return def.type === "Variable" && def.node.init?.type === "CallExpression" && isCreateRequire(context, def.node.init.callee);
}

// A call that loads or resolves a module: the forms of isRequire, their
// .resolve, and import.meta.resolve.
function isLoaderCall(context, callee) {
  if (isRequire(context, callee)) return true;
  if (callee.type !== "MemberExpression" || callee.computed || callee.property.name !== "resolve") return false;
  return callee.object.type === "MetaProperty" || isRequire(context, callee.object);
}

// Report every literal specifier that `test` matches, in the forms a file can
// name a module with: static import and export, import(), and a loader call
// (isLoaderCall) with the specifier as its first argument. For a loader call,
// `test` also gets the callee.
function specifierVisitors(context, test, messageId, { skipStatic } = {}) {
  const check = (node, loader) => {
    const specifier = staticSpecifier(node);
    if (typeof specifier === "string" && test(specifier, loader)) context.report({ node, messageId });
  };
  return {
    ImportExpression(node) {
      check(node.source);
    },
    CallExpression(node) {
      if (isLoaderCall(context, node.callee)) check(node.arguments[0], node.callee);
    },
    "ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration"(node) {
      if (node.source && !skipStatic?.(node.source.value)) check(node.source);
    },
  };
}

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
        // Static imports and re-exports: no-restricted-imports matches the
        // trimmed text, so this rule reports only the forms it cannot see,
        // those that are the driver only after normalization.
        return specifierVisitors(context, isPg, "restrictedPg", {
          skipStatic: (specifier) => typeof specifier === "string" && PG_SPECIFIER_RE.test(specifier.trim()),
        });
      },
    },
    "db-entry-only": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          deepDb: "app/ reaches the database through @/server/db only.",
        },
      },
      create(context) {
        return specifierVisitors(context, isDeepDb, "deepDb");
      },
    },
  },
};

// DAN-927 (E-0.1): src/editor is the editor-core package and src/editor/index.ts
// its only entry. A specifier is resolved against the importing file (@/ is
// src/, a relative one from the file's directory, or from the base a
// createRequire was given) and made relative to the repository root, where this
// file is, so ESLint's working directory does not matter. It is normalized and
// compared without case, so case-insensitive file systems are covered too. Any
// other specifier is tested as text for a src/editor/ segment.
const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const EDITOR_DEEP_RE = /(?:^|\/)src\/editor\/(?!index(?:\.[cm]?[jt]sx?)?$)[^/]/u;
const EDITOR_ENTRY_RE = /^src\/editor(?:\/index(?:\.[cm]?[jt]sx?)?)?$/u;
const repoPath = (path) => relative(REPO_ROOT, path).replace(/\\/g, "/");

// The file a createRequire base names when it is static: import.meta.url,
// import.meta.filename, __filename, import.meta.dirname, __dirname, a literal
// absolute path or file URL, or new URL(literal, import.meta.url). Node reads
// a base as a directory only when it ends in a slash, so a dirname without one
// resolves from its parent. Otherwise undefined.
function ownLocation(context, node) {
  const file = context.filename;
  if (node?.type === "MemberExpression" && !node.computed && node.object.type === "MetaProperty") {
    if (node.property.name === "url" || node.property.name === "filename") return file;
    if (node.property.name === "dirname") return dirname(file);
  }
  if (node?.type === "Identifier" && binding(context, node, node.name) === undefined) {
    if (node.name === "__filename") return file;
    if (node.name === "__dirname") return dirname(file);
  }
  return undefined;
}
function requireBase(context, node) {
  const own = ownLocation(context, node);
  if (own !== undefined) return own;
  let text = staticSpecifier(node);
  if (node?.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === "URL" && node.arguments.length === 2) {
    const input = staticSpecifier(node.arguments[0]);
    const base = ownLocation(context, node.arguments[1]);
    if (typeof input === "string" && base !== undefined) text = new URL(input, pathToFileURL(base)).href;
  }
  if (typeof text !== "string") return undefined;
  try {
    const path = text.startsWith("file:") ? fileURLToPath(text) : text;
    return isAbsolute(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

// The directory a loader call resolves a relative specifier from: the calling
// file's for require, module.require and import.meta.resolve, the base's for a
// createRequire, and null when that base is not static.
function loaderDir(context, callee) {
  let loader = callee;
  if (loader?.type === "MemberExpression" && !loader.computed && loader.property.name === "resolve") {
    if (loader.object.type === "MetaProperty") loader = undefined;
    else loader = loader.object;
  }
  let call;
  if (loader?.type === "CallExpression") call = loader;
  else if (loader?.type === "Identifier") {
    const def = binding(context, loader, loader.name);
    if (def?.type === "Variable" && def.node.init?.type === "CallExpression") call = def.node.init;
  }
  if (call === undefined) return dirname(context.filename);
  const base = requireBase(context, call.arguments[0]);
  if (base === undefined) return null;
  return /[\\/]$/u.test(base) ? base : dirname(base);
}

// A query or fragment suffix does not change the module, so the text before it
// is tested as well; when that text is the entry, the import is the entry. A
// suffix that holds a "/" is a path to TypeScript and require, so it is not
// stripped. The percent-decoded text, as Node ESM reads a path, is tested too.
// A relative specifier through a createRequire with an unknown base is rejected.
function isEditorDeep(context, specifier, loader) {
  const dir = loader === undefined ? dirname(context.filename) : loaderDir(context, loader);
  const target = (raw) => {
    const text = raw.replace(/\\/g, "/");
    if (/^@\//u.test(text)) return `src/${text.slice(2)}`;
    if (!/^\.\.?(?:\/|$)/u.test(text)) return text;
    return dir === null ? null : repoPath(resolve(dir, text));
  };
  const text = specifier.trim();
  const bare = text.replace(/[?#][^/]*$/su, "");
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // Malformed escapes: Node rejects the specifier, so nothing more to test.
  }
  const forms = [text, bare, decoded].map((raw) => {
    const path = target(raw);
    return path === null ? null : posix.normalize(path).replace(/\/+$/u, "").toLowerCase();
  });
  if (forms.includes(null)) return true;
  if (EDITOR_ENTRY_RE.test(forms[1])) return false;
  return forms.some((path) => EDITOR_DEEP_RE.test(path));
}

const editorBoundaryPlugin = {
  rules: {
    "entry-only": {
      meta: {
        type: "problem",
        schema: [],
        messages: { deepEditor: "Outside src/editor, import the editor through its entry @/editor only." },
      },
      create(context) {
        // The package's own files, decided here from the repository root, not
        // by a files pattern, which follows the working directory under --config.
        if (/^src\/editor\//u.test(repoPath(context.filename).toLowerCase())) return {};
        const test = (specifier, loader) => isEditorDeep(context, specifier, loader);
        return {
          ...specifierVisitors(context, test, "deepEditor"),
          // A type that names a module: import(M).X and typeof import(M) (TSImportType).
          TSImportType(node) {
            const source = node.source ?? node.argument?.literal;
            const specifier = staticSpecifier(source);
            if (typeof specifier === "string" && test(specifier)) context.report({ node: source, messageId: "deepEditor" });
          },
          // TypeScript's import x = require(M) (TSImportEqualsDeclaration).
          TSExternalModuleReference(node) {
            const specifier = staticSpecifier(node.expression);
            if (typeof specifier === "string" && test(specifier)) context.report({ node: node.expression, messageId: "deepEditor" });
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
  ...nextCoreWebVitals,
  ...nextTypescript,
  // Keep direct driver imports behind src/server/db (withActor, BACKEND 4.3).
  // This development guard covers literal specifiers in static imports,
  // import() and calls such as require; it does not resolve computed ones.
  // An inline directive cannot lift it unseen: tests/unit/db-boundary-forms
  // lints the repository again with directives off (F-019).
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
    // Route handlers and pages take withActor from the entry of src/server/db,
    // not from its modules (F-019).
    files: ["app/**"],
    rules: { "database-boundary/db-entry-only": "error" },
  },
  {
    // Integration tests and the full login E2E check the compose stack directly.
    // The session-GUC guard reads the driver's source text, and the pg-boss
    // contract its schema plan; neither runs a query.
    files: [
      "src/server/db/**",
      "tests/integration/**",
      "e2e/login/**",
      "tests/unit/session-guc-scope.test.ts",
      "scripts/db/pgboss-contract.mjs",
    ],
    rules: {
      "no-restricted-imports": "off",
      "database-boundary/no-restricted-dynamic-imports": "off",
    },
  },
  {
    // Everything outside src/editor reaches it through its entry (DAN-927);
    // the rule itself exempts the package's files. An inline directive cannot
    // lift it unseen: tests/unit/editor-boundary lints the repository again
    // with directives off.
    plugins: { "editor-boundary": editorBoundaryPlugin },
    rules: { "editor-boundary/entry-only": "error" },
  },
];

export default eslintConfig;
