import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGOUT_TIMEOUT_MS } from "./logout-hold";
import { followLogoutNatively, postLogout, signOutHere, type SignOutDeps } from "./logout-request";
import { CURRENT_KEY, ENDED_KEY, hasEnded, type CookieJar, type MarkStore } from "./session-marks";

// DAN-99: the shell's sign-out is the editor's request. It ends the session of
// the click on this device whatever the route answers. Tags are invented.

const A = { tag: "tag-a", at: 1_000 };
const B = { tag: "tag-b", at: 2_000 };

type StoreKind = "works" | "refusesSetItem" | "none";

function storeOf(kind: StoreKind): (MarkStore & { data: Map<string, string> }) | null {
  if (kind === "none") return null;
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (kind === "refusesSetItem") throw new DOMException("Storage refused.", "QuotaExceededError");
      data.set(key, value);
    },
    removeItem: (key) => void data.delete(key),
  };
}

function cookieJar(): CookieJar & { names: () => string[] } {
  const jar = new Map<string, string>();
  return {
    secure: true,
    read: () => [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
    write: (cookie) => {
      const [pair] = cookie.split(";");
      const at = pair!.indexOf("=");
      jar.set(pair!.slice(0, at), pair!.slice(at + 1));
    },
    names: () => [...jar.keys()],
  };
}

const response = (type: ResponseType, status: number) => ({ type, status }) as Response;

const ANSWERS: [string, () => typeof fetch, boolean][] = [
  ["the route's redirect", () => vi.fn(async () => response("opaqueredirect", 0)), true],
  ["a 200 without the redirect", () => vi.fn(async () => response("basic", 200)), false],
  ["a 503", () => vi.fn(async () => response("basic", 503)), false],
  ["no network", () => vi.fn(async () => { throw new TypeError("Failed to fetch"); }), false],
];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("postLogout: true only for the route's redirect", () => {
  it.each(ANSWERS)("%s", async (_name, fetchOf, reached) => {
    const fetchImpl = fetchOf();
    await expect(postLogout(fetchImpl)).resolves.toBe(reached);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({
      method: "POST", redirect: "manual", cache: "no-store",
    }));
  });

  it("no answer within the limit aborts the request and is false", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const result = postLogout(fetchImpl as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(LOGOUT_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
  });
});

describe("signOutHere: every answer ends the session of the click on this device", () => {
  const cases = ANSWERS.flatMap(([name, fetchOf, reached]) =>
    (["works", "refusesSetItem", "none"] as const).map((kind) => [name, kind, fetchOf, reached] as const));

  it.each(cases)("%s, storage %s", async (_name, kind, fetchOf, reached) => {
    const store = storeOf(kind);
    const jar = cookieJar();
    const announce = vi.fn();
    const fetchImpl = fetchOf();
    const deps: SignOutDeps = { post: () => postLogout(fetchImpl), store, jar, announce };

    await expect(signOutHere(A, deps)).resolves.toBe(reached);
    // The cookie holds the end wherever localStorage refuses it (#1444).
    expect(jar.names()).toEqual(["ductus-ended-tag-a"]);
    expect(hasEnded(store, A, jar)).toBe(true);
    if (kind === "works") expect(JSON.parse(store!.data.get(ENDED_KEY)!)).toEqual(["tag-a"]);
    expect(announce.mock.calls).toEqual([["tag-a"]]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("without a page mark it ends the session the browser records at the click", async () => {
    const store = storeOf("works")!;
    store.data.set(CURRENT_KEY, JSON.stringify(A));
    const jar = cookieJar();
    await signOutHere(null, { post: async () => true, store, jar, announce: vi.fn() });
    expect(hasEnded(store, A, jar)).toBe(true);
  });

  it("without any session it ends nobody and announces nothing", async () => {
    const store = storeOf("works")!;
    const jar = cookieJar();
    const announce = vi.fn();
    await expect(signOutHere(null, { post: async () => false, store, jar, announce })).resolves.toBe(false);
    expect(jar.names()).toEqual([]);
    expect(store.data.has(ENDED_KEY)).toBe(false);
    expect(announce).not.toHaveBeenCalled();
  });

  it("a post that rejects and an announcement that throws still end it here", async () => {
    const store = storeOf("works")!;
    const jar = cookieJar();
    const announce = () => { throw new Error("channel closed"); };
    await expect(signOutHere(A, { post: () => Promise.reject(new Error("lost")), store, jar, announce }))
      .resolves.toBe(false);
    expect(hasEnded(store, A, jar)).toBe(true);
  });

  it.each([[true], [false]])("a sign-in elsewhere while the POST waits stays (reached %s)", async (reached) => {
    const store = storeOf("works")!;
    store.data.set(CURRENT_KEY, JSON.stringify(A));
    const jar = cookieJar();
    const announce = vi.fn();
    const post = async () => {
      store.data.set(CURRENT_KEY, JSON.stringify(B));
      return reached;
    };
    await signOutHere(null, { post, store, jar, announce });
    expect(hasEnded(store, A, jar)).toBe(true);
    expect(hasEnded(store, B, jar)).toBe(false);
    expect(JSON.parse(store.data.get(CURRENT_KEY)!)).toEqual(B);
    expect(announce.mock.calls).toEqual([["tag-a"]]);
  });
});

describe("followLogoutNatively", () => {
  it("submits a hidden POST form to the route, without a condition", () => {
    type Fake = { tag: string; children: unknown[]; submitted: boolean; [key: string]: unknown };
    const body: Fake = { tag: "body", children: [], submitted: false };
    body.append = (child: unknown) => void body.children.push(child);
    const createElement = (tag: string): Fake => {
      const element: Fake = { tag, children: [], submitted: false };
      element.append = (child: unknown) => void element.children.push(child);
      element.submit = () => void (element.submitted = true);
      return element;
    };
    vi.stubGlobal("document", { body, createElement });
    followLogoutNatively();
    expect(body.children).toEqual([expect.objectContaining({
      tag: "form", method: "post", action: "/api/auth/logout", hidden: true, submitted: true, children: [],
    })]);
  });
});
