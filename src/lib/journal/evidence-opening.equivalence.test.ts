// @vitest-environment node
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { newNodeId, paragraphNode, textNode, type CanonicalDocument } from "../../domain/document";
import { canonicalizeJcs } from "../../domain/forensics/jcs";
import type { EvidenceOpening } from "../../domain/sync/journal-types";
import { DOC, journalKit, PROFILE, R0, raw, UTC } from "../sync/evidence-test-kit";
import { JournalError, type AtomicDexieJournal } from "./atomic-dexie-journal";

/**
 * M0.1 (DAN-376, #1071): query case of the core port that had no Ductus test
 * (map: docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md): a stored
 * document the canonical model cannot read, sent with its correct hash.
 * Every text here is invented.
 */

const kit = journalKit("b");
afterEach(kit.cleanup);

const VALID: CanonicalDocument = {
  schemaVersion: 1,
  nodes: [paragraphNode(newNodeId(() => "cccccccc-0000-4000-8000-000000000001"), [textNode("Izmišljeni otvoreni tekst")])],
};

/** An open answer for `bytes` whose documentHash is the true hash of those bytes. */
function openingOf(bytes: Uint8Array): EvidenceOpening {
  return {
    documentId: DOC, currentRevision: R0, documentHash: createHash("sha256").update(bytes).digest("hex"),
    headSegmentHash: null, lastSequenceTo: 0, document: bytes, evidenceProfileId: PROFILE,
  };
}
const encoded = (text: string) => new TextEncoder().encode(text);

async function stored(journal: AtomicDexieJournal) {
  const db = raw(journal);
  return {
    snapshots: await db.table("snapshots").toArray(),
    pending: await db.table("pending").toArray(),
    meta: await db.table("meta").toArray(),
  };
}

describe("M0.1 queries: a stored document the model cannot read", () => {
  it("7: the control case, a canonical document with its hash, opens", async () => {
    const journal = kit.open();
    await journal.startEvidence(DOC, openingOf(encoded(canonicalizeJcs(VALID))), UTC);
    expect((await journal.readEvidence(DOC)).snapshot?.document).toEqual(VALID);
  });

  it.each([
    ["an unknown schema version", canonicalizeJcs({ ...VALID, schemaVersion: 9 })],
    ["nodes that are not a list", canonicalizeJcs({ nodes: "smeće", schemaVersion: 1 })],
    ["an unknown node type", canonicalizeJcs({ nodes: [{ type: "izmišljeni-čvor" }], schemaVersion: 1 })],
    ["valid JSON that is not JCS", JSON.stringify(VALID, null, 2)],
    ["bytes that are not JSON", "{\"schemaVersion\":1,"],
  ])("7: %s with a correct documentHash is invalid_input and writes nothing", async (_label, text) => {
    const journal = kit.open();
    const before = await stored(journal);
    const error = await journal.startEvidence(DOC, openingOf(encoded(text)), UTC)
      .then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(JournalError);
    expect(error).toMatchObject({ code: "invalid_input" });
    expect(await stored(journal)).toEqual(before);
    expect(await journal.readEvidence(DOC)).toMatchObject({ snapshot: null, pending: [], meta: null });
  });
});
