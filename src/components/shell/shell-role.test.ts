import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readHome, readShellRole } from "./shell-role";

const TOKEN = "A".repeat(43);

function actor(row: { signed_in: boolean; teacher: boolean } | undefined) {
  const query = vi.fn(async () => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 }));
  const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, query };
}

describe("shell role (I3)", () => {
  it("asks the database nothing without a well-formed cookie", async () => {
    const { withActor, query } = actor({ signed_in: true, teacher: true });
    for (const token of [undefined, "", "invalid", "!".repeat(43)]) {
      expect(await readShellRole(token, withActor)).toBeNull();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("reads the role under the cookie's own session, through the B-7 role check", async () => {
    const { withActor, query } = actor({ signed_in: true, teacher: true });
    expect(await readShellRole(TOKEN, withActor)).toBe("teacher");
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("institution.actor_has_role('teacher')"));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM app.current_actor()"));
  });

  it("makes any other open session a student", async () => {
    expect(await readShellRole(TOKEN, actor({ signed_in: true, teacher: false }).withActor)).toBe("student");
  });

  it("shows no role for a closed session, an empty answer or a failed read", async () => {
    expect(await readShellRole(TOKEN, actor({ signed_in: false, teacher: false }).withActor)).toBeNull();
    expect(await readShellRole(TOKEN, actor(undefined).withActor)).toBeNull();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const outage = vi.fn(async () => { throw new Error("raw SQL must not leak"); }) as unknown as WithActor;
    expect(await readShellRole(TOKEN, outage)).toBeNull();
    expect(JSON.stringify(error.mock.calls)).not.toContain("raw SQL");
    error.mockRestore();
  });
});

// DAN-325 and F-151: "/" decides where a signed-in person goes, and the
// shell's scope, from one read (the cases of home-target.test.ts).
describe("readHome", () => {
  const USER = "00000000-0000-4000-8000-0000000000a1";
  const INSTITUTION = "00000000-0000-4000-8000-0000000000b1";

  it("sends a confirmed teacher to /nastavnik and any other open session to /rad, with one read", async () => {
    const teacher = actor({ signed_in: true, teacher: true, user_id: USER, institution_id: INSTITUTION } as never);
    const home = await readHome(TOKEN, teacher.withActor);
    expect(home.path).toBe("/nastavnik");
    expect(home.scope).not.toBeNull();
    expect(home.closed).toBe(false);
    expect(teacher.withActor).toHaveBeenCalledTimes(1);
    const student = actor({ signed_in: true, teacher: false, user_id: USER, institution_id: INSTITUTION } as never);
    expect((await readHome(TOKEN, student.withActor)).path).toBe("/rad");
    expect(student.withActor).toHaveBeenCalledTimes(1);
  });

  it("guesses nothing without an open session, and asks nothing without a well-formed cookie", async () => {
    const { withActor } = actor({ signed_in: true, teacher: true });
    for (const token of [undefined, "", "kratko", `${TOKEN}!`]) {
      expect(await readHome(token, withActor)).toEqual({ path: null, scope: null, closed: true });
    }
    expect(withActor).not.toHaveBeenCalled();
    expect(await readHome(TOKEN, actor({ signed_in: false, teacher: false }).withActor)).toEqual({ path: null, scope: null, closed: true });
  });

  it("guesses nothing when the database does not answer as expected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const outage = vi.fn(async () => { throw new Error("connection refused"); }) as unknown as WithActor;
    // #1231: a database that could not be read is not a closed session.
    expect(await readHome(TOKEN, outage)).toEqual({ path: null, scope: null, closed: false });
    // No row from current_actor() is no open session.
    expect(await readHome(TOKEN, actor(undefined).withActor)).toEqual({ path: null, scope: null, closed: true });
    error.mockRestore();
  });
});
