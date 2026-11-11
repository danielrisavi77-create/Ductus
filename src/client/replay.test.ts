import type { Transform } from "@tiptap/pm/transform";
import { describe, expect, it, vi } from "vitest";

import type { EvidenceChainHeadV2 } from "@/domain/forensics/evidence-chain-v2";
import {
  buildRecord,
  jcsOf,
  RECORD_DOCUMENT_ID as DOC,
  recordSchema as schema,
  sha,
  startNode as start,
  type BuiltRecord,
} from "@/domain/projection/replay-record.fixture";

import {
  fetchReplayRecord,
  loadReplay,
  parseReplayPage,
  REPLAY_PAGE_FORMAT,
  REPLAY_PAGE_MAX_SEGMENTS,
  REPLAY_RESTARTS,
} from "./replay";

const typeAt = (pos: number, value: string) => ({ edit: (tr: Transform) => void tr.insert(pos, schema.text(value)) });
const recordOf = (letters: string) =>
  buildRecord(start, [...letters].map((letter, i) => ({ at: `10:${String(i).padStart(2, "0")}`, events: [typeAt(17 + i, letter)] })));

const one = recordOf("XYZ");
const other = recordOf("QRST");

/** The page of `r` from `from` with `size` segments, as the route writes it. */
function pageOf(r: BuiltRecord, from: number, size: number, resumeDocuments: Record<string, string> = {}) {
  const count = r.segments.length;
  const segments = r.segments.slice(from, from + size);
  const end = from + segments.length;
  return {
    replayFormat: REPLAY_PAGE_FORMAT,
    segmentCount: count,
    head: r.head,
    from,
    next: end < count ? end : null,
    startDocument: from === 0 && count > 0 ? jcsOf(start) : null,
    segments,
    resumeDocuments,
  };
}
const EMPTY = { replayFormat: REPLAY_PAGE_FORMAT, segmentCount: 0, head: null, from: 0, next: null, startDocument: null, segments: [], resumeDocuments: {} };

type Reply = { status: number; body?: unknown } | "offline";
/** A fetcher that answers each request with the next reply and records every body. */
function scripted(replies: Reply[]) {
  const bodies: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const reply = replies.shift();
    if (reply === undefined) throw new Error("no more replies");
    if (reply === "offline") throw new TypeError("offline");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
  });
  return { fetcher, bodies };
}
const ok = (body: unknown): Reply => ({ status: 200, body });
const changed: Reply = { status: 409, body: { error: "record_changed" } };

