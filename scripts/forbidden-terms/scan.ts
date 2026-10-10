import { existsSync, readFileSync, readdirSync } from "node:fs";
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
 * - Interface text modules (`UI_TEXT_MODULES`), JSON catalogues
 *   (`src/lib/i18n/**` `.json`) and static web app manifests under `app/**`:
 *   every string value; object keys, import paths and literal types are
 *   skipped.
 * - Components (`app/**` and `src/**` `.tsx`): JSX text, strings rendered from
 *   JSX expressions, the string value of every JSX attribute that is not on
 *   `TECHNICAL_ATTRIBUTES`, and the Next.js metadata described below.
 * - Any other `.ts` module under `app/**`: the Next.js metadata only, that is
 *   the `metadata` export, what `generateMetadata` and `generateImageMetadata`
 *   return, and the `alt` export of `opengraph-image` and `twitter-image`.
 * - Every other string in a `.ts` or `.tsx` module: checked against the
 *   Croatian entries only. Code is written in English, so a Croatian entry in
 *   a string is interface text wherever it stands, while the English entries
 *   (`hidden`, `saved`, `risk`) are ordinary words in SQL, log lines and DOM
 *   code. `findMisplacedUiText` reports other Croatian text in a `.ts` module
 *   outside the list, so interface text cannot move out of scope.
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
  // The web app manifest: name, short name and description of the application.
  "app/**/manifest.ts",
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

/**
 * JSX attributes whose value is never shown or read out to a person: it is a
 * token from a fixed set, a reference to another element, an address or
 * styling. Every other attribute is read, including `value`, `children` and
 * the props of the project's own components, because that is how text reaches
 * a component. `data-*` attributes are technical as a family (see
 * `isTechnicalAttribute`). An attribute belongs here only for what the
 * platform does with it, never because of the file it is used in.
 */
export const TECHNICAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  // Styling.
  "className",
  "class",
  "style",
  // Identity and references to other elements.
  "id",
  "name",
  "key",
  "ref",
  "slot",
  "htmlFor",
  "for",
  "form",
  "list",
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
  // Addresses.
  "href",
  "src",
  "srcSet",
  "action",
  "formAction",
  "poster",
  // Tokens from a fixed set.
  "type",
  "role",
  "hidden",
  "lang",
  "dir",
  "rel",
  "target",
  "method",
  "encType",
  "autoComplete",
  "inputMode",
  "loading",
  "decoding",
  "crossOrigin",
  "referrerPolicy",
  "aria-atomic",
  "aria-autocomplete",
  "aria-busy",
  "aria-checked",
  "aria-current",
  "aria-disabled",
  "aria-expanded",
  "aria-haspopup",
  "aria-hidden",
  "aria-invalid",
  "aria-live",
  "aria-modal",
  "aria-orientation",
  "aria-pressed",
  "aria-relevant",
  "aria-selected",
  "aria-sort",
]);

function isTechnicalAttribute(name: string): boolean {
  return TECHNICAL_ATTRIBUTES.has(name) || name.startsWith("data-");
}

const METADATA_FUNCTIONS = new Set(["generateMetadata", "generateImageMetadata"]);
const IMAGE_ROUTE_FILE = /(?:^|\/)(?:opengraph|twitter)-image\.[cm]?tsx?$/;
const MANIFEST_FILE = /^app\/(?:.*\/)?manifest\.(?:json|webmanifest)$/;

// Path segments are compared literally. A double star segment stands for any
// number of directories, including none; as the last segment it stands for
// everything below. No other wildcard is supported, and no RegExp is built.
function matchesSegments(pattern: readonly string[], file: readonly string[]): boolean {
  if (pattern.length === 0) return file.length === 0;
  const [head, ...rest] = pattern;
  if (head !== "**") return file.length > 0 && file[0] === head && matchesSegments(rest, file.slice(1));
  if (rest.length === 0) return file.length > 0;
  return file.some((_, skipped) => matchesSegments(rest, file.slice(skipped)));
}

const UI_TEXT_PATTERNS = UI_TEXT_MODULES.map((glob) => glob.split("/"));

/** Whether `file` (repository path with forward slashes) is on `UI_TEXT_MODULES`. */
export function isUiTextModule(file: string): boolean {
  const segments = file.split("/");
  return UI_TEXT_PATTERNS.some((pattern) => matchesSegments(pattern, segments));
}

type Collect = (node: ts.Node, text: string) => void;

/** The operands of a `+` chain, left to right; any other expression is its own single operand. */
function operands(expression: ts.Expression): ts.Expression[] {
  if (ts.isParenthesizedExpression(expression)) return operands(expression.expression);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return [...operands(expression.left), ...operands(expression.right)];
  }
  return [expression];
}

const isPlainString = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

/**
 * Strings an expression can render: literals, both branches of `?:`,
 * `&&`/`||`/`??` operands, `+` chains and templates. In a `+` chain adjacent
 * literals are joined as written and anything computed leaves a space, as a
 * template placeholder does; the computed parts are then read in turn.
 */
function renderedStrings(expression: ts.Expression, collect: Collect): void {
  if (isPlainString(expression)) {
    collect(expression, expression.text);
  } else if (ts.isTemplateExpression(expression)) {
    collect(expression, [expression.head.text, ...expression.templateSpans.map((s) => s.literal.text)].join(" "));
    for (const span of expression.templateSpans) renderedStrings(span.expression, collect);
  } else if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
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
    } else if (operator === ts.SyntaxKind.PlusToken) {
      const parts = operands(expression);
      if (parts.some(isPlainString)) {
        collect(expression, parts.map((part) => (isPlainString(part) ? part.text : " ")).join(""));
      }
      for (const part of parts) if (!isPlainString(part)) renderedStrings(part, collect);
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

/** What a metadata function returns: every `return` in its own body, or the body of an arrow without braces. */
function returnedStrings(body: ts.Node, collect: Collect): void {
  if (!ts.isBlock(body)) {
    allStrings(body, collect);
    return;
  }
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) allStrings(node.expression, collect);
    else ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
}

