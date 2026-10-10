import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { findForbiddenTerms, type ForbiddenTerm } from "./terms";

/**
 * Finds interface text in the source tree and checks it against the
 * dictionary (docs/PRODUCT.md 5). Only text a person can read is checked:
 * identifiers, comments, class names and import paths are not, so technical
 * code may use words like `hidden` freely.
 *
 * - Modules (`app/**` and `src/**` `.ts`, which covers the state labels in
 *   `src/domain/**` and the catalogues in `src/lib/i18n/**`) and JSON
 *   catalogues (`src/lib/i18n/**` `.json`): every string value; object keys,
 *   import paths and literal types are skipped. A `.ts` module cannot say
 *   which of its strings reach the screen, so all of them are checked.
 * - Components (`app/**` and `src/**` `.tsx`): JSX text, strings rendered from
 *   JSX expressions, text attributes (alt, title, placeholder, label, aria-*)
 *   and the Next.js `metadata` export.
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

const SCANNED_DIRS = ["app", "src"];
const CATALOGUE_DIR = path.join("src", "lib", "i18n");
const SKIPPED_DIRS = new Set(["node_modules", ".next"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$/;

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

/** Interface text in one source file; `kind` decides which strings count. */
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

function* sourceFiles(root: string, dir: string): Generator<string> {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* sourceFiles(root, relative);
    } else if (!TEST_FILE.test(entry.name)) {
      yield relative;
    }
  }
}

/** How a file under `app/` or `src/` is read; `null` when it holds no interface text. */
function scanKind(file: string): "catalogue" | "component" | null {
  if (file.endsWith(".tsx")) return "component";
  if (/\.[cm]?ts$/.test(file)) return /\.d\.[cm]?ts$/.test(file) ? null : "catalogue";
  if (file.endsWith(".json")) return file.startsWith(CATALOGUE_DIR + path.sep) ? "catalogue" : null;
  return null;
}

/** Every piece of interface text in the repository at `root` that uses a forbidden term. */
export function scanUiText(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of sourceFiles(root, dir)) {
      const kind = scanKind(file);
      if (kind === null) continue;
      const content = readFileSync(path.join(root, file), "utf8");
      for (const text of extractUiText(file.split(path.sep).join("/"), content, kind)) {
        const terms = findForbiddenTerms(text.text);
        if (terms.length > 0) findings.push({ ...text, terms });
      }
    }
  }
  return findings;
}
