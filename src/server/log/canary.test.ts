import { afterEach, describe, expect, it, vi } from "vitest";

import { consoleLog } from "@/server/evidence/ingest-http";
import { createEvidencePayloadReader } from "@/server/evidence/payload-reader";

import { codesLog, createLogger, logEvent, type LogLevel } from "./logger";

// DAN-586 canary: one invented value pushed through every server logging path
// of this PR must never appear in what reaches the console.
const CANARY = "kanarinac7Qx9Lm2Pz4Rt8Vw";

function captureConsole(): () => string {
  const spies = (["error", "warn", "log", "info", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  return () => JSON.stringify(spies.map((spy) => spy.mock.calls));
}

const everyClass = {
  headers: new Headers({ authorization: `Bearer ${CANARY}`, cookie: `ductus_session=${CANARY}` }),
  "Set-Cookie": CANARY,
  text: `Uvod ${CANARY}`,
  document: { content: [{ text: CANARY }] },
  email: `${CANARY}@example.test`,
  url: new URL(`https://s3.example.test/b?X-Amz-Signature=${CANARY}`),
  note: `retry with token=${CANARY}`,
  error: new Error("outer", { cause: new Error(`inner ${CANARY}`, { cause: { password: CANARY } }) }),
  stage: CANARY,
};

describe("canary through every server log path", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logEvent, at every level", () => {
    const printed = captureConsole();
    for (const level of ["debug", "info", "warn", "error"] as const) logEvent(level, `event ${CANARY}`, everyClass);
    expect(printed()).toContain("event [redacted]");
    expect(printed()).not.toContain("kanarinac");
  });

  it("codesLog and the evidence routes' consoleLog", () => {
    const printed = captureConsole();
    codesLog(`failed ${CANARY}`, CANARY, `token=${CANARY}`);
    consoleLog("commit failed", CANARY);
    expect(printed()).toContain("commit failed");
    expect(printed()).not.toContain("kanarinac");
  });

  it("the evidence storage reader with a refused configuration", () => {
    const printed = captureConsole();
    createEvidencePayloadReader({ EVIDENCE_STORAGE_DOMAINS: CANARY, EVIDENCE_STORAGE_SECRET: CANARY });
    expect(printed()).toContain("evidence storage is not configured");
    expect(printed()).not.toContain("kanarinac");
  });

  it("instrumentation with a refused database URL", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", `mysql://app:${CANARY}@db.example.test/${CANARY}`);
    const printed = captureConsole();
    const { register } = await import("../../../instrumentation");
    await expect(
      register(() => {
        throw new Error("exit");
      }),
    ).rejects.toThrow("exit");
    vi.unstubAllEnvs();
    expect(printed()).toContain("Ductus cannot start");
    expect(printed()).not.toContain("kanarinac");
  });

  it("createLogger with a pair inside a pair, an array subclass and a token with a digit run", () => {
    class WorkArray extends Array {
      toJSON() {
        return { text: `Uvod ${CANARY}`, password: "zeleni" };
      }
    }
    const lines: string[] = [];
    createLogger((_level, line) => lines.push(line), () => new Date(0))("error", "x", {
      error: new Error("request: password=zeleni"),
      note: "request: text=Uvod",
      items: WorkArray.from(["context"]),
      stage: "kanarinacABCDEFGHIJKLMN123456789",
    });
    expect(lines.join("")).toContain("context");
    for (const part of ["zeleni", "Uvod", "kanarinac", "ABCDEFGHIJKLMN", "123456789"]) expect(lines.join("")).not.toContain(part);
  });
});

describe("logger shape", () => {
  it("writes exactly one JSON line per call, with time, level, event and fields", () => {
    const lines: Array<[LogLevel, string]> = [];
    const log = createLogger((level, line) => lines.push([level, line]), () => new Date(0));
    log("warn", "readiness", { codes: { queue: "42501" } });
    log("info", "started");
    expect(lines).toEqual([
      ["warn", '{"time":"1970-01-01T00:00:00.000Z","level":"warn","event":"readiness","fields":{"codes":{"queue":"42501"}}}'],
      ["info", '{"time":"1970-01-01T00:00:00.000Z","level":"info","event":"started"}'],
    ]);
  });

  it("writes the time it sets itself unredacted", () => {
    const lines: string[] = [];
    createLogger((_level, line) => lines.push(line), () => new Date(1762632000123))("info", "started");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ time: "2025-11-08T20:00:00.123Z" });
  });

  it("keeps a line break in an event or field inside the one line", () => {
    const lines: string[] = [];
    const log = createLogger((_level, line) => lines.push(line), () => new Date(0));
    log("warn", "a\nforged", { stage: "b\r\nc" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/);
  });

  it("never throws into the caller", () => {
    const lines: string[] = [];
    const broken = createLogger(
      (_level, line) => lines.push(line),
      () => {
        throw new Error(CANARY);
      },
    );
    expect(() => broken("error", "x", { a: 1 })).not.toThrow();
    expect(lines).toEqual(['{"level":"error","event":"log_failed"}']);
    const throwingSink = createLogger(() => {
      throw new Error(CANARY);
    });
    expect(() => throwingSink("error", "x")).not.toThrow();
  });
});