/** JSX text, rendered strings, attributes and Next.js metadata; in a `.ts` file only the metadata is left. */
function componentText(source: ts.SourceFile, collect: Collect): void {
  const isImageRoute = IMAGE_ROUTE_FILE.test(source.fileName);
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      if (node.text.trim() !== "") collect(node, node.text);
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      renderedStrings(node.expression, collect);
    } else if (ts.isJsxAttribute(node) && node.initializer && !isTechnicalAttribute(node.name.getText(source))) {
      if (ts.isStringLiteral(node.initializer)) collect(node.initializer, node.initializer.text);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        renderedStrings(node.initializer.expression, collect);
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (name === "metadata" || (name === "alt" && isImageRoute)) {
        allStrings(node.initializer, collect);
        return;
      }
      const value = node.initializer;
      if (METADATA_FUNCTIONS.has(name) && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
        returnedStrings(value.body, collect);
      }
    } else if (ts.isFunctionDeclaration(node) && node.name && METADATA_FUNCTIONS.has(node.name.text) && node.body) {
      returnedStrings(node.body, collect);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

type Kind = "catalogue" | "component";

/** A piece of text with the span of source it was read from (both zero in JSON). */
interface Located extends UiText {
  readonly start: number;
  readonly end: number;
}

function locate(file: string, content: string, kind: Kind): Located[] {
  const found: Located[] = [];
  if (file.endsWith(".json") || file.endsWith(".webmanifest")) {
    const lines = content.split("\n");
    const walk = (value: unknown): void => {
      if (typeof value === "string") {
        const line = lines.findIndex((row) => row.includes(JSON.stringify(value).slice(1, -1))) + 1;
        found.push({ file, line, text: value, start: 0, end: 0 });
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
    found.push({ file, line, text, start: node.getStart(source), end: node.getEnd() });
  };
  if (kind === "catalogue") allStrings(source, collect);
  else componentText(source, collect);
  return found;
}

const withoutSpan = ({ file, line, text }: Located): UiText => ({ file, line, text });

/**
 * Interface text in one source file. `catalogue` reads every string value,
 * `component` only what a component renders (see the module comment).
 */
export function extractUiText(file: string, content: string, kind: Kind): UiText[] {
  return locate(file, content, kind).map(withoutSpan);
}

/** The strings of a code file that lie outside everything in `read`. */
function stringsOutside(read: readonly Located[], file: string, content: string): UiText[] {
  return locate(file, content, "catalogue")
    .filter((text) => !read.some((seen) => seen.start <= text.start && text.end <= seen.end))
    .map(withoutSpan);
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
  for (const dir of SCANNED_DIRS) if (existsSync(path.join(root, dir))) yield* walk(dir);
}

const isModule = (file: string): boolean => /\.[cm]?ts$/.test(file) && !/\.d\.[cm]?ts$/.test(file);
const isCode = (file: string): boolean => isModule(file) || file.endsWith(".tsx");

/** How a file under `app/` or `src/` is read; `null` when the scan does not read it. */
function scanKind(file: string): Kind | null {
  if (file.endsWith(".tsx")) return "component";
  if (isModule(file)) {
    if (isUiTextModule(file)) return "catalogue";
    return file.startsWith("app/") ? "component" : null;
  }
  if (file.endsWith(".json") && file.startsWith(CATALOGUE_DIR)) return "catalogue";
  return MANIFEST_FILE.test(file) ? "catalogue" : null;
}

/**
 * Every piece of interface text in the repository at `root` that uses a
 * forbidden term. Text the file's kind reads is checked against the whole
 * dictionary; every other string in a code file against its Croatian entries.
 */
export function scanUiText(root: string): Finding[] {
  const findings: Finding[] = [];
  const check = (text: UiText, terms: ForbiddenTerm[]): void => {
    if (terms.length > 0) findings.push({ ...text, terms });
  };
  for (const file of sourceFiles(root)) {
    const kind = scanKind(file);
    if (kind === null && !isCode(file)) continue;
    const content = readFileSync(path.join(root, file), "utf8");
    const read = kind === null ? [] : locate(file, content, kind);
    for (const text of read) check(withoutSpan(text), findForbiddenTerms(text.text));
    if (kind === "catalogue" || !isCode(file)) continue;
    for (const text of stringsOutside(read, file, content)) check(text, findForbiddenTerms(text.text, "hr"));
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
 * is not reported. Text without a Croatian letter is not reported either;
 * `scanUiText` still checks it against the Croatian dictionary entries. English
 * text in a module outside the list is not caught.
 */
export function findMisplacedUiText(root: string): UiText[] {
  const misplaced: UiText[] = [];
  for (const file of sourceFiles(root)) {
    if (!isModule(file) || isUiTextModule(file)) continue;
    const content = readFileSync(path.join(root, file), "utf8");
    const kind = scanKind(file);
    const read = kind === null ? [] : locate(file, content, kind);
    for (const text of stringsOutside(read, file, content)) {
      if (looksLikeCroatianUiText(text.text)) misplaced.push(text);
    }
  }
  return misplaced;
}
