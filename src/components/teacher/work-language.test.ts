import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { saveAssignmentWorkLanguage } from "./work-language";

// Invented assignment only. Contract: #1836 c.6791532518, class (a).
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function reply(status: number, body?: unknown, raw?: string) {
  return vi.fn(async () => new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), {
    status, headers: { "content-type": "application/json" },
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("DAN-386 assignment work language save (P02c)", () => {
  it("posts only the version seen and the language, same origin, no cache, no redirect", async () => {
    const send = reply(200, { version: 4 });
    expect(await saveAssignmentWorkLanguage(ID.toUpperCase(), 3, "en", send)).toEqual({ kind: "saved", version: 4 });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = (send as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe(`/api/institution/assignments/${ID}/work-language`);
    expect(init).toMatchObject({
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(init.body as string)).toEqual({ expectedVersion: 3, language: "en" });
  });

  it.each([
    [401, "unauthorized"], [403, "forbidden"], [409, "conflict"],
    [400, "invalid"], [413, "invalid"], [415, "invalid"], [422, "invalid"],
    [201, "unavailable"], [204, "unavailable"], [302, "unavailable"], [404, "unavailable"],
    [500, "unavailable"], [503, "unavailable"],
  ])("maps status %i to %s", async (status, kind) => {
    expect(await saveAssignmentWorkLanguage(ID, 1, "hr", reply(status, { version: 2 }))).toEqual({ kind });
  });

  it.each([
    ["another version", { version: 5 }],
    ["the same version", { version: 3 }],
    ["no key", {}],
    ["a string", { version: "4" }],
    ["null", null],
    ["an array", [4]],
    ["a bare number", 4],
  ])("never reports saved for 200 with %s", async (_name, body) => {
    expect(await saveAssignmentWorkLanguage(ID, 3, "hr", reply(200, body))).toEqual({ kind: "unavailable" });
  });

  it("is unavailable on malformed JSON and on a network failure", async () => {
    expect(await saveAssignmentWorkLanguage(ID, 3, "hr", reply(200, undefined, "{"))).toEqual({ kind: "unavailable" });
    const down = vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(await saveAssignmentWorkLanguage(ID, 3, "hr", down)).toEqual({ kind: "unavailable" });
  });

  it.each([
    ["an id that is not a UUID", "1; DROP", 1, "hr"],
    ["version 0", ID, 0, "hr"],
    ["a negative version", ID, -1, "hr"],
    ["a fractional version", ID, 1.5, "hr"],
    ["a version above int4", ID, 2_147_483_648, "hr"],
    ["NaN", ID, Number.NaN, "hr"],
    ["an unknown language", ID, 1, "de"],
    ["an upper-case language", ID, 1, "HR"],
    ["a padded language", ID, 1, " hr"],
    ["an empty language", ID, 1, ""],
  ])("refuses %s without a request", async (_name, id, version, language) => {
    const send = reply(200, { version: version + 1 });
    expect(await saveAssignmentWorkLanguage(id, version, language as "hr", send)).toEqual({ kind: "invalid" });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports saved only for exactly the next version (property)", async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 2_147_483_646 }), fc.constantFrom("hr" as const, "en" as const), fc.anything(),
      async (seen, language, body) => {
        const result = await saveAssignmentWorkLanguage(ID, seen, language, reply(200, body));
        const exact = typeof body === "object" && body !== null && !Array.isArray(body)
          && Object.hasOwn(body, "version") && (body as { version: unknown }).version === seen + 1;
        expect(result.kind).toBe(exact ? "saved" : "unavailable");
      },
    ), { numRuns: 200 });
  });
});
