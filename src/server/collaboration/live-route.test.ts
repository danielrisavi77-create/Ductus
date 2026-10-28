import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "@/domain/document/snapshot";
import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { handleLivePublishRequest, handleLiveReadRequest } from "./live-route";

// An invented document of the golden chain, as exact JCS bytes.
const chain = loadGoldenVectors().chain;
const VALUE = chain.documentStates[chain.documentStates.length - 1]?.value;
const TEXT = canonicalizeJcs(VALUE);
const BYTES = Buffer.from(TEXT, "utf8");
const HASH = createHash("sha256").update(BYTES).digest("hex");
const ORIGIN = "http://localhost:3000";
const TOKEN = "A".repeat(43);
const DOC = "doc-student-a-1";
const WRITE = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
const NEXT = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
const CANARY = "kanarinac-uzivo-5d2e";

type Answer = { rows?: Record<string, unknown>[]; code?: string };

/** A database stand-in: the session lookup, then the live state RPC. */
function database(answer: Answer, session: "open" | "closed" | "down" = "open") {
  const calls: { text: string; values: unknown[] }[] = [];
  const withActor = vi.fn(async (_token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values: [...(values ?? [])] });
        if (text.includes("app.current_actor()")) {
          if (session === "down") throw new Error(`connection lost ${CANARY}`);
          const rows = session === "open"
            ? [{ user_id: "33333333-3333-4333-8333-333333333333", institution_id: "44444444-4444-4444-8444-444444444444" }]
            : [{ user_id: null, institution_id: null }];
          return { rows, rowCount: 1 };
        }
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        return { rows: structuredClone(answer.rows ?? []), rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction),
  ) as unknown as WithActor;
  return { withActor, calls };
}

/** A same-origin PUT with If-Match; a header given as null is left out. */
function put(body: BodyInit | null = BYTES, headers: Record<string, string | null> = {}): Request {
  const all: Record<string, string | null> = {
    origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", "if-match": `"${WRITE}"`, ...headers,
  };
  return new Request(`${ORIGIN}/api/live/${DOC}`, {
    method: "PUT",
    headers: Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== null)),
    body,
  });
}

/** A read as the live reader sends it; a header given as null is left out. */
function get(headers: Record<string, string | null> = {}, method = "GET"): Request {
  const all: Record<string, string | null> = { "sec-fetch-site": "same-origin", "ductus-protocol": "1", ...headers };
  return new Request(`${ORIGIN}/api/live/${DOC}`, {
    method,
    headers: Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== null)),
  });
}

// `token` given as undefined means no cookie; left out, the cookie is TOKEN.
type Options = { token?: string; documentId?: string };
const tokenOf = (options: Options) => ("token" in options ? options.token : TOKEN);
const publish = (db: ReturnType<typeof database>, request = put(), options: Options = {}) =>
  handleLivePublishRequest(request, options.documentId ?? DOC, {
    withActor: db.withActor, expectedOrigin: ORIGIN, sessionToken: tokenOf(options),
  });
const read = (db: ReturnType<typeof database>, request = get(), options: Options = {}) =>
  handleLiveReadRequest(request, options.documentId ?? DOC, { withActor: db.withActor, sessionToken: tokenOf(options) });

afterEach(() => vi.restoreAllMocks());

