import { describe, expect, it } from "vitest";

import { applicationOrigin, evidenceIngestDeps } from "./ingest-deps";

describe("evidence ingest dependencies", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["ne-url", null],
    ["file:///tmp/callback", null],
    ["http://localhost:3000/api/auth/callback", "http://localhost:3000"],
  ])("takes the expected origin from OIDC_REDIRECT_URI %j", (value, expected) => {
    expect(applicationOrigin({ OIDC_REDIRECT_URI: value })).toBe(expected);
  });

  it("builds one signer and one storage router per process", () => {
    const first = evidenceIngestDeps();
    const second = evidenceIngestDeps();
    expect(second.signer).toBe(first.signer);
    expect(second.payloads).toBe(first.payloads);
  });
});
