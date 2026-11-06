/**
 * D-46 guard (DAN-413, M9.6-P01; contract #1091 c.6680511432). Before an AI
 * proofreading or translation is applied, the numbers, literal quotations and
 * source marks of the proposed text are compared with those of the source.
 * Pure: no network, no model, no I/O and no logging; the texts never leave
 * the function. It decides nothing about the provider or model (Q-10).
 *
 * - Each kind is a sequence of keys. A key that is missing or extra is
 *   `removed` or `added`; the same keys in another order is `reordered`.
 * - Quotes are taken first, then source marks outside quotes, then numbers
 *   outside both, so a digit inside a quote counts once, as part of the quote.
 * - Over `MAX_PROTECTED_TEXT_LENGTH` there are no findings, only `too-long`:
 *   the caller must not apply the proposal unchecked.
 * - Every scan is linear in the text; no pattern runs over the whole text.
 */
import { fpzgCitationStyle, type CitationStyle } from "@/domain/citation";

export const MAX_PROTECTED_TEXT_LENGTH = 200_000;
const MAX_SOURCE_MARK_LENGTH = 300;

export type ProtectedKind = "source" | "quote" | "number";
export type ProtectedFinding =
  | Readonly<{ kind: ProtectedKind; change: "removed" | "added"; text: string; count: number }>
  | Readonly<{ kind: ProtectedKind; change: "reordered" }>;
export type ProtectedCheck =
  | Readonly<{ ok: true; findings: readonly ProtectedFinding[] }>
  | Readonly<{ ok: false; reason: "too-long" | "not-text" }>;

type Item = { key: string; text: string };
type Scan = { rest: string; items: Item[] };

const D = String.raw`\p{Nd}`;
const HS = String.raw`[\t   -   　]`;
const DASH = String.raw`[\-‐-―−﹣－]`;
const SIGN = String.raw`[+\-‐-–−﹣－]`;
const GROUP = String.raw`[.   ]`;
const INT = `${D}{1,3}(?:${GROUP}${D}{3}(?!${D}))+|${D}+`;
const NUM = `(?:${INT})(?:[.,]${D}+)?`;
// A sign after a letter or digit is a hyphen (COVID-19) or a range dash.
const LEAD_SIGN = String.raw`(?<![\p{L}\p{N}])${SIGN}`;
const NUMBER_PARTS = new RegExp(`^(?<int>${INT})(?:[.,](?<frac>${D}+))?$`, "u");
const GROUPS = new RegExp(GROUP, "gu");
const HS_RUN = new RegExp(`${HS}+`, "gu");
const PAGE_DASH = new RegExp(`${HS}*${DASH}${HS}*`, "gu");
const TOKEN = new RegExp(
  `(?<dd>${D}{1,2})\\.${HS}{0,2}(?<dm>${D}{1,2})\\.${HS}{0,2}(?<dy>${D}{4})(?!${D})` +
    `|(?<iy>${D}{4})-(?<im>${D}{2})-(?<id>${D}{2})(?!${D})` +
    `|(?<fs>${LEAD_SIGN})?(?<from>${NUM})${HS}{0,3}${DASH}${HS}{0,3}(?<ts>${SIGN})?(?<to>${NUM})` +
    `|(?<sign>${LEAD_SIGN})?(?<num>${NUM})`,
  "gu",
);

// Opening mark -> the marks that close it. “ opens an English quote and also
// closes a Croatian one; the scan goes left to right, so „…“ wins inside.
const QUOTES: ReadonlyMap<string, string> = new Map([
  ["„", "“”"],
  ["“", "”"],
  ["»", "«"],
  ["«", "»"],
  ["‚", "‘’"],
  ["‘", "’"],
  ['"', '"'],
]);

const LETTER = /^\p{L}/u;

/** ’ followed by a letter is an apostrophe (don’t), not a closing mark. */
function closes(text: string, at: number): boolean {
  return text[at] !== "’" || !LETTER.test(text.slice(at + 1, at + 3));
}

