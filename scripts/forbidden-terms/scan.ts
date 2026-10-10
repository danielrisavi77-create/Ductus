import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { decodeEntities } from "./entities";
import { FORBIDDEN_TERMS, PHRASE_BREAK, findForbiddenTerms, findForbiddenTermsInMarkup, type ForbiddenTerm } from "./terms";

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
 *   `TECHNICAL_ATTRIBUTES`, and the Next.js metadata described below. JSX text
 *   and attribute strings are read as React renders them: HTML entities are
 *   decoded and line breaks follow the JSX rules. The content of every element
 *   is also read as one text, put together from its pieces, so a phrase that
 *   markup splits (`Nestali <strong>podaci</strong>`) is still found. A phrase
 *   goes on through an inline element and a `<br />`; it ends at any other
 *   element, at a component and at a computed value (`PHRASE_BREAK`). That
 *   text is read twice, as a sighted person sees it and as a screen reader
 *   speaks it, and an entry found in either reading is reported (see `hiding`).
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

/**
 * HTML elements that set their text inside a line of the parent (phrasing
 * content). Their content is read as part of the parent's text and joined to
 * it without a space, as the browser does: `Sum<b>njivo</b>` is one word. Any
 * other element, and every component, is a text of its own: it is read by
 * itself and stands in the parent's text between phrase breaks.
 */
export const INLINE_ELEMENTS: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);

/** Who a text reaches: a sighted person, or a person who hears it from a screen reader. */
type Audience = "sighted" | "spoken";
const AUDIENCES: readonly Audience[] = ["sighted", "spoken"];
/** Whether an element is kept from one audience; `maybe` when the source does not say, or says it can change. */
type Hiding = "no" | "yes" | "maybe";

/**
 * Class names that take content away from the eye and leave it to a screen
 * reader. Like `HIDING_CLASSES`, this is a convention the stylesheet has to
 * keep; these two lists are the only place such a name is recognised. A name
 * counts with a variant in front too (`md:sr-only`).
 */
export const VISUALLY_HIDDEN_CLASSES: ReadonlySet<string> = new Set(["sr-only", "visually-hidden"]);
/** Class names that take content away from everyone (`display: none`, `visibility: hidden`). */
export const HIDING_CLASSES: ReadonlySet<string> = new Set(["hidden", "invisible"]);
/** Inline style values that take content away from everyone. */
const HIDING_STYLES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["display", new Set(["none"])],
  ["visibility", new Set(["hidden", "collapse"])],
]);

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

/**
 * Takes a piece of text read from `node`; `at` is where the text starts when
 * that is not where the node starts. `check` is the text to check when it is
 * not the text to show: the same text with a phrase break at computed parts.
 */
type Collect = (node: ts.Node, text: string, at?: number, check?: string) => void;

/** One text in the two readings `findForbiddenTermsInMarkup` takes: pieces joined as rendered, and with a space at every element boundary. */
type Reading = readonly [joined: string, spaced: string];

const EMPTY: Reading = ["", ""];
/** Something that is shown but cannot be read: no phrase goes on through it. */
const UNKNOWN: Reading = [PHRASE_BREAK, PHRASE_BREAK];
/** A `<br />`: the words on both sides are still read as one phrase. */
const LINE_BREAK: Reading = [" ", " "];
/** An inline element one audience does not get: nothing in the text, an element boundary between its neighbours. */
const HIDDEN: Reading = ["", " "];
/** Most readings kept for one text; see `inSequence` in `componentText`. */
const MAX_READINGS = 64;

const exactly = (text: string): Reading[] => [[text, text]];
const distinct = (readings: readonly Reading[]): Reading[] => [...new Map(readings.map((reading) => [reading.join("\u0000"), reading])).values()];

interface Reader {
  /** Text that stands by itself and is checked against every entry. */
  readonly text: Collect;
  /** A piece of a unit: checked by itself, except for contextual entries, which the unit decides. */
  readonly part: Collect;
  /** The content of an element or the value of an attribute expression, in every form it can be rendered. */
  readonly unit: (at: number, start: number, end: number, readings: readonly Reading[]) => void;
}

