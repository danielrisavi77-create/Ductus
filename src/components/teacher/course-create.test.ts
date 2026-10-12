import { describe, expect, it, vi } from "vitest";

import { createCourse } from "./course-create";

const valid = {
  name: "Političke institucije",
  academicYear: "2026/2027",
  aiPolicy: "partially_allowed" as const,
};
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("F-6b course form transport contract", () => {
  it("posts only the course fields to the existing same-origin endpoint", async () => {
    const send = vi.fn(async () => Response.json({ id: ID }, { status: 200 })) as unknown as typeof fetch;
    const result = await createCourse({ ...valid, institutionId: "forged", userId: "forged" } as typeof valid, send);
    expect(result).toEqual({ kind: "created", id: ID });
    expect(send).toHaveBeenCalledTimes(1);
    const [path, options] = (send as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("/api/institution/courses");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(options.body as string)).toEqual(valid);
  });

  it.each([
    [{ ...valid, name: "" }],
    [{ ...valid, name: "   " }],
    [{ ...valid, name: "A".repeat(161) }],
    [{ ...valid, academicYear: "2026/2028" }],
    [{ ...valid, academicYear: "2026-2027" }],
    [{ ...valid, aiPolicy: "all_allowed" }],
  ])("rejects invalid data before calling the endpoint", async (input) => {
    const send = vi.fn();
    expect(await createCourse(input as typeof valid, send as unknown as typeof fetch)).toEqual({ kind: "invalid" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [409, "conflict"],
    [413, "invalid"],
    [415, "invalid"],
    [422, "invalid"],
    [500, "unavailable"],
    [429, "unavailable"],
  ] as const)("keeps HTTP %i as a safe, user-visible %s state", async (status, kind) => {
    const send = vi.fn(async () => Response.json({ error: "raw database diagnostics" }, { status }));
    expect(await createCourse(valid, send as unknown as typeof fetch)).toEqual({ kind });
  });

  it("refuses a malformed successful response and does not claim a course was created", async () => {
    for (const payload of [{ id: "not-a-uuid" }, { ok: true }, []]) {
      const send = vi.fn(async () => Response.json(payload));
      expect(await createCourse(valid, send as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
    }
    const broken = vi.fn(async () => new Response("{broken", { status: 200 }));
    expect(await createCourse(valid, broken as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
  });

  it("never claims success on transport exceptions or a redirected login", async () => {
    const offline = vi.fn(async () => { throw new Error("secret raw transport details"); });
    expect(await createCourse(valid, offline as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: "/api/auth/login" } }));
    expect(await createCourse(valid, redirect as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
  });
});