describe("parseReplayPage (DAN-537)", () => {
  const first = pageOf(one, 0, 2);
  const second = pageOf(one, 2, 2);
  const pin = one.head as EvidenceChainHeadV2;

  it("takes a first page, a later page pinned to the head, and the empty record", () => {
    expect(parseReplayPage(first, 0, null)).toMatchObject({ from: 0, next: 2, segments: one.segments.slice(0, 2) });
    expect(parseReplayPage(second, 2, pin)).toMatchObject({ from: 2, next: null, startDocument: null });
    expect(parseReplayPage(EMPTY, 0, null)).toMatchObject({ segmentCount: 0, head: null, segments: [] });
  });

  const rejected: [string, unknown, number, EvidenceChainHeadV2 | null][] = [
    ["not an object", [first], 0, null],
    ["an unknown field", { ...first, minute: 3 }, 0, null],
    ["a missing field", Object.fromEntries(Object.entries(first).filter(([key]) => key !== "resumeDocuments")), 0, null],
    ["another format", { ...first, replayFormat: "ductus-evidence-replay-v2" }, 0, null],
    ["another start than asked", first, 1, null],
    ["a count that is no whole number", { ...first, segmentCount: 3.5 }, 0, null],
    ["a negative count", { ...EMPTY, segmentCount: -1 }, 0, null],
    ["a head whose count is not the page's", { ...first, segmentCount: 4, next: 2 }, 0, null],
    ["a head with an extra field", { ...first, head: { ...pin, at: "x" } }, 0, null],
    ["a head hash that is not hex", { ...first, head: { ...pin, segmentHash: pin.segmentHash.toUpperCase() } }, 0, null],
    ["no head for a record with segments", { ...first, head: null }, 0, null],
    ["a head for the empty record", { ...EMPTY, head: pin }, 0, null],
    ["a later page with another head than the pin", pageOf(other, 2, 2), 2, pin],
    ["a later page with no head", { ...second, head: null, segmentCount: 0 }, 2, pin],
    ["a segment that is not text", { ...first, segments: [one.segments[0], 7] }, 0, null],
    ["more segments than a page holds", { ...first, segments: Array(REPLAY_PAGE_MAX_SEGMENTS + 1).fill("x"), next: REPLAY_PAGE_MAX_SEGMENTS + 1, segmentCount: 300, head: { ...pin, segmentCount: 300 } }, 0, null],
    ["segments past the count", { ...first, segments: [...one.segments, "x"], next: null }, 0, null],
    ["no segments on a page of a non-empty record", { ...first, segments: [], next: 0 }, 0, null],
    ["a next that is not the end of the page", { ...first, next: 3 }, 0, null],
    ["a next on the last page", { ...second, next: 3 }, 2, pin],
    ["no start document on the first page", { ...first, startDocument: null }, 0, null],
    ["a start document on a later page", { ...second, startDocument: jcsOf(start) }, 2, pin],
    ["a resume document under a key that is no hash", { ...first, resumeDocuments: { abc: "{}" } }, 0, null],
    ["a resume document that is not text", { ...first, resumeDocuments: { [sha("x")]: 1 } }, 0, null],
    ["an empty record that goes on", { ...EMPTY, next: 1 }, 0, null],
    ["an empty record with a start document", { ...EMPTY, startDocument: "{}" }, 0, null],
    ["an empty record with a resume document", { ...EMPTY, resumeDocuments: { [sha("x")]: "{}" } }, 0, null],
  ];
  it.each(rejected)("rejects %s", (_name, value, from, pinned) => {
    expect(parseReplayPage(value, from, pinned)).toBeNull();
  });
});

