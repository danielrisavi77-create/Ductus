import { dirname, join, posix, relative, resolve, sep } from "node:path";
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

// The name of a member: x.resolve, or a literal computed one, x["resolve"].
const memberName = (node) => (node.computed ? staticSpecifier(node.property) : node.property.name);

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
  if (callee.type === "MemberExpression") return memberName(callee) === "createRequire";
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
    return node.object.type === "Identifier" && node.object.name === "module" && memberName(node) === "require";
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
  if (callee.type !== "MemberExpression" || memberName(callee) !== "resolve") return false;
  return callee.object.type === "MetaProperty" || isRequire(context, callee.object);
}

// Report every literal specifier that `test` matches, in the forms a file can
// name a module with: static import and export, import(), and a loader call
// (isLoaderCall) with the specifier as its first argument. `test` also gets
// the loader call, undefined for the other forms.
function specifierVisitors(context, test, messageId, { skipStatic } = {}) {
  const check = (node, call) => {
    const specifier = staticSpecifier(node);
    if (typeof specifier === "string" && test(specifier, call)) context.report({ node, messageId });
  };
  return {
    ImportExpression(node) {
      check(node.source);
    },
    CallExpression(node) {
      if (isLoaderCall(context, node.callee)) check(node.arguments[0], node);
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

// DAN-927: outside src/editor, the editor is imported through its entry
// @/editor only. A specifier is read the ways a loader reads it, with the URL
// parser and with path.resolve, and reported when any reading names a module
// of the package other than its entry, or when it cannot be placed.
const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
// The names of a path in the repository as Windows reads them as well: any
// letter case, trailing dots and spaces and a ":stream" suffix dropped.
const repoNames = (path) =>
  relative(REPO_ROOT.toLowerCase(), path.toLowerCase())
    .split(/[\\/]/u)
    .map((name) => name.replace(/:.*$/su, "").replace(/[. ]+$/u, ""));
function isDeepEditor(path) {
  const [top, pkg, ...rest] = repoNames(path);
  return top === "src" && pkg === "editor" && rest.length > 0 && !(rest.length === 1 && /^index(?:\.[cm]?[jt]sx?)?$/u.test(rest[0]));
}
// From directory dir: as a URL (ESM, bundlers: tab, CR and LF removed,
// percent-decoded, query and hash cut) and as a file path (require,
// TypeScript), with either slash. Throws when the URL reading fails.
const readings = (dir, text) => [
  resolve(dir, text),
  resolve(dir, text.replace(/\\/g, "/")),
  fileURLToPath(new URL(text, pathToFileURL(`${dir}/`))),
];
const PACKAGE_RE = /^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.@+-]+)*$/u;
// The bases a bare name is read from: the repository root, the file's
// directory (new URL) and each node_modules from there up to the root, as
// Node looks for packages, so pkg/../../src/editor/x is read too.
function bareBases(dir) {
  const bases = [REPO_ROOT];
  for (let at = dir ?? REPO_ROOT; ; at = dirname(at)) {
    bases.push(join(at, "node_modules"));
    if (at === REPO_ROOT || at === dirname(at)) break;
  }
  return dir ? [...bases, dir] : bases;
}
function reachesEditor(text, dir) {
  try {
    let url;
    try {
      url = new URL(text);
    } catch {
      // No scheme: a path, the alias or a bare name.
    }
    if (url) return url.protocol !== "node:" && (url.protocol !== "file:" || isDeepEditor(fileURLToPath(url)));
    let paths;
    if (/^@[\\/]/u.test(text)) {
      paths = readings(join(REPO_ROOT, "src"), `./${text.slice(2)}`);
    } else if (/^(?:\.\.?)?[\\/]|^\.\.?$/u.test(text)) {
      if (!dir) return true;
      paths = readings(dir, text);
    } else {
      if (!dir && !(PACKAGE_RE.test(text) && !/(?:^|\/)\.\.?(?:\/|$)/u.test(text))) return true;
      paths = bareBases(dir).flatMap((base) => readings(base, text));
    }
    return paths.some(isDeepEditor);
  } catch {
    return true;
  }
}
const isMeta = (node, names) =>
  node?.type === "MemberExpression" && node.object.type === "MetaProperty" && names.includes(memberName(node));
const isFree = (context, node, name) => node?.type === "Identifier" && node.name === name && !binding(context, node, name);
// The directory a loader call resolves from; undefined when it is not this
// file's: a second argument, or createRequire from another base.
function loaderBase(context, call, dir) {
  if (call === undefined) return dir;
  if (call.arguments.length !== 1) return undefined;
  let callee = call.callee;
  if (callee.type === "MemberExpression" && memberName(callee) === "resolve") callee = callee.object;
  let made = callee.type === "CallExpression" ? callee : undefined;
  if (callee.type === "Identifier") {
    const def = binding(context, callee, callee.name);
    if (def?.type === "Variable" && def.node.init?.type === "CallExpression") made = def.node.init;
  }
  if (made === undefined) return dir;
  const [base, ...more] = made.arguments;
  if (more.length > 0) return undefined;
  if (isMeta(base, ["url", "filename"]) || isFree(context, base, "__filename")) return dir;
  if (isMeta(base, ["dirname"]) || isFree(context, base, "__dirname")) return dirname(dir);
  return undefined;
}

const editorBoundaryPlugin = {
  rules: {
    "entry-only": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          deepEditor: "Outside src/editor, import the editor through @/editor only; a specifier this check cannot place is reported too.",
        },
      },
      create(context) {
        const [top, pkg, ...rest] = relative(REPO_ROOT, context.filename).split(sep);
        if (top === "src" && pkg === "editor" && rest.length > 0) return {};
        const dir = dirname(context.filename);
        const test = (text, call) => reachesEditor(text, loaderBase(context, call, dir));
        const check = (node) => {
          const text = staticSpecifier(node);
          if (typeof text === "string" && test(text)) context.report({ node, messageId: "deepEditor" });
        };
        return {
          ...specifierVisitors(context, test, "deepEditor"),
          // TypeScript: import("M").X, typeof import("M"), import x = require("M").
          TSImportType(node) {
            check(node.source ?? node.argument?.literal ?? node.argument);
          },
          TSExternalModuleReference(node) {
            check(node.expression);
          },
          // new URL("M", import.meta.url), which bundlers follow.
          NewExpression(node) {
            if (isFree(context, node.callee, "URL") && node.arguments.length === 2 && isMeta(node.arguments[1], ["url"])) {
              check(node.arguments[0]);
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
    // Every file outside src/editor (DAN-927); an inline directive cannot lift
    // it unseen, tests/unit/editor-boundary lints again with directives off.
    plugins: { "editor-boundary": editorBoundaryPlugin },
    rules: { "editor-boundary/entry-only": "error" },
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
];

export default eslintConfig;
