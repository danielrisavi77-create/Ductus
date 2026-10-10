import { EventEmitter } from "node:events";

import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ActorTransaction, createWithActor } from "./with-actor";

const TOKEN = "t".repeat(43);

type Reply = { command?: string; rows?: unknown[]; rowCount?: number };

/** Records what withActor sends; `replies` overrides an answer by statement prefix. */
function fakePool(replies: Record<string, Reply | Error> = {}) {
  const sent: { text: string; values?: unknown[] }[] = [];
  const released: unknown[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      sent.push({ text: text.trim(), values });
      const key = Object.keys(replies).find((prefix) => text.trim().startsWith(prefix));
      const reply = key === undefined ? undefined : replies[key];
      if (reply instanceof Error) throw reply;
      if (reply) return { rows: [], rowCount: 0, ...reply };
      if (text.includes("set_config")) return { rows: [{ token_set: true, app_role: true }], rowCount: 1 };
      return { command: text.trim().split(" ")[0], rows: [{ answer: 1 }], rowCount: 1 };
    },
    release: (error?: unknown) => void released.push(error),
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { withActor: createWithActor(pool), sent, released, statements: () => sent.map((q) => q.text.split(/\s/)[0]) };
}

describe("withActor", () => {
  it("sets the token transaction-locally, runs fn and commits", async () => {
    const db = fakePool();
    const value = await db.withActor(TOKEN, async (tx) => (await tx.query("SELECT 1", [7])).rows);

    expect(value).toEqual([{ answer: 1 }]);
    expect(db.statements()).toEqual(["BEGIN", "SELECT", "SELECT", "COMMIT"]);
    expect(db.sent[1].text).toContain("set_config('app.session_token', $1, true)");
    expect(db.sent[1].values).toEqual([TOKEN]);
    expect(db.sent[2]).toEqual({ text: "SELECT 1", values: [7] });
    expect(db.released).toEqual([undefined]);
  });

  it("never puts the token into statement text", async () => {
    const db = fakePool();
    await db.withActor(TOKEN, async (tx) => tx.query("SELECT 1"));
    expect(db.sent.some((q) => q.text.includes(TOKEN))).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["too short", "t".repeat(42)],
    ["too long", "t".repeat(44)],
    ["trailing space", `${"t".repeat(42)} `],
    ["NUL byte", `${"t".repeat(42)}\u0000`],
    ["a non-string", 12345 as unknown as string],
  ])("treats %s as anonymous and does not send it", async (_name, token) => {
    const db = fakePool();
    await db.withActor(token, async () => undefined);
    expect(db.sent[1].values).toEqual([""]);
  });

  it("rolls back and rethrows when fn fails", async () => {
    const db = fakePool();
    const failure = new Error("fn failed");
    await expect(db.withActor(TOKEN, async () => Promise.reject(failure))).rejects.toBe(failure);
    expect(db.statements()).toEqual(["BEGIN", "SELECT", "ROLLBACK"]);
    expect(db.released).toEqual([undefined]);
  });

  it.each([
    ["a role outside ductus_app", [{ token_set: true, app_role: false }]],
    ["an unknown role", [{ token_set: true, app_role: null }]],
    ["no answer", []],
  ])("refuses %s before fn runs", async (_name, rows) => {
    const db = fakePool({ "SELECT pg_catalog.set_config": { rows } });
    const fn = vi.fn(async () => "ran");
    await expect(db.withActor(TOKEN, fn)).rejects.toThrow("not a ductus_app login");
    expect(fn).not.toHaveBeenCalled();
    expect(db.statements()).toEqual(["BEGIN", "SELECT", "ROLLBACK"]);
  });

  it("fails when COMMIT answers ROLLBACK (aborted transaction)", async () => {
    const db = fakePool({ COMMIT: { command: "ROLLBACK" } });
    await expect(db.withActor(TOKEN, async () => "saved")).rejects.toThrow("rolled back");
  });

  it("does not return a connection whose rollback failed to the pool", async () => {
    const rollbackFailure = new Error("connection lost");
    const db = fakePool({ ROLLBACK: rollbackFailure });
    const failure = new Error("fn failed");
    await expect(db.withActor(TOKEN, async () => Promise.reject(failure))).rejects.toBe(failure);
    expect(db.released).toEqual([rollbackFailure]);
  });

  it("refuses a handle that outlived its transaction", async () => {
    const db = fakePool();
    let leaked: ActorTransaction | undefined;
    await db.withActor(TOKEN, async (tx) => void (leaked = tx));
    const before = db.sent.length;
    await expect(leaked?.query("SELECT 1")).rejects.toThrow("transaction has ended");
    expect(db.sent).toHaveLength(before);
  });
});

describe("withActor from the environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("stays closed without APP_DATABASE_URL", async () => {
    vi.stubEnv("APP_DATABASE_URL", "");
    const { withActor } = await import("./index");
    const fn = vi.fn(async () => "ran");
    await expect(withActor(TOKEN, fn)).rejects.toThrow("APP_DATABASE_URL is not set");
    expect(fn).not.toHaveBeenCalled();
  });

  it("bounds every wait of the application pool", async () => {
    const { appPoolConfig } = await import("./index");
    const config = appPoolConfig("postgres://app.invalid/ductus");
    for (const limit of [
      config.max,
      config.connectionTimeoutMillis,
      config.statement_timeout,
      config.idle_in_transaction_session_timeout,
      config.query_timeout,
    ]) {
      expect(limit).toBeGreaterThan(0);
      expect(Number.isFinite(limit)).toBe(true);
    }
    // A server that answers must cancel a statement before the driver stops waiting for it.
    expect(config.query_timeout).toBeGreaterThan(Number(config.statement_timeout));
    // A nested call must fail on its own wait before the server ends the outer transaction.
    expect(config.idle_in_transaction_session_timeout).toBeGreaterThan(config.connectionTimeoutMillis ?? 0);
  });

  it("listens for the failure of every connection and logs its code only", async () => {
    const { handleConnectionErrors } = await import("./index");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = new EventEmitter();
    const client = new EventEmitter();
    handleConnectionErrors(pool as unknown as Pool);
    pool.emit("connect", client);

    // An `error` event without a listener throws; neither of these may.
    const failure = Object.assign(new Error(`statement with ${TOKEN}`), { code: "25P03", detail: TOKEN });
    client.emit("error", failure);
    client.emit("error", new Error(`dropped while sending ${TOKEN}`));
    pool.emit("error", failure, client);

    expect(logged.mock.calls).toEqual([
      ["database connection failed", "25P03"],
      ["database connection failed", "Error"],
    ]);
    logged.mockRestore();
  });
});