describe("PUT /api/live/[documentId]: publish the last state (BACKEND 4.12 point 6)", () => {
  it("passes the document, the expected token and the exact text to the RPC and answers accepted with the new token", async () => {
    const db = database({ rows: [{ outcome: "accepted", write_token: NEXT }] });
    const response = await publish(db);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toStrictEqual({ outcome: "accepted", token: NEXT });
    expect(db.calls.map((c) => c.text)).toStrictEqual([
      "SELECT user_id, institution_id FROM app.current_actor()",
      "SELECT outcome, write_token FROM collaboration.publish_live_state($1, $2, $3)",
    ]);
    expect(db.calls[1].values).toStrictEqual([DOC, WRITE, TEXT]);
  });

  it("sends a NULL token for If-None-Match: * and maps unchanged and conflict", async () => {
    const first = database({ rows: [{ outcome: "accepted", write_token: NEXT }] });
    await publish(first, put(BYTES, { "if-match": null, "if-none-match": "*" }));
    expect(first.calls[1].values[1]).toBeNull();

    const cases: [Record<string, unknown>, number, unknown][] = [
      [{ outcome: "unchanged", write_token: WRITE }, 200, { outcome: "unchanged", token: WRITE }],
      [{ outcome: "conflict", write_token: NEXT }, 409, { outcome: "conflict", token: NEXT }],
      [{ outcome: "conflict", write_token: null }, 409, { outcome: "conflict", token: null }],
    ];
    for (const [row, status, body] of cases) {
      const response = await publish(database({ rows: [row] }));
      expect([response.status, await response.json()]).toStrictEqual([status, body]);
    }
  });

  it("maps the database refusals to one closed answer each, without the message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [Answer, number, string][] = [
      [{ code: "ZD401" }, 401, "unauthorized"],
      [{ code: "ZD403" }, 404, "not_found"],
      [{ code: "ZD422" }, 422, "invalid_document"],
      [{ code: "57014" }, 503, "unavailable"],
      [{ rows: [] }, 503, "unavailable"],
      [{ rows: [{ outcome: "accepted", write_token: null }] }, 503, "unavailable"],
      [{ rows: [{ outcome: "accepted", write_token: "not-a-uuid" }] }, 503, "unavailable"],
      [{ rows: [{ outcome: "maybe", write_token: NEXT }] }, 503, "unavailable"],
      [{ rows: [{ outcome: "accepted", write_token: NEXT }, { outcome: "accepted", write_token: NEXT }] }, 503, "unavailable"],
    ];
    for (const [answer, status, error] of cases) {
      const response = await publish(database(answer));
      expect([response.status, await response.json()]).toStrictEqual([status, { error }]);
    }
    expect(JSON.stringify(log.mock.calls)).not.toMatch(new RegExp(`${CANARY}|${DOC}|${TOKEN}`));
  });

  it("refuses from the headers before the session, the body or the database", async () => {
    const cases: [Request, number, string, Options?][] = [
      [put(BYTES, { origin: "https://drugi.example" }), 403, "forbidden"],
      [put(BYTES, { origin: null }), 403, "forbidden"],
      [put(BYTES, { "sec-fetch-site": "same-site" }), 403, "forbidden"],
      [new Request(`${ORIGIN}/api/live/${DOC}`, { method: "POST", headers: { origin: ORIGIN }, body: BYTES }), 405, "method_not_allowed"],
      [put(BYTES, { "content-type": "text/plain" }), 415, "unsupported_media_type"],
      [put(), 401, "unauthorized", { token: "kratki" }],
      [put(), 401, "unauthorized", { token: undefined }],
      [put(BYTES, { "if-match": null }), 428, "precondition_required"],
      [put(BYTES, { "if-match": "" }), 428, "precondition_required"],
      [put(BYTES, { "if-match": WRITE }), 428, "precondition_required"],
      [put(BYTES, { "if-match": `"${WRITE.toUpperCase()}"` }), 428, "precondition_required"],
      [put(BYTES, { "if-match": `W/"${WRITE}"` }), 428, "precondition_required"],
      [put(BYTES, { "if-none-match": "*" }), 428, "precondition_required"],
      [put(BYTES, { "if-match": null, "if-none-match": `"${HASH}"` }), 428, "precondition_required"],
    ];
    for (const [request, status, error, options] of cases) {
      const db = database({ rows: [{ outcome: "accepted", write_token: NEXT }] });
      const response = await publish(db, request, options);
      expect([response.status, await response.json()]).toStrictEqual([status, { error }]);
      expect(db.withActor).not.toHaveBeenCalled();
    }
    const unconfigured = database({});
    const response = await handleLivePublishRequest(put(), DOC, { withActor: unconfigured.withActor, expectedOrigin: null, sessionToken: TOKEN });
    expect(response.status).toBe(503);
  });

  it("answers an id that cannot exist as not found without asking the database", async () => {
    for (const documentId of ["", " doc", "doc\u0000a", "x".repeat(257)]) {
      const db = database({ rows: [{ outcome: "accepted", write_token: NEXT }] });
      const response = await publish(db, put(), { documentId });
      expect([response.status, await response.json()]).toStrictEqual([404, { error: "not_found" }]);
      expect(db.withActor).not.toHaveBeenCalled();
    }
  });

  // F-098 for this route: up to 2 MiB is never read for a session that is not open.
  it("asks the database for the session before a single body byte is read", async () => {
    for (const [session, status] of [["closed", 401], ["down", 503]] as const) {
      let pulled = false;
      const body = new ReadableStream<Uint8Array>({
        pull() {
          pulled = true;
          throw new Error("read before the session");
        },
      }, { highWaterMark: 0 });
      const request = new Request(`${ORIGIN}/api/live/${DOC}`, {
        method: "PUT",
        headers: { origin: ORIGIN, "content-type": "application/json", "if-match": `"${WRITE}"` },
        body,
        duplex: "half",
      } as RequestInit);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const db = database({ rows: [{ outcome: "accepted", write_token: NEXT }] }, session);
      const response = await publish(db, request);
      expect(response.status).toBe(status);
      expect(pulled).toBe(false);
      expect(db.calls).toHaveLength(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
    }
  });

  it("refuses a body that is not the exact JCS bytes of a valid document before the RPC", async () => {
    const pretty = Buffer.from(JSON.stringify(VALUE, null, 2), "utf8");
    const cases: [Uint8Array, number, string][] = [
      [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), BYTES]), 422, "invalid_document"],
      [Buffer.from([0x7b, 0xff, 0x7d]), 422, "invalid_document"],
      [pretty, 422, "invalid_document"],
      [Buffer.from(canonicalizeJcs({ type: "doc", content: [], [CANARY]: 1 }), "utf8"), 422, "invalid_document"],
      [new Uint8Array(0), 422, "invalid_document"],
      [new Uint8Array(MAX_DOCUMENT_SNAPSHOT_BYTES + 1), 413, "too_large"],
    ];
    for (const [bytes, status, error] of cases) {
      const db = database({ rows: [{ outcome: "accepted", write_token: NEXT }] });
      const response = await publish(db, put(Buffer.from(bytes)));
      expect([response.status, await response.json()]).toStrictEqual([status, { error }]);
      expect(db.calls.some((c) => c.text.includes("publish_live_state"))).toBe(false);
    }
    const declared = database({});
    const response = await publish(declared, put(BYTES, { "content-length": String(MAX_DOCUMENT_SNAPSHOT_BYTES + 1) }));
    expect(response.status).toBe(413);
    expect(declared.withActor).not.toHaveBeenCalled();
  });
});

