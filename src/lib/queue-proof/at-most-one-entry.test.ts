import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Temporary probe for the Mergify queue acceptance (DAN-263). Each probe PR
// adds one entry file next to this test; one entry passes, two entries fail.
describe("queue acceptance probe", () => {
  it("has at most one entry file", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const entries = readdirSync(here).filter((name) => name.endsWith(".entry"));
    expect(entries.length).toBeLessThanOrEqual(1);
  });
});
