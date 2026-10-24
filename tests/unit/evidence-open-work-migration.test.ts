import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
import { REVISION_ZERO_JCS, revisionZeroDocument } from "@/domain/document/revision-zero";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import { EVIDENCE_PROFILE_ID } from "@/domain/forensics/evidence-profile";
import { canonicalizeJcs } from "@/domain/forensics/jcs";

// B-8 step 2 / DAN-83: app.open_student_work writes revision 0, the capture
// profile and the payload limit as SQL literals. pgTAP checks the stored
// bytes and hash against the same literals (db/tests/046-evidence-open-work.sql);
// this keeps the migration and the TypeScript constants from drifting apart.
const MIGRATION = "20261019150000_evidence_open_work.sql";
const TEXT = readFileSync(new URL(`../../db/migrations/${MIGRATION}`, import.meta.url), "utf8");
const UP = TEXT.slice(0, TEXT.indexOf("-- migrate:down"));

describe("open_student_work migration", () => {
  it("stores the revision 0 bytes of src/domain/document/revision-zero.ts", () => {
    expect(UP).toContain(`'${REVISION_ZERO_JCS}'::text`);
  });

  it("gives the package the shared capture profile and the D-96 payload limit", () => {
    expect(UP).toContain(`v_actor.user_id, '${EVIDENCE_PROFILE_ID}', ${MAX_EVIDENCE_SEGMENT_BYTES}`);
  });
});

describe("revision 0 through the editor's replayer", () => {
  it("loads and returns the same canonical bytes, so B-12 starts from them", () => {
    const replayer = createEditStepsV1Replayer();
    const loaded = replayer.load(revisionZeroDocument());
    expect(canonicalizeJcs(replayer.toCanonical(loaded))).toBe(REVISION_ZERO_JCS);
  });
});
