import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { teacherAccess } from "./teacher-access";

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
      expect(await teacherAccess(token, withActor)).toBe("denied");
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
