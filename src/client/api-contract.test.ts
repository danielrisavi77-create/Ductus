// DAN-268 Contract Radar, first cut: the real route handler answers the real
// client reader, with no network and no database. If the server changes the
// shape it sends and the client does not follow (or the other way round), one
// of these fails although each side's own tests stay green.
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { handleCommentRequest } from "@/server/collaboration/comments";
import { handleLiveReadRequest, LIVE_STATE_HEADER as ROUTE_LIVE_STATE_HEADER } from "@/server/collaboration/live-route";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { listComments } from "./comments";
import { LIVE_STATE_HEADER, readLiveState } from "./live-reader";

const ORIGIN = "http://localhost:3000";
const TOKEN = "A".repeat(43);
const DOC = "doc-student-a-1";
const THREAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANCHOR = {
  nodeId: "11111111-1111-4111-8111-111111111111",
  quote: "invented quote",
  prefix: "",
  suffix: "",
  startHint: 0,
  endHint: 10,
};

const chain = loadGoldenVectors().chain;
const BODY = canonicalizeJcs(chain.documentStates[chain.documentStates.length - 1]?.value);
const HASH = createHash("sha256").update(Buffer.from(BODY, "utf8")).digest("hex");

/** A database stand-in: the session lookup, then one answer for the RPC. */
function database(rows: Record<string, unknown>[]): WithActor {
  return (async (_token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string) {
        if (text.includes("app.current_actor()")) {
          return { rows: [{ user_id: "33333333-3333-4333-8333-333333333333", institution_id: "44444444-4444-4444-8444-444444444444" }], rowCount: 1 };
        }
        return { rows: structuredClone(rows), rowCount: rows.length };
      },
    } as unknown as ActorTransaction)) as unknown as WithActor;
}

/** What the browser adds to a same-origin request the page script made. */
function browserRequest(path: string, init: RequestInit | undefined): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", ORIGIN);
  headers.set("sec-fetch-site", "same-origin");
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

afterEach(() => vi.unstubAllGlobals());

describe("contract: GET /api/live/[documentId] and readLiveState", () => {
  const fetcherFor = (rows: Record<string, unknown>[]): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) =>
      handleLiveReadRequest(browserRequest(String(input), init), DOC, {
        withActor: database(rows),
        sessionToken: TOKEN,
      })) as typeof fetch;

  it("a state the route serves is a state the reader shows, under the hash the route sent", async () => {
    const read = await readLiveState(DOC, null, fetcherFor([{ outcome: "state", content_hash: HASH, body: BODY }]));
    expect(read.kind).toBe("state");
    if (read.kind === "state") expect(read.hash).toBe(HASH);
  });

  it("the route's unchanged answer is the reader's unchanged, and its empty answer the reader's empty", async () => {
    expect(await readLiveState(DOC, HASH, fetcherFor([{ outcome: "unchanged", content_hash: HASH, body: null }])))
      .toStrictEqual({ kind: "unchanged", submitted: false });
    expect(await readLiveState(DOC, null, fetcherFor([{ outcome: "empty", content_hash: null, body: null }])))
      .toStrictEqual({ kind: "empty" });
  });

  it("the submitted revision the route serves is the reader's submitted state, never the live one (#826)", async () => {
    expect(LIVE_STATE_HEADER).toBe(ROUTE_LIVE_STATE_HEADER);
    const read = await readLiveState(DOC, null, fetcherFor([{ outcome: "submitted", content_hash: HASH, body: BODY }]));
    expect(read).toMatchObject({ kind: "state", hash: HASH, submitted: true });
    expect(await readLiveState(DOC, HASH, fetcherFor([{ outcome: "submitted", content_hash: HASH, body: null }])))
      .toStrictEqual({ kind: "unchanged", submitted: true });
    const live = await readLiveState(DOC, null, fetcherFor([{ outcome: "state", content_hash: HASH, body: BODY }]));
    expect(live).toMatchObject({ kind: "state", submitted: false });
  });

  it("an answer the route refuses is never shown in part", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await readLiveState(DOC, null, fetcherFor([{ outcome: "state", content_hash: "0".repeat(64), body: BODY }])))
      .toStrictEqual({ kind: "unavailable" });
  });
});

describe("contract: POST /api/comments/list and listComments", () => {
  const ROW = {
    thread_id: THREAD,
    comment_id: COMMENT,
    comment_position: 1,
    author_role: "teacher",
    is_own: false,
    body: "Invented comment.",
    anchor: ANCHOR,
    state: "open",
    created_window: new Date("2026-10-17T10:05:00Z"),
  };

  const stubFetch = (rows: Record<string, unknown>[]) =>
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      handleCommentRequest("list", browserRequest(String(input), init), {
        withActor: database(rows),
        expectedOrigin: ORIGIN,
        sessionToken: TOKEN,
      }));

  it("the rows the route lists are the threads the client builds, in order and with the anchor", async () => {
    stubFetch([ROW, { ...ROW, comment_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", comment_position: 2, author_role: "student", anchor: null }]);
    const outcome = await listComments(DOC);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.threads).toHaveLength(1);
    const [thread] = outcome.threads;
    expect(thread).toMatchObject({ id: THREAD, number: 1, state: "open", anchor: ANCHOR });
    expect(thread?.comments.map((c) => c.role)).toStrictEqual(["teacher", "student"]);
  });

  it("a thread without rows is an empty list, not an error", async () => {
    stubFetch([]);
    expect(await listComments(DOC)).toStrictEqual({ kind: "ok", threads: [] });
  });
});
