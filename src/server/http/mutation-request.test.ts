import { describe, expect, it } from "vitest";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import { checkMutationRequest, readBodyWithLimit } from "./mutation-request";

const ORIGIN = "https://ductus.example";
const URL_INGEST = `${ORIGIN}/api/v1/evidence/ingest`;

function post(headers: Record<string, string>, method = "POST"): Request {
  return new Request(URL_INGEST, { method, headers });
}

describe("checkMutationRequest (#155 item 8)", () => {
  it("accepts a same-origin POST with and without Sec-Fetch-Site", () => {
    expect(
      checkMutationRequest(
        post({ origin: ORIGIN, "sec-fetch-site": "same-origin" }),
        ORIGIN,
      ),
    ).toEqual({ ok: true });
    expect(checkMutationRequest(post({ origin: ORIGIN }), ORIGIN)).toEqual({
      ok: true,
    });
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "refuses %s with 405",
    (method) => {
      expect(
        checkMutationRequest(post({ origin: ORIGIN }, method), ORIGIN),
      ).toMatchObject({ status: 405 });
    },
  );

  it("refuses a missing, empty or opaque Origin even when Sec-Fetch-Site says same-origin", () => {
    for (const headers of [
      { "sec-fetch-site": "same-origin" },
      { origin: "" },
      { origin: "null" },
    ] as Record<string, string>[]) {
      expect(checkMutationRequest(post(headers), ORIGIN)).toEqual({
        ok: false,
        status: 403,
        reason: "origin_missing",
      });
    }
  });

  it.each([
    "https://evil.example",
    "http://ductus.example",
    "https://ductus.example:8443",
    "https://sub.ductus.example",
    "https://ductus.example.evil.example",
    "https://DUCTUS.example",
    `${ORIGIN}/`,
  ])("refuses foreign Origin %s", (origin) => {
    expect(checkMutationRequest(post({ origin }), ORIGIN)).toEqual({
      ok: false,
      status: 403,
      reason: "origin_mismatch",
    });
  });

  it.each(["cross-site", "same-site", "none"])(
    "refuses Sec-Fetch-Site %s even with our Origin",
    (site) => {
      expect(
        checkMutationRequest(
          post({ origin: ORIGIN, "sec-fetch-site": site }),
          ORIGIN,
        ),
      ).toEqual({
        ok: false,
        status: 403,
        reason: "cross_site",
      });
    },
  );

  it("throws on a misconfigured expected origin instead of matching anything", () => {
    expect(() =>
      checkMutationRequest(post({ origin: ORIGIN }), `${ORIGIN}/app`),
    ).toThrow();
    expect(() =>
      checkMutationRequest(post({ origin: "null" }), "null"),
    ).toThrow();
  });

  it("never touches the body", () => {
    const request = new Request(URL_INGEST, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: "{}",
    });
    checkMutationRequest(request, ORIGIN);
    expect(request.bodyUsed).toBe(false);
  });
});

/** A body that produces chunks on demand and records how far it was read. */
function trackedStream(chunkSize: number, chunks: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled === chunks) return controller.close();
      state.pulled++;
      controller.enqueue(new Uint8Array(chunkSize).fill(0x61));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

