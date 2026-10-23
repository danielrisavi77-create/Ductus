import { describe, expect, it } from "vitest";

import { REVISION_ZERO_JCS, REVISION_ZERO_SHA256 } from "./revision-zero";
import { MAX_DOCUMENT_SNAPSHOT_BYTES, verifyDocumentSnapshot } from "./snapshot";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("verifyDocumentSnapshot", () => {
  it("accepts the exact JCS bytes of a valid document and hashes those bytes", async () => {
    const result = await verifyDocumentSnapshot(bytes(REVISION_ZERO_JCS));
    expect(result).toMatchObject({ ok: true, text: REVISION_ZERO_JCS, sha256: REVISION_ZERO_SHA256 });
    expect(result.ok && result.document.schemaVersion).toBe(1);
  });

  it("is 2 MiB, the bound of the checkpoint column", () => {
    expect(MAX_DOCUMENT_SNAPSHOT_BYTES).toBe(2_097_152);
  });

  it.each([
    ["a byte order mark", new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(REVISION_ZERO_JCS)])],
    ["a text that is not JCS", bytes(JSON.stringify(JSON.parse(REVISION_ZERO_JCS), null, 1))],
    ["keys out of JCS order", bytes('{"schemaVersion":1,"nodes":[{"children":[],"id":"00000000-0000-4000-8000-000000000000","type":"paragraph"}]}')],
    ["invalid UTF-8", new Uint8Array([0x7b, 0xff, 0x7d])],
    ["JSON that is no document", bytes('{"nodes":[],"schemaVersion":2}')],
    ["no JSON", bytes("izmisljeni tekst")],
    ["nothing", new Uint8Array()],
  ])("refuses %s as invalid", async (_, input) => {
    expect(await verifyDocumentSnapshot(input)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a snapshot over the limit before reading it, and judges one at the limit by its content", async () => {
    expect(await verifyDocumentSnapshot(new Uint8Array(MAX_DOCUMENT_SNAPSHOT_BYTES + 1))).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(await verifyDocumentSnapshot(new Uint8Array(MAX_DOCUMENT_SNAPSHOT_BYTES))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses a value that is no byte array", async () => {
    expect(await verifyDocumentSnapshot(REVISION_ZERO_JCS as unknown as Uint8Array)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
