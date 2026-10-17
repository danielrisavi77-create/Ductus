import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { createAssignmentPostHandler } from "./assignment-route";
import { createAssignmentResponse } from "./create-assignment";

type QueryRow = Record<string, unknown>;

const ORIGIN = "https://ductus.example";
const COURSE = "00000000-0000-4000-8000-000000000010";
const REQUEST_ID = "00000000-0000-4000-8000-000000000020";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000030";
const INPUT = {
  title: "Esej o izmišljenoj temi",
  instructions: "Upute za izmišljeni zadatak.",
  workType: "essay",
  opensAt: "2026-11-02T08:00:00+01:00",
  dueAt: "2026-12-01T23:59:00+01:00",
  aiPolicy: "partially_allowed",
  aiPurposes: ["proofreading"],
  evidenceProfile: "basic",
  importAllowed: false,
};

function request(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}/api/institution/courses/${COURSE}/assignments`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "idempotency-key": REQUEST_ID,
      ...headers,
    },
    body,
  });
}

function routedRequest(
  body: BodyInit,
  headers: Record<string, string> = {},
): NextRequest {
  const url = `https://attacker.example/api/institution/courses/${COURSE}/assignments`;
  const requestHeaders = new Headers({
    origin: ORIGIN,
    "content-type": "application/json",
    "idempotency-key": REQUEST_ID,
    host: new URL(url).host,
    ...headers,
  });
  const requestValue = new NextRequest(url, {
    method: "POST",
    headers: requestHeaders,
    body,
    duplex: "half",
  } as unknown as ConstructorParameters<typeof NextRequest>[1]);
  requestValue.cookies.set(SESSION_COOKIE_NAME, "cookie-session-token");
  return requestValue;
}

function assignmentPost(withActor: WithActor) {
  return createAssignmentPostHandler({
    withActor,
    getRedirectUri: () => `${ORIGIN}/api/auth/callback`,
  });
}

function dependencies(
  responseId = ASSIGNMENT_ID,
  rejection?: { code: string; message: string },
) {
  const calls: Array<[string | null | undefined]> = [];
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const withActor = Object.assign(async <T>(
      token: string | null | undefined,
      fn: (tx: ActorTransaction) => Promise<T>,
    ): Promise<T> => {
      calls.push([token]);
    if (rejection) throw rejection;
    const tx: ActorTransaction = {
      query: async <Row extends QueryRow = QueryRow>(sql: string, values?: readonly unknown[]) => {
        queries.push({ sql, values });
        return { rows: [{ id: responseId } as unknown as Row], rowCount: 1 };
      },
    };
    return fn(tx);
  }, { calls, queries });
  return withActor as WithActor & typeof withActor;
}

async function send(
  body: string,
  withActor = dependencies(),
  requestValue = request(body),
  token: string | null = "session-token",
) {
  return createAssignmentResponse(requestValue, token, withActor, ORIGIN, COURSE);
}

