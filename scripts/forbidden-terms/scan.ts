import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { findForbiddenTerms, type ForbiddenTerm } from "./terms";

/**
 * Finds interface text in the source tree and checks it against the
 * dictionary (docs/PRODUCT.md 5). Only text a person can read is checked:
 * identifiers, comments, class names, import paths, SQL, log lines and DOM
 * attribute values are not, so technical code may use words like `hidden`
 * or `saved_at` freely.
 *
 * - Interface text modules (`UI_TEXT_MODULES`) and JSON catalogues
 *   (`src/lib/i18n/**` `.json`): every string value; object keys, import
 *   paths and literal types are skipped.
 * - Components (`app/**` and `src/**` `.tsx`): JSX text, strings rendered from
 *   JSX expressions, the attributes a person reads or hears (`TEXT_ATTRIBUTES`)
 *   and the Next.js `metadata` export. Other attributes (`aria-hidden`, `type`,
 *   `role`, `className`, `data-*`, `id`, `name`, `href`, `style`) are not read.
 * - Any other `.ts` module under `app/**`: the Next.js `metadata` export only.
 * - Any other `.ts` module: not read. `findMisplacedUiText` reports Croatian
 *   text that turns up there, so interface text cannot move out of scope.
 *
 * Test files (`*.test.*`, `*.spec.*`) and declaration files are not read.
 */
export interface UiText {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface Finding extends UiText {
  readonly terms: readonly ForbiddenTerm[];
}

/**
 * The `.ts` modules that hold interface text, as globs over repository paths.
 * Every string value in them is checked, so they should hold text and the
 * code that picks it; SQL, log lines and DOM code belong elsewhere. A module
 * that starts to hold interface text is named to match a pattern below or is
 * added here. This is the only list: there are no exemptions per file or per
 * finding.
 */
export const UI_TEXT_MODULES: readonly string[] = [
  // Message catalogues.
  "src/lib/i18n/**",
  // Label and message modules wherever they live (today src/domain/sync/labels.ts).
  "**/labels.ts",
  "**/messages.ts",
  "**/copy.ts",
  // Messages for loading, sending and checkpoints, kept next to their codes.
  "src/domain/serverSync/**",
  // The editor placeholder.
  "src/editor/schema.ts",
];

const SCANNED_DIRS = ["app", "src"];
const CATALOGUE_DIR = "src/lib/i18n/";
const SKIPPED_DIRS = new Set(["node_modules", ".next"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$/;
const CROATIAN_LETTER = /[čćđšž]/iu;
const STARTS_WITH_CAPITAL = /^[^\p{L}]*\p{Lu}/u;

function looksLikeCroatianUiText(text: string): boolean {
  const trimmed = text.trim();
  return CROATIAN_LETTER.test(trimmed) && (/\s/u.test(trimmed) || STARTS_WITH_CAPITAL.test(trimmed));
}

const TEXT_ATTRIBUTES = new Set([
  "alt",
  "title",
  "placeholder",
  "label",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
]);

// A double star crosses directories (followed by a slash it may match none);
// a single star stays inside one name.
function globPattern(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
    .replace(/\*\*\/|\*\*|\*/g, (wildcard) => (wildcard === "**/" ? "(?:.*/)?" : wildcard === "**" ? ".*" : "[^/]*"));
  return new RegExp(`^${body}$`, "u");
}

const UI_TEXT_PATTERNS = UI_TEXT_MODULES.map(globPattern);

/** Whether `file` (repository path with forward slashes) is on `UI_TEXT_MODULES`. */
export function isUiTextModule(file: string): boolean {
  return UI_TEXT_PATTERNS.some((pattern) => pattern.test(file));
}

type Collect = (node: ts.Node, text: string) => void;

/** Strings an expression can render: literals, both branches of `?:`, `&&`/`||`/`??` operands. */
function renderedStrings(expression: ts.Expression, collect: Collect): void {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    collect(expression, expression.text);
  } else if (ts.isTemplateExpression(expression)) {
    collect(expression, [expression.head.text, ...expression.templateSpans.map((s) => s.literal.text)].join(" "));
  } else if (ts.isParenthesizedExpression(expression)) {
    renderedStrings(expression.expression, collect);
  } else if (ts.isConditionalExpression(expression)) {
    renderedStrings(expression.whenTrue, collect);
    renderedStrings(expression.whenFalse, collect);
  } else if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
      renderedStrings(expression.left, collect);
      renderedStrings(expression.right, collect);
    } else if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      renderedStrings(expression.right, collect);
    }
  }
}