/**
 * JSX text as React renders it: lines are trimmed where they meet a line
 * break, empty lines are dropped, the rest is joined with single spaces and
 * HTML entities are decoded. White space next to a tag on the same line stays.
 */
export function jsxTextValue(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  const kept = lines
    .map((line, index) => {
      const fromStart = index > 0 ? line.trimStart() : line;
      return index < lines.length - 1 ? fromStart.trimEnd() : fromStart;
    })
    .filter((line) => line !== "");
  return decodeEntities(kept.join(" "));
}

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
      const pieces = [current.head.text, ...current.templateSpans.map((s) => s.literal.text)];
      collect(current, pieces.join(" "), undefined, pieces.join(PHRASE_BREAK));
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

type JsxNode = ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement;
const isJsxNode = (node: ts.Node): node is JsxNode =>
  ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node);

const RENDERS_NOTHING = new Set([ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword]);

const neverSet = (node: ts.Expression): boolean =>
  node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined");

/** Every string written anywhere inside `node`. */
function stringsWithin(node: ts.Node): string[] {
  if (isPlainString(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.flatMap((span) => [...stringsWithin(span.expression), span.literal.text])];
  const found: string[] = [];
  ts.forEachChild(node, (child) => void found.push(...stringsWithin(child)));
  return found;
}

/**
 * Whether the attributes of an element keep its content from `audience`.
 *
 * - `aria-hidden` keeps it from a screen reader: without a value or with
 *   `true` always, with `false` never, with anything else maybe.
 * - A class on `VISUALLY_HIDDEN_CLASSES` keeps it from the eye: always when it
 *   is written as one string without variants, otherwise maybe.
 * - The `hidden` attribute, a class on `HIDING_CLASSES` and an inline
 *   `display` or `visibility` that hides, or is computed, keep it from both,
 *   and only maybe: such content is there to be shown at some point.
 * - Spread props can carry any of these: maybe, for both.
 *
 * Not covered, because the value is not in the element: a class or a `style`
 * that comes from a variable or a CSS module, a rule in a stylesheet, and what
 * a parent element or a component does to its children.
 */
function hiding(source: ts.SourceFile, element: ts.JsxOpeningElement, audience: Audience): Hiding {
  let result: Hiding = "no";
  const maybe = (): void => void (result = result === "yes" ? "yes" : "maybe");
  for (const attribute of element.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      maybe();
      continue;
    }
    const name = attribute.name.getText(source);
    const written = attribute.initializer;
    const value = written && ts.isJsxExpression(written) ? written.expression : written;
    if (name === "aria-hidden" && audience === "spoken") {
      const token = value && isPlainString(value) ? value.text.trim().toLowerCase() : undefined;
      if (value === undefined || value.kind === ts.SyntaxKind.TrueKeyword || token === "true") result = "yes";
      else if (!neverSet(value) && token !== "false") maybe();
    } else if (name === "hidden") {
      if (value === undefined || !neverSet(value)) maybe();
    } else if ((name === "className" || name === "class") && value) {
      const classes = stringsWithin(value).flatMap((text) => text.split(/\s+/).filter(Boolean));
      const named = (list: ReadonlySet<string>): boolean => classes.some((token) => list.has(token.slice(token.lastIndexOf(":") + 1).replace(/^!/, "")));
      if (named(HIDING_CLASSES)) maybe();
      if (audience === "sighted" && named(VISUALLY_HIDDEN_CLASSES)) {
        if (isPlainString(value) && !classes.some((token) => token.includes(":"))) result = "yes";
        else maybe();
      }
    } else if (name === "style" && value && ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        const hides = property.name && (ts.isIdentifier(property.name) || isPlainString(property.name)) ? HIDING_STYLES.get(property.name.text) : undefined;
        if (!hides) continue;
        const set = ts.isPropertyAssignment(property) ? property.initializer : undefined;
        if (!set || !isPlainString(set) || hides.has(set.text.trim().toLowerCase())) maybe();
      }
    }
  }
  return result;
}