describe("createAssignmentResponse", () => {
  it("calls the authenticated RPC with the cookie token and idempotency key", async () => {
    const withActor = dependencies();
    const response = await send(JSON.stringify(INPUT), withActor);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: ASSIGNMENT_ID });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(withActor.calls).toHaveLength(1);
    const [token] = withActor.calls[0]!;
    expect(token).toBe("session-token");
    expect(withActor.queries).toHaveLength(1);
    expect(withActor.queries[0]!.sql).toMatch(/\$1::uuid,\s*\$2::uuid,\s*\$3::text/);
    expect(withActor.queries[0]!.sql).toContain("$11::boolean");
    expect(withActor.queries[0]!.sql).not.toContain(INPUT.title);
    expect(withActor.queries[0]!.values).toEqual([
      COURSE,
      REQUEST_ID,
      INPUT.title,
      INPUT.instructions,
      INPUT.workType,
      INPUT.opensAt,
      INPUT.dueAt,
      INPUT.aiPolicy,
      INPUT.aiPurposes,
      INPUT.evidenceProfile,
      INPUT.importAllowed,
    ]);
  });

  it("refuses a cross-origin request before reading its body or opening a transaction", async () => {
    const withActor = dependencies();
    const foreign = request(JSON.stringify(INPUT), { origin: "https://evil.example" });
    const response = await send(JSON.stringify(INPUT), withActor, foreign);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(foreign.bodyUsed).toBe(false);
    expect(withActor.calls).toHaveLength(0);
  });

  it("requires a UUID request key and JSON content type", async () => {
    for (const [headers, status, error] of [
      [{ "idempotency-key": "not-a-uuid" }, 400, "invalid_idempotency_key"],
      [{ "content-type": "text/plain" }, 415, "unsupported_media_type"],
    ] as const) {
      const withActor = dependencies();
      const response = await send(JSON.stringify(INPUT), withActor, request(JSON.stringify(INPUT), headers));
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error });
      expect(withActor.calls).toHaveLength(0);
    }

    const withActor = dependencies();
    const missingKeyRequest = request(JSON.stringify(INPUT));
    missingKeyRequest.headers.delete("idempotency-key");
    const missingKeyResponse = await send(JSON.stringify(INPUT), withActor, missingKeyRequest);
    expect(missingKeyResponse.status).toBe(400);
    await expect(missingKeyResponse.json()).resolves.toEqual({ error: "invalid_idempotency_key" });
    expect(withActor.calls).toHaveLength(0);

    const noContentTypeActor = dependencies();
    const noContentTypeRequest = request(JSON.stringify(INPUT));
    noContentTypeRequest.headers.delete("content-type");
    const noContentTypeResponse = await send(JSON.stringify(INPUT), noContentTypeActor, noContentTypeRequest);
    expect(noContentTypeResponse.status).toBe(415);
    await expect(noContentTypeResponse.json()).resolves.toEqual({ error: "unsupported_media_type" });
    expect(noContentTypeActor.calls).toHaveLength(0);
  });

  it.each([
    "not-json",
    JSON.stringify({ ...INPUT, unexpected: true }),
    JSON.stringify({ ...INPUT, opensAt: "2026-11-02T08:00:00" }),
    JSON.stringify({ ...INPUT, dueAt: "2026-02-30T08:00:00Z" }),
    JSON.stringify({ ...INPUT, title: "naslov\u0000s NUL-om" }),
    JSON.stringify({ ...INPUT, instructions: "upute\u0000s NUL-om" }),
    JSON.stringify({ ...INPUT, aiPurposes: ["proofreading", "proofreading"] }),
    JSON.stringify({ ...INPUT, aiPolicy: "prohibited" }),
  ])("refuses malformed or non-contract input without calling the database", async (body) => {
    const withActor = dependencies();
    const response = await send(body, withActor);
    expect(response.status).toBe(body === "not-json" ? 400 : 422);
    expect(withActor.calls).toHaveLength(0);
  });

  it("rejects invalid UTF-8 instead of replacing bytes during JSON parsing", async () => {
    const withActor = dependencies();
    const raw = new Uint8Array([0xff, 0xfe]);
    const bodyRequest = new Request(`${ORIGIN}/api`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "idempotency-key": REQUEST_ID,
      },
      body: raw,
    });
    const response = await send("", withActor, bodyRequest);
    expect(response.status).toBe(400);
    expect(withActor.calls).toHaveLength(0);
  });

  it("bounds the whole request before parsing", async () => {
    const withActor = dependencies();
    const response = await send(JSON.stringify({ ...INPUT, instructions: "x".repeat(91_000) }), withActor);
    expect(response.status).toBe(413);
    expect(withActor.calls).toHaveLength(0);
  });

  it.each([
    ["ZD401", 401, "unauthenticated"],
    ["ZD403", 403, "forbidden"],
    ["ZD409", 409, "idempotency_conflict"],
    ["ZD422", 422, "invalid_input"],
    ["XX001", 503, "assignment_unavailable"],
  ] as const)("maps database code %s without exposing its message", async (code, status, error) => {
    const withActor = dependencies(ASSIGNMENT_ID, { code, message: "sensitive input" });
    const response = await send(JSON.stringify(INPUT), withActor);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error });
  });

  it("rejects a malformed path identifier before opening a transaction", async () => {
    const withActor = dependencies();
    const response = await createAssignmentResponse(request(JSON.stringify(INPUT)), "token", withActor, ORIGIN, "../not-a-uuid");
    expect(response.status).toBe(400);
    expect(withActor.calls).toHaveLength(0);
  });

  it("uses the session cookie and configured OIDC origin instead of Host", async () => {
    const withActor = dependencies();
    const response = await assignmentPost(withActor)(
      routedRequest(JSON.stringify(INPUT), { host: "attacker.example" }),
      { params: Promise.resolve({ courseId: COURSE }) },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(withActor.calls).toEqual([["cookie-session-token"]]);

    const spoofedActor = dependencies();
    const spoofedOrigin = routedRequest(JSON.stringify(INPUT), {
      host: "attacker.example",
      origin: "https://attacker.example",
    });
    const denied = await assignmentPost(spoofedActor)(spoofedOrigin, {
      params: Promise.resolve({ courseId: COURSE }),
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(spoofedActor.calls).toHaveLength(0);
  });

  it("rejects cross-site Fetch Metadata at the HTTP boundary before opening a transaction", async () => {
    const withActor = dependencies();
    const requestValue = routedRequest(JSON.stringify(INPUT), { "sec-fetch-site": "cross-site" });
    const response = await assignmentPost(withActor)(requestValue, {
      params: Promise.resolve({ courseId: COURSE }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requestValue.bodyUsed).toBe(false);
    expect(withActor.calls).toHaveLength(0);
  });

  it("times out a slow request body at the HTTP boundary without opening a transaction", async () => {
    vi.useFakeTimers();
    const withActor = dependencies();
    const streamState = { cancelled: false };
    const slowBody = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {});
      },
      cancel() {
        streamState.cancelled = true;
      },
    });
    try {
      const responsePromise = assignmentPost(withActor)(routedRequest(slowBody), {
        params: Promise.resolve({ courseId: COURSE }),
      });
      await vi.advanceTimersByTimeAsync(10_000);
      const response = await responsePromise;
      expect(response.status).toBe(408);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ error: "body_timeout" });
      expect(streamState.cancelled).toBe(true);
      expect(withActor.calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