/** Every string value below `node`, except object keys and module specifiers. */
function allStrings(node: ts.Node, collect: Collect): void {
  const visit = (current: ts.Node): void => {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current) || ts.isImportTypeNode(current)) return;
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      const parent = current.parent;
      const isKey = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === current;
      const isTypeOnly = ts.isLiteralTypeNode(parent);
      if (!isKey && !isTypeOnly) collect(current, current.text);
      return;
    }
    if (ts.isTemplateExpression(current)) {
      collect(current, [current.head.text, ...current.templateSpans.map((s) => s.literal.text)].join(" "));
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
}

/** JSX text, rendered strings, text attributes and `metadata`; in a `.ts` file only `metadata` is left. */
function componentText(source: ts.SourceFile, collect: Collect): void {
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      if (node.text.trim() !== "") collect(node, node.text);
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      renderedStrings(node.expression, collect);
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(source)) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) collect(node.initializer, node.initializer.text);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        renderedStrings(node.initializer.expression, collect);
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "metadata" &&
      node.initializer
    ) {
      allStrings(node.initializer, collect);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/**
 * Interface text in one source file. `catalogue` reads every string value,
 * `component` only what a component renders (see the module comment).
 */
export function extractUiText(file: string, content: string, kind: "catalogue" | "component"): UiText[] {
  const found: UiText[] = [];
  if (file.endsWith(".json")) {
    const lines = content.split("\n");
    const walk = (value: unknown): void => {
      if (typeof value === "string") {
        const line = lines.findIndex((row) => row.includes(JSON.stringify(value).slice(1, -1))) + 1;
        found.push({ file, line, text: value });
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(JSON.parse(content));
    return found;
  }
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const collect: Collect = (node, text) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    found.push({ file, line, text });
  };
  if (kind === "catalogue") allStrings(source, collect);
  else componentText(source, collect);
  return found;
}

/** Non-test files under `app/` and `src/`, as repository paths with forward slashes. */
function* sourceFiles(root: string): Generator<string> {
  const walk = function* (dir: string): Generator<string> {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) yield* walk(relative);
      } else if (!TEST_FILE.test(entry.name)) {
        yield relative;
      }
    }
  };
  for (const dir of SCANNED_DIRS) yield* walk(dir);
}

const isModule = (file: string): boolean => /\.[cm]?ts$/.test(file) && !/\.d\.[cm]?ts$/.test(file);

/** How a file under `app/` or `src/` is read; `null` when the scan does not read it. */
function scanKind(file: string): "catalogue" | "component" | null {
  if (file.endsWith(".tsx")) return "component";
  if (isModule(file)) {
    if (isUiTextModule(file)) return "catalogue";
    return file.startsWith("app/") ? "component" : null;
  }
  if (file.endsWith(".json")) return file.startsWith(CATALOGUE_DIR) ? "catalogue" : null;
  return null;
}

/** Every piece of interface text in the repository at `root` that uses a forbidden term. */
export function scanUiText(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const file of sourceFiles(root)) {
    const kind = scanKind(file);
    if (kind === null) continue;
    const content = readFileSync(path.join(root, file), "utf8");
    for (const text of extractUiText(file, content, kind)) {
      const terms = findForbiddenTerms(text.text);
      if (terms.length > 0) findings.push({ ...text, terms });
    }
  }
  return findings;
}

/**
 * Guard for the narrow scope above: strings in a `.ts` module that is not on
 * `UI_TEXT_MODULES` which have a Croatian letter (č, ć, đ, š, ž) and either
 * white space or a capital first letter. Such a string looks like interface
 * text that the scan would not read. The fix is to move it into a listed
 * module or to extend the list, never to exempt the file.
 *
 * A single lower-case word ("može" in a word list) is data, not a label, and
 * is not reported. Not caught either: text without a Croatian letter and
 * English text in a module outside the list.
 */
export function findMisplacedUiText(root: string): UiText[] {
  const misplaced: UiText[] = [];
  for (const file of sourceFiles(root)) {
    if (!isModule(file) || isUiTextModule(file)) continue;
    const content = readFileSync(path.join(root, file), "utf8");
    const kind = scanKind(file);
    const read = new Set(kind === null ? [] : extractUiText(file, content, kind).map((t) => `${t.line}:${t.text}`));
    for (const text of extractUiText(file, content, "catalogue")) {
      if (looksLikeCroatianUiText(text.text) && !read.has(`${text.line}:${text.text}`)) misplaced.push(text);
    }
  }
  return misplaced;
}
