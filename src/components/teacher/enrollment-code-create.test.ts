import { afterEach, describe, expect, it, vi } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import type { CourseCreation } from "./course-create";
import { createCourseThenCode, createEnrollmentCode, enrollmentCodeExpiry } from "./enrollment-code-create";

// Simulated HTTP only: this proves the browser side of #576, not the server,
// the session or the database (the real route runs in e2e/login/demo-flow.spec.ts).
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CODE = "0123-4567-89AB-CDEF"; // Invented, never issued by a server.
const UNTIL = "2026-11-02T09:00:00.000Z";
const ec = messagesHr.teacher.enrollmentCode;
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("enrollmentCodeExpiry: the teacher's local minute, no default", () => {
  it.each(["", "bad", "2026-11-02", "2026-11-02T10:00:01", "2026-11-02T10:00Z",
    "0000-01-01T10:00", "2026-02-30T10:00", "2026-02-29T10:00", "2026-04-31T10:00",
    "2026-13-01T10:00", "2026-01-01T24:00", "2026-01-01T10:60"])("rejects %j without normalizing it", (local) => {
    expect(enrollmentCodeExpiry(local)).toBeNull();
  });

  it("turns a valid choice into one instant with its offset; past dates stay the server's to refuse", () => {
    vi.stubEnv("TZ", "Europe/Zagreb");
    expect(enrollmentCodeExpiry("2026-11-02T10:00")).toEqual({ validUntil: UNTIL, offset: "+01:00" });
    expect(enrollmentCodeExpiry("2028-02-29T10:07")).toEqual({ validUntil: "2028-02-29T09:07:00.000Z", offset: "+01:00" });
    expect(enrollmentCodeExpiry("2020-01-01T10:00")).not.toBeNull();
  });

  it("refuses a minute the spring change skips and names the offset of the repeated autumn hour", () => {
    vi.stubEnv("TZ", "Europe/Zagreb");
    expect(enrollmentCodeExpiry("2026-03-29T02:30")).toBeNull();
    expect(enrollmentCodeExpiry("2026-03-29T03:30")).toEqual({ validUntil: "2026-03-29T01:30:00.000Z", offset: "+02:00" });
    expect(enrollmentCodeExpiry("2026-10-25T02:30")).toEqual({ validUntil: "2026-10-25T00:30:00.000Z", offset: "+02:00" });
    expect(enrollmentCodeExpiry("2026-10-25T03:30")).toEqual({ validUntil: "2026-10-25T02:30:00.000Z", offset: "+01:00" });
  });

  it("uses the teacher's own zone rather than assuming Zagreb", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(enrollmentCodeExpiry("2026-11-02T10:07")).toEqual({ validUntil: "2026-11-02T15:07:00.000Z", offset: "-05:00" });
    expect(enrollmentCodeExpiry("2026-03-08T02:30")).toBeNull();
  });
});

