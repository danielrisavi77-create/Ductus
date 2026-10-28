import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// B-8 step 3 / DAN-83: the down migration puts back the acceptance of
// 20261017130000 as it was, so a local rollback restores the earlier
// contract exactly. The copy is checked here instead of by eye.
function migration(name: string): string {
  return readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url), "utf8");
}
const EARLIER = migration("20261017130000_evidence_acceptance.sql");
const STEP_3 = migration("20261019170000_evidence_acceptance_signature.sql");
const DOWN = STEP_3.slice(STEP_3.indexOf("-- migrate:down"));

function acceptanceOf(text: string): string {
  const start = text.indexOf("CREATE FUNCTION app.commit_evidence_segment(");
  const end = text.indexOf("  TO ductus_app;", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("acceptance signature migration", () => {
  it("restores the earlier acceptance verbatim on the way down", () => {
    expect(acceptanceOf(DOWN)).toBe(acceptanceOf(EARLIER));
  });
});
