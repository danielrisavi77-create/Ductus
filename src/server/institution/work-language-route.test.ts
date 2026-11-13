import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { withActor as appWithActor } from "@/server/db";
import { POST as ASSIGNMENT_POST } from "../../../app/api/institution/assignments/[assignmentId]/work-language/route";
import { POST as WORK_POST } from "../../../app/api/institution/assignments/[assignmentId]/students/[studentId]/work-language/route";
import { POST as WORK_BY_DOCUMENT_POST } from "../../../app/api/institution/assignments/[assignmentId]/works/[documentId]/work-language/route";
import {
  handleAssignmentWorkLanguageRequest, handleWorkLanguageByDocumentRequest, handleWorkLanguageRequest,
  MAX_WORK_LANGUAGE_BODY_BYTES,
  type WorkLanguageRouteDeps,
} from "./work-language-route";

// DAN-386 (M2.10-P02b, contract on #1091): the classes of input of both work
// language routes, written before the routes. Each class names its status and
// error, and whether the database may be reached at all.
vi.mock("@/server/db", () => ({ withActor: vi.fn() }));
const ORIGIN = "https://ductus.example";
const ASSIGNMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STUDENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TOKEN = "A".repeat(43);
const ASSIGNMENT_URL = `${ORIGIN}/api/institution/assignments/${ASSIGNMENT}/work-language`;
const WORK_URL = `${ORIGIN}/api/institution/assignments/${ASSIGNMENT}/students/${STUDENT}/work-language`;

const request = (url: string, body: unknown, headers: Record<string, string> = {}, method = "POST") => new Request(url, {
  method, headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
  body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
});

type Row = Record<string, unknown>;
function port(row: Row) {
  const query = vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 });
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as ActorTransaction)) as unknown as WithActor;
  const deps: WorkLanguageRouteDeps = { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN };
  return { query, withActor, deps };
}

const routes = [
  {
    name: "assignment",
    url: ASSIGNMENT_URL,
    body: { expectedVersion: 3, language: "en" },
    row: { version: 4 },
    ok: { version: 4 },
    sql: "institution.set_assignment_work_language(",
    params: [ASSIGNMENT, 3, "en"],
    run: (req: Request, deps: WorkLanguageRouteDeps, ids: unknown[] = [ASSIGNMENT]) =>
      handleAssignmentWorkLanguageRequest(req, ids[0], deps),
  },
  {
    name: "one work",
    url: WORK_URL,
    body: { language: "en" },
    row: { language: "en" },
    ok: { language: "en" },
    sql: "institution.set_work_language(",
    params: [ASSIGNMENT, STUDENT, "en"],
    run: (req: Request, deps: WorkLanguageRouteDeps, ids: unknown[] = [ASSIGNMENT, STUDENT]) =>
      handleWorkLanguageRequest(req, ids[0], ids[1], deps),
  },
] as const;

