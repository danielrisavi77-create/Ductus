import { describe, expect, it } from "vitest";

import type { CanonicalDocument } from "@/domain/document";
import { validateDocument } from "@/domain/document";
import { canonicalizeJcs } from "@/domain/forensics/jcs";

import {
  createLivePublisher, LIVE_PUBLISH_GAP_MS, type NetworkSource,
} from "./live-publisher";

// Invented text only.
function doc(text: string): CanonicalDocument {
  return {
    schemaVersion: 1,
    nodes: [{ id: "b-1", type: "paragraph", content: text.length === 0 ? [] : [{ type: "text", text }] }],
  } as unknown as CanonicalDocument;
}

const TOKEN_A = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";

function validDoc(text: string): CanonicalDocument {
  const result = validateDocument({
    schemaVersion: 1,
    nodes: [{
      id: TOKEN_A, type: "paragraph", children: [{ type: "text", text, marks: [] }],
    }],
  });
  if (!result.ok) throw new Error("Invalid synthetic document");
  return result.doc;
}

type Call = { init: RequestInit; resolve: (response: Response) => void; reject: (error: unknown) => void };

/** A fetch whose answers the test gives, one call at a time. */
function fakeFetch() {
  const calls: Call[] = [];
  const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      calls.push({ init: init ?? {}, resolve, reject });
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  return { calls, fetcher };
}

function answer(status: number, token: string | null): Response {
  return new Response(JSON.stringify({ outcome: status === 200 ? "accepted" : "conflict", token }), {
    status, headers: { "content-type": "application/json" },
  });
}

/** Manual clock and timers. */
function fakeTime() {
  let at = 0;
  let queue: { run: () => void; at: number; id: number }[] = [];
  let next = 1;
  return {
    now: () => at,
    timers: {
      set(run: () => void, ms: number) {
        const id = next++;
        queue.push({ run, at: at + ms, id });
        return id;
      },
      clear(handle: unknown) {
        queue = queue.filter((t) => t.id !== handle);
      },
    },
    async advance(ms: number) {
      const end = at + ms;
      for (;;) {
        // Answers first: a timer they set is due in this same advance.
        await flush();
        queue.sort((a, b) => a.at - b.at);
        const due = queue[0];
        if (!due || due.at > end) break;
        queue.shift();
        at = due.at;
        due.run();
      }
      at = end;
    },
    pending: () => queue.length,
  };
}

