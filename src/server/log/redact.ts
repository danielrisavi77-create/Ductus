/**
 * Deep redaction for every server log line (DAN-586, BACKEND 4.9, R06).
 *
 * A log line may carry closed codes, stages, counts, flags and identifiers;
 * it never carries a secret, the text of a work, document content or a
 * personal datum. `redact` turns any value into plain JSON data with that
 * property. It is a pure synchronous function: it never throws, never calls
 * `toJSON`, a getter or a proxy trap result it cannot read safely, and holds
 * no state between calls.
 *
 * Three nets, each enough on its own for its class:
 * - a value under a sensitive key (any letter case or separator) is dropped;
 * - every string, including keys, is scanned for credentials, URLs, e-mail
 *   addresses, long digit runs and token-like runs, then cut to a length;
 * - depth, width, cycles and the values read per call are bounded, so a
 *   large, hostile or self-sharing structure cannot push a deep leaf into the
 *   line or hold the event loop.
 */

export const REDACTED = "[redacted]";

const MAX_DEPTH = 8;
const MAX_ENTRIES = 50;
const MAX_STRING = 200;
const MAX_KEY = 64;
/** Values read per call, so shared references cannot multiply the work. */
const MAX_NODES = 2000;

/** Credentials, text of a work and personal data, by normalized key. */
const SENSITIVE_PARTS = [
  "authorization",
  "cookie",
  "token",
  "session",
  "password",
  "passwd",
  "lozinka",
  "secret",
  "apikey",
  "credential",
  "privatekey",
  "idempotencykey",
  "signature",
  "html",
  "snapshot",
  "plaintext",
  "email",
  "phone",
  "useragent",
];

