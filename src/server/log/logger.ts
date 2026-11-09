import { redact } from "./redact";

/**
 * The one structured log of the web process and the worker (DAN-586,
 * BACKEND 4.9). One call writes exactly one JSON line,
 * `{ time, level, event, fields }`, and every part of it passes `redact`
 * first. Plain Node: no Next.js import, so the worker uses it unchanged.
 *
 * Logging never throws into the caller: a line that cannot be built becomes a
 * fixed `log_failed` line, and a sink that throws is ignored.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogSink = (level: LogLevel, line: string) => void;

export type LogEvent = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;

/** stderr for warnings and errors, stdout for the rest; Next.js captures both. */
export const consoleSink: LogSink = (level, line) => {
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
};

const FAILED = JSON.stringify({ level: "error", event: "log_failed" });

export function createLogger(sink: LogSink = consoleSink, now: () => Date = () => new Date()): LogEvent {
  return (level, event, fields) => {
    let line: string;
    try {
      const record: Record<string, unknown> = { time: now().toISOString(), level, event: redact(event) };
      if (fields !== undefined) record.fields = redact(fields);
      line = JSON.stringify(record);
    } catch {
      line = FAILED;
    }
    try {
      sink(level, line);
    } catch {
      // A log that cannot be written must not take the request down with it.
    }
  };
}

export const logEvent: LogEvent = (level, event, fields) => createLogger()(level, event, fields);

/**
 * The `(message, ...codes)` shape the evidence routes already take: the
 * message is the event, the closed codes are its only field.
 */
export function codesLog(message: string, ...codes: string[]): void {
  logEvent("error", message, codes.length > 0 ? { codes } : undefined);
}