function fakeNetwork(online = true) {
  let listeners: (() => void)[] = [];
  const source: NetworkSource = {
    isOnline: () => online,
    subscribe(onChange) {
      listeners.push(onChange);
      return () => { listeners = listeners.filter((l) => l !== onChange); };
    },
  };
  return {
    source,
    set(value: boolean) {
      online = value;
      for (const l of [...listeners]) l();
    },
    listeners: () => listeners.length,
  };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function setup(options: { current?: () => boolean; online?: boolean } = {}) {
  const f = fakeFetch();
  const time = fakeTime();
  const net = fakeNetwork(options.online ?? true);
  const publisher = createLivePublisher({
    documentId: "doc-1", fetcher: f.fetcher, now: time.now, timers: time.timers, network: net.source,
    current: options.current,
  });
  return { ...f, time, net, publisher };
}

describe("live publisher (BACKEND 4.12 t. 7 and 8)", () => {
  it("sends nothing before start, and only the whole JCS document after it", async () => {
    const s = setup();
    s.publisher.offer(doc("Prva rečenica."));
    await s.time.advance(5000);
    expect(s.calls).toHaveLength(0);

    s.publisher.start();
    await s.time.advance(0);
    expect(s.calls).toHaveLength(1);
    const { init } = s.calls[0]!;
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(canonicalizeJcs(doc("Prva rečenica.")));
    // I1: the document and two fixed headers, never a time or a counter.
    expect(init.headers).toEqual({ "content-type": "application/json", "if-none-match": "*" });
  });

  it("keeps one request in flight, merges changes into the last state and waits a second between starts", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("a"));
    await s.time.advance(0);
    s.publisher.offer(doc("ab"));
    s.publisher.offer(doc("abc"));
    await s.time.advance(3000);
    expect(s.calls).toHaveLength(1);

    s.calls[0]!.resolve(answer(200, TOKEN_A));
    await s.time.advance(0);
    // The answer came after the gap: the last state goes at once, with the token.
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]!.init.body).toBe(canonicalizeJcs(doc("abc")));
    expect(s.calls[1]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_A}"` });

    s.calls[1]!.resolve(answer(200, TOKEN_B));
    s.publisher.offer(doc("abcd"));
    await s.time.advance(LIVE_PUBLISH_GAP_MS - 1);
    expect(s.calls).toHaveLength(2);
    await s.time.advance(1);
    expect(s.calls).toHaveLength(3);
  });

  it("does not send bytes the server already accepted", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("isto"));
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(200, TOKEN_A));
    await s.time.advance(0);
    s.publisher.offer(doc("isto"));
    await s.time.advance(5000);
    expect(s.calls).toHaveLength(1);
  });

  it("takes the token of a conflict and sends the last state once more, never a second time", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("x"));
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(409, TOKEN_B));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_B}"` });

    // Contract #476 6275905316: at most one repeat per state, no loop.
    s.calls[1]!.resolve(answer(409, TOKEN_A));
    await s.time.advance(120_000);
    expect(s.calls).toHaveLength(2);
    expect(s.time.pending()).toBe(0);

    // A later change is tried afresh, with the token of the last conflict.
    s.publisher.offer(doc("xy"));
    await s.time.advance(0);
    expect(s.calls).toHaveLength(3);
    expect(s.calls[2]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_A}"` });
  });

  it.each([200, 409])("gives B its own conflict retry after A conflicts, ending with %i", async (status) => {
    const s = setup();
    const a = validDoc("A");
    const b = validDoc("B");
    s.publisher.start();
    s.publisher.offer(a);
    await s.time.advance(0);
    s.publisher.offer(b);
    await s.time.advance(0);
    expect(s.calls).toHaveLength(1);

    s.calls[0]!.resolve(answer(409, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS - 1);
    expect(s.calls).toHaveLength(1);
    await s.time.advance(1);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_A}"` });

    s.calls[1]!.resolve(answer(409, TOKEN_B));
    await s.time.advance(LIVE_PUBLISH_GAP_MS - 1);
    expect(s.calls).toHaveLength(2);
    await s.time.advance(1);
    expect(s.calls).toHaveLength(3);
    expect(s.calls.map((call) => call.init.body)).toEqual([
      canonicalizeJcs(a), canonicalizeJcs(b), canonicalizeJcs(b),
    ]);
    expect(s.calls[2]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_B}"` });

    s.calls[2]!.resolve(answer(status, TOKEN_A));
    await s.time.advance(120_000);
    expect(s.calls).toHaveLength(3);
    expect(s.time.pending()).toBe(0);
    expect(s.publisher.halted()).toBeNull();
    if (status === 200) {
      s.publisher.offer(b);
      await s.time.advance(LIVE_PUBLISH_GAP_MS);
      expect(s.calls).toHaveLength(3);
    }
  });

  it("does not renew the same bytes' conflict retry for an unsent intermediate offer", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(validDoc("B"));
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(409, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(2);
    s.publisher.offer(validDoc("C"));
    s.publisher.offer(validDoc("B"));
    s.calls[1]!.resolve(answer(409, TOKEN_B));
    await s.time.advance(120_000);
    expect(s.calls).toHaveLength(2);
    expect(s.time.pending()).toBe(0);
  });

  it("does not publish A again after its conflict retry is exhausted and an edit returns to A", async () => {
    const s = setup();
    const a = validDoc("A");
    const b = validDoc("AB");
    s.publisher.start();
    s.publisher.offer(a);
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(409, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(2);
    s.calls[1]!.resolve(answer(409, TOKEN_B));
    await s.time.advance(0);

    // The editor publishes an insertion and deletion within its debounce window.
    s.publisher.offer(b);
    await s.time.advance(399);
    s.publisher.offer(a);
    await s.time.advance(120_000);
    expect(s.calls.map((call) => call.init.body)).toEqual([
      canonicalizeJcs(a), canonicalizeJcs(a),
    ]);
    expect(s.time.pending()).toBe(0);

    // Once B actually goes out, its own conflict still has one retry.
    s.publisher.offer(b);
    await s.time.advance(0);
    expect(s.calls).toHaveLength(3);
    expect(s.calls[2]!.init.body).toBe(canonicalizeJcs(b));
    expect(s.calls[2]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_B}"` });
    s.calls[2]!.resolve(answer(409, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(4);
    expect(s.calls[3]!.init.body).toBe(canonicalizeJcs(b));
    expect(s.calls[3]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_A}"` });
  });

  // Review FAIL 6305913033: after 409 + 409 for A, the editor offers the
  // identical A again (typed and deleted within its debounce, so only A is
  // offered). However often A comes back, by a timer or at once, no third A.
  it("never sends A a third time when the identical A is offered again after 409 + 409", async () => {
    const s = setup();
    const a = validDoc("A");
    s.publisher.start();
    s.publisher.offer(a);
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(409, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    s.calls[1]!.resolve(answer(409, TOKEN_B));
    await s.time.advance(0);
    expect(s.time.pending()).toBe(0);

    for (const wait of [0, 400, LIVE_PUBLISH_GAP_MS, 30_000]) {
      s.publisher.offer(validDoc("A"));
      await s.time.advance(wait);
    }
    s.publisher.stop();
    s.publisher.start();
    s.publisher.offer(a);
    await s.time.advance(120_000);
    expect(s.calls.map((call) => call.init.body)).toEqual([canonicalizeJcs(a), canonicalizeJcs(a)]);
    expect(s.time.pending()).toBe(0);
  });

  // The allowance ends only when different bytes actually go out: then the
  // route may hold them, so A is a new state for it, not a third retry.
  it("treats A as new once a different state has gone out after A's retry was spent", async () => {
    const s = setup();
    const a = validDoc("A");
    const b = validDoc("AB");
    s.publisher.start();
    s.publisher.offer(a);
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(409, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    s.calls[1]!.resolve(answer(409, TOKEN_B));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);

    s.publisher.offer(b);
    await s.time.advance(0);
    expect(s.calls).toHaveLength(3);
    s.publisher.offer(a);
    s.calls[2]!.resolve(answer(200, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls.map((call) => call.init.body)).toEqual([
      canonicalizeJcs(a), canonicalizeJcs(a), canonicalizeJcs(b), canonicalizeJcs(a),
    ]);
    expect(s.calls[3]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_A}"` });
  });

  it("ignores a stale conflict body after stop and restart without consuming the new retry", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(validDoc("A"));
    await s.time.advance(0);
    let finishBody!: (body: unknown) => void;
    const stale = answer(409, TOKEN_A);
    stale.json = () => new Promise((resolve) => { finishBody = resolve; });
    s.calls[0]!.resolve(stale);
    await flush();
    s.publisher.stop();
    s.publisher.offer(validDoc("B"));
    s.publisher.start();
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(2);
    finishBody({ token: TOKEN_A });
    await flush();
    expect(s.time.pending()).toBe(0);
    s.calls[1]!.resolve(answer(409, TOKEN_B));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(3);
    expect(s.calls[2]!.init.body).toBe(canonicalizeJcs(validDoc("B")));
    expect(s.calls[2]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_B}"` });
    s.publisher.stop();
    await s.time.advance(120_000);
    expect(s.calls).toHaveLength(3);
    expect(s.time.pending()).toBe(0);
  });

  it("sends a return to the accepted state that came while another state was in flight", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("A"));
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(200, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);

    s.publisher.offer(doc("AB"));
    await s.time.advance(0);
    expect(s.calls).toHaveLength(2);
    // The student deletes the letter (or undoes it) before the answer comes.
    s.publisher.offer(doc("A"));
    s.calls[1]!.resolve(answer(200, TOKEN_B));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(3);
    expect(s.calls[2]!.init.body).toBe(canonicalizeJcs(doc("A")));
    expect(s.calls[2]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_B}"` });
  });

  it("drops a return to the accepted state after a refusal, but sends it after a lost answer", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("A"));
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(200, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);

    // Refused: the route still holds A.
    s.publisher.offer(doc("AB"));
    await s.time.advance(0);
    s.publisher.offer(doc("A"));
    s.calls[1]!.resolve(new Response("{}", { status: 413 }));
    await s.time.advance(60_000);
    expect(s.calls).toHaveLength(2);

    // Lost on the network: the route may hold AC or still A, so the return
    // to A goes once more, with the token of A (Codex 4367003542).
    s.publisher.offer(doc("AC"));
    await s.time.advance(0);
    s.publisher.offer(doc("A"));
    s.calls[2]!.reject(new TypeError("network"));
    await s.time.advance(2000);
    expect(s.calls).toHaveLength(4);
    expect(s.calls[3]!.init.body).toBe(canonicalizeJcs(doc("A")));
    expect(s.calls[3]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_A}"` });
    s.calls[3]!.resolve(answer(200, TOKEN_B));
    await s.time.advance(60_000);
    expect(s.calls).toHaveLength(4);
  });

  // Codex 4367003542: the route stored AB but its answer was lost; the student
  // went back to A. A must still go, or the teacher keeps AB.
  it("sends a return to the accepted state when the answer of the state in flight was lost", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("A"));
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(200, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);

    s.publisher.offer(doc("AB"));
    await s.time.advance(0);
    s.calls[1]!.reject(new TypeError("network"));
    s.publisher.offer(doc("A"));
    await s.time.advance(2000);
    expect(s.calls).toHaveLength(3);
    expect(s.calls[2]!.init.body).toBe(canonicalizeJcs(doc("A")));
    // The route moved to AB with a token unknown here: CAS answers 409 and A goes once more.
    s.calls[2]!.resolve(answer(409, TOKEN_B));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(4);
    expect(s.calls[3]!.init.body).toBe(canonicalizeJcs(doc("A")));
    expect(s.calls[3]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_B}"` });
  });

  it("sends the accepted state again after a conflict on the state in flight, since the route may hold anything", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("A"));
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(200, TOKEN_A));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);

    s.publisher.offer(doc("AB"));
    await s.time.advance(0);
    s.publisher.offer(doc("A"));
    s.calls[1]!.resolve(answer(409, TOKEN_B));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(3);
    expect(s.calls[2]!.init.body).toBe(canonicalizeJcs(doc("A")));
    expect(s.calls[2]!.init.headers).toMatchObject({ "if-match": `"${TOKEN_B}"` });
  });

  it("does not resend bytes already refused when they come back while another state is in flight", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("R"));
    await s.time.advance(0);
    s.calls[0]!.resolve(new Response("{}", { status: 422 }));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);

    s.publisher.offer(doc("B"));
    await s.time.advance(0);
    s.publisher.offer(doc("R"));
    s.calls[1]!.resolve(answer(200, TOKEN_A));
    await s.time.advance(60_000);
    // The route keeps B, the last state it can hold: R would be refused again,
    // just as when R comes back with nothing in flight.
    expect(s.calls).toHaveLength(2);
    s.publisher.offer(doc("RC"));
    await s.time.advance(0);
    expect(s.calls).toHaveLength(3);
  });

  it.each([401, 404])("stops for good on %i", async (status) => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("x"));
    await s.time.advance(0);
    s.calls[0]!.resolve(new Response(JSON.stringify({ error: "x" }), { status }));
    await s.time.advance(0);
    s.publisher.offer(doc("y"));
    s.publisher.stop();
    s.publisher.start();
    await s.time.advance(60_000);
    expect(s.calls).toHaveLength(1);
    expect(s.publisher.halted()).toBe(status === 401 ? "signedOut" : "notFound");
  });

  it("does not repeat bytes refused as too large or invalid, but tries a later change", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("x"));
    await s.time.advance(0);
    s.calls[0]!.resolve(new Response("{}", { status: 413 }));
    await s.time.advance(60_000);
    s.publisher.offer(doc("x"));
    await s.time.advance(60_000);
    expect(s.calls).toHaveLength(1);
    s.publisher.offer(doc("y"));
    await s.time.advance(0);
    expect(s.calls).toHaveLength(2);
  });

  it("backs off after a failure from two seconds up to thirty", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("x"));
    await s.time.advance(0);
    const gaps: number[] = [];
    let last = 0;
    for (let i = 0; i < 6; i += 1) {
      s.calls[i]!.reject(new TypeError("network"));
      const before = s.calls.length;
      let waited = 0;
      while (s.calls.length === before) {
        await s.time.advance(1000);
        waited += 1000;
      }
      gaps.push(waited);
      last = waited;
    }
    expect(gaps).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    expect(last).toBe(30000);
  });

  it("without a network keeps only the last state and sends it once back online", async () => {
    const s = setup({ online: false });
    s.publisher.start();
    s.publisher.offer(doc("a"));
    s.publisher.offer(doc("ab"));
    await s.time.advance(10_000);
    expect(s.calls).toHaveLength(0);
    s.net.set(true);
    await s.time.advance(0);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.init.body).toBe(canonicalizeJcs(doc("ab")));
  });

  it("asks current() before every request and stops once the sign-in has ended", async () => {
    let signedIn = true;
    const s = setup({ current: () => signedIn });
    s.publisher.start();
    s.publisher.offer(doc("a"));
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(200, TOKEN_A));
    await s.time.advance(0);
    signedIn = false;
    s.publisher.offer(doc("ab"));
    await s.time.advance(10_000);
    expect(s.calls).toHaveLength(1);
    expect(s.publisher.halted()).toBe("signedOut");
  });

  it("stop aborts the request in flight, ignores its answer and sends nothing until start", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("a"));
    await s.time.advance(0);
    const signal = s.calls[0]!.init.signal!;
    s.publisher.stop();
    expect(signal.aborted).toBe(true);
    s.publisher.offer(doc("ab"));
    await s.time.advance(60_000);
    expect(s.calls).toHaveLength(1);
    expect(s.time.pending()).toBe(0);
    expect(s.net.listeners()).toBe(0);
  });

  it("sends the accepted state again after a stop aborted another state in flight", async () => {
    const s = setup();
    s.publisher.start();
    s.publisher.offer(doc("a"));
    await s.time.advance(0);
    s.calls[0]!.resolve(answer(200, TOKEN_A));
    await s.time.advance(0);
    s.publisher.offer(doc("ab"));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(2);
    // "Odjava", then "Ostani": the request for AB is aborted, but may have landed.
    s.publisher.stop();
    s.publisher.start();
    s.publisher.offer(doc("a"));
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(3);
    expect(s.calls[2]!.init.body).toBe(canonicalizeJcs(doc("a")));
    expect(s.calls[2]!.init.headers).toEqual({ "content-type": "application/json", "if-match": `"${TOKEN_A}"` });
  });

  it("survives repeated starts and stops: never two in flight, and the last state goes after the last start", async () => {
    const s = setup();
    for (let i = 0; i < 5; i += 1) {
      s.publisher.start();
      s.publisher.start();
      s.publisher.offer(doc(`stanje ${i}`));
      await s.time.advance(0);
      s.publisher.stop();
      s.publisher.stop();
      await s.time.advance(LIVE_PUBLISH_GAP_MS);
    }
    const sent = s.calls.length;
    expect(s.calls.every((c) => c.init.signal?.aborted)).toBe(true);
    expect(s.net.listeners()).toBe(0);

    s.publisher.start();
    await s.time.advance(LIVE_PUBLISH_GAP_MS);
    expect(s.calls).toHaveLength(sent + 1);
    expect(s.calls.at(-1)!.init.body).toBe(canonicalizeJcs(doc("stanje 4")));
    expect(s.calls.filter((c) => !c.init.signal?.aborted)).toHaveLength(1);
    expect(s.net.listeners()).toBe(1);
  });
});
