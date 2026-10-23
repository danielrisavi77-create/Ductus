import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readShellRole } from "./shell-role";

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