const BAD_LANGUAGES: unknown[] = ["de", "HR", "En", " hr", "hr ", "", "hrv", 1, true, {}, ["hr"]];
const BAD_VERSIONS: unknown[] = [0, -1, 1.5, "1", null, 2 ** 31, Number.MAX_SAFE_INTEGER, true, [1], {}];

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.each(routes)("work language route: $name (DAN-386)", (route) => {
  it("passes the session, the path's ids and the body to the one RPC and answers 200 uncached", async () => {
    const { query, withActor, deps } = port(route.row);
    const response = await route.run(request(route.url, route.body), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(route.ok);
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(route.sql), route.params);
  });

  // Classes 1 to 4: the shared guard, before the body and the database.
  it.each([
    ["no session", { sessionToken: undefined }, {}, 401, "unauthorized"],
    ["a malformed session", { sessionToken: "short" }, {}, 401, "unauthorized"],
    ["a foreign origin", {}, { origin: "https://evil.example" }, 403, null],
    ["a cross-site fetch", {}, { "sec-fetch-site": "cross-site" }, 403, null],
    ["a text body", {}, { "content-type": "text/plain" }, 415, "unsupported_media_type"],
  ] as const)("refuses %s before the body and the database", async (_label, over, headers, status, error) => {
    const { withActor, deps } = port(route.row);
    const req = request(route.url, route.body, headers);
    const response = await route.run(req, { ...deps, ...over });
    expect(response.status).toBe(status);
    if (error) expect(await response.json()).toEqual({ error });
    if (status !== 415) expect(req.bodyUsed).toBe(false);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("refuses another method, a path id that is not a UUID, a body over the limit and bad JSON", async () => {
    const { withActor, deps } = port(route.row);
    expect((await route.run(request(route.url, null, {}, "GET"), deps)).status).toBe(405);
    for (const id of ["not-an-id", "", null, 7, `${ASSIGNMENT}x`]) {
      const ids = route.name === "assignment" ? [id] : [ASSIGNMENT, id];
      expect((await route.run(request(route.url, route.body), deps, ids)).status).toBe(422);
      if (route.name !== "assignment") expect((await route.run(request(route.url, route.body), deps, [id, STUDENT])).status).toBe(422);
    }
    expect(MAX_WORK_LANGUAGE_BODY_BYTES).toBe(128);
    expect((await route.run(request(route.url, { ...route.body, pad: "x".repeat(128) }), deps)).status).toBe(413);
    for (const text of ["{bad", "", "﻿" + JSON.stringify(route.body), "{\"language\":\"hr\""]) {
      const response = await route.run(request(route.url, text), deps);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_json" });
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  // Classes 5 to 7: a closed body, judged here before any database call.
  it("accepts only the closed body and a known language", async () => {
    const { withActor, deps } = port(route.row);
    const bodies: unknown[] = [
      "null", "[]", "1", "\"hr\"", {}, { ...route.body, extra: 1 }, { ...route.body, assignmentId: ASSIGNMENT },
      { ...route.body, studentId: STUDENT }, { ...route.body, role: "teacher" },
      `{"__proto__":{"isAdmin":true},${JSON.stringify(route.body).slice(1)}`,
      Object.fromEntries(Object.entries(route.body).filter(([key]) => key !== "language")),
      ...BAD_LANGUAGES.map((language) => ({ ...route.body, language })),
    ];
    if (route.name === "assignment") {
      bodies.push({ language: "hr" }, { ...route.body, language: null },
        ...BAD_VERSIONS.map((expectedVersion) => ({ ...route.body, expectedVersion })));
    } else {
      bodies.push({ ...route.body, expectedVersion: 1 });
    }
    for (const body of bodies) {
      const response = await route.run(request(route.url, body), deps);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(withActor).not.toHaveBeenCalled();
  });

  // Classes 1 and 8 to 11: what the RPC decides, named neutrally.
  it.each([
    ["ZD401", 401, "unauthorized"], ["ZD403", 403, "forbidden"], ["ZD409", 409, "conflict"],
    ["ZD422", 422, "invalid_input"], ["XX000", 503, "unavailable"], ["40P01", 503, "unavailable"], [undefined, 503, "unavailable"],
  ] as const)("maps %s from the RPC to %i without its text", async (code, status, error) => {
    const { query, deps } = port(route.row);
    vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockRejectedValue({ code, message: `SQL private ${STUDENT}` });
    const response = await route.run(request(route.url, route.body), deps);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error });
  });

  it("answers 503 for a result that is not a valid answer of the RPC", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad: Row[] = route.name === "assignment"
      ? [{ version: 2 }, { version: "4" }, { version: null }, { version: 4.5 }, {}]
      : [{ language: "de" }, { language: null }, { language: "HR" }, {}];
    for (const row of bad) {
      const { deps } = port(row);
      expect((await route.run(request(route.url, route.body), deps)).status, JSON.stringify(row)).toBe(503);
    }
  });
});

describe("work language of one work (DAN-386)", () => {
  it("passes null through to remove the exception and answers the language the work has afterwards", async () => {
    const { query, deps } = port({ language: "hr" });
    const response = await handleWorkLanguageRequest(request(WORK_URL, { language: null }), ASSIGNMENT, STUDENT, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ language: "hr" });
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("institution.set_work_language("), [ASSIGNMENT, STUDENT, null]);
  });
});

// #1986, QA c.6861733018: the page for one work posts by document id, so the
// student's id never reaches the browser; the server names the student.
const DOC = "izmisljeni-rad-1";
const BY_DOCUMENT_URL = `${ORIGIN}/api/institution/assignments/${ASSIGNMENT}/works/${DOC}/work-language`;
/** The first query names the work's students, the second sets the language. */
function documentPort(students: unknown[], row: Row = { language: "en" }) {
  const query = vi.fn()
    .mockResolvedValueOnce({ rows: students.map((student_id) => ({ student_id })), rowCount: students.length })
    .mockResolvedValueOnce({ rows: [row], rowCount: 1 });
  const withActor = vi.fn(async (_token: unknown, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as ActorTransaction)) as unknown as WithActor;
  const deps: WorkLanguageRouteDeps = { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN };
  return { query, withActor, deps };
}
const byDocument = (body: unknown, deps: WorkLanguageRouteDeps, documentId: unknown = DOC, assignmentId: unknown = ASSIGNMENT) =>
  handleWorkLanguageByDocumentRequest(request(BY_DOCUMENT_URL, body), assignmentId, documentId, deps);

describe("work language of one work by document id (DAN-386, #1986)", () => {
  it.each([["en", "en"], [null, "hr"]] as const)(
    "names the student from the document in the same transaction and sets %s without a student id from the caller",
    async (language, after) => {
      const { query, withActor, deps } = documentPort([STUDENT], { language: after });
      const response = await byDocument({ language }, deps);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ language: after });
      expect(withActor).toHaveBeenCalledExactlyOnceWith(TOKEN, expect.any(Function));
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0]![0]).toContain("app.assignment_works($1::uuid)");
      expect(query.mock.calls[0]![1]).toEqual([ASSIGNMENT, DOC]);
      expect(query.mock.calls[1]![0]).toContain("institution.set_work_language(");
      expect(query.mock.calls[1]![1]).toEqual([ASSIGNMENT, STUDENT, language]);
    });

  it("refuses a work the caller may not see, or no work, as forbidden and writes nothing", async () => {
    const { query, deps } = documentPort([]);
    const response = await byDocument({ language: "en" }, deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("answers 503 and writes nothing when the document names more than one student or no valid one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const students of [[STUDENT, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"], ["not-a-uuid"], [null], [7]]) {
      const { query, deps } = documentPort(students);
      expect((await byDocument({ language: "en" }, deps)).status, JSON.stringify(students)).toBe(503);
      expect(query).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses a document id that is not one, a dot segment or a student id in the body before the database", async () => {
    const { withActor, deps } = documentPort([STUDENT]);
    for (const documentId of ["", " doc", "a\nb", "d".repeat(257), ".", "..", null, 7]) {
      const response = await byDocument({ language: "en" }, deps, documentId);
      expect(response.status, JSON.stringify(documentId)).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    for (const assignmentId of ["not-an-id", "", null, `${ASSIGNMENT}x`]) {
      expect((await byDocument({ language: "en" }, deps, DOC, assignmentId)).status).toBe(422);
    }
    for (const body of [{}, { language: "de" }, { language: "en", studentId: STUDENT }, { language: "en", documentId: DOC }, "null", "[]"]) {
      expect((await byDocument(body, deps)).status, JSON.stringify(body)).toBe(422);
    }
    expect((await byDocument({ language: "en" }, { ...deps, sessionToken: undefined })).status).toBe(401);
    expect(withActor).not.toHaveBeenCalled();
  });

  it.each([
    ["ZD401", 401, "unauthorized"], ["ZD403", 403, "forbidden"], ["ZD409", 409, "conflict"],
    ["ZD422", 422, "invalid_input"], ["XX000", 503, "unavailable"],
  ] as const)("maps %s from either statement to %i without its text", async (code, status, error) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const at of [0, 1]) {
      const { query, deps } = documentPort([STUDENT]);
      if (at === 0) query.mockReset().mockRejectedValue({ code, message: `SQL private ${STUDENT}` });
      else query.mockReset()
        .mockResolvedValueOnce({ rows: [{ student_id: STUDENT }], rowCount: 1 })
        .mockRejectedValueOnce({ code, message: `SQL private ${STUDENT}` });
      const response = await byDocument({ language: "en" }, deps);
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error });
      expect(text).not.toContain(STUDENT);
    }
  });
});