const SENSITIVE_EXACT = new Set([
  "auth",
  "bearer",
  "jwt",
  "pwd",
  "passphrase",
  "text",
  "body",
  "content",
  "document",
  "doc",
  "payload",
  "instruction",
  "instructions",
  "explanation",
  "anchor",
  "segment",
  "segments",
  "comment",
  "note",
  "quote",
  "excerpt",
  "title",
  "name",
  "firstname",
  "lastname",
  "surname",
  "fullname",
  "givenname",
  "familyname",
  "displayname",
  "username",
  "oib",
  "jmbag",
  "address",
  "ip",
  "ipaddress",
  "remoteaddress",
  "xforwardedfor",
  "xrealip",
  "birthdate",
  "dateofbirth",
  // Croatian names of the same fields.
  "tekst",
  "sadrzaj",
  "naslov",
  "ime",
  "prezime",
  "adresa",
  "eposta",
]);

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_EXACT.has(normalized) || SENSITIVE_PARTS.some((part) => normalized.includes(part));
}

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const AUTH_SCHEME = /\b(bearer|basic|digest)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[\w-]*\.[\w-]*\.[\w-]*/g;
/** A quoted value is taken whole, escapes included, so no word of it stays. */
const KEY_VALUE = /(["']?)([A-Za-z0-9_-]{2,40})\1(\s*[:=]\s*)("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|[^\s"'&,;}]+)/g;
/** A credential header written as text: everything to the end of the line. */
const HEADER_LINE = /\b((?:proxy-)?authorization|(?:set-)?cookie)(\s*:\s*)[^\n]*/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const DIGIT_RUN = /\d{9,}/g;
const TOKEN_RUN = /[A-Za-z0-9+/_=-]{20,}/g;
/** Quoted free text of two or more words, as a parser error quotes a snippet. */
const QUOTED_WORDS = /"[^"\s:,{}[\]][^"\n]*\s[^"\n]*?[^"\s:,{}[\]]"|„[^“”\n]*[“”]/g;
const SCAN_LIMIT = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A URL keeps its scheme, host and path; userinfo, query and fragment go. */
export function stripUrl(text: string): string {
  try {
    const url = new URL(text);
    const query = url.search.length > 1 ? `?${REDACTED}` : "";
    return `${url.protocol}//${url.host}${url.pathname}${query}`;
  } catch {
    return "[url]";
  }
}

function scrubTokenRun(run: string): string {
  if (UUID.test(run)) return run;
  return /[A-Za-z]/.test(run) && /\d/.test(run) ? REDACTED : run;
}

/** Scans free text in a fixed order; each step only ever removes data. */
export function redactString(text: string, max = MAX_STRING): string {
  // Scanning cost stays bounded: only the head is read, and a word cut in two
  // by that limit is dropped so no fragment of a token survives unscanned.
  const head = text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT).replace(/\S*$/, "") : text;
  const scanned = head
    .replace(URL_IN_TEXT, stripUrl)
    .replace(AUTH_SCHEME, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(HEADER_LINE, (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`)
    .replace(KEY_VALUE, (match, quote: string, key: string, separator: string, value: string) => {
      if (!isSensitiveKey(key)) return match;
      const valueQuote = value.startsWith('"') || value.startsWith("'") ? value[0] : "";
      return `${quote}${key}${quote}${separator}${valueQuote}${REDACTED}${valueQuote}`;
    })
    .replace(QUOTED_WORDS, (match) => (match.startsWith("„") ? `„${REDACTED}“` : `"${REDACTED}"`))
    .replace(EMAIL, "[email]")
    .replace(DIGIT_RUN, "[number]")
    .replace(TOKEN_RUN, scrubTokenRun);
  return scanned.length > max || head !== text ? `${scanned.slice(0, max)}[cut]` : scanned;
}

/** Reads one property without letting a getter or a proxy throw out. */
function read(value: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return (value as Record<PropertyKey, unknown>)[key];
    return "value" in descriptor ? descriptor.value : "[accessor]";
  } catch {
    return "[unreadable]";
  }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** One call's state: the objects on the current path and the values left to read. */
type Walk = { path: Set<object>; left: number };

function entriesObject(entries: Iterable<[unknown, unknown]>, depth: number, ctx: Walk): Json {
  const out: Array<[string, Json]> = [];
  let more = 0;
  for (const [key, item] of entries) {
    if (out.length >= MAX_ENTRIES) {
      more += 1;
      continue;
    }
    const name = typeof key === "string" ? key : String(walk(key, depth + 1, ctx));
    out.push([redactString(name, MAX_KEY), isSensitiveKey(name) ? REDACTED : walk(item, depth + 1, ctx)]);
  }
  if (more > 0) out.push(["[more]", more]);
  return Object.fromEntries(out);
}

function errorObject(error: Error, depth: number, ctx: Walk): Json {
  const out: Array<[string, Json]> = [
    ["name", walk(read(error, "name"), depth + 1, ctx)],
    ["message", walk(read(error, "message"), depth + 1, ctx)],
  ];
  const code = read(error, "code");
  if (typeof code === "string" || typeof code === "number") out.push(["code", walk(code, depth + 1, ctx)]);
  const cause = read(error, "cause");
  if (cause !== undefined) out.push(["cause", walk(cause, depth + 1, ctx)]);
  if (error instanceof AggregateError) out.push(["errors", walk(read(error, "errors"), depth + 1, ctx)]);
  return Object.fromEntries(out);
}

/** Only a safe integer is shown, so an own byteLength cannot carry text. */
function byteCount(value: ArrayBufferView | ArrayBuffer): number {
  const count = Number(value.byteLength);
  return Number.isSafeInteger(count) && count >= 0 && count < 2 ** 32 ? count : 0;
}

function walkObject(value: object, depth: number, ctx: Walk): Json {
  // Native methods, so an own toISOString or getTime cannot put text in the line.
  if (value instanceof Date) {
    return Number.isNaN(Date.prototype.getTime.call(value)) ? null : Date.prototype.toISOString.call(value);
  }
  if (value instanceof URL) return redactString(stripUrl(value.href));
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[bytes ${byteCount(value)}]`;
  if (value instanceof Error) return errorObject(value, depth, ctx);
  if (typeof Headers !== "undefined" && value instanceof Headers) return entriesObject(value.entries(), depth, ctx);
  if (value instanceof Map) return entriesObject(value.entries(), depth, ctx);
  if (value instanceof Set) return walk([...value], depth, ctx);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ENTRIES).map((_item, index) => walk(read(value, index), depth + 1, ctx));
    return value.length > MAX_ENTRIES ? [...items, `[more ${value.length - MAX_ENTRIES}]`] : items;
  }
  return entriesObject(
    Object.keys(value).map((key) => [key, read(value, key)]),
    depth,
    ctx,
  );
}

function walk(value: unknown, depth: number, ctx: Walk): Json {
  if (ctx.left <= 0) return "[budget]";
  ctx.left -= 1;
  switch (typeof value) {
    case "string":
      return redactString(value);
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "bigint":
      return redactString(value.toString());
    case "undefined":
      return null;
    case "function":
      return "[function]";
    case "symbol":
      return "[symbol]";
  }
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return "[depth]";
  if (ctx.path.has(value)) return "[cycle]";
  ctx.path.add(value);
  try {
    return walkObject(value, depth, ctx);
  } catch {
    return "[unreadable]";
  } finally {
    ctx.path.delete(value);
  }
}

/** Any value as JSON data that is safe to write to a log line. */
export function redact(value: unknown): Json {
  return walk(value, 0, { path: new Set(), left: MAX_NODES });
}