function scanQuotes(text: string): Scan {
  const items: Item[] = [];
  const pieces: string[] = [];
  const unclosed = new Set<string>();
  let last = 0;
  let i = 0;
  while (i < text.length) {
    const open = text[i]!;
    const closers = QUOTES.get(open);
    if (closers === undefined || unclosed.has(open)) {
      i += 1;
      continue;
    }
    // Scans never overlap: a found quote is skipped whole, and a family
    // without a closer is not searched again, so this stays linear.
    let end = i + 1;
    while (end < text.length && !(closers.includes(text[end]!) && closes(text, end))) end += 1;
    if (end === text.length) {
      unclosed.add(open);
      i += 1;
      continue;
    }
    items.push({ key: text.slice(i + 1, end).normalize("NFC"), text: text.slice(i, end + 1) });
    pieces.push(text.slice(last, i));
    last = end + 1;
    i = end + 1;
  }
  pieces.push(text.slice(last));
  return { rest: pieces.join("\n"), items };
}

const YEAR = /^\p{Nd}{4}\p{Ll}?/u;

/** Year, then nothing or the page separator and 1 to 40 characters of pages. */
function yearPages(rest: string, pageSeparator: string): { year: string; pages: string } | undefined {
  const m = YEAR.exec(rest);
  if (!m) return undefined;
  // \p{Ll}? may give the letter back, as a regex would, if pages start with it.
  for (const len of m[0].length === 5 ? [5, 4] : [4]) {
    const after = rest.slice(len);
    if (after === "") return { year: rest.slice(0, len), pages: "" };
    const pages = after.slice(pageSeparator.length);
    if (after.startsWith(pageSeparator) && pages.length >= 1 && pages.length <= 40) {
      return { year: rest.slice(0, len), pages };
    }
  }
  return undefined;
}

/**
 * One part of a source mark: `[authors + separator] year [page separator +
 * pages]`, authors 1 to 200 characters, the shortest that fits. The
 * separators come from the style, so this is plain string work, no regex
 * built from them.
 */
function sourcePart(part: string, style: CitationStyle): string | undefined {
  const { authorYearSeparator: sep, pageSeparator, open, close } = style.inText;
  const key = (authors: string, found: { year: string; pages: string }) =>
    `${authors}|${found.year}|${found.pages.replace(PAGE_DASH, style.rangeDash)}`;
  // Only authors may hold the marks, as in (Institut (Sjever), 2007): in
  // (vidi (Horvat, 2007: 9)) the outer part has no year and pages of its own.
  const plain = (rest: string) => !rest.includes(open) && !rest.includes(close);
  for (let at = part.indexOf(sep, 1); at !== -1 && at <= 200; at = part.indexOf(sep, at + 1)) {
    const rest = part.slice(at + sep.length);
    const found = yearPages(rest, pageSeparator);
    if (found && plain(rest)) return key(part.slice(0, at), found);
  }
  const found = yearPages(part, pageSeparator);
  return found && plain(part) ? key("", found) : undefined;
}

function sourceKey(inner: string, style: CitationStyle): string | undefined {
  const keys: string[] = [];
  for (const raw of inner.split(";")) {
    const key = sourcePart(raw.replace(HS_RUN, " ").trim().normalize("NFC"), style);
    if (key === undefined) return undefined;
    keys.push(key);
  }
  return keys.join(";");
}

/**
 * Open marks on a stack, cleared at a line break; each close pairs with the
 * last open, so candidates are nested or disjoint. A candidate is read only
 * when it is at most `MAX_SOURCE_MARK_LENGTH` long, and the outermost valid
 * one wins: `(Institut (Sjever), 2007)` is one mark, `(vidi (Horvat, 2007))`
 * keeps the inner one. Candidates come in order of their end, so a valid one
 * swallows the kept ones that start inside it; each is kept and dropped at
 * most once.
 */
