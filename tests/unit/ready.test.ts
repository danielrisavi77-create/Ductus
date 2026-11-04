import { describe, expect, it } from "vitest";

import { READY_TIMEOUT_MS, checkReadiness } from "@/server/ready";

// DAN-299: readiness is 200 only when the database answers in time. Every
// class of input below is a refusal except the last.
const neverAnswers = () => new Promise<void>(() => {});

const REFUSED: ReadonlyArray<[string, () => Promise<void>]> = [
  ["variable not set", () => Promise.reject(new Error("APP_DATABASE_URL is not set; database access stays closed"))],
  ["variable empty", () => Promise.reject(new Error("APP_DATABASE_URL is not set; database access stays closed"))],
  ["variable not a URL", () => Promise.reject(new TypeError("Invalid URL: secret-value"))],
  ["connection refused", () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))],
  ["database never answers", neverAnswers],
  ["throws a non-Error", () => Promise.reject("postgres://user:pw@host/db")],
  ["throws synchronously", () => { throw new Error("boom"); }],
];

describe("checkReadiness", () => {
  it.each(REFUSED)("is not ready when %s", async (_name, probe) => {
    const result = await checkReadiness(probe, 20);
    expect(result.ready).toBe(false);
  });

  it("is ready when the probe succeeds", async () => {
    expect(await checkReadiness(async () => {}, 20)).toEqual({ ready: true });
  });

  it("never carries the error text, URL or password in the result", async () => {
    const result = await checkReadiness(() => Promise.reject(new Error("postgres://user:pw@host/db")), 20);
    expect(JSON.stringify(result)).not.toMatch(/postgres|pw|host/);
  });

  it("gives up after the limit instead of hanging", async () => {
    const started = Date.now();
    await checkReadiness(neverAnswers, 30);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(READY_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });

  it("holds no shared state between concurrent calls", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => checkReadiness(i % 2 === 0 ? async () => {} : () => Promise.reject(new Error("x")), 20)),
    );
    expect(results.map((r) => r.ready)).toEqual(Array.from({ length: 20 }, (_, i) => i % 2 === 0));
  });
});
