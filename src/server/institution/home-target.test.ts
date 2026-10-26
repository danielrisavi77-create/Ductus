import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { homeTarget } from "./home-target";

const TOKEN = "T".repeat(43);
const COURSE = {
  course_id: "00000000-0000-4000-8000-0000000000c1",
  course_name: "Izmišljeni kolegij",
  academic_year: "2026/2027",
  assignment_id: null,
};

function database(answer: { rows?: Record<string, unknown>[]; code?: string; fail?: boolean }) {
  return vi.fn(async (_token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) => {
    if (answer.fail) throw new Error("connection refused");
    return fn({
      async query() {
        if (answer.code) throw Object.assign(new Error("refused"), { code: answer.code });
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction);
  }) as unknown as WithActor;
}

describe("homeTarget", () => {
  it("sends a confirmed teacher to /nastavnik, also without any course", async () => {
    expect(await homeTarget(TOKEN, database({ rows: [] }))).toEqual({ kind: "page", path: "/nastavnik" });
    expect(await homeTarget(TOKEN, database({ rows: [COURSE] }))).toEqual({ kind: "page", path: "/nastavnik" });
  });

  it("sends a person without the teacher role to /rad", async () => {
    expect(await homeTarget(TOKEN, database({ code: "ZD403" }))).toEqual({ kind: "page", path: "/rad" });
  });

  it("guesses nothing without an open session", async () => {
    const withActor = database({ rows: [] });
    for (const token of [undefined, "", "kratko", `${TOKEN}!`]) {
      expect(await homeTarget(token, withActor)).toEqual({ kind: "signed-out" });
    }
    expect(withActor).not.toHaveBeenCalled();
    expect(await homeTarget(TOKEN, database({ code: "ZD401" }))).toEqual({ kind: "signed-out" });
  });

  it("guesses nothing when the database does not answer as expected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await homeTarget(TOKEN, database({ fail: true }))).toEqual({ kind: "unverified" });
    expect(await homeTarget(TOKEN, database({ code: "57P01" }))).toEqual({ kind: "unverified" });
    expect(await homeTarget(TOKEN, database({ rows: [{ course_id: "nije-uuid" }] }))).toEqual({ kind: "unverified" });
    vi.restoreAllMocks();
  });
});
