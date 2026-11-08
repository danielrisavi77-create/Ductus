import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readTeacherRoles, teacherRolesOf } from "./teacher-roles";

// Invented people and ids only.
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-nastavnici-4c2e";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const WHEN = new Date("2026-11-02T09:15:00.000Z");
const EARLIER = new Date("2026-10-20T14:00:00.000Z");

type Row = Record<string, unknown>;

function candidate(n: number, extra: Row = {}): Row {
  return { user_id: id(n), list: "candidate", given_name: "Iva", family_name: "Primjer", confirmed_at: null,
    revoked_at: null, for_review: null, ...extra };
}

function teacher(n: number, extra: Row = {}): Row {
  return { user_id: id(n), list: "confirmed", given_name: "Ana", family_name: "Uzorak", confirmed_at: WHEN,
    revoked_at: null, for_review: false, ...extra };
}

function database(answer: { rows?: Row[]; code?: string }) {
  const calls: string[] = [];
  const withActor = vi.fn(async (_token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string) {
        calls.push(text);
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("readTeacherRoles", () => {
  it.each([undefined, "", "kratko", `${"T".repeat(42)}!`])("refuses token %j without a query", async (token) => {
    const db = database({ rows: [] });
    expect(await readTeacherRoles(token, db.withActor)).toEqual({ kind: "unauthorized" });
    expect(db.withActor).not.toHaveBeenCalled();
  });

  it("reads both lists under the caller's session, with no parameter and no login time", async () => {
    const db = database({ rows: [candidate(1, { revoked_at: EARLIER }), teacher(2, { for_review: true })] });
    expect(await readTeacherRoles(TOKEN, db.withActor)).toEqual({
      kind: "ok",
      pending: [{ personId: id(1), name: { givenName: "Iva", familyName: "Primjer" }, revokedAt: EARLIER.toISOString() }],
      confirmed: [{ personId: id(2), name: { givenName: "Ana", familyName: "Uzorak" }, confirmedAt: WHEN.toISOString(),
        forReview: true }],
    });
    expect(db.withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toContain("institution.teacher_roles()");
    expect(db.calls[0]).not.toMatch(/\$1|login|last_seen|session/i);
  });

  it("answers empty lists when nobody is a candidate or a teacher", async () => {
    expect(await readTeacherRoles(TOKEN, database({ rows: [] }).withActor))
      .toEqual({ kind: "ok", pending: [], confirmed: [] });
  });

  it.each([
    ["ZD401", "unauthorized"],
    ["ZD403", "notFound"],
    ["42501", "unavailable"],
    ["57014", "unavailable"],
  ])("maps SQLSTATE %s to %s and logs only the code", async (code, kind) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readTeacherRoles(TOKEN, database({ code }).withActor)).toEqual({ kind });
    expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
    if (kind === "unavailable") expect(log).toHaveBeenCalledWith("teacher roles read failed", code);
  });

  it("logs unknown for an error without a SQLSTATE", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const withActor = vi.fn(async () => { throw new Error(CANARY); }) as unknown as WithActor;
    expect(await readTeacherRoles(TOKEN, withActor)).toEqual({ kind: "unavailable" });
    expect(log).toHaveBeenCalledWith("teacher roles read failed", "unknown");
  });

  it("is unavailable, never a shorter list, when one row is malformed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = database({ rows: [teacher(1), teacher(2, { for_review: "da" })] });
    expect(await readTeacherRoles(TOKEN, db.withActor)).toEqual({ kind: "unavailable" });
    expect(log).toHaveBeenCalledWith("teacher roles read failed", "row_malformed");
  });
});