describe("fetchReplayRecord (DAN-537)", () => {
  it("joins the pages of one record, and every page after the first names the pinned head", async () => {
    const { fetcher, bodies } = scripted([ok(pageOf(one, 0, 1)), ok(pageOf(one, 1, 1)), ok(pageOf(one, 2, 1))]);
    const read = await fetchReplayRecord(DOC, () => true, fetcher);
    expect(read).toStrictEqual({ kind: "ok", record: { startDocument: jcsOf(start), segments: one.segments, head: one.head, resumeDocuments: {} } });
    expect(bodies).toStrictEqual([
      { documentId: DOC, from: 0 },
      { documentId: DOC, from: 1, head: one.head },
      { documentId: DOC, from: 2, head: one.head },
    ]);
    const init = fetcher.mock.calls[0][1];
    expect([fetcher.mock.calls[0][0], init?.method, init?.credentials, init?.cache]).toStrictEqual(["/api/evidence/replay", "POST", "same-origin", "no-store"]);
  });

  it("reads the empty record in one request", async () => {
    const { fetcher } = scripted([ok(EMPTY)]);
    expect(await fetchReplayRecord(DOC, () => true, fetcher)).toStrictEqual({
      kind: "ok",
      record: { startDocument: null, segments: [], head: null, resumeDocuments: {} },
    });
  });

  it.each([
    [401, "signedOut"],
    [404, "notFound"],
    [503, "unavailable"],
    [500, "unavailable"],
    [204, "unavailable"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const { fetcher } = scripted([{ status, body: { error: "x" } }]);
    expect(await fetchReplayRecord(DOC, () => true, fetcher)).toStrictEqual({ kind });
  });

  it("is unavailable when the network fails, or the body is not UTF-8 JSON", async () => {
    expect(await fetchReplayRecord(DOC, () => true, scripted(["offline"]).fetcher)).toStrictEqual({ kind: "unavailable" });
    const bytes = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200 }));
    expect(await fetchReplayRecord(DOC, () => true, bytes)).toStrictEqual({ kind: "unavailable" });
  });

  it("sends nothing once the session has ended, also between pages", async () => {
    const { fetcher } = scripted([ok(pageOf(one, 0, 1))]);
    expect(await fetchReplayRecord(DOC, () => false, fetcher)).toStrictEqual({ kind: "signedOut" });
    expect(fetcher).not.toHaveBeenCalled();
    let left = 1;
    expect(await fetchReplayRecord(DOC, () => left-- > 0, fetcher)).toStrictEqual({ kind: "signedOut" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("after a 409 on the second page starts again and shows only the new record", async () => {
    const { fetcher, bodies } = scripted([ok(pageOf(one, 0, 2)), changed, ok(pageOf(other, 0, 3)), ok(pageOf(other, 3, 3))]);
    const read = await fetchReplayRecord(DOC, () => true, fetcher);
    expect(read).toStrictEqual({ kind: "ok", record: { startDocument: jcsOf(start), segments: other.segments, head: other.head, resumeDocuments: {} } });
    // The fresh reading asks without a head, then pins the new one.
    expect(bodies.slice(2)).toStrictEqual([{ documentId: DOC, from: 0 }, { documentId: DOC, from: 3, head: other.head }]);
    if (read.kind === "ok") for (const segment of one.segments) expect(read.record.segments).not.toContain(segment);
  });

  it(`is unavailable after ${REPLAY_RESTARTS + 1} readings that each end in a 409`, async () => {
    const replies: Reply[] = [];
    for (let i = 0; i <= REPLAY_RESTARTS; i++) replies.push(ok(pageOf(one, 0, 1)), changed);
    const { fetcher } = scripted(replies);
    expect(await fetchReplayRecord(DOC, () => true, fetcher)).toStrictEqual({ kind: "unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(2 * (REPLAY_RESTARTS + 1));
  });

  it("rejects a 200 page whose head is not the pinned one, and never joins two records", async () => {
    const { fetcher } = scripted([ok(pageOf(one, 0, 2)), ok({ ...pageOf(other, 2, 2), next: null, segmentCount: 4 })]);
    expect(await fetchReplayRecord(DOC, () => true, fetcher)).toStrictEqual({ kind: "unavailable" });
  });

  it("joins the resume documents of the pages, and refuses two texts for one hash", async () => {
    const hash = sha("{\"a\":1}");
    const same = scripted([ok(pageOf(one, 0, 2, { [hash]: "{\"a\":1}" })), ok(pageOf(one, 2, 1, { [hash]: "{\"a\":1}" }))]);
    const joined = await fetchReplayRecord(DOC, () => true, same.fetcher);
    expect(joined.kind === "ok" && joined.record.resumeDocuments).toStrictEqual({ [hash]: "{\"a\":1}" });

    const clash = scripted([ok(pageOf(one, 0, 2, { [hash]: "{\"a\":1}" })), ok(pageOf(one, 2, 1, { [hash]: "{\"a\":2}" }))]);
    expect(await fetchReplayRecord(DOC, () => true, clash.fetcher)).toStrictEqual({ kind: "unavailable" });
  });
});

describe("loadReplay (DAN-537)", () => {
  it("replays a record read over pages, with no input about who looks", async () => {
    const { fetcher } = scripted([ok(pageOf(one, 0, 2)), ok(pageOf(one, 2, 2))]);
    const loaded = await loadReplay(DOC, () => true, fetcher);
    if (loaded.kind !== "ok") throw new Error(loaded.kind);
    expect(loaded.player.total).toBe(3);
    expect(loaded.player.documentAt(3)).toStrictEqual(one.ends[2].toJSON());
    expect(loadReplay.length).toBe(1);
  });

  it("is unavailable, never partly shown, when the record fails a check", async () => {
    const tampered = { ...pageOf(one, 0, 3), segments: [one.segments[0], one.segments[1].replace("\"Y\"", "\"W\""), one.segments[2]] };
    expect(await loadReplay(DOC, () => true, scripted([ok(tampered)]).fetcher)).toStrictEqual({ kind: "unavailable" });
  });

  it("passes signed out and not found through", async () => {
    expect(await loadReplay(DOC, () => true, scripted([{ status: 401 }]).fetcher)).toStrictEqual({ kind: "signedOut" });
    expect(await loadReplay(DOC, () => true, scripted([{ status: 404 }]).fetcher)).toStrictEqual({ kind: "notFound" });
  });
});
