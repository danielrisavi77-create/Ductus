import { randomUUID } from "node:crypto";

/**
 * DAN-299, PR 2: one JSON line per server event, with a correlation id. The
 * shape is the existing `Log` (`src/server/evidence/ingest-http.ts`), so a
 * call site moves over by passing a logger instead of `consoleLog`; moving
 * call sites is not part of this file (separate PRs, per area).
 *
 * Nothing a person typed or a secret ever reaches the line: the event and
 * every code must have one of the fixed shapes below, and anything else is
 * written as "redacted". The shapes are the ones the server already logs:
 * SQLSTATE (`40001`), snake_case reasons (`row_malformed`), error class
 * names (`AuthConfigError`) and Node error codes (`ECONNREFUSED`). A
 * snake_case code is at most 40 characters, so a 43-character session token
 * can never pass as one.
 */
export type Log = (message: string, ...codes: string[]) => void;

export type LogLevel = "info" | "warn" | "error";

const EVENT = /^[a-z][a-z0-9 _-]{0,79}$/;
const CODE_SHAPES = [
  /^[0-9A-Z]{5}$/, // SQLSTATE
  /^[a-z][a-z0-9_]{0,39}$/, // snake_case reason
  /^[A-Z][A-Za-z]{0,39}Error$/, // error class name
  /^E[A-Z0-9_]{2,30}$/, // Node error code
];
// Only a UUID is taken from the request; anything else could carry a token.
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REDACTED = "redacted";

const safeEvent = (message: unknown): string => (typeof message === "string" && EVENT.test(message) ? message : REDACTED);
const safeCode = (code: unknown): string =>
  typeof code === "string" && CODE_SHAPES.some((shape) => shape.test(code)) ? code : REDACTED;

/** The request's `x-request-id` when it is a UUID, else a new one. */
export function requestIdFrom(headers?: Pick<Headers, "get"> | null, generate: () => string = randomUUID): string {
  const given = headers?.get("x-request-id")?.trim();
  return given && REQUEST_ID.test(given) ? given.toLowerCase() : generate();
}

export interface LoggerOptions {
  requestId: string;
  level?: LogLevel;
  write?: (line: string) => void;
  now?: () => Date;
}

/** A `Log` that writes one JSON line per call: time, level, event, requestId, codes. */
export function createLogger({
  requestId,
  level = "error",
  write = (line) => process.stderr.write(`${line}\n`),
  now = () => new Date(),
}: LoggerOptions): Log {
  const id = REQUEST_ID.test(requestId) ? requestId.toLowerCase() : REDACTED;
  return (message, ...codes) => {
    write(JSON.stringify({ time: now().toISOString(), level, event: safeEvent(message), requestId: id, codes: codes.map(safeCode) }));
  };
}
