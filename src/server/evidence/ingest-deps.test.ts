import { describe, expect, it } from "vitest";

import { evidenceIngestDeps } from "./ingest-deps";

// The expected origin of the ingest routes is expectedOrigin from
// src/server/auth/config.ts now (DAN-302 L3); its cases moved to config.test.ts.
describe("evidence ingest dependencies", () => {
  it("builds one signer and one storage router per process", () => {
    const first = evidenceIngestDeps();
    const second = evidenceIngestDeps();
    expect(second.signer).toBe(first.signer);
    expect(second.payloads).toBe(first.payloads);
  });
});
