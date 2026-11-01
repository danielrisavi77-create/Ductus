import { describe, expect, it } from "vitest";

import { createLogger, REDACTED, requestIdFrom, type Log } from "./logger";
import type { Log as IngestLog } from "../evidence/ingest-http";

// Canary: invented secrets and personal data, every one of which must stay out of the line.
// The token has the session token's shape (43 base64url characters) but plainly invented
// content, so the secret scanner has nothing real to find.
const TOKEN = `invented_session_token_${"A".repeat(20)}`;
const CANARIES = {
  token: TOKEN,
  cookie: `ductus_session=${TOKEN}`,
  authorization: "Bearer invented-bearer-value-0001",
  urlWithPassword: "postgres://ductus_app:invented-password@db.example.test:5432/ductus",
  email: "izmisljena.studentica@example.test",
  workText: "Ovo je izmišljeni odlomak rada koji nikad ne smije u log.",
};

const ID = "3f2c1e9a-7b4d-4c8e-9a1f-0d2b3c4e5f60";
const capture = (requestId = ID) => {
  const lines: string[] = [];
  const log = createLogger({ requestId, write: (line) => lines.push(line), now: () => new Date("2026-11-01T12:00:00.000Z") });
  return { log, lines };
};

describe("createLogger", () => {
  it("writes one JSON line with time, level, event, requestId and codes", () => {
    const { log, lines } = capture();
    log("evidence commit", "unavailable", "40001", "AuthConfigError", "ECONNREFUSED");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(JSON.parse(lines[0])).toEqual({
      time: "2026-11-01T12:00:00.000Z",
      level: "error",
      event: "evidence commit",
      requestId: ID,
      codes: ["unavailable", "40001", "AuthConfigError", "ECONNREFUSED"],
    });
  });

  it("has the shape of the existing Log, so a call site can take it as is", () => {
    const log: IngestLog = capture().log;
    const same: Log = log;
    expect(typeof same).toBe("function");
  });

  it("takes the level from its options", () => {
    const lines: string[] = [];
    createLogger({ requestId: ID, level: "warn", write: (line) => lines.push(line) })("live state read failed", "row_malformed");
    expect(JSON.parse(lines[0]).level).toBe("warn");
  });


  it("canary: no token, cookie, Authorization, URL with a password, e-mail or work text reaches the output", () => {
    const { log, lines } = capture();
    const values = Object.values(CANARIES);
    for (const value of values) log(value, value);
    log("login failed", ...values);
    const out = lines.join("\n");
    for (const [name, value] of Object.entries(CANARIES)) {
      expect(out, name).not.toContain(value);
      for (const part of value.split(/[^A-Za-z0-9]+/).filter((p) => p.length >= 8)) expect(out, `${name}: ${part}`).not.toContain(part);
    }
    expect(JSON.parse(lines.at(-1)!).codes).toEqual(values.map(() => REDACTED));
    expect(JSON.parse(lines[0]).event).toBe(REDACTED);
  });

  it("refuses codes that only look close to an allowed shape", () => {
    const { log, lines } = capture();
    const tooLong = `a${"b".repeat(40)}`;
    log("x", tooLong, "4000", "row-malformed", "Error", "ECONNREFUSED; rm", "", "a b");
    expect(JSON.parse(lines[0]).codes).toEqual(Array(7).fill(REDACTED));
  });

  it("never writes a request id that is not a UUID", () => {
    const { log, lines } = capture(CANARIES.token);
    log("x");
    expect(JSON.parse(lines[0]).requestId).toBe(REDACTED);
    expect(lines[0]).not.toContain(CANARIES.token);
  });
});

describe("requestIdFrom", () => {
  const headers = (value?: string) => new Headers(value === undefined ? {} : { "x-request-id": value });

  it("keeps a UUID from x-request-id, lower-cased", () => {
    expect(requestIdFrom(headers(ID.toUpperCase()), () => "new")).toBe(ID);
  });

  it("makes a new id when the header is missing, empty or not a UUID, such as a token", () => {
    for (const value of [undefined, "", "   ", CANARIES.token, "not-a-uuid", `${ID}x`]) {
      expect(requestIdFrom(headers(value), () => "generated"), String(value)).toBe("generated");
    }
    expect(requestIdFrom(null, () => "generated")).toBe("generated");
  });

  it("generates a UUID by default", () => {
    expect(requestIdFrom(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