describe("teacherRolesOf", () => {
  it.each<[string, Row[]]>([
    ["an unknown list", [candidate(1, { list: "admin" })]],
    ["an id that is not a UUID", [candidate(1, { user_id: "1" })]],
    ["an id that is not a string", [teacher(1, { user_id: 1 })]],
    ["half a name", [candidate(1, { family_name: null })]],
    ["an empty name", [teacher(1, { given_name: "" })]],
    ["a name of 256 code points", [teacher(1, { family_name: "Ž".repeat(256) })]],
    ["a name with a control character", [candidate(1, { given_name: "Iva\u0007" })]],
    ["a name with a C1 control character", [candidate(1, { family_name: "Pri\u0085mjer" })]],
    ["a candidate with a confirmation time", [candidate(1, { confirmed_at: WHEN })]],
    ["a candidate with the P7 mark", [candidate(1, { for_review: false })]],
    ["a candidate with a revocation that is not a date", [candidate(1, { revoked_at: "2026-10-20" })]],
    ["a candidate with an invalid date", [candidate(1, { revoked_at: new Date(Number.NaN) })]],
    ["a teacher without a confirmation time", [teacher(1, { confirmed_at: null })]],
    ["a teacher with a revocation time", [teacher(1, { revoked_at: EARLIER })]],
    ["a teacher without a boolean mark", [teacher(1, { for_review: null })]],
    ["the same person twice", [teacher(1), teacher(1)]],
    ["the same person on both lists", [candidate(1), teacher(1)]],
  ])("refuses %s", (_label, rows) => {
    expect(teacherRolesOf(rows)).toBeNull();
  });

  it("accepts a name of 255 code points, counted as the database counts", () => {
    const long = "𝔸".repeat(255);
    expect(teacherRolesOf([teacher(1, { given_name: long })])?.confirmed[0]?.name?.givenName).toBe(long);
  });

  it("orders by surname, then given name, in Croatian collation, then id; no name last", () => {
    const roles = teacherRolesOf([
      teacher(5, { given_name: null, family_name: null }),
      teacher(4, { given_name: null, family_name: null }),
      teacher(3, { given_name: "Ana", family_name: "Čavlić" }),
      teacher(2, { given_name: "Ana", family_name: "Zorić" }),
      teacher(1, { given_name: "Ana", family_name: "Cvjetić" }),
      teacher(7, { given_name: "Bor", family_name: "Cvjetić" }),
      teacher(6, { given_name: "Bor", family_name: "Cvjetić" }),
    ]);
    expect(roles?.confirmed.map((r) => r.personId)).toEqual([id(1), id(6), id(7), id(3), id(2), id(4), id(5)]);
  });

  it("keeps each list a permutation of its rows, in an order that does not depend on the input order", () => {
    const names = fc.option(fc.record({
      given_name: fc.constantFrom("Ana", "Bor", "Čedo", "Ivo"),
      family_name: fc.constantFrom("Cvjetić", "Čavlić", "Ćorić", "Zorić", "Šarić"),
    }), { nil: null });
    const rows = fc.uniqueArray(
      fc.record({ n: fc.integer({ min: 1, max: 10_000 }), name: names, pending: fc.boolean(), mark: fc.boolean() }),
      { selector: (r) => r.n, maxLength: 30 },
    ).map((list) => list.map(({ n, name, pending, mark }) => {
      const pair = name ?? { given_name: null, family_name: null };
      return pending ? candidate(n, pair) : teacher(n, { ...pair, for_review: mark });
    }));
    fc.assert(fc.property(rows, fc.func(fc.integer()), (input, key) => {
      const shuffled = [...input].sort((a, b) => key(a.user_id) - key(b.user_id));
      const first = teacherRolesOf(input);
      expect(first).not.toBeNull();
      expect(teacherRolesOf(shuffled)).toEqual(first);
      const ids = (list: Row[]) => list.map((r) => r.user_id as string).sort();
      expect(first!.pending.map((r) => r.personId).sort()).toEqual(ids(input.filter((r) => r.list === "candidate")));
      expect(first!.confirmed.map((r) => r.personId).sort()).toEqual(ids(input.filter((r) => r.list === "confirmed")));
    }));
  });
});
