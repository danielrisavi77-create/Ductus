import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ActorTransaction, createWithActor, leadingKeyword } from "./with-actor";

const TOKEN = "t".repeat(43);

type Reply = { command?: string; rows?: unknown[]; rowCount?: number };

/** Records what withActor sends; `replies` overrides an answer by statement prefix. */
function fakePool(replies: Record<string, Reply | Error> = {}) {
  const sent: { text: string; values?: unknown[]; queryMode?: string }[] = [];
  const released: unknown[] = [];
  const client = {
    async query(statement: string | { text: string; values?: unknown[]; queryMode?: string }, params?: unknown[]) {
      const { text, values, queryMode } = typeof statement === "string" ? { text: statement, values: params, queryMode: undefined } : statement;
      sent.push({ text: text.trim(), values, ...(queryMode ? { queryMode } : {}) });
      const key = Object.keys(replies).find((prefix) => text.trim().startsWith(prefix));
      const reply = key === undefined ? undefined : replies[key];
      if (reply instanceof Error) throw reply;
      if (reply) return { rows: [], rowCount: 0, ...reply };
      if (text.includes("app.with_actor_tx")) {
        return { rows: [{ token_set: true, same_tx: true, app_role: true }], rowCount: 1 };
      }
      return { command: text.trim().split(" ")[0], rows: [{ answer: 1 }], rowCount: 1 };
    },
    release: (error?: unknown) => void released.push(error),
    listeners: new Set<(error: Error) => void>(),
    on(_event: "error", listener: (error: Error) => void) {
      client.listeners.add(listener);
    },
    removeListener(_event: "error", listener: (error: Error) => void) {
      client.listeners.delete(listener);
    },
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { withActor: createWithActor(pool), client, sent, released, statements: () => sent.map((q) => q.text.split(/\s/)[0]) };
}

describe("withActor", () => {
  it("sets the token transaction-locally, runs fn and commits", async () => {
    const db = fakePool();
    const value = await db.withActor(TOKEN, async (tx) => (await tx.query("SELECT 1", [7])).rows);

    expect(value).toEqual([{ answer: 1 }]);
    expect(db.statements()).toEqual(["BEGIN", "SELECT", "SELECT", "SELECT", "COMMIT", "DISCARD"]);
    expect(db.sent[1].text).toContain("set_config('app.session_token', $1, true)");
    expect(db.sent[1].text).toContain("set_config('app.with_actor_tx', $2, true)");
    expect(db.sent[1].values?.[0]).toEqual(TOKEN);
    expect(db.sent[2]).toEqual({ text: "SELECT 1", values: [7], queryMode: "extended" });
    // The exit check compares the marker that the entry set.
    expect(db.sent[3].text).toContain("current_setting('app.with_actor_tx', true)");
    expect(db.sent[3].values).toEqual([db.sent[1].values?.[1], TOKEN]);
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
    expect(db.sent[1].values?.[0]).toEqual("");
  });

  it("rolls back and rethrows when fn fails", async () => {
    const db = fakePool();
    const failure = new Error("fn failed");
    await expect(db.withActor(TOKEN, async () => Promise.reject(failure))).rejects.toBe(failure);
    expect(db.statements()).toEqual(["BEGIN", "SELECT", "ROLLBACK", "DISCARD"]);
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
    // A connection that failed the lock is closed, not pooled for the next call.
    expect(db.released).toEqual([expect.any(Error)]);
  });

  it.each([
    ["the transaction ended or the token changed inside fn", { same_tx: false, app_role: true }],
    ["the marker is unreadable", { same_tx: null, app_role: true }],
    ["fn changed role", { same_tx: true, app_role: false }],
  ])("does not commit and closes the connection when %s", async (_name, row) => {
    const db = fakePool({ "SELECT pg_catalog.current_setting": { rows: [row] } });
    await expect(db.withActor(TOKEN, async () => "saved")).rejects.toThrow("changed inside fn");
    expect(db.statements()).toEqual(["BEGIN", "SELECT", "SELECT", "ROLLBACK"]);
    expect(db.released).toEqual([expect.any(Error)]);
  });

  it.each([
    "COMMIT",
    "commit",
    "End",
    "ROLLBACK",
    "abort",
    "BEGIN",
    "start transaction",
    "SAVEPOINT a",
    "release savepoint a",
    "PREPARE TRANSACTION 'x'",
    "prepare q AS SELECT 1",
    "SET app.session_token = 'x'",
    "set local role ductus_auth",
    "SET SESSION AUTHORIZATION DEFAULT",
    "RESET ROLE",
    "reset all",
    "DISCARD ALL",
    "LISTEN channel",
    "DO $$ BEGIN END $$",
    "-- SELECT\nCOMMIT",
    "-- SELECT\rCOMMIT;\nSELECT 1",
    "/* SELECT */ COMMIT; SELECT 1",
    "/* /* SELECT */ */COMMIT",
    "/* unterminated SELECT",
    "-- SELECT",
    "((\n\tcommit",
    "",
    "   ",
    "\u00a0SELECT 1",
  ])("refuses %j before it reaches the database", async (text) => {
    const db = fakePool();
    const statement = text;
    await expect(db.withActor(TOKEN, (tx) => tx.query(statement))).rejects.toThrow("not allowed in a withActor transaction");
    expect(db.statements()).toEqual(["BEGIN", "SELECT", "ROLLBACK", "DISCARD"]);
  });

  it.each([
    ["SELECT 1", "SELECT"],
    ["  with x AS (SELECT 1) SELECT * FROM x", "WITH"],
    ["-- note\n/* a /* b */ c */ insert INTO t VALUES (1)", "INSERT"],
    ["(SELECT 1) UNION (SELECT 2)", "SELECT"],
    ["update t SET a = 1", "UPDATE"],
    ["DELETE FROM t", "DELETE"],
    ["CALL p()", "CALL"],
  ])("reads the first keyword of %j", async (text, keyword) => {
    const statement = text;
    expect(leadingKeyword(statement)).toBe(keyword);
    const db = fakePool();
    await db.withActor(TOKEN, (tx) => tx.query(statement));
    expect(db.sent[2]).toMatchObject({ text: statement.trim(), queryMode: "extended" });
  });

  it("refuses a nested call and leaves the outer transaction to fail on its own terms", async () => {
    const db = fakePool();
    const inner = vi.fn(async () => "inner");
    await expect(db.withActor(TOKEN, async () => db.withActor(TOKEN, inner))).rejects.toThrow("nested call");
    expect(inner).not.toHaveBeenCalled();
    expect(db.statements()).toEqual(["BEGIN", "SELECT", "ROLLBACK", "DISCARD"]);
    // Calls side by side are not nested.
    await expect(Promise.all([db.withActor(TOKEN, async () => 1), db.withActor(null, async () => 2)])).resolves.toEqual([1, 2]);
  });

  it("fails without committing when fn swallowed an error that aborted the transaction", async () => {
    const aborted = Object.assign(new Error("current transaction is aborted"), { code: "25P02" });
    const db = fakePool({ "SELECT pg_catalog.current_setting": aborted });
    await expect(db.withActor(TOKEN, async () => "saved")).rejects.toThrow("rolled back");
    expect(db.statements()).toEqual(["BEGIN", "SELECT", "SELECT", "ROLLBACK", "DISCARD"]);
  });

  it("closes a connection that dropped inside fn and stops listening to it", async () => {
    const db = fakePool();
    const dropped = new Error("Connection terminated unexpectedly");
    await db.withActor(TOKEN, async () => {
      expect(db.client.listeners.size).toBe(1);
      for (const listener of db.client.listeners) listener(dropped);
    });
    expect(db.released).toEqual([dropped]);
    expect(db.client.listeners.size).toBe(0);
  });

  it("closes a connection it cannot reset and keeps the committed result", async () => {
    const resetFailure = new Error("connection lost");
    const db = fakePool({ DISCARD: resetFailure });
    await expect(db.withActor(TOKEN, async () => "saved")).resolves.toBe("saved");
    expect(db.statements()).toEqual(["BEGIN", "SELECT", "SELECT", "COMMIT", "DISCARD"]);
    expect(db.released).toEqual([resetFailure]);

    const failure = new Error("fn failed");
    const failed = fakePool({ DISCARD: resetFailure });
    await expect(failed.withActor(TOKEN, async () => Promise.reject(failure))).rejects.toBe(failure);
    expect(failed.released).toEqual([resetFailure]);
  });

  it("does not reset a connection that is closed anyway", async () => {
    const db = fakePool({ "SELECT pg_catalog.set_config": { rows: [{ token_set: true, app_role: false }] } });
    await expect(db.withActor(TOKEN, async () => "ran")).rejects.toThrow("not a ductus_app login");
    expect(db.statements()).not.toContain("DISCARD");
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
});
