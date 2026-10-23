import { describe, expect, it } from "vitest";

import type { ActorTransaction } from "@/server/db/with-actor";

import { readEvidenceDomainKeys } from "./evidence-domain-keys";

// Invented domain and key; the SPKI is 32 repeated bytes, not a key anyone holds.
const DOMAIN = "00000000-0000-4000-8000-0000000000d1";
const ROW = {
  key_id: "dev-ed25519-0011223344556677",
  key_version: "spki-sha256-" + "a".repeat(64),
  evidence_domain_id: DOMAIN,
  purpose: "receipt",
  algorithm: "Ed25519",
  key_base64url: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.alloc(32, 0x11)]).toString("base64url"),
  valid_from: "2026-10-19T05:00:00.000Z",
  valid_to: null,
  revoked_at: null,
};

function tx(rows: unknown[]) {
  const calls: unknown[][] = [];
  const handle: ActorTransaction = {
    async query(text, values) {
      calls.push([text, values]);
      return { rows: rows as never[], rowCount: rows.length };
    },
  };
  return { handle, calls };
}

describe("readEvidenceDomainKeys", () => {
  it("maps every row of the domain to a verifier key entry, asking only for that domain", async () => {
    const retired = { ...ROW, key_id: "k2", valid_to: "2026-10-20T00:00:00.000Z", revoked_at: "2026-10-19T06:01:02.345Z" };
    const { handle, calls } = tx([ROW, retired]);
    expect(await readEvidenceDomainKeys(handle, DOMAIN)).toEqual({
      status: "ok",
      keys: [
        {
          algorithm: "Ed25519",
          keyId: ROW.key_id,
          keyVersion: ROW.key_version,
          encoding: "spki-der",
          keyBase64Url: ROW.key_base64url,
          evidenceDomainId: DOMAIN,
          purpose: "receipt",
          validFrom: ROW.valid_from,
          validTo: null,
          revokedAt: null,
        },
        expect.objectContaining({ keyId: "k2", validTo: retired.valid_to, revokedAt: retired.revoked_at }),
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual([DOMAIN]);
  });

  it("gives an empty list when RLS shows no key", async () => {
    expect(await readEvidenceDomainKeys(tx([]).handle, DOMAIN)).toEqual({ status: "ok", keys: [] });
  });

  it.each([
    ["another domain", { evidence_domain_id: "00000000-0000-4000-8000-0000000000d2" }],
    ["an unknown purpose", { purpose: "log" }],
    ["another algorithm", { algorithm: "RSA_PSS_SHA256" }],
    ["an empty key id", { key_id: "" }],
    ["no start of validity", { valid_from: null }],
    ["a Date instead of text", { valid_to: new Date(0) }],
  ])("makes the whole list unavailable for a row with %s", async (_, change) => {
    const result = await readEvidenceDomainKeys(tx([ROW, { ...ROW, key_id: "k2", ...change }]).handle, DOMAIN);
    expect(result).toEqual({ status: "unavailable", reason: "domain_keys_malformed" });
  });

  it("asks nothing for a domain id that is not a lowercase UUID v4", async () => {
    const { handle, calls } = tx([ROW]);
    expect(await readEvidenceDomainKeys(handle, DOMAIN.toUpperCase())).toEqual({
      status: "unavailable",
      reason: "domain_keys_malformed",
    });
    expect(calls).toHaveLength(0);
  });
});
