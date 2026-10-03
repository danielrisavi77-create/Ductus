import { describe, expect, it } from "vitest";

import { emptyDocument, paragraphNode, newNodeId, type CanonicalDocument } from "../document";
import { LOAD_FAILURE_MESSAGE, resolveInitialDocument } from "./bootstrap";

const JOURNAL_ID = "11111111-1111-4111-8111-111111111111";
const SERVER_ID = "22222222-2222-4222-8222-222222222222";

function docWith(id: string): CanonicalDocument {
  return { schemaVersion: 1, nodes: [paragraphNode(newNodeId(() => id))] };
}

describe("resolveInitialDocument", () => {
  const journal = { document: docWith(JOURNAL_ID), revision: 4 };
  const server = { document: docWith(SERVER_ID), revision: 9 };

  it("prefers the journal snapshot and keeps ITS base revision", () => {
    expect(resolveInitialDocument(journal, server)).toEqual({
      mode: "edit",
      document: journal.document,
      revision: 4,
      from: "journal",
    });
  });

  it("never takes the server revision for a journal document", () => {
    const resolved = resolveInitialDocument(journal, server);
    expect(resolved.mode === "edit" && resolved.revision).toBe(4);
    expect(resolved.mode === "edit" && resolved.revision).not.toBe(server.revision);
  });

  it("falls back to the canonical server document at its own revision", () => {
    expect(resolveInitialDocument(null, server)).toEqual({
      mode: "edit",
      document: server.document,
      revision: 9,
      from: "server",
    });
  });

  it("uses the journal even when the server could not be read", () => {
    expect(resolveInitialDocument(journal, null)).toEqual({
      mode: "edit",
      document: journal.document,
      revision: 4,
      from: "journal",
    });
  });

  it("errors rather than opening an empty document when neither source answered", () => {
    expect(resolveInitialDocument(null, null)).toEqual({ mode: "error" });
    expect(resolveInitialDocument(undefined, undefined)).toEqual({ mode: "error" });
  });

  it("never invents an empty document as a fallback", () => {
    const resolved = resolveInitialDocument(null, null);
    expect(resolved).not.toHaveProperty("document");
    expect(JSON.stringify(resolved)).not.toContain(JSON.stringify(emptyDocument(() => JOURNAL_ID)));
  });

  it("accepts revision 0 as a real revision, not a missing one", () => {
    const fresh = { document: docWith(SERVER_ID), revision: 0 };
    expect(resolveInitialDocument(null, fresh)).toEqual({
      mode: "edit",
      document: fresh.document,
      revision: 0,
      from: "server",
    });
  });

  it("does not copy or rebuild the document it selects", () => {
    const resolved = resolveInitialDocument(null, server);
    expect(resolved.mode === "edit" && resolved.document).toBe(server.document);
  });

  it("states the load failure in Croatian", () => {
    expect(LOAD_FAILURE_MESSAGE).toBe("Ne mogu učitati dokument. Osvježi stranicu.");
    expect(LOAD_FAILURE_MESSAGE.toLowerCase()).not.toContain("spremljeno");
  });
});
