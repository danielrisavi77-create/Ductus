import { fc, test } from "@fast-check/vitest";
import { describe, expect, it, vi } from "vitest";

import { NOTICE_TEMPLATE_VERSION } from "@/domain/notice/fingerprint";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { handleAcknowledgment } from "./acknowledgment-route";

// DAN-306 M2.13-P02b (#1502 B1-B4, B7-B9, E3): the route takes the
// fingerprint of the notice the browser showed and never records an
// acknowledgment of a text the student did not see.
const ORIGIN = "http://localhost:3000";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "A".repeat(43);
const FP = "0123456789abcdef".repeat(4);
const OTHER = "f".repeat(64);
const AT = new Date("2026-11-06T09:14:00.000Z");

type Stub = { stored?: string | null; error?: { code: string }; current?: number };

function actor(stub: Stub = {}) {
  const calls: { text: string; values: unknown[] }[] = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    if (text.includes("acknowledge_notice")) {
      if (stub.error) throw Object.assign(new Error("private SQL and input"), stub.error);
      return { rows: [{ acknowledged_at: AT }], rowCount: 1 };
    }
    if (text.includes("notice_fingerprint")) {
      return { rows: stub.stored === undefined ? [{ notice_fingerprint: FP }] : [{ notice_fingerprint: stub.stored }], rowCount: 1 };
    }
    if (text.includes("current_version")) return { rows: [{ current_version: stub.current ?? 3 }], rowCount: 1 };
    throw new Error(`unexpected query ${text}`);
  });
  const withActor = vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, calls };
}

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/institution/assignments/${ID}/acknowledgment`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body,
  });
}

async function post(body: string, stub: Stub = {}, headers: Record<string, string> = {}) {
  const { withActor, calls } = actor(stub);
  const response = await handleAcknowledgment(request(body, headers), ID, { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN });
  return { status: response.status, body: await response.json() as Record<string, string>, calls };
}

const valid = (fingerprint: unknown = FP, versionNo: unknown = 3) => JSON.stringify({ versionNo, fingerprint });

describe("DAN-306 acknowledgment with the notice fingerprint", () => {
  it("B1: records with the server's template version and answers the database time", async () => {
    const { status, body, calls } = await post(valid());
    expect([status, body]).toEqual([200, { acknowledgedAt: AT.toISOString() }]);
    expect(calls[0]!.values).toEqual([ID, 3, NOTICE_TEMPLATE_VERSION]);
    expect(calls[1]!.text).toMatch(/student_id = app\.current_user_id\(\)/);
    expect(calls[1]!.values).toEqual([ID, 3]);
  });

  it.each([
    ["another fingerprint", OTHER],
    ["no fingerprint on an older row", null],
  ])("B2/E3: %s rolls the acknowledgment back and says the notice changed", async (_name, stored) => {
    const { withActor } = actor({ stored });
    const rolledBack = vi.fn();
    const guarded = (async (token: string, fn: (tx: ActorTransaction) => Promise<unknown>) => {
      try {
        return await withActor(token, fn);
      } catch (error) {
        rolledBack();
        throw error;
      }
    }) as WithActor;
    const response = await handleAcknowledgment(request(valid()), ID, { withActor: guarded, expectedOrigin: ORIGIN, sessionToken: TOKEN });
    expect([response.status, await response.json()]).toEqual([409, { error: "notice_changed" }]);
    expect(rolledBack).toHaveBeenCalledOnce();
  });

  it("B6: ZD409 for a version that is no longer current stays a version conflict", async () => {
    const { status, body } = await post(valid(FP, 2), { error: { code: "ZD409" }, current: 3 });
    expect([status, body]).toEqual([409, { error: "conflict" }]);
  });

  it("ZD409 on the current version is another fingerprint, not another version", async () => {
    const { status, body } = await post(valid(FP, 3), { error: { code: "ZD409" }, current: 3 });
    expect([status, body]).toEqual([409, { error: "notice_changed" }]);
  });

  it("ZD409 with the version unreadable keeps today's answer", async () => {
    const { withActor } = actor({ error: { code: "ZD409" } });
    let calls = 0;
    const flaky = (async (token: string, fn: (tx: ActorTransaction) => Promise<unknown>) => {
      calls += 1;
      if (calls > 1) throw new Error("outage");
      return withActor(token, fn);
    }) as WithActor;
    const response = await handleAcknowledgment(request(valid()), ID, { withActor: flaky, expectedOrigin: ORIGIN, sessionToken: TOKEN });
    expect([response.status, await response.json()]).toEqual([409, { error: "conflict" }]);
  });

  it.each([["ZD401", 401, "unauthorized"], ["ZD403", 403, "forbidden"], ["XX000", 503, "unavailable"]] as const)(
    "B6: %s stays HTTP %i", async (code, status, error) => {
      expect(await post(valid(), { error: { code } })).toMatchObject({ status, body: { error } });
    },
  );

  // #1502 B3: one row per input class; none reaches the database.
  it.each([
    ["uppercase", FP.toUpperCase()],
    ["63 characters", FP.slice(1)],
    ["65 characters", `${FP}0`],
    ["a non-hex g", `g${FP.slice(1)}`],
    ["a sha256: prefix", `sha256:${FP}`],
    ["a 0x prefix", `0x${FP}`],
    ["a leading space", ` ${FP.slice(1)}`],
    ["a trailing space", `${FP} `],
    ["null", null],
    ["a number", 1],
    ["an array", [FP]],
    ["an object", { value: FP }],
    ["true", true],
    ["an empty string", ""],
    ["full-width digits", "０".repeat(64)],
  ])("B3: a fingerprint as %s is refused with 422", async (_name, fingerprint) => {
    const { status, body, calls } = await post(valid(fingerprint));
    expect([status, body]).toEqual([422, { error: "invalid_input" }]);
    expect(calls).toEqual([]);
  });

  // singleKeys is a deliberately strict rule for this one body, not a general
  // JSON parser: any backslash, or any quote count other than the six that
  // {"versionNo":n,"fingerprint":"hex"} has, is refused, which also refuses a
  // repeated or escaped key. A canonical JSON.stringify comparison would be
  // exact too, but would refuse whitespace and either key order (last test).
  it.each([
    ["B4: only the version, as an old client sends", JSON.stringify({ versionNo: 3 })],
    ["an unknown extra key", JSON.stringify({ versionNo: 3, fingerprint: FP, studentId: ID })],
    ["a repeated fingerprint key", `{"versionNo":3,"fingerprint":"${OTHER}","fingerprint":"${FP}"}`],
    ["a repeated version key", `{"versionNo":2,"versionNo":3,"fingerprint":"${FP}"}`],
    ["an escaped repeat of the key", `{"versionNo":3,"fingerprint":"${OTHER}","fingerpr\\u0069nt":"${FP}"}`],
    ["an escaped key alone", `{"versionNo":3,"fingerpr\\u0069nt":"${FP}"}`],
    ["version 0", valid(FP, 0)],
    ["version -1", valid(FP, -1)],
    ["version 2147483648", valid(FP, 2_147_483_648)],
    ["version 1.5", valid(FP, 1.5)],
    ["version \"1\"", valid(FP, "1")],
  ])("%s is refused with 422", async (_name, body) => {
    const result = await post(body);
    expect([result.status, result.body]).toEqual([422, { error: "invalid_input" }]);
    expect(result.calls).toEqual([]);
  });

  it("accepts whitespace and either key order in a single-key body", async () => {
    expect((await post(` { "fingerprint" : "${FP}" ,\n "versionNo" : 3 } `)).status).toBe(200);
  });

  it("B7: no error body repeats the fingerprint, the instructions or the database message", async () => {
    for (const result of [
      await post(valid(`${FP}0`)),
      await post(valid(), { stored: OTHER }),
      await post(valid(), { error: { code: "XX000" } }),
      await post(valid(), { error: { code: "ZD409" } }),
    ]) {
      const text = JSON.stringify(result.body);
      expect(Object.keys(result.body)).toEqual(["error"]);
      expect(text).not.toContain(FP.slice(0, 16));
      expect(text).not.toMatch(/private|SQL/);
    }
  });

  it("B8: an oversize body and a body that is not strict UTF-8 keep today's answers", async () => {
    const padded = `{"versionNo":3,"fingerprint":"${FP}"${" ".repeat(1024)}}`;
    expect((await post(padded)).status).toBe(413);
    const { withActor } = actor();
    const bytes = new Uint8Array([...new TextEncoder().encode(`{"versionNo":3,"fingerprint":"${FP.slice(1)}`), 0xff, 0x22, 0x7d]);
    const response = await handleAcknowledgment(
      new Request(`${ORIGIN}/x`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: bytes }),
      ID, { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN },
    );
    expect([response.status, await response.json()]).toEqual([400, { error: "invalid_json" }]);
  });

  it("B9: a wrong content type and a cross-site origin are refused before the body is read", async () => {
    expect((await post(valid(), {}, { "content-type": "text/plain" })).status).toBe(415);
    const crossSite = await post(valid(), {}, { origin: "https://other.example", "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);
    expect(crossSite.calls).toEqual([]);
  });
});

test.prop([fc.string({ maxLength: 80 }).filter((s) => !/^[0-9a-f]{64}$/.test(s))])(
  "B3: any string that is not 64 lowercase hex digits is refused without a database call",
  async (fingerprint) => {
    const body = valid(fingerprint);
    if (new TextEncoder().encode(body).length > 1024) return;
    const result = await post(body);
    expect(result.status).toBe(422);
    expect(result.calls).toEqual([]);
  },
);

test.prop([fc.stringMatching(/^[0-9a-f]{64}$/), fc.integer({ min: 1, max: 2_147_483_647 })])(
  "B1: any well-formed fingerprint reaches the comparison unchanged",
  async (fingerprint, versionNo) => {
    const result = await post(valid(fingerprint, versionNo), { stored: fingerprint });
    expect(result.status).toBe(200);
    expect(result.calls[0]!.values).toEqual([ID, versionNo, NOTICE_TEMPLATE_VERSION]);
  },
);
