import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { saveAssignmentWorkLanguage, saveWorkLanguageException, workLanguageExceptionHref } from "./work-language";

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

// Invented student only. Contract: #1836 c.6858305983, classes 1 to 3.
const STUDENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("DAN-386 one work's language exception save (P02d)", () => {
  it("posts only the language to the pair's route, same origin, no cache, no redirect", async () => {
    const send = reply(200, { language: "en" });
    expect(await saveWorkLanguageException(ID.toUpperCase(), STUDENT.toUpperCase(), "en", send))
      .toEqual({ kind: "saved", language: "en" });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = (send as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe(`/api/institution/assignments/${ID}/students/${STUDENT}/work-language`);
    expect(init).toMatchObject({
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(init.body as string)).toEqual({ language: "en" });
  });

  it("removes the exception with null and saves the assignment's language it answers", async () => {
    const send = reply(200, { language: "hr" });
    expect(await saveWorkLanguageException(ID, STUDENT, null, send)).toEqual({ kind: "saved", language: "hr" });
    const [, init] = (send as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ language: null });
  });

  it.each([
    [401, "unauthorized"], [403, "forbidden"], [409, "conflict"],
    [400, "invalid"], [413, "invalid"], [415, "invalid"], [422, "invalid"],
    [201, "unavailable"], [204, "unavailable"], [302, "unavailable"], [404, "unavailable"],
    [500, "unavailable"], [503, "unavailable"],
  ])("maps status %i to %s", async (status, kind) => {
    expect(await saveWorkLanguageException(ID, STUDENT, "en", reply(status, { language: "en" }))).toEqual({ kind });
  });

  it.each([
    ["another language", "en", { language: "hr" }],
    ["no key", "en", {}],
    ["an extra key", "en", { language: "en", version: 2 }],
    ["an upper-case language", "en", { language: "EN" }],
    ["a null language", "en", { language: null }],
    ["null", "en", null],
    ["an array", "en", ["en"]],
    ["a bare string", "en", "en"],
    ["a null language after removal", null, { language: null }],
    ["an unknown language after removal", null, { language: "de" }],
  ])("never reports saved for 200 with %s", async (_name, sent, body) => {
    expect(await saveWorkLanguageException(ID, STUDENT, sent as "en" | null, reply(200, body)))
      .toEqual({ kind: "unavailable" });
  });

  it("is unavailable on malformed JSON and on a network failure", async () => {
    expect(await saveWorkLanguageException(ID, STUDENT, "en", reply(200, undefined, "{"))).toEqual({ kind: "unavailable" });
    const down = vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(await saveWorkLanguageException(ID, STUDENT, null, down)).toEqual({ kind: "unavailable" });
  });

  it.each([
    ["an assignment id that is not a UUID", "1; DROP", STUDENT, "hr"],
    ["a student id that is not a UUID", ID, "../x", "hr"],
    ["an empty student id", ID, "", "hr"],
    ["an unknown language", ID, STUDENT, "de"],
    ["an upper-case language", ID, STUDENT, "HR"],
    ["an empty language", ID, STUDENT, ""],
    ["undefined in place of null", ID, STUDENT, undefined],
  ])("refuses %s without a request", async (_name, a, s, language) => {
    const send = reply(200, { language: "hr" });
    expect(await saveWorkLanguageException(a, s, language as "hr", send)).toEqual({ kind: "invalid" });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports saved only for the language sent, or any work language after removal (property)", async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom("hr" as const, "en" as const, null), fc.oneof(
        fc.anything(), fc.record({ language: fc.constantFrom("hr", "en", "de", null) }),
      ),
      async (sent, body) => {
        const result = await saveWorkLanguageException(ID, STUDENT, sent, reply(200, body));
        const plain = typeof body === "object" && body !== null && !Array.isArray(body)
          && Object.keys(body).length === 1 && Object.hasOwn(body, "language");
        const answered = plain ? (body as { language: unknown }).language : undefined;
        const ok = sent === null ? answered === "hr" || answered === "en" : answered === sent;
        expect(result).toEqual(ok ? { kind: "saved", language: answered } : { kind: "unavailable" });
      },
    ), { numRuns: 300 });
  });
});

describe("DAN-386 the page of one work's language (P02d)", () => {
  it("names the work by assignment and encoded document id, lower-casing the UUID", () => {
    expect(workLanguageExceptionHref(ID.toUpperCase(), "izmisljeni rad/a?b"))
      .toBe(`/nastavnik/zadatak/${ID}/rad/izmisljeni%20rad%2Fa%3Fb/jezik`);
  });

  it.each([
    ["an assignment id that is not a UUID", "../x", "doc"],
    ["an assignment id that is not text", 7, "doc"],
    ["an empty document id", ID, ""],
    ["a padded document id", ID, " doc"],
    ["a document id with a control character", ID, "a\nb"],
    ["an overlong document id", ID, "d".repeat(257)],
    ["a document id that is not text", ID, null],
    ["a document id that is a dot segment", ID, "."],
    ["a document id that is a parent segment", ID, ".."],
  ])("gives no page for %s", (_name, a, d) => {
    expect(workLanguageExceptionHref(a, d)).toBeNull();
  });

  it("always stays one path segment under the work, whatever the document id", () => {
    fc.assert(fc.property(fc.oneof(fc.constantFrom(".", ".."), fc.string({ minLength: 1, maxLength: 256 })), (d) => {
      const href = workLanguageExceptionHref(ID, d);
      if (href === null) return;
      const rest = href.slice(`/nastavnik/zadatak/${ID}/rad/`.length, -"/jezik".length);
      expect(rest).not.toMatch(/[/?#]/);
      expect(new URL(href, "https://ductus.invalid").pathname).toBe(href.split("?")[0]);
      expect(decodeURIComponent(rest)).toBe(d);
    }), { numRuns: 300 });
  });
});
