import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGOUT_TIMEOUT_MS } from "./logout-hold";
import { followLogoutNatively, postLogout, signOutHere, type SignOutDeps } from "./logout-request";
import { CURRENT_KEY, ENDED_KEY, hasEnded, type CookieJar, type MarkStore } from "./session-marks";

// DAN-99 (Z-02, D-118): a sign-out from a page without the editor ends the
// session on this device whatever the route answers, and only the session
// the click belonged to. Tags are invented.

const A = { tag: "tag-a", at: 1_000 };
const B = { tag: "tag-b", at: 2_000 };

type StoreClass = "works" | "refusesSetItem" | "refusesAll" | "none";

function storeOf(kind: StoreClass): (MarkStore & { data: Map<string, string> }) | null {
  if (kind === "none") return null;
  const data = new Map<string, string>();
  const refuse = (call: string) => {
    if (kind === "refusesAll" || (kind === "refusesSetItem" && call === "setItem")) {
      throw new DOMException("Storage refused.", "QuotaExceededError");
    }
  };
  return {
    data,
    getItem: (key) => (refuse("getItem"), data.get(key) ?? null),
    setItem: (key, value) => (refuse("setItem"), void data.set(key, value)),
    removeItem: (key) => (refuse("removeItem"), void data.delete(key)),
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

// The route's answers (classes 1 to 6) and whether the sign-out reached it.
const ANSWERS: [string, () => typeof fetch, boolean][] = [
  ["1 the route's redirect", () => vi.fn(async () => response("opaqueredirect", 0)), true],
  ["2 a 200 without the redirect", () => vi.fn(async () => response("basic", 200)), false],
  ["3a a 403", () => vi.fn(async () => response("basic", 403)), false],
  ["3b a 503", () => vi.fn(async () => response("basic", 503)), false],
  ["4 no network", () => vi.fn(async () => { throw new TypeError("Failed to fetch"); }), false],
  ["6 a fetch that throws at once", () => vi.fn(() => { throw new TypeError("fetch is not a function"); }), false],
];

afterEach(() => {
  vi.useRealTimers();
});

describe("postLogout: true only for the route's redirect", () => {
  it.each(ANSWERS)("class %s", async (_name, fetchOf, reached) => {
    const fetchImpl = fetchOf();
    await expect(postLogout(fetchImpl)).resolves.toBe(reached);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({
      method: "POST", redirect: "manual", cache: "no-store",
    }));
  });

  it("class 5: no answer within the limit aborts the request and is false", async () => {
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
  const STORES: StoreClass[] = ["works", "refusesSetItem", "refusesAll", "none"];
  const cases = ANSWERS.flatMap(([name, fetchOf, reached]) => STORES.map((store) => [name, store, fetchOf, reached] as const));

  it.each(cases)("answer %s, storage %s", async (_name, kind, fetchOf, reached) => {
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
    // The other tabs and the parts of this page hear it, once.
    expect(announce.mock.calls).toEqual([["tag-a"]]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("class (v): without a tag of its own it ends nobody and announces nothing", async () => {
    const store = storeOf("works")!;
    const jar = cookieJar();
    const announce = vi.fn();
    await expect(signOutHere(null, { post: async () => false, store, jar, announce })).resolves.toBe(false);
    expect(jar.names()).toEqual([]);
    expect(store.data.has(ENDED_KEY)).toBe(false);
    expect(announce).not.toHaveBeenCalled();
  });

  it("a page without a mark of its own ends the session the browser records at the click", async () => {
    const store = storeOf("works")!;
    store.data.set(CURRENT_KEY, JSON.stringify(A));
    const jar = cookieJar();
    const announce = vi.fn();
    await signOutHere(null, { post: async () => true, store, jar, announce });
    expect(hasEnded(store, A, jar)).toBe(true);
    expect(announce.mock.calls).toEqual([["tag-a"]]);
  });

  it("a post that throws still ends the session here and is false", async () => {
    const store = storeOf("works")!;
    const jar = cookieJar();
    const announce = vi.fn();
    const post = () => Promise.reject(new Error("lost"));
    await expect(signOutHere(A, { post, store, jar, announce })).resolves.toBe(false);
    expect(hasEnded(store, A, jar)).toBe(true);
  });

  it("an announcement that fails changes nothing else", async () => {
    const store = storeOf("works")!;
    const jar = cookieJar();
    const announce = () => { throw new Error("channel closed"); };
    await expect(signOutHere(A, { post: async () => false, store, jar, announce })).resolves.toBe(false);
    expect(hasEnded(store, A, jar)).toBe(true);
  });
});

describe("Istodobnost: a sign-in elsewhere while the sign-out waits", () => {
  it.each([[true], [false]])("keeps the newer session (reached %s)", async (reached) => {
    const store = storeOf("works")!;
    store.data.set(CURRENT_KEY, JSON.stringify(A));
    const jar = cookieJar();
    const announce = vi.fn();
    // While the POST waits, another person signs in in a second tab.
    const post = async () => {
      store.data.set(CURRENT_KEY, JSON.stringify(B));
      return reached;
    };
    await signOutHere(null, { post, store, jar, announce });
    expect(hasEnded(store, A, jar)).toBe(true);
    expect(hasEnded(store, B, jar)).toBe(false);
    expect(JSON.parse(store.data.get(CURRENT_KEY)!)).toEqual(B);
    expect(jar.names()).toEqual(["ductus-ended-tag-a"]);
    expect(announce.mock.calls).toEqual([["tag-a"]]);
  });
});

describe("followLogoutNatively names the click's session (#1929)", () => {
  type Fake = { tag: string; children: Fake[]; submitted: boolean; [key: string]: unknown };
  function fakeDocument() {
    const body: Fake = { tag: "body", children: [], submitted: false };
    const make = (tag: string): Fake => {
      const element: Fake = { tag, children: [], submitted: false };
      element.append = (child: Fake) => void element.children.push(child);
      element.submit = () => void (element.submitted = true);
      return element;
    };
    body.append = (child: Fake) => void body.children.push(child);
    return { body, createElement: make };
  }
  afterEach(() => vi.unstubAllGlobals());

  it.each([["tag-a", "tag-a"], [null, ""]])("tag %s posts session=%s to the route", (tag, sent) => {
    const doc = fakeDocument();
    vi.stubGlobal("document", doc);
    followLogoutNatively(tag);
    const [form] = doc.body.children;
    expect(form).toMatchObject({ tag: "form", method: "post", action: "/api/auth/logout", hidden: true, submitted: true });
    expect(form.children).toEqual([expect.objectContaining({ tag: "input", type: "hidden", name: "session", value: sent })]);
  });
});
