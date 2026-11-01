import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readStudentHome } from "./student-home-read";

// F-171: /zadaci and /zadaci/kolegiji read the shell account first and the
// courses only for an open session, through one shared helper.
const TOKEN = "A".repeat(43);
const USER = "00000000-0000-4000-8000-0000000000a1";
const INSTITUTION = "00000000-0000-4000-8000-0000000000b1";

type Account = { signed_in: boolean; teacher: boolean; user_id: string | null; institution_id: string | null };

function actor(account: Account | "fail") {
  const transactions = vi.fn();
  const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) => {
    const query = async (sql: string) => {
      transactions(sql.includes("app.current_actor()") ? "account" : "assignments");
      if (account === "fail") throw new Error("down");
      if (sql.includes("app.current_actor()")) return { rows: [account], rowCount: 1 };
      return { rows: [{ user_id: USER, course_id: null, course_name: null, assignment_id: null, title: null, due_at: null, acknowledged: null }], rowCount: 1 };
    };
    return fn({ query } as unknown as ActorTransaction);
  }) as unknown as WithActor;
  return { withActor, transactions };
}

describe("readStudentHome (F-171)", () => {
  it("reads no courses when the session is not open", async () => {
    const { withActor, transactions } = actor({ signed_in: false, teacher: false, user_id: null, institution_id: null });
    const home = await readStudentHome(TOKEN, withActor);
    expect(home.read).toEqual({ kind: "signedOut" });
    expect(home.account).toEqual({ role: null, scope: null });
    expect(withActor).toHaveBeenCalledTimes(1);
    expect(transactions.mock.calls).toEqual([["account"]]);
  });

  it("asks the database nothing without a well-formed cookie", async () => {
    const { withActor } = actor({ signed_in: true, teacher: false, user_id: USER, institution_id: INSTITUTION });
    for (const token of [undefined, "", "!".repeat(43)]) {
      expect((await readStudentHome(token, withActor)).read).toEqual({ kind: "signedOut" });
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  it("shows the list unavailable, not signed out, when the account read fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { withActor } = actor("fail");
    const home = await readStudentHome(TOKEN, withActor);
    expect(home.read).toEqual({ kind: "unavailable" });
    expect(withActor).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("reads the courses after the account for an open session", async () => {
    const { withActor, transactions } = actor({ signed_in: true, teacher: false, user_id: USER, institution_id: INSTITUTION });
    const home = await readStudentHome(TOKEN, withActor);
    expect(home.account.role).toBe("student");
    expect(home.account.scope).not.toBeNull();
    expect(home.read).toEqual({ kind: "ready", courses: [] });
    expect(transactions.mock.calls).toEqual([["account"], ["assignments"]]);
  });

  it.each(["app/zadaci/page.tsx", "app/zadaci/kolegiji/page.tsx"])("%s reads through readStudentHome only", (page) => {
    const source = readFileSync(join(process.cwd(), page), "utf8");
    expect(source).toContain("readStudentHome(token, withActor)");
    expect(source).not.toMatch(/readMyAssignments|readShellAccount/);
  });
});