describe("GET /api/live/[documentId]: one reading for the owner and the teacher (rule 5)", () => {
  it("returns the stored bytes with the hash as ETag, uncached, and passes only the document and a known hash", async () => {
    const db = database({ rows: [{ outcome: "state", content_hash: HASH, body: TEXT }] });
    const response = await read(db);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"${HASH}"`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(Buffer.from(await response.arrayBuffer()).equals(BYTES)).toBe(true);
    expect(db.calls).toStrictEqual([
      { text: "SELECT outcome, content_hash, body FROM collaboration.read_live_state($1, $2)", values: [DOC, null] },
    ]);

    const known = database({ rows: [{ outcome: "unchanged", content_hash: HASH, body: null }] });
    const same = await read(known, get({ "if-none-match": `"${HASH}"` }));
    expect([same.status, same.headers.get("etag"), await same.text()]).toStrictEqual([304, `"${HASH}"`, ""]);
    expect(known.calls[0].values).toStrictEqual([DOC, HASH]);
  });

  it("gives the owner and the teacher the same status, bytes and ETag", async () => {
    const db = database({ rows: [{ outcome: "state", content_hash: HASH, body: TEXT }] });
    const [owner, teacher] = [await read(db, get(), { token: "S".repeat(43) }), await read(db, get(), { token: "N".repeat(43) })];
    expect([owner.status, owner.headers.get("etag")]).toStrictEqual([teacher.status, teacher.headers.get("etag")]);
    expect(Buffer.from(await owner.arrayBuffer()).equals(Buffer.from(await teacher.arrayBuffer()))).toBe(true);
  });

  it("answers empty with 204 and reads any other If-None-Match as no hash", async () => {
    const empty = await read(database({ rows: [{ outcome: "empty", content_hash: null, body: null }] }));
    expect([empty.status, await empty.text(), empty.headers.get("cache-control")]).toStrictEqual([204, "", "no-store"]);
    for (const header of ["*", HASH, `W/"${HASH}"`, `"${HASH.toUpperCase()}"`, `"${HASH}", "${HASH}"`]) {
      const db = database({ rows: [{ outcome: "state", content_hash: HASH, body: TEXT }] });
      await read(db, get({ "if-none-match": header }));
      expect(db.calls[0].values).toStrictEqual([DOC, null]);
    }
  });

  it("maps refusals and malformed rows to closed answers and never serves a body that does not match its hash", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [Answer, number, string][] = [
      [{ code: "ZD401" }, 401, "unauthorized"],
      [{ code: "ZD403" }, 404, "not_found"],
      [{ code: "08006" }, 503, "unavailable"],
      [{ rows: [] }, 503, "unavailable"],
      [{ rows: [{ outcome: "state", content_hash: HASH, body: `${TEXT} ${CANARY}` }] }, 503, "unavailable"],
      [{ rows: [{ outcome: "state", content_hash: "x", body: TEXT }] }, 503, "unavailable"],
      [{ rows: [{ outcome: "unchanged", content_hash: HASH, body: null }] }, 503, "unavailable"],
      [{ rows: [{ outcome: "maybe", content_hash: HASH, body: TEXT }] }, 503, "unavailable"],
    ];
    for (const [answer, status, error] of cases) {
      const response = await read(database(answer));
      expect([response.status, await response.json()]).toStrictEqual([status, { error }]);
    }
    expect(JSON.stringify(log.mock.calls)).not.toMatch(new RegExp(`${CANARY}|${DOC}`));
  });

  it("answers a submitted work with its submitted revision and the mark, the same for owner and teacher (DAN-289 A3)", async () => {
    const db = database({ rows: [{ outcome: "submitted", content_hash: HASH, body: TEXT }] });
    const [owner, teacher] = [await read(db, get(), { token: "S".repeat(43) }), await read(db, get(), { token: "N".repeat(43) })];
    for (const response of [owner, teacher]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("ductus-live-state")).toBe("submitted");
      expect(response.headers.get("etag")).toBe(`"${HASH}"`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    }
    expect(Buffer.from(await owner.arrayBuffer()).equals(BYTES)).toBe(true);
    expect(Buffer.from(await teacher.arrayBuffer()).equals(BYTES)).toBe(true);

    const known = database({ rows: [{ outcome: "submitted", content_hash: HASH, body: null }] });
    const same = await read(known, get({ "if-none-match": `"${HASH}"` }));
    expect([same.status, same.headers.get("etag"), same.headers.get("ductus-live-state"), await same.text()])
      .toStrictEqual([304, `"${HASH}"`, "submitted", ""]);
    expect(known.calls[0].values).toStrictEqual([DOC, HASH]);

    // A live state carries no mark.
    const live = await read(database({ rows: [{ outcome: "state", content_hash: HASH, body: TEXT }] }));
    expect(live.headers.get("ductus-live-state")).toBeNull();
  });

  it("never serves a submitted answer it cannot vouch for, and maps unavailable to 503 (DAN-289 A3)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: Answer[] = [
      { rows: [{ outcome: "unavailable", content_hash: null, body: null }] },
      { rows: [{ outcome: "submitted", content_hash: HASH, body: `${TEXT} ${CANARY}` }] },
      { rows: [{ outcome: "submitted", content_hash: "x", body: TEXT }] },
      // No bytes for a reader that does not hold the hash.
      { rows: [{ outcome: "submitted", content_hash: HASH, body: null }] },
    ];
    for (const answer of cases) {
      const response = await read(database(answer));
      expect([response.status, response.headers.get("ductus-live-state"), await response.json()])
        .toStrictEqual([503, null, { error: "unavailable" }]);
    }
    expect(log.mock.calls[0]).toStrictEqual(["live state read failed", "submitted_unavailable"]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(new RegExp(`${CANARY}|${DOC}`));
  });

  it("refuses another site, a missing session and an id that cannot exist before the database", async () => {
    const cases: [Request, number, string, Options?][] = [
      [get({ "sec-fetch-site": "cross-site" }), 403, "forbidden"],
      [get({ "sec-fetch-site": "same-site" }), 403, "forbidden"],
      [get(), 401, "unauthorized", { token: undefined }],
      [get(), 401, "unauthorized", { token: "kratki" }],
      [get(), 404, "not_found", { documentId: " doc" }],
      [new Request(`${ORIGIN}/api/live/${DOC}`, { method: "DELETE" }), 405, "method_not_allowed"],
    ];
    for (const [request, status, error, options] of cases) {
      const db = database({ rows: [{ outcome: "state", content_hash: HASH, body: TEXT }] });
      const response = await read(db, request, options);
      expect([response.status, await response.json()]).toStrictEqual([status, { error }]);
      expect(db.withActor).not.toHaveBeenCalled();
    }
  });

  it("reads only with the protocol header, for GET and HEAD alike, before the database (F-107)", async () => {
    for (const method of ["GET", "HEAD"]) {
      const refused: Request[] = [
        get({ "ductus-protocol": null }, method),
        get({ "ductus-protocol": null, "sec-fetch-site": null }, method),
        get({ "ductus-protocol": "2" }, method),
        get({ "ductus-protocol": "" }, method),
        get({ "ductus-protocol": "1, 1" }, method),
        get({ "sec-fetch-site": "none" }, method),
        get({ "sec-fetch-site": "cross-site" }, method),
      ];
      for (const request of refused) {
        const db = database({ rows: [{ outcome: "state", content_hash: HASH, body: TEXT }] });
        const response = await read(db, request);
        expect(response.status).toBe(403);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(db.withActor).not.toHaveBeenCalled();
      }
      // The header proves the page when the browser sends no Sec-Fetch-Site.
      const db = database({ rows: [{ outcome: "state", content_hash: HASH, body: TEXT }] });
      const response = await read(db, get({ "sec-fetch-site": null }, method));
      expect([response.status, response.headers.get("etag")]).toStrictEqual([200, `"${HASH}"`]);
      expect(db.withActor).toHaveBeenCalledTimes(1);
    }
  });
});
