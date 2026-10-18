import { describe, expect, it, vi } from "vitest";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { enrollWithCode, normalizeCode } from "./enroll-code";

const COURSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("F-7 enrollment code", () => {
  it("normalizes the code as enroll_with_code compares it", () => {
    expect(normalizeCode(" ab12-cd34 ef56-7890 ")).toBe("AB12CD34EF567890");
    for (const bad of ["", "ABC-123", "A".repeat(33), "ABCD-1234-ČĆŽŠ", `${"A".repeat(8)}${" ".repeat(60)}`]) {
      expect(normalizeCode(bad)).toBeNull();
    }
  });

  it("posts only the normalized code", async () => {
    const send = vi.fn(async () => Response.json({ courseId: COURSE }));
    expect(await enrollWithCode("ab12-cd34-ef56-7890", send as unknown as typeof fetch)).toEqual({ kind: "enrolled", courseId: COURSE });
    const [path, options] = send.mock.calls[0]! as unknown as [string, RequestInit];
    expect(path).toBe("/api/institution/enrollments");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(options.body as string)).toEqual({ code: "AB12CD34EF567890" });
  });

  it("does not send a code that can never match, so it spends no attempt", async () => {
    const send = vi.fn();
    expect(await enrollWithCode("12-34", send as unknown as typeof fetch)).toEqual({ kind: "malformed" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [422, "refused"],
    [429, "tooManyAttempts"],
    [400, "invalid"],
    [404, "unavailable"],
    [201, "unavailable"],
    [503, "unavailable"],
  ] as const)("keeps HTTP %i as the local %s state", async (status, kind) => {
    const send = vi.fn(async () => Response.json({ courseId: COURSE, error: "raw diagnostics" }, { status }));
    expect(await enrollWithCode("AB12CD34", send as unknown as typeof fetch)).toEqual({ kind });
  });

  it("never claims enrollment on a malformed reply or a transport failure", async () => {
    const bad = vi.fn(async () => Response.json({ courseId: "nope" }));
    expect(await enrollWithCode("AB12CD34", bad as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
    const offline = vi.fn(async () => { throw new Error("offline"); });
    expect(await enrollWithCode("AB12CD34", offline as unknown as typeof fetch)).toEqual({ kind: "unavailable" });
  });

  it("has a local message for every failure", () => {
    expect(Object.keys(t.student.enroll.errors).sort()).toEqual(
      ["forbidden", "invalid", "malformed", "refused", "tooManyAttempts", "unauthorized", "unavailable"]);
  });

  it("promises no fixed wait after 429, since the institution sets the window", () => {
    expect(t.student.enroll.errors.tooManyAttempts).not.toMatch(/minut|sat[ia]?\b|sekund|\d/i);
  });
});
