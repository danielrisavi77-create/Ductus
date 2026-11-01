import { describe, expect, it } from "vitest";

import { createLogger, REDACTED, requestIdFrom } from "./logger";

// DAN-299. Every value below is invented; the canary strings must never reach a line.
const NOW = () => new Date("2026-11-01T00:00:00.000Z");

function capture(options: Parameters<typeof createLogger>[0] = {}) {
  const lines: { line: string; level: string }[] = [];
  const log = createLogger({ now: NOW, write: (line, level) => lines.push({ line, level }), ...options });
  return { log, lines, parsed: () => lines.map(({ line }) => JSON.parse(line) as Record<string, unknown>) };
}

describe("createLogger", () => {
  it("writes one JSON line with time, level, event, codes and the request id", () => {
    const { log, lines, parsed } = capture({ requestId: "req-1234abcd" });
    log("database connection failed", "57P01", "ECONNRESET");
    expect(lines).toHaveLength(1);
    expect(lines[0].line).not.toContain("\n");
    expect(lines[0].level).toBe("error");
    expect(parsed()[0]).toEqual({
      time: "2026-11-01T00:00:00.000Z",
      level: "error",
      event: "database connection failed",
      codes: ["57P01", "ECONNRESET"],
      requestId: "req-1234abcd",
    });
  });

  it("leaves out codes and an invalid request id", () => {
    const { log, parsed } = capture({ requestId: "has space" });
    log("replay unavailable");
    expect(parsed()[0]).toEqual({ time: "2026-11-01T00:00:00.000Z", level: "error", event: "replay unavailable" });
  });

  it("canary: no token, cookie, header, URL, address or text of a work reaches the output", () => {
    const canaries = [
      "Zq3vX9mB2kL7pR4tW8yN1cF6hJ0sD5aG3eU7iO9oQ2x", // a session token shape (43 characters)
      "ductus_session=Zq3vX9mB2kL7pR4tW8yN1cF6hJ0sD5aG3eU7iO9oQ2x",
      "Bearer eyJhbGciOiJIUzI1NiJ9.invented.signature",
      "postgres://ductus_app_local:invented-password@127.0.0.1:54329/ductus",
      "ana.invented@student.example.invalid",
      "Uvod: ovaj rad istražuje izmišljenu temu na izmišljenom primjeru.",
      "line one\nline two",
      '{"injected":"json"}',
    ];
    const { log, lines, parsed } = capture();
    for (const canary of canaries) {
      log(canary, canary);
      log("login failed", canary);
    }
    const output = lines.map(({ line }) => line).join("\n");
    for (const canary of canaries) {
      expect(output, canary).not.toContain(canary);
      for (const part of canary.split(/[\s=:@/]+/).filter((p) => p.length >= 12)) expect(output, part).not.toContain(part);
    }
    for (const entry of parsed()) {
      expect([REDACTED, "login failed"]).toContain(entry.event);
      expect(entry.codes).toEqual([REDACTED]);
    }
  });

  it("keeps at most eight codes and redacts anything that is not a string", () => {
    const { log, parsed } = capture();
    (log as (...args: unknown[]) => void)("x failed", ...Array.from({ length: 12 }, (_, i) => `c${i}`));
    (log as (...args: unknown[]) => void)(42, { a: 1 }, null);
    expect(parsed()[0].codes).toHaveLength(8);
    expect(parsed()[1]).toMatchObject({ event: REDACTED, codes: [REDACTED, REDACTED] });
  });

  it("writes info to stdout's channel and warn and error to stderr's", () => {
    for (const level of ["info", "warn", "error"] as const) {
      const { log, lines } = capture({ level });
      log("live state read failed");
      expect(lines[0].level).toBe(level);
    }
  });
});

describe("requestIdFrom", () => {
  it("keeps a plain caller id and replaces anything else", () => {
    expect(requestIdFrom(new Headers({ "x-request-id": "abcd-1234-efgh" }))).toBe("abcd-1234-efgh");
    for (const bad of ["short", "has space here", "a".repeat(65), "id\nnext", "<script>x</script>"]) {
      const id = requestIdFrom(new Headers([["x-request-id", bad.replace("\n", " ")]]));
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(requestIdFrom(null)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
