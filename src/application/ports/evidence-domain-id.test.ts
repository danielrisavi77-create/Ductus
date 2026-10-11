import { describe, expect, it } from "vitest";

import { fromHex, loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { isEvidenceIngestCommandV2, isEvidenceSegmentDescriptorV2 } from "./evidence-ingest";

/**
 * The evidence domain of a receipt is set by the server, from the package and
 * the institution of the actor (plan supplement 6105090985 on issue 202, D2).
 * A client that names one is refused, wherever in the command it puts it.
 */
const { chain, receiptV2 } = loadGoldenVectors();
const [vector] = chain.segments;
const command = {
  clientRequestId: vector.clientRequestId,
  descriptor: vector.descriptor,
  canonicalPayload: new TextDecoder().decode(fromHex(vector.canonicalUtf8Hex)),
};

describe("evidence domain id sent by a client (D2)", () => {
  it("accepts the command as the client builds it", () => {
    expect(isEvidenceSegmentDescriptorV2(command.descriptor)).toBe(true);
    expect(isEvidenceIngestCommandV2(command)).toBe(true);
  });

  it.each(["evidenceDomainId", "evidence_domain_id", "domainId"])("refuses %s in the descriptor", (field) => {
    const descriptor = { ...command.descriptor, [field]: receiptV2.evidenceDomainId };
    expect(isEvidenceSegmentDescriptorV2(descriptor)).toBe(false);
    expect(isEvidenceIngestCommandV2({ ...command, descriptor })).toBe(false);
  });

  it.each(["evidenceDomainId", "evidence_domain_id", "domainId"])("refuses %s next to the descriptor", (field) => {
    expect(isEvidenceIngestCommandV2({ ...command, [field]: receiptV2.evidenceDomainId })).toBe(false);
  });
});
