import { describe, expect, it, vi } from "vitest";

import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { PROBLEM_REPORT_DESCRIPTION_MAX, parseProblemReport } from "@/domain/support/problem-report";
import { MAX_PROBLEM_REPORT_BODY_BYTES } from "@/server/support/problem-report-route";

import {
  APP_VERSION,
  browserFromUserAgent,
  buildProblemReportBody,
  checkDescription,
  descriptionLength,
  outcomeFromResponse,
  sendProblemReport,
  singleFlight,
  type FailureReason,
} from "./problem-report-client";

// DAN-431, contract on #1836: every input class the form can meet, written
// before the code. The client refuses what the server would refuse, and
// every refusal from the server gets a reason the dialog can name.

const emoji = "\u{1F600}"; // four UTF-8 bytes, two UTF-16 units, one code point

describe("description classes", () => {
  const rows: Array<[string, string, ReturnType<typeof checkDescription>]> = [
    ["empty", "", "empty"],
    ["only spaces and new lines", "   \n\t \n", "empty"],
    ["only zero-width space", "\u200B", "empty"],
    ["one visible character", "a", "ok"],
    ["longest allowed", "a".repeat(PROBLEM_REPORT_DESCRIPTION_MAX), "ok"],
    ["one over the limit", "a".repeat(PROBLEM_REPORT_DESCRIPTION_MAX + 1), "tooLong"],
    ["four-byte characters at the limit", emoji.repeat(PROBLEM_REPORT_DESCRIPTION_MAX), "ok"],
    ["four-byte characters over the limit", emoji.repeat(PROBLEM_REPORT_DESCRIPTION_MAX + 1), "tooLong"],
    ["Croatian letters and new lines", "Ne mogu spremiti\nčćžšđ ČĆŽŠĐ", "ok"],
    ["control character", "a\u0007b", "invalid"],
    ["bidi override", "a\u202Eb", "invalid"],
    ["lone surrogate", "a\uD83D", "invalid"],
  ];

  it.each(rows)("%s", (_name, text, expected) => {
    expect(checkDescription(text)).toBe(expected);
    // The client never lets through what the server's own check refuses.
    if (expected === "ok") expect(buildBody(text)).not.toBeNull();
  });

  it("counts code points, so a four-byte character is one", () => {
    expect(descriptionLength(emoji.repeat(3))).toBe(3);
    expect(descriptionLength("čćž")).toBe(3);
  });

  it("keeps the longest four-byte description under the server's body limit", () => {
    const body = buildBody(emoji.repeat(PROBLEM_REPORT_DESCRIPTION_MAX));
    expect(new TextEncoder().encode(body ?? "").length).toBeLessThan(MAX_PROBLEM_REPORT_BODY_BYTES);
  });
});

function buildBody(description: string): string | null {
  return buildProblemReportBody({
    category: "technical",
    description,
    pathname: "/nastavnik/rad/00000000-0000-4000-8000-000000000001",
    syncState: null,
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
}

describe("the request body", () => {
  it("is the canonical JCS form of exactly the six wire keys, and the server parses it", () => {
    const body = buildBody("Gumb ne reagira.");
    expect(body).not.toBeNull();
    const value = JSON.parse(body ?? "") as unknown;
    expect(canonicalizeJcs(value)).toBe(body);
    expect(parseProblemReport(value)).toEqual({
      category: "technical",
      description: "Gumb ne reagira.",
      route: "/nastavnik/rad/[id]",
      appVersion: APP_VERSION,
      browserFamily: "chromium",
      browserMajor: 131,
      syncState: null,
    });
  });

  it("sends no identifier from the address, and null for a page outside the list", () => {
    expect(buildBody("x")).not.toContain("00000000-0000-4000-8000-000000000001");
    const other = buildProblemReportBody({
      category: "account",
      description: "x",
      pathname: "/nepoznato/123",
      syncState: null,
      userAgent: "",
    });
    expect(JSON.parse(other ?? "")).toMatchObject({ route: null, browser: { family: "other", major: null } });
  });

  it("builds nothing for a description outside its class", () => {
    expect(buildBody("")).toBeNull();
    expect(buildBody("a\u202Eb")).toBeNull();
  });
});

describe("browser from the user agent", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0", "firefox", 133],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "safari", 18],
    ["Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "chromium", 130],
    ["Mozilla/5.0 Chrome/99999.0", "chromium", null],
    ["curl/8.0", "other", null],
  ] as const)("%s", (ua, family, major) => {
    expect(browserFromUserAgent(ua)).toEqual({ family, major });
  });
});