function streamed(
  stream: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Request {
  return new Request(URL_INGEST, {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  } as RequestInit);
}

const LIMIT = MAX_EVIDENCE_SEGMENT_BYTES;

describe("readBodyWithLimit (#155 items 10 and 12, HTTP part)", () => {
  it("accepts a body of exactly the limit and refuses one byte more (D-96)", async () => {
    const exact = await readBodyWithLimit(
      new Request(URL_INGEST, { method: "POST", body: new Uint8Array(LIMIT) }),
      LIMIT,
    );
    expect(exact.ok && exact.bytes.byteLength).toBe(LIMIT);
    const over = await readBodyWithLimit(
      new Request(URL_INGEST, {
        method: "POST",
        body: new Uint8Array(LIMIT + 1),
      }),
      LIMIT,
    );
    expect(over).toEqual({ ok: false, status: 413, reason: "body_too_large" });
  });

  it("counts multi-byte characters in bytes, not code units", async () => {
    // 4 x U+010D (č) is 8 bytes in UTF-8 but 4 UTF-16 code units.
    const body = "č".repeat(4);
    expect(
      await readBodyWithLimit(
        new Request(URL_INGEST, { method: "POST", body }),
        7,
      ),
    ).toMatchObject({ status: 413 });
    const fits = await readBodyWithLimit(
      new Request(URL_INGEST, { method: "POST", body }),
      8,
    );
    expect(fits.ok && fits.bytes.byteLength).toBe(8);
  });

  it("refuses a declared Content-Length over the limit without reading the body", async () => {
    const { stream, state } = trackedStream(1024, 4096);
    const result = await readBodyWithLimit(
      streamed(stream, { "content-length": String(LIMIT + 1) }),
      LIMIT,
    );
    expect(result).toEqual({
      ok: false,
      status: 413,
      reason: "body_too_large",
    });
    expect(state.pulled).toBeLessThanOrEqual(1);
    expect(state.cancelled).toBe(true);
  });

  it("stops at the limit when Content-Length is missing or understated, without draining the rest", async () => {
    for (const headers of [{}, { "content-length": "10" }] as Record<
      string,
      string
    >[]) {
      // 4 MiB offered in 64 KiB chunks against a 2 MiB limit.
      const { stream, state } = trackedStream(64 * 1024, 64);
      const result = await readBodyWithLimit(streamed(stream, headers), LIMIT);
      expect(result).toEqual({
        ok: false,
        status: 413,
        reason: "body_too_large",
      });
      expect(state.cancelled).toBe(true);
      // 33 chunks cross the limit; allow a little read-ahead, never the whole 64.
      expect(state.pulled).toBeLessThan(40);
    }
  });

  it("refuses a declared length that does not match the bytes received", async () => {
    const { stream } = trackedStream(10, 1);
    expect(
      await readBodyWithLimit(
        streamed(stream, { "content-length": "11" }),
        LIMIT,
      ),
    ).toEqual({
      ok: false,
      status: 400,
      reason: "content_length_mismatch",
    });
  });

  // Leading and trailing whitespace is stripped by the Headers class itself.
  it.each(["-1", "1e3", "0x10", "01", "5, 5", "99999999999999999999"])(
    "refuses a malformed Content-Length %j",
    async (value) => {
      const { stream } = trackedStream(5, 1);
      expect(
        await readBodyWithLimit(
          streamed(stream, { "content-length": value }),
          LIMIT,
        ),
      ).toMatchObject({
        ok: false,
        status: 400,
        reason: "content_length_invalid",
      });
    },
  );

  it("returns the received bytes untouched: BOM, invalid UTF-8 and NUL survive for the strict check", async () => {
    const raw = new Uint8Array([
      0xef, 0xbb, 0xbf, 0x7b, 0xff, 0x00, 0xed, 0xa0, 0x80, 0x7d,
    ]);
    const result = await readBodyWithLimit(
      new Request(URL_INGEST, { method: "POST", body: raw }),
      LIMIT,
    );
    expect(result.ok && [...result.bytes]).toEqual([...raw]);
  });

  it("returns body_stream_error, not a throw or partial bytes, when the stream fails mid-read", async () => {
    let pulls = 0;
    for (const headers of [{}, { "content-length": "4096" }] as Record<
      string,
      string
    >[]) {
      pulls = 0;
      const failing = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulls++ === 0)
            controller.enqueue(new Uint8Array(1024).fill(0x61));
          else controller.error(new Error("connection reset"));
        },
      });
      expect(
        await readBodyWithLimit(streamed(failing, headers), LIMIT),
      ).toEqual({ ok: false, status: 400, reason: "body_stream_error" });
    }
  });

  it("keeps the 413 refusal when cancelling the stream itself fails", async () => {
    const declared = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error("cancel failed");
      },
    });
    expect(
      await readBodyWithLimit(
        streamed(declared, { "content-length": String(LIMIT + 1) }),
        LIMIT,
      ),
    ).toEqual({ ok: false, status: 413, reason: "body_too_large" });
    const undeclared = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(LIMIT + 1));
      },
      cancel() {
        throw new Error("cancel failed");
      },
    });
    expect(await readBodyWithLimit(streamed(undeclared), LIMIT)).toEqual({
      ok: false,
      status: 413,
      reason: "body_too_large",
    });
  });

  it("returns an empty body as zero bytes", async () => {
    const result = await readBodyWithLimit(
      new Request(URL_INGEST, { method: "POST" }),
      LIMIT,
    );
    expect(result.ok && result.bytes.byteLength).toBe(0);
  });

  it("rejects a limit that is not a non-negative safe integer", async () => {
    for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        readBodyWithLimit(new Request(URL_INGEST, { method: "POST" }), limit),
      ).rejects.toThrow();
    }
  });
});