describe("createEnrollmentCode: one attempt against the #575 route", () => {
  it("sends only the chosen instant to the course's same-origin route", async () => {
    const send = vi.fn(async () => Response.json({ code: CODE }));
    expect(await createEnrollmentCode(ID, UNTIL, send)).toEqual({ kind: "available", code: CODE, validUntil: UNTIL });
    expect(send).toHaveBeenCalledExactlyOnceWith(`/api/institution/courses/${ID}/enrollment-code`, {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      cache: "no-store", redirect: "error", body: JSON.stringify({ validUntil: UNTIL }),
    });
  });

  it.each([[401, "unauthorized"], [403, "forbidden"], [400, "invalid"], [413, "invalid"], [415, "invalid"],
    [422, "invalid"], [500, "unavailable"], [503, "unavailable"], [302, "unavailable"], [201, "unavailable"]] as const)(
    "maps %i to %s and never retries", async (status, kind) => {
      const send = vi.fn(async () => Response.json({ error: "x" }, { status }));
      expect(await createEnrollmentCode(ID, UNTIL, send)).toEqual({ kind });
      expect(send).toHaveBeenCalledTimes(1);
    });

  it("refuses a forged course id or a malformed instant before sending", async () => {
    const send = vi.fn();
    for (const [id, until] of [["../other", UNTIL], [ID, ""], [ID, "2026-02-30T10:00:00.000Z"],
      [ID, "2026-11-02T10:00"], [ID, "2026-11-02T10:00:00+01:00"]] as const) {
      expect(await createEnrollmentCode(id, until, send)).toEqual({ kind: "invalid" });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { code: 123 }, { code: "made-up" }, { code: CODE.toLowerCase() }])(
    "does not show a malformed success %j as a code", async (body) => {
      expect(await createEnrollmentCode(ID, UNTIL, async () => Response.json(body))).toEqual({ kind: "unavailable" });
    });

  it("reports a lost or unreadable reply as unknown, once", async () => {
    for (const send of [vi.fn(async () => { throw new Error("lost"); }), vi.fn(async () => new Response("{broken"))]) {
      expect(await createEnrollmentCode(ID, UNTIL, send)).toEqual({ kind: "unavailable" });
      expect(send).toHaveBeenCalledTimes(1);
    }
  });
});

describe("createCourseThenCode: one teacher action, course first", () => {
  const created: CourseCreation = { kind: "available", id: ID };
  const run = (overrides: Partial<Parameters<typeof createCourseThenCode>[0]> = {}) => {
    const calls = { course: vi.fn(async () => created), onCourse: vi.fn(), send: vi.fn<typeof fetch>(async () => Response.json({ code: CODE })) };
    const result = createCourseThenCode({
      courseId: null, createCourse: calls.course, onCourse: calls.onCourse, validUntil: UNTIL,
      active: () => true, send: calls.send, ...overrides,
    });
    return { calls, result };
  };

  it("creates the course, reports it, then asks for that course's code", async () => {
    const { calls, result } = run();
    expect(await result).toEqual({ kind: "available", code: CODE, validUntil: UNTIL });
    expect(calls.course).toHaveBeenCalledOnce();
    expect(calls.onCourse).toHaveBeenCalledExactlyOnceWith(created);
    expect(calls.send.mock.calls[0]![0]).toBe(`/api/institution/courses/${ID}/enrollment-code`);
  });

  it("retries only the code for a saved course: no second course", async () => {
    const { calls, result } = run({ courseId: ID });
    expect(await result).toMatchObject({ kind: "available" });
    expect(calls.course).not.toHaveBeenCalled();
    expect(calls.onCourse).not.toHaveBeenCalled();
    expect(calls.send).toHaveBeenCalledOnce();
  });

  it("keeps the course when its code fails, and returns the failure", async () => {
    const send = vi.fn(async () => new Response(null, { status: 503 }));
    const { calls, result } = run({ send });
    expect(await result).toEqual({ kind: "unavailable" });
    expect(calls.onCourse).toHaveBeenCalledExactlyOnceWith(created);
    expect(send).toHaveBeenCalledOnce();
  });

  it("asks for no code when the course is refused", async () => {
    const refused: CourseCreation = { kind: "forbidden" };
    const { calls, result } = run({ createCourse: vi.fn(async () => refused) });
    expect(await result).toBeNull();
    expect(calls.onCourse).toHaveBeenCalledExactlyOnceWith(refused);
    expect(calls.send).not.toHaveBeenCalled();
  });

  it("sends nothing further, and reports nothing, once the screen is gone", async () => {
    let alive = true;
    const late = run({ createCourse: vi.fn(async () => { alive = false; return created; }), active: () => alive });
    expect(await late.result).toBeNull();
    expect(late.calls.onCourse).not.toHaveBeenCalled();
    expect(late.calls.send).not.toHaveBeenCalled();

    alive = true;
    const afterCode = run({ send: vi.fn(async () => { alive = false; return Response.json({ code: CODE }); }), active: () => alive });
    expect(await afterCode.result).toBeNull();
  });
});

// TeacherSetup.tsx is JSX, which this unit project cannot import (jsx: preserve);
// its render, the required empty deadline and axe run in e2e/login (teacher-home, demo-flow).
describe("enrollment-code text", () => {
  it("uses no forbidden term", () => {
    expect(findForbiddenTerms(JSON.stringify(ec))).toEqual([]);
  });
});