describe("work language route adapters (DAN-386)", () => {
  it.each([
    ["assignment", ASSIGNMENT_URL, { expectedVersion: 1, language: "en" }, { version: 2 },
      () => ASSIGNMENT_POST, { assignmentId: ASSIGNMENT }],
    ["one work", WORK_URL, { language: "en" }, { language: "en" },
      () => WORK_POST, { assignmentId: ASSIGNMENT, studentId: STUDENT }],
    ["one work by document id", BY_DOCUMENT_URL, { language: "en" }, { language: "en" },
      () => WORK_BY_DOCUMENT_POST, { assignmentId: ASSIGNMENT, documentId: DOC }],
  ] as const)("wires the real POST of %s to the path, the cookie and the configured origin", async (_name, url, body, row, post, params) => {
    const { withActor, query } = url === BY_DOCUMENT_URL ? documentPort([STUDENT], row) : port(row);
    vi.mocked(appWithActor).mockImplementation(withActor);
    const context = { params: Promise.resolve(params) } as never;
    const req = () => new NextRequest(request(url, body, { cookie: `__Host-ductus_session=${TOKEN}`, host: "evil.example" }));
    vi.stubEnv("OIDC_REDIRECT_URI", "");
    expect((await post()(req(), context)).status).toBe(503);
    expect(withActor).not.toHaveBeenCalled();
    vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
    const response = await post()(req(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(row);
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query.mock.calls[0]![1]![0]).toBe(ASSIGNMENT);
  });
});
