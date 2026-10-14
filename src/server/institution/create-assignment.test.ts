import { describe, expect, it } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
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

function dependencies(
  responseId = ASSIGNMENT_ID,
  rejection?: { code: string; message: string },
) {
  const calls: Array<[string | null | undefined]> = [];
  const withActor = Object.assign(async <T>(
      token: string | null | undefined,
      fn: (tx: ActorTransaction) => Promise<T>,
    ): Promise<T> => {
      calls.push([token]);
    if (rejection) throw rejection;
    const tx: ActorTransaction = {
      query: async <Row extends QueryRow = QueryRow>() => ({
        rows: [{ id: responseId } as unknown as Row],
        rowCount: 1,
      }),
    };
    return fn(tx);
  }, { calls });
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
    expect(withActor.calls).toHaveLength(1);
    const [token] = withActor.calls[0]!;
    expect(token).toBe("session-token");
  });

  it("refuses a cross-origin request before reading its body or opening a transaction", async () => {
    const withActor = dependencies();
    const foreign = request(JSON.stringify(INPUT), { origin: "https://evil.example" });
    const response = await send(JSON.stringify(INPUT), withActor, foreign);
    expect(response.status).toBe(403);
    expect(foreign.bodyUsed).toBe(false);
    expect(withActor.calls).toHaveLength(0);
  });

  it("requires a UUID request key and JSON content type", async () => {
    for (const [headers, status, error] of [
      [{ "idempotency-key": "not-a-uuid" }, 400, "invalid_idempotency_key"],
      [{ "content-type": "text/plain" }, 415, "unsupported_media_type"],
    ] as const) {
      const response = await send(JSON.stringify(INPUT), dependencies(), request(JSON.stringify(INPUT), headers));
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error });
    }
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
    expect(await response.json()).toEqual({ error });
  });

  it("rejects a malformed path identifier before opening a transaction", async () => {
    const withActor = dependencies();
    const response = await createAssignmentResponse(request(JSON.stringify(INPUT)), "token", withActor, ORIGIN, "../not-a-uuid");
    expect(response.status).toBe(400);
    expect(withActor.calls).toHaveLength(0);
  });
});
