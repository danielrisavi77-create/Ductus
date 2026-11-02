import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { teacherPageAccess } from "@/components/auth/access-kind";

import { teacherAccess, teacherPageRead } from "./teacher-access";

const TOKEN = "A".repeat(43);

function actor(allowed: boolean) {
  const query = vi.fn(async () => ({ rows: [{ allowed }], rowCount: 1 }));
  const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, query };
}

describe("F-6b teacher-only screen", () => {
  it("does not contact the DB without a valid session cookie", async () => {
    const { withActor, query } = actor(true);
    for (const token of [undefined, "", "invalid", "!".repeat(43)]) {
      expect(await teacherAccess(token, withActor)).toBe("signedOut");
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("uses the cookie principal and the B-7 confirmed role function", async () => {
    const { withActor, query } = actor(true);
    expect(await teacherAccess(TOKEN, withActor)).toBe("allowed");
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledWith("SELECT institution.actor_has_role('teacher') AS allowed");
  });

  it("refuses absent/revoked teacher roles and fails closed on DB errors", async () => {
    expect(await teacherAccess(TOKEN, actor(false).withActor)).toBe("denied");
    const outage = vi.fn(async () => { throw new Error("raw SQL must not leak"); }) as unknown as WithActor;
    expect(await teacherAccess(TOKEN, outage)).toBe("unavailable");
  });
});

// #1242 round 1 (c.6562992740, c.6563056077): the session and the role are
// one statement, so a session closed in another tab between two reads can
// no longer read as open for one and closed for the other.
describe("teacherPageRead", () => {
  type Row = { user_id: string | null; institution_id: string | null; allowed: boolean | null };

  /** A database whose session is closed once the first statement has run, as a sign-out in another tab would. */
  function closingAfterFirstStatement(first: Row) {
    let calls = 0;
    const query = vi.fn(async () => {
      calls += 1;
      const row = calls === 1 ? first : { user_id: null, institution_id: null, allowed: false };
      return { rows: [row], rowCount: 1 };
    });
    const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
      fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
    return { withActor, query };
  }

  const USER = "00000000-0000-4000-8000-0000000000a1";
  const INSTITUTION = "00000000-0000-4000-8000-0000000000b1";

  it("reads the session and the role in one statement under one withActor", async () => {
    const { withActor, query } = closingAfterFirstStatement({ user_id: USER, institution_id: INSTITUTION, allowed: true });
    const read = await teacherPageRead(TOKEN, withActor);
    expect(withActor).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toContain("app.current_actor()");
    expect(sql).toContain("institution.actor_has_role('teacher')");
    expect(read.access).toBe("allowed");
    expect(read.principal.kind).toBe("signed-in");
  });

  it("never pairs an allowed role with a closed principal (Z-03, not the page)", async () => {
    const { withActor } = closingAfterFirstStatement({ user_id: USER, institution_id: INSTITUTION, allowed: true });
    const read = await teacherPageRead(TOKEN, withActor);
    expect(teacherPageAccess(read.access, read.principal.kind, TOKEN)).toBe("allowed");
    const closed = await teacherPageRead(TOKEN, closingAfterFirstStatement({ user_id: null, institution_id: null, allowed: false }).withActor);
    expect(closed).toEqual({ access: "signedOut", principal: { kind: "signed-out" } });
    expect(teacherPageAccess(closed.access, closed.principal.kind, TOKEN)).toBe("expired");
  });

  it("reads a closed session as Z-03, never as Z-05 without a sign-in", async () => {
    const { withActor } = closingAfterFirstStatement({ user_id: null, institution_id: null, allowed: false });
    const read = await teacherPageRead(TOKEN, withActor);
    expect(read.access).not.toBe("denied");
    expect(teacherPageAccess(read.access, read.principal.kind, TOKEN)).toBe("expired");
  });

  it("gives Z-05 only to an open session without the role", async () => {
    const { withActor } = closingAfterFirstStatement({ user_id: USER, institution_id: INSTITUTION, allowed: false });
    const read = await teacherPageRead(TOKEN, withActor);
    expect(read).toMatchObject({ access: "denied", principal: { kind: "signed-in" } });
    expect(teacherPageAccess(read.access, read.principal.kind, TOKEN)).toBe("denied");
  });

  it("does not contact the DB without a valid cookie and fails closed on errors", async () => {
    const { withActor, query } = closingAfterFirstStatement({ user_id: USER, institution_id: INSTITUTION, allowed: true });
    for (const token of [undefined, "", "invalid", "!".repeat(43)]) {
      expect(await teacherPageRead(token, withActor)).toEqual({ access: "signedOut", principal: { kind: "signed-out" } });
    }
    expect(query).not.toHaveBeenCalled();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const outage = vi.fn(async () => { throw new Error(`raw SQL ${TOKEN} must not leak`); }) as unknown as WithActor;
    expect(await teacherPageRead(TOKEN, outage)).toEqual({ access: "unavailable", principal: { kind: "unverified" } });
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
    error.mockRestore();
  });
});
