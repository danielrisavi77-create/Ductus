import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db";

import { counted, pageActivity, recordActivity, type Schedule } from "./activity";
import { SESSION_COOKIE_NAME } from "./session-token";

// DAN-296 (D-200 P2): input classes 1 to 6 and 10 of the contract on #1091.
// Tokens are synthetic: 43 characters of the base64url alphabet.
const TOKEN = "a".repeat(43);

function fakeRun(touched: boolean | Error) {
  const calls: { token: string | null | undefined; sql: string[] }[] = [];
  const run: WithActor = async (token, fn) => {
    const call = { token, sql: [] as string[] };
    calls.push(call);
    const tx: ActorTransaction = {
      query: async (text: string) => {
        call.sql.push(text);
        if (touched instanceof Error) throw touched;
        return { rows: [{ touched }] as never[], rowCount: 1 };
      },
    };
    return fn(tx);
  };
  return { run, calls };
}

function request(cookie?: string) {
  const cookies = new Map(cookie === undefined ? [] : [[SESSION_COOKIE_NAME, cookie]]);
  return Object.assign(new Request("https://ductus.test/api/x", { method: "POST" }), {
    cookies: { get: (name: string) => (cookies.has(name) ? { value: cookies.get(name)! } : undefined) },
  });
}

function collect() {
  const tasks: (() => Promise<unknown>)[] = [];
  const schedule: Schedule = (task) => tasks.push(task);
  return { tasks, schedule };
}

afterEach(() => vi.restoreAllMocks());

describe("recordActivity", () => {
  it("touches the session behind a well-formed token, in its own transaction", async () => {
    const { run, calls } = fakeRun(true);
    expect(await recordActivity(TOKEN, run)).toBe(true);
    expect(calls).toEqual([{ token: TOKEN, sql: ["SELECT identity.touch_current_session() AS touched"] }]);
  });

  it("reports false when the database does not write (closed, expired, idle or recent)", async () => {
    const { run } = fakeRun(false);
    expect(await recordActivity(TOKEN, run)).toBe(false);
  });

  it.each([undefined, null, "", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}+`])(
    "sends no query for a missing or malformed token (%j)",
    async (token) => {
      const { run, calls } = fakeRun(true);
      expect(await recordActivity(token, run)).toBe(false);
      expect(calls).toEqual([]);
    },
  );

  it("swallows a failure and logs the error name alone", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new TypeError(`connection refused near ${TOKEN}`);
    const { run } = fakeRun(failure);
    expect(await recordActivity(TOKEN, run)).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toEqual(["session activity not recorded:", "TypeError"]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("does not throw for a non-Error rejection", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const run: WithActor = async () => Promise.reject(TOKEN);
    expect(await recordActivity(TOKEN, run)).toBe(false);
    expect(log.mock.calls[0]).toEqual(["session activity not recorded:", "unknown"]);
  });
});

describe("pageActivity", () => {
  it("schedules one touch for a well-formed token", () => {
    const { tasks, schedule } = collect();
    pageActivity(TOKEN, schedule);
    expect(tasks).toHaveLength(1);
  });

  it.each([undefined, "", "not-a-token"])("schedules nothing without a well-formed token (%j)", (token) => {
    const { tasks, schedule } = collect();
    pageActivity(token, schedule);
    expect(tasks).toEqual([]);
  });
});

describe("counted", () => {
  it.each([200, 201, 204])("records activity once the request is accepted (%i)", async (status) => {
    const order: string[] = [];
    const record = vi.fn(async () => (order.push("touch"), true));
    const reply = new Response(null, { status });
    const handler = counted(async () => (order.push("handler"), reply), record);

    expect(await handler(request(TOKEN))).toBe(reply);
    expect(record).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(order).toEqual(["handler", "touch"]);
  });

  it("returns the same response when the touch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = new Response("{}", { status: 200 });
    const { run } = fakeRun(new Error("down"));
    const handler = counted(async () => reply, (token) => recordActivity(token, run));
    expect(await handler(request(TOKEN))).toBe(reply);
  });

  it("reads the cookie before the handler runs", async () => {
    const record = vi.fn(async () => true);
    const req = request(TOKEN);
    const handler = counted(async (r: typeof req) => {
      r.cookies.get = () => undefined;
      return new Response(null, { status: 200 });
    }, record);
    await handler(req);
    expect(record).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });

  it.each([303, 400, 401, 403, 404, 405, 408, 409, 413, 422, 500, 503])(
    "records nothing for a refused or failed request (%i)",
    async (status) => {
      const record = vi.fn(async () => true);
      const reply = new Response(null, { status });
      const handler = counted(async () => reply, record);
      expect(await handler(request(TOKEN))).toBe(reply);
      expect(record).not.toHaveBeenCalled();
    },
  );

  it("records nothing without a cookie or with a malformed one", async () => {
    const record = vi.fn(async () => true);
    const handler = counted(async () => new Response(null, { status: 200 }), record);
    await handler(request());
    await handler(request("x".repeat(10)));
    expect(record).not.toHaveBeenCalled();
  });

  it("passes the request and route context through and does not swallow a handler error", async () => {
    const record = vi.fn(async () => true);
    const inner = vi.fn<(req: ReturnType<typeof request>, context: { id: string }) => Promise<Response>>(async () => {
      throw new RangeError("handler failed");
    });
    const handler = counted(inner, record);
    const req = request(TOKEN);
    await expect(handler(req, { id: "x" })).rejects.toThrow("handler failed");
    expect(inner).toHaveBeenCalledExactlyOnceWith(req, { id: "x" });
    expect(record).not.toHaveBeenCalled();
  });
});