describe("server answers", () => {
  const rows: Array<[string, number, unknown, FailureReason | "sent"]> = [
    // The server writes the number in upper-case hex (migration, route guard).
    ["created", 201, { reference: "PR-3FA9C01B2E" }, "sent"],
    ["created without a reference", 201, {}, "unknown"],
    ["created with a lower-case number", 201, { reference: "PR-3fa9c01b2e" }, "unknown"],
    ["signed out", 401, { error: "unauthorized" }, "signedOut"],
    ["body too large", 413, { error: "too_large" }, "tooLarge"],
    ["refused input", 422, { error: "invalid_input" }, "invalid"],
    ["hourly limit", 429, { error: "too_many_reports" }, "tooMany"],
    ["unavailable", 503, { error: "unavailable" }, "unavailable"],
    ["unexpected status", 500, null, "unknown"],
    ["bad request", 400, { error: "invalid_json" }, "unknown"],
  ];

  it.each(rows)("%s → %s", (_name, status, json, expected) => {
    const outcome = outcomeFromResponse(status, json);
    if (expected === "sent") expect(outcome).toEqual({ kind: "sent", reference: "PR-3FA9C01B2E" });
    else expect(outcome).toEqual({ kind: "failed", reason: expected });
  });

  it("ends a network failure as a failed send, not a thrown error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(sendProblemReport("{}", fetcher)).resolves.toEqual({ kind: "failed", reason: "network" });
  });

  it("ends an unreadable answer body by its status", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<html>", { status: 429 }));
    await expect(sendProblemReport("{}", fetcher)).resolves.toEqual({ kind: "failed", reason: "tooMany" });
  });

  it("posts the exact bytes as JSON to the route, with the session cookie", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ reference: "PR-ABCDEF0123" }, { status: 201 }));
    const body = buildBody("x") ?? "";
    await expect(sendProblemReport(body, fetcher)).resolves.toEqual({ kind: "sent", reference: "PR-ABCDEF0123" });
    expect(fetcher).toHaveBeenCalledWith("/api/support/problem-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });
  });
});

// Another person signing in in another tab puts their cookie in this browser:
// a report written before that must not go out under it (Codex, #1967).
describe("a send after the session has ended", () => {
  it("posts nothing and says the session ended", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ reference: "PR-ABCDEF0123" }, { status: 201 }));
    await expect(sendProblemReport("{}", fetcher, 10, () => false)).resolves.toEqual({ kind: "ended" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks right before posting, not earlier", async () => {
    const order: string[] = [];
    const fetcher = vi.fn(() => {
      order.push("post");
      return Promise.resolve(Response.json({ reference: "PR-ABCDEF0123" }, { status: 201 }));
    });
    const current = () => {
      order.push("check");
      return true;
    };
    await expect(sendProblemReport("{}", fetcher, 1000, current)).resolves.toEqual({ kind: "sent", reference: "PR-ABCDEF0123" });
    expect(order).toEqual(["check", "post"]);
  });
});

// A stalled send would hold the locked dialog shut (Codex, #1967).
describe("a send that gets no answer in time", () => {
  it("ends as a timeout and aborts the request when the connection stalls", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    await expect(sendProblemReport("{}", fetcher, 10)).resolves.toEqual({ kind: "failed", reason: "timeout" });
    expect(signal?.aborted).toBe(true);
  });

  it("ends as a timeout when the answer starts but its body never finishes", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 201 });
    const fetcher = vi.fn().mockResolvedValue(stalled);
    await expect(sendProblemReport("{}", fetcher, 10)).resolves.toEqual({ kind: "failed", reason: "timeout" });
  });

  it("leaves no timer behind once the answer has come", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ reference: "PR-ABCDEF0123" }, { status: 201 }));
      await expect(sendProblemReport("{}", fetcher)).resolves.toEqual({ kind: "sent", reference: "PR-ABCDEF0123" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("frees the single-flight slot after a timeout, so the next send is a new request", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValueOnce(Response.json({ reference: "PR-0000000003" }, { status: 201 }));
    const send = singleFlight(() => sendProblemReport("{}", fetcher, 10));
    await expect(send()).resolves.toEqual({ kind: "failed", reason: "timeout" });
    await expect(send()).resolves.toEqual({ kind: "sent", reference: "PR-0000000003" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("Istodobnost: one request per send", () => {
  it("gives a double click and a resend while the first is in flight exactly one request", async () => {
    let finish: (response: Response) => void = () => {};
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => (finish = resolve)));
    const send = singleFlight(() => sendProblemReport("{}", fetcher));

    const first = send();
    const second = send();
    const third = send();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);

    finish(Response.json({ reference: "PR-0000000001" }, { status: 201 }));
    const outcomes = await Promise.all([first, second, third]);
    expect(new Set(outcomes.map((o) => JSON.stringify(o))).size).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows a new send once the first has ended, also after a failure", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(Response.json({ reference: "PR-0000000002" }, { status: 201 }));
    const send = singleFlight(() => sendProblemReport("{}", fetcher));

    await expect(send()).resolves.toEqual({ kind: "failed", reason: "network" });
    await expect(send()).resolves.toEqual({ kind: "sent", reference: "PR-0000000002" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("frees the slot when the task throws", async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const send = singleFlight(task);
    await expect(send()).rejects.toThrow("boom");
    await expect(send()).resolves.toBe("ok");
  });
});
