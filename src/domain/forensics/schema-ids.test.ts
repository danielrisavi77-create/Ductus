import { describe, expect, it } from "vitest";

import { EVIDENCE_RECEIPT_SCHEMA_V1 } from "./evidence-receipt";
import { EVIDENCE_SEGMENT_SCHEMA_V2 } from "./evidence-segment-v2";

// The ids enter the canonical bytes that are hashed and signed (D-88).
describe("evidence schema ids", () => {
  it("use the ductus-evidence prefix", () => {
    expect(EVIDENCE_SEGMENT_SCHEMA_V2).toBe("ductus-evidence-segment-v2");
    expect(EVIDENCE_RECEIPT_SCHEMA_V1).toBe("ductus-evidence-receipt-v1");
  });
});
