import { randomUUID } from "node:crypto";

// DAN-299: one JSON line per server event, with a correlation id. The shape of
// the call is the one the server already uses (`Log` in
// src/server/evidence/ingest-http.ts: a message and codes), so moving an area
// over is mechanical. Nothing free-form reaches the output: the message is a
// short fixed phrase and every code a short identifier (an SQLSTATE, a stage,
// an error name). Anything else, such as a token, a cookie, a URL, an address
// or a piece of a work, is replaced, never echoed (BACKEND 4.13, PRODUCT §5).
export type Log = (message: string, ...codes: string[]) => void;
export type Level = "info" | "warn" | "error";

const MESSAGE = /^[a-z][a-z0-9 _-]{0,79}$/;
const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
// The shapes a caller may hand in that look like an identifier but are not.
const SECRET_LIKE = /^[A-Za-z0-9_-]{32,}$|@|:\/\//;
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
export const REDACTED = "redacted";

/** A message that may be logged, or "redacted". */
function safeMessage(message: unknown): string {
  return typeof message === "string" && MESSAGE.test(message) ? message : REDACTED;
}

/** A code that may be logged, or "redacted". */
function safeCode(code: unknown): string {
  return typeof code === "string" && CODE.test(code) && !SECRET_LIKE.test(code) ? code : REDACTED;
}

/** The caller's x-request-id when it is a plain id, otherwise a new one. */
export function requestIdFrom(headers: Pick<Headers, "get"> | null | undefined): string {
  const given = headers?.get("x-request-id");
  return given && REQUEST_ID.test(given) ? given : randomUUID();
}

export type LoggerOptions = {
  requestId?: string;
  level?: Level;
  now?: () => Date;
  write?: (line: string, level: Level) => void;
};

const defaultWrite = (line: string, level: Level) => {
  if (level === "info") process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
};

/** A `Log` that writes one JSON line per call. */
export function createLogger({ requestId, level = "error", now = () => new Date(), write = defaultWrite }: LoggerOptions = {}): Log {
  const id = requestId !== undefined && REQUEST_ID.test(requestId) ? requestId : undefined;
  return (message, ...codes) => {
    const entry: Record<string, unknown> = { time: now().toISOString(), level, event: safeMessage(message) };
    if (codes.length > 0) entry.codes = codes.slice(0, 8).map(safeCode);
    if (id) entry.requestId = id;
    write(JSON.stringify(entry), level);
  };
}
