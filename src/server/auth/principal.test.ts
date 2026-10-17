import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import {
  PRINCIPAL_SCOPE_LABEL, principalScope, SESSION_TAG_LABEL, sessionPrincipal, sessionTag,
} from "./principal";

// F-5, plan #376 rows 1 and 7: the journal scope comes from the session the
// database recognises, never from anything else in the request.

const TOKEN = "A".repeat(43);
const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const INSTITUTION = "00000000-0000-4000-8000-0000000000f1";

function fakeWithActor(row: Record<string, unknown> | undefined) {
  const queries: string[] = [];
  const tokens: (string | null | undefined)[] = [];
  const withActor: WithActor = async (token, fn) => {
    tokens.push(token);
    const tx: ActorTransaction = {
      async query(text) {
        queries.push(text);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 } as never;
      },
    };
    return fn(tx);
  };
  return { withActor, queries, tokens };
}

describe("sessionPrincipal", () => {
  it("names the journal of the person and institution the database returns", async () => {
    const db = fakeWithActor({ user_id: USER_A, institution_id: INSTITUTION });
    const principal = await sessionPrincipal(TOKEN, db.withActor);
    expect(principal).toEqual({ kind: "signed-in", scope: principalScope(USER_A, INSTITUTION) });
    expect(db.tokens).toEqual([TOKEN]);
    expect(db.queries).toEqual(["SELECT user_id, institution_id FROM app.current_actor()"]);
  });

  it.each([
    ["no cookie", undefined],
    ["an empty cookie", ""],
    ["a short cookie", "A".repeat(42)],
    ["a cookie with other characters", `${"A".repeat(42)}=`],
  ])("is signed out without asking the database for %s", async (_name, token) => {
    const db = fakeWithActor({ user_id: USER_A, institution_id: INSTITUTION });
    expect(await sessionPrincipal(token, db.withActor)).toEqual({ kind: "signed-out" });
    expect(db.tokens).toEqual([]);
  });

  it.each([
    ["a closed or expired session (current_actor gives nulls)", { user_id: null, institution_id: null }],
    ["no row at all", undefined],
    ["a user without an institution", { user_id: USER_A, institution_id: null }],
  ])("is signed out for %s", async (_name, row) => {
    expect(await sessionPrincipal(TOKEN, fakeWithActor(row).withActor)).toEqual({ kind: "signed-out" });
  });

  it("is unverified, not signed out, when the database cannot answer, and logs no token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: WithActor = async () => {
      throw Object.assign(new Error(`connection refused for ${TOKEN}`), { name: "DatabaseError" });
    };
    expect(await sessionPrincipal(TOKEN, failing)).toEqual({ kind: "unverified" });
    expect(log).toHaveBeenCalledWith("session check failed", "DatabaseError");
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    log.mockRestore();
  });
});

describe("sessionTag", () => {
  it("is a labelled digest of the cookie, never the database's token digest", () => {
    const tag = sessionTag(TOKEN);
    expect(tag).toBe(createHash("sha256").update(`${SESSION_TAG_LABEL}\n${TOKEN}`, "utf8").digest("hex"));
    expect(tag).not.toBe(createHash("sha256").update(TOKEN, "utf8").digest("hex"));
    expect(tag).not.toContain(TOKEN);
    expect(sessionTag("B".repeat(43))).not.toBe(tag);
  });

  it.each([undefined, "", "A".repeat(42), `${"A".repeat(42)}=`])("is null for %s", (token) => {
    expect(sessionTag(token)).toBeNull();
  });
});

describe("principalScope", () => {
  it("is the SHA-256 hex of the versioned label, institution and user", () => {
    const expected = createHash("sha256")
      .update(`${PRINCIPAL_SCOPE_LABEL}\n${INSTITUTION}\n${USER_A}`, "utf8")
      .digest("hex");
    expect(principalScope(USER_A, INSTITUTION)).toBe(expected);
    expect(principalScope(USER_A, INSTITUTION)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs per user, per institution and from the local demo scope", async () => {
    const { LOCAL_DEMO_SCOPE_HASH } = await import("@/lib/journal/local-scope");
    const scopes = new Set([
      principalScope(USER_A, INSTITUTION),
      principalScope(USER_B, INSTITUTION),
      principalScope(USER_A, "00000000-0000-4000-8000-0000000000f2"),
      LOCAL_DEMO_SCOPE_HASH,
    ]);
    expect(scopes.size).toBe(4);
  });
});