function scanSources(text: string, style: CitationStyle): Scan {
  const { open, close } = style.inText;
  const opens: number[] = [];
  const kept: { from: number; to: number; key: string }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith(open, i)) {
      opens.push(i);
    } else if (text[i] === "\n") {
      opens.length = 0;
    } else if (opens.length > 0 && text.startsWith(close, i)) {
      const from = opens.pop()!;
      const start = from + open.length;
      const key = i - start <= MAX_SOURCE_MARK_LENGTH ? sourceKey(text.slice(start, i), style) : undefined;
      if (key !== undefined) {
        while (kept.length > 0 && kept[kept.length - 1]!.from > from) kept.pop();
        kept.push({ from, to: i + close.length, key });
      }
    }
  }
  const pieces: string[] = [];
  let last = 0;
  for (const { from, to } of kept) {
    pieces.push(text.slice(last, from));
    last = to;
  }
  pieces.push(text.slice(last));
  return { rest: pieces.join("\n"), items: kept.map(({ from, to, key }) => ({ key, text: text.slice(from, to) })) };
}

function numberKey(text: string): string {
  const m = NUMBER_PARTS.exec(text)!;
  const int = m.groups!.int!.replace(GROUPS, "");
  return m.groups!.frac === undefined ? int : `${int}.${m.groups!.frac}`;
}

const sign = (text: string | undefined) => (text === undefined ? "" : text === "+" ? "+" : "-");
const day = (text: string) => text.replace(/^0+(?=\p{Nd})/u, "");

function scanNumbers(text: string): Item[] {
  const items: Item[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const g = m.groups!;
    let key: string;
    if (g.dy !== undefined) key = `${day(g.dd!)}.${day(g.dm!)}.${g.dy}`;
    else if (g.iy !== undefined) key = `${day(g.id!)}.${day(g.im!)}.${g.iy}`;
    else if (g.from !== undefined) key = `${sign(g.fs)}${numberKey(g.from)}–${sign(g.ts)}${numberKey(g.to!)}`;
    else key = `${sign(g.sign)}${numberKey(g.num!)}`;
    items.push({ key, text: m[0] });
  }
  return items;
}

function extract(text: string, style: CitationStyle): Record<ProtectedKind, Item[]> {
  const quotes = scanQuotes(text);
  const sources = scanSources(quotes.rest, style);
  return { source: sources.items, quote: quotes.items, number: scanNumbers(sources.rest) };
}

function compareKind(kind: ProtectedKind, before: Item[], after: Item[], out: ProtectedFinding[]): void {
  if (before.length === after.length && before.every((item, i) => item.key === after[i]!.key)) return;
  const tally = new Map<string, { count: number; text: string }>();
  for (const item of before) {
    const entry = tally.get(item.key);
    if (entry) entry.count += 1;
    else tally.set(item.key, { count: 1, text: item.text });
  }
  const added = new Map<string, { count: number; text: string }>();
  for (const item of after) {
    const entry = tally.get(item.key);
    if (entry && entry.count > 0) entry.count -= 1;
    else {
      const extra = added.get(item.key);
      if (extra) extra.count += 1;
      else added.set(item.key, { count: 1, text: item.text });
    }
  }
  const start = out.length;
  for (const { count, text } of tally.values()) if (count > 0) out.push({ kind, change: "removed", text, count });
  for (const { count, text } of added.values()) out.push({ kind, change: "added", text, count });
  if (out.length === start) out.push({ kind, change: "reordered" });
}

/**
 * Numbers, literal quotations and source marks that differ between `source`
 * and `proposed`, sources first, then quotes, then numbers; within a kind,
 * removed in source order, then added in proposed order. No finding means the
 * three sequences are equal key by key.
 */
export function compareProtectedContent(
  source: string,
  proposed: string,
  style: CitationStyle = fpzgCitationStyle,
): ProtectedCheck {
  if (typeof source !== "string" || typeof proposed !== "string") return { ok: false, reason: "not-text" };
  if (source.length > MAX_PROTECTED_TEXT_LENGTH || proposed.length > MAX_PROTECTED_TEXT_LENGTH) {
    return { ok: false, reason: "too-long" };
  }
  const before = extract(source, style);
  const after = extract(proposed, style);
  const findings: ProtectedFinding[] = [];
  for (const kind of ["source", "quote", "number"] as const) compareKind(kind, before[kind], after[kind], findings);
  return { ok: true, findings };
}