/** JSX text, rendered strings, attributes and Next.js metadata; in a `.ts` file only the metadata is left. */
function componentText(source: ts.SourceFile, reader: Reader): void {
  const isImageRoute = IMAGE_ROUTE_FILE.test(source.fileName);
  /** Inline elements and fragments already read as part of the unit around them. */
  const absorbed = new Set<ts.Node>();
  /** The audience the text is being read for, and how many elements around the current one each audience never gets. */
  let audience: Audience = "sighted";
  const withheld: Record<Audience, number> = { sighted: 0, spoken: 0 };

  // Readings of parts that follow one another. A part that would take the
  // count past MAX_READINGS is read as unknown text and its alternatives go to
  // `alone`, to be checked by themselves.
  const inSequence = (parts: readonly Reading[][], alone: Reading[]): Reading[] => {
    let all: Reading[] = [EMPTY];
    for (const part of parts) {
      let options = part;
      if (all.length * part.length > MAX_READINGS) {
        alone.push(...part);
        options = [UNKNOWN];
      }
      all = distinct(all.flatMap(([joined, spaced]) => options.map(([j, s]): Reading => [joined + j, spaced + s])));
    }
    return all;
  };

  // Every text an expression can render. Both branches of `?:`, `||` and `??`
  // are alternatives, `&&` can also render nothing, `+` and templates put
  // their parts in a row, and anything computed is unknown text.
  const expressionReadings = (expression: ts.Expression, alone: Reading[]): Reading[] => {
    if (isPlainString(expression)) return exactly(expression.text);
    if (RENDERS_NOTHING.has(expression.kind)) return [EMPTY];
    if (isJsxNode(expression)) return elementReadings(expression, alone);
    if (ts.isTemplateExpression(expression)) {
      const parts = [exactly(expression.head.text)];
      for (const span of expression.templateSpans) {
        parts.push(expressionReadings(span.expression, alone), exactly(span.literal.text));
      }
      return inSequence(parts, alone);
    }
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isNonNullExpression(expression)
    ) {
      return expressionReadings(expression.expression, alone);
    }
    if (ts.isConditionalExpression(expression)) {
      return distinct([...expressionReadings(expression.whenTrue, alone), ...expressionReadings(expression.whenFalse, alone)]);
    }
    if (ts.isBinaryExpression(expression)) {
      const operator = expression.operatorToken.kind;
      if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
        return distinct([...expressionReadings(expression.left, alone), ...expressionReadings(expression.right, alone)]);
      }
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        return distinct([EMPTY, ...expressionReadings(expression.right, alone)]);
      }
      if (operator === ts.SyntaxKind.PlusToken) {
        return inSequence(
          operands(expression).map((part) => expressionReadings(part, alone)),
          alone,
        );
      }
    }
    return [UNKNOWN];
  };

  const contentReadings = (node: ts.JsxElement | ts.JsxFragment, alone: Reading[]): Reading[] =>
    inSequence(
      node.children.map((child) => {
        if (ts.isJsxText(child)) return exactly(jsxTextValue(child.text));
        if (ts.isJsxExpression(child)) return child.expression ? expressionReadings(child.expression, alone) : [EMPTY];
        return elementReadings(child, alone);
      }),
      alone,
    );

  // An element as it stands in the text around it. An element without
  // children shows something unknown (an icon), except `br`, a line break,
  // and `wbr`, which shows nothing. A fragment is its content. Any element
  // that is not inline ends the phrase on both sides; see `INLINE_ELEMENTS`.
  const elementReadings = (node: JsxNode, alone: Reading[]): Reading[] => {
    if (ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      return [tag === "wbr" ? EMPTY : tag === "br" ? LINE_BREAK : UNKNOWN];
    }
    if (ts.isJsxFragment(node)) {
      absorbed.add(node);
      return contentReadings(node, alone);
    }
    if (!INLINE_ELEMENTS.has(node.openingElement.tagName.getText(source))) {
      return contentReadings(node, alone).map(([joined, spaced]): Reading => [PHRASE_BREAK + joined + PHRASE_BREAK, PHRASE_BREAK + spaced + PHRASE_BREAK]);
    }
    // An inline element is part of the text only for the audience that gets
    // it. Content that neither audience gets is hidden by a class at least
    // once, which only the stylesheet makes true, so it is read by itself.
    absorbed.add(node);
    const other = audience === "sighted" ? "spoken" : "sighted";
    const [here, there] = [hiding(source, node.openingElement, audience), hiding(source, node.openingElement, other)];
    if (there === "yes") withheld[other] += 1;
    const content = contentReadings(node, alone);
    if (there === "yes") withheld[other] -= 1;
    const shown = content.map(([joined, spaced]): Reading => [joined, ` ${spaced} `]);
    if (here === "no") return shown;
    if (here === "maybe") return distinct([...shown, HIDDEN]);
    if (withheld[other] > 0 || there === "yes") alone.push(...content);
    return [HIDDEN];
  };

  // A text in every reading it has: for each audience in turn, then the parts
  // that are read by themselves.
  const forEveryone = (read: (alone: Reading[]) => Reading[]): Reading[] => {
    const alone: Reading[] = [];
    const readings = AUDIENCES.flatMap((to) => {
      audience = to;
      return read(alone);
    });
    return distinct([...readings, ...alone]);
  };

  const textStart = (node: ts.JsxText): number => node.end - node.text.trimStart().length;

  /** Where the content of an element starts: its first text or, failing that, its first child. */
  const contentStart = (node: ts.JsxElement | ts.JsxFragment): number => {
    for (const child of node.children) {
      if (!ts.isJsxText(child)) return child.getStart(source);
      if (child.text.trim() !== "") return textStart(child);
    }
    return node.getStart(source);
  };

  const visit = (node: ts.Node): void => {
    if ((ts.isJsxElement(node) || ts.isJsxFragment(node)) && !absorbed.has(node)) {
      const readings = forEveryone((alone) => contentReadings(node, alone));
      reader.unit(contentStart(node), node.children.pos, node.children.end, readings);
    } else if (ts.isJsxText(node)) {
      const value = jsxTextValue(node.text);
      if (value.trim() !== "") reader.part(node, value, textStart(node));
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      renderedStrings(node.expression, reader.part);
    } else if (ts.isJsxAttribute(node) && node.initializer && !isTechnicalAttribute(node.name.getText(source))) {
      if (ts.isStringLiteral(node.initializer)) reader.text(node.initializer, decodeEntities(node.initializer.text));
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const expression = node.initializer.expression;
        renderedStrings(expression, reader.part);
        const readings = forEveryone((alone) => expressionReadings(expression, alone));
        reader.unit(expression.getStart(source), expression.pos, expression.end, readings);
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (name === "metadata" || (name === "alt" && isImageRoute)) {
        allStrings(node.initializer, reader.text);
        return;
      }
      const value = node.initializer;
      if (METADATA_FUNCTIONS.has(name) && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
        returnedStrings(value.body, reader.text);
      }
    } else if (ts.isFunctionDeclaration(node) && node.name && METADATA_FUNCTIONS.has(node.name.text) && node.body) {
      returnedStrings(node.body, reader.text);
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
  /** Set for a piece of a unit; see `Reader`. */
  readonly part?: true;
  /** The text to check when it is not `text`; see `Collect`. */
  readonly check?: string;
}

/** Text put together from pieces: where it starts, the span that holds its pieces and its readings. */
interface Unit {
  readonly line: number;
  readonly at: number;
  readonly start: number;
  readonly end: number;
  readonly readings: readonly Reading[];
}

interface Read {
  readonly texts: Located[];
  readonly units: Unit[];
}

const NOTHING_READ: Read = { texts: [], units: [] };

function locate(file: string, content: string, kind: Kind): Read {
  const texts: Located[] = [];
  const units: Unit[] = [];
  if (file.endsWith(".json") || file.endsWith(".webmanifest")) {
    const lines = content.split("\n");
    const walk = (value: unknown): void => {
      if (typeof value === "string") {
        const line = lines.findIndex((row) => row.includes(JSON.stringify(value).slice(1, -1))) + 1;
        texts.push({ file, line, text: value, start: 0, end: 0 });
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(JSON.parse(content));
    return { texts, units };
  }
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const lineAt = (position: number): number => source.getLineAndCharacterOfPosition(position).line + 1;
  const collect =
    (part?: true): Collect =>
    (node, text, at, check) => {
      const start = at ?? node.getStart(source);
      texts.push({ file, line: lineAt(start), text, start, end: node.getEnd(), ...(part && { part }), ...(check !== undefined && { check }) });
    };
  if (kind === "catalogue") allStrings(source, collect());
  else {
    componentText(source, {
      text: collect(),
      part: collect(true),
      unit: (at, start, end, readings) => units.push({ line: lineAt(at), at, start, end, readings }),
    });
  }
  return { texts, units };
}

const withoutSpan = ({ file, line, text }: UiText): UiText => ({ file, line, text });

/**
 * The pieces of interface text in one source file. `catalogue` reads every
 * string value, `component` only what a component renders (see the module
 * comment). `scanUiText` also checks the pieces of one element put together.
 */
export function extractUiText(file: string, content: string, kind: Kind): UiText[] {
  return locate(file, content, kind).texts.map(withoutSpan);
}

/** The strings of a code file that lie outside everything in `read`. */
function stringsOutside(read: readonly Located[], file: string, content: string): Located[] {
  return locate(file, content, "catalogue").texts.filter((text) => !read.some((seen) => seen.start <= text.start && text.end <= seen.end));
}

/**
 * Findings in what was read from one file, in source order. A piece is
 * reported where it stands. A unit is reported for the entries that nothing
 * inside it was reported for: a phrase that only exists once the pieces are
 * put together, or a contextual entry.
 */
function findingsIn(file: string, read: Read): Finding[] {
  const placed: { at: number; start: number; end: number; finding: Finding }[] = [];
  for (const text of read.texts) {
    const terms = findForbiddenTerms(text.check ?? text.text).filter((term) => !(text.part && term.contextual));
    if (terms.length > 0) placed.push({ at: text.start, start: text.start, end: text.end, finding: { ...withoutSpan(text), terms } });
  }
  const pieces = [...placed];
  const units = read.units.map((unit) => {
    const hits = unit.readings.map(([joined, spaced]) => ({ text: joined, terms: findForbiddenTermsInMarkup(joined, spaced) }));
    return { ...unit, hits, terms: new Set(hits.flatMap((hit) => hit.terms)) };
  });
  for (const unit of units) {
    const holds = (other: { start: number; end: number }): boolean => unit.start <= other.start && other.end <= unit.end;
    const reported = new Set([
      ...pieces.filter(holds).flatMap((piece) => piece.finding.terms),
      ...units.filter((inner) => holds(inner) && !(inner.start === unit.start && inner.end === unit.end)).flatMap((inner) => [...inner.terms]),
    ]);
    const terms = FORBIDDEN_TERMS.filter((term) => unit.terms.has(term) && !reported.has(term));
    const hit = unit.hits.find((candidate) => candidate.terms.some((term) => terms.includes(term)));
    if (hit) placed.push({ ...unit, finding: { file, line: unit.line, text: hit.text, terms } });
  }
  return placed.sort((a, b) => a.at - b.at).map((entry) => entry.finding);
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

/**
 * Guard for the file types the scan does not read: `.js`, `.jsx`, `.mjs`,
 * `.cjs` and `.mdx` under `app/` and `src/` (repository paths, sorted). The
 * project is TypeScript, so there are none today. A file of this kind would
 * hold interface text the scan never looks at and leave it green, so the
 * repository test fails on every one. The fix is to write the file as `.ts` or
 * `.tsx`, never to exempt it.
 */
export function findUnreadSourceFiles(root: string): string[] {
  return [...sourceFiles(root)].filter((file) => /\.(?:[cm]?jsx?|mdx)$/.test(file)).sort();
}

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
    const read = kind === null ? NOTHING_READ : locate(file, content, kind);
    findings.push(...findingsIn(file, read));
    if (kind === "catalogue" || !isCode(file)) continue;
    for (const text of stringsOutside(read.texts, file, content)) check(withoutSpan(text), findForbiddenTerms(text.check ?? text.text, "hr"));
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
    const read = kind === null ? NOTHING_READ : locate(file, content, kind);
    for (const text of stringsOutside(read.texts, file, content)) {
      if (looksLikeCroatianUiText(text.text)) misplaced.push(withoutSpan(text));
    }
  }
  return misplaced;
}
