import { describe, expect, it } from "vitest";

import {
  emptyDocument,
  headingNode,
  newNodeId,
  paragraphNode,
  textNode,
  type CanonicalDocument,
} from "../document";

import {
  buildConflictRecord,
  conflictSummary,
  isResolvedConflict,
  resolveConflict,
  withLatestLocalDocument,
  type ConflictRecord,
} from "./conflict";

const DOC_ID = "11111111-1111-4111-8111-111111111111";

function uuidSeq(prefix = "a"): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

/** A one-paragraph document with `text`, with deterministic node ids. */
function docWithText(text: string, prefix = "a"): CanonicalDocument {
  const empty = emptyDocument(uuidSeq(prefix));
  return {
    ...empty,
    nodes: [paragraphNode(empty.nodes[0].id, [textNode(text)])],
  };
}

function clockSeq(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `2026-09-19T12:00:${String(n).padStart(2, "0")}.000Z`;
  };
}

function record(overrides: Partial<ConflictRecord> = {}): ConflictRecord {
  return {
    documentId: DOC_ID,
    detectedAt: "2026-09-19T12:00:00.000Z",
    localDocument: docWithText("moja verzija", "a"),
    localBaseRevision: 3,
    serverDocument: docWithText("tuđa verzija", "b"),
    serverRevision: 7,
    ...overrides,
  };
}

describe("buildConflictRecord", () => {
  it("keeps both versions and both revisions whole", () => {
    const local = docWithText("moje", "a");
    const server = docWithText("njihovo", "b");

    const built = buildConflictRecord(
      {
        documentId: DOC_ID,
        localDocument: local,
        localBaseRevision: 2,
        serverDocument: server,
        serverRevision: 5,
      },
      () => "2026-09-19T12:00:00.000Z",
    );

    expect(built).toEqual({
      documentId: DOC_ID,
      detectedAt: "2026-09-19T12:00:00.000Z",
      localDocument: local,
      localBaseRevision: 2,
      serverDocument: server,
      serverRevision: 5,
    });
  });

  it("stamps the detection instant from the injected clock", () => {
    const now = clockSeq();
    const first = buildConflictRecord(
      {
        documentId: DOC_ID,
        localDocument: docWithText("a"),
        localBaseRevision: 1,
        serverDocument: null,
        serverRevision: 2,
      },
      now,
    );
    const second = buildConflictRecord(
      {
        documentId: DOC_ID,
        localDocument: docWithText("b"),
        localBaseRevision: 1,
        serverDocument: null,
        serverRevision: 2,
      },
      now,
    );

    expect(first.detectedAt).toBe("2026-09-19T12:00:01.000Z");
    expect(second.detectedAt).toBe("2026-09-19T12:00:02.000Z");
  });

  it("is born unresolved: no decision is ever implied by detection", () => {
    const built = buildConflictRecord({
      documentId: DOC_ID,
      localDocument: docWithText("moje"),
      localBaseRevision: 0,
      serverDocument: docWithText("njihovo"),
      serverRevision: 1,
    });

    expect(built.resolvedVia).toBeUndefined();
    expect(built.resolvedAt).toBeUndefined();
    expect(isResolvedConflict(built)).toBe(false);
  });

  it("accepts a missing server document: a failed fetch is still a conflict", () => {
    const built = buildConflictRecord({
      documentId: DOC_ID,
      localDocument: docWithText("moje"),
      localBaseRevision: 4,
      // The CAS was refused, but the follow-up read did not come back.
      serverDocument: null,
      serverRevision: 9,
    });

    expect(built.serverDocument).toBeNull();
    // The revision is known even when the bytes are not: `stale_base` carries it.
    expect(built.serverRevision).toBe(9);
  });

  it("copies only the fields of the record, not extra keys of the detection", () => {
    const built = buildConflictRecord({
      documentId: DOC_ID,
      localDocument: docWithText("moje"),
      localBaseRevision: 1,
      serverDocument: null,
      serverRevision: 2,
      // Extra keys a caller might carry along must not reach the stored row.
      ...({ resolvedVia: "discard", secret: "x" } as object),
    });

    expect(built.resolvedVia).toBeUndefined();
    expect(Object.keys(built).sort()).toEqual([
      "detectedAt",
      "documentId",
      "localBaseRevision",
      "localDocument",
      "serverDocument",
      "serverRevision",
    ]);
  });
});

describe("resolveConflict — rebase", () => {
  it("keeps my document, based on the server's revision", () => {
    const original = record();
    const result = resolveConflict(original, "rebase", () => "2026-09-19T12:05:00.000Z");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.nextDocument).toBe(original.localDocument);
    expect(result.nextBaseRevision).toBe(7);
    expect(result.journalAction).toBe("save-local");
  });

  it("routes the rebase through the journal, never straight to the server", () => {
    const result = resolveConflict(record(), "rebase");

    expect(result.ok && result.journalAction).toBe("save-local");
  });

  it("is available even when the server document could not be fetched", () => {
    // Keeping my own text destroys nothing: the server's revision log still
    // holds its version, and the CAS refuses the commit if the base moved on.
    const result = resolveConflict(record({ serverDocument: null }), "rebase");

    expect(result.ok).toBe(true);
    expect(result.ok && result.nextBaseRevision).toBe(7);
  });

  it("stamps the decision on a COPY and leaves the original untouched", () => {
    const original = record();
    const result = resolveConflict(original, "rebase", () => "2026-09-19T12:05:00.000Z");

    expect(result.ok && result.record.resolvedVia).toBe("rebase");
    expect(result.ok && result.record.resolvedAt).toBe("2026-09-19T12:05:00.000Z");
    expect(original.resolvedVia).toBeUndefined();
    expect(original.resolvedAt).toBeUndefined();
  });

  it("keeps both versions on the resolved record", () => {
    const original = record();
    const result = resolveConflict(original, "rebase");

    // The constitution's rule: the original conflict stays recorded, which
    // means the version that was NOT chosen is still there afterwards.
    expect(result.ok && result.record.localDocument).toBe(original.localDocument);
    expect(result.ok && result.record.serverDocument).toBe(original.serverDocument);
  });
});

describe("resolveConflict — discard", () => {
  it("adopts the server document at the server revision", () => {
    const original = record();
    const result = resolveConflict(original, "discard");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.nextDocument).toBe(original.serverDocument);
    expect(result.nextBaseRevision).toBe(7);
    expect(result.journalAction).toBe("clear-pending");
  });

  it("is refused while the server document is unknown", () => {
    const result = resolveConflict(record({ serverDocument: null }), "discard");

    expect(result).toEqual({ ok: false, reason: "server-unknown" });
  });

  it("becomes possible again once a later fetch fills the server side in", () => {
    const stale = record({ serverDocument: null });
    expect(resolveConflict(stale, "discard").ok).toBe(false);

    const refreshed: ConflictRecord = {
      ...stale,
      serverDocument: docWithText("stigla verzija", "c"),
      serverRevision: 8,
    };
    const result = resolveConflict(refreshed, "discard");

    expect(result.ok).toBe(true);
    expect(result.ok && result.nextBaseRevision).toBe(8);
  });

  it("keeps the discarded local document on the record", () => {
    const original = record();
    const result = resolveConflict(original, "discard");

    // A discard drops the local change from the sync queue, not from history.
    expect(result.ok && result.record.localDocument).toBe(original.localDocument);
    expect(result.ok && result.record.resolvedVia).toBe("discard");
  });
});

describe("resolveConflict — refusals", () => {
  it("refuses a second decision on an already resolved conflict", () => {
    const resolved = record({
      resolvedVia: "rebase",
      resolvedAt: "2026-09-19T12:05:00.000Z",
    });

    expect(resolveConflict(resolved, "discard")).toEqual({
      ok: false,
      reason: "already-resolved",
    });
    expect(resolveConflict(resolved, "rebase")).toEqual({
      ok: false,
      reason: "already-resolved",
    });
  });

  it("refuses a resolution it does not recognise", () => {
    const result = resolveConflict(record(), "merge" as never);

    expect(result).toEqual({ ok: false, reason: "unknown-resolution" });
  });

  it("checks the resolution before the record's state", () => {
    const resolved = record({ resolvedVia: "discard" });

    expect(resolveConflict(resolved, "" as never)).toEqual({
      ok: false,
      reason: "unknown-resolution",
    });
  });

  it("never mutates the record it refuses", () => {
    const stale = record({ serverDocument: null });
    resolveConflict(stale, "discard");

    expect(stale.resolvedVia).toBeUndefined();
    expect(stale.resolvedAt).toBeUndefined();
  });
});

describe("isResolvedConflict", () => {
  it("is false for a fresh record and true once a decision is stamped", () => {
    const fresh = record();
    expect(isResolvedConflict(fresh)).toBe(false);

    const result = resolveConflict(fresh, "rebase");
    expect(result.ok && isResolvedConflict(result.record)).toBe(true);
  });

  it("ignores a stored value that is not one of the two resolutions", () => {
    // Stored data is data: a row damaged or written by another build must not
    // be able to claim a decision the machine does not have.
    const damaged = record({ resolvedVia: "auto" as never });

    expect(isResolvedConflict(damaged)).toBe(false);
    expect(resolveConflict(damaged, "rebase").ok).toBe(true);
  });
});

describe("conflictSummary", () => {
  it("counts blocks and words in each version", () => {
    const local: CanonicalDocument = {
      ...emptyDocument(uuidSeq("a")),
      nodes: [
        headingNode(newNodeId(uuidSeq("c")), 1, [textNode("Naslov rada")]),
        paragraphNode(newNodeId(uuidSeq("d")), [textNode("Prvi odlomak teksta")]),
      ],
    };
    const summary = conflictSummary(record({ localDocument: local }));

    expect(summary.local).toEqual({ nodes: 2, words: 5 });
    expect(summary.server).toEqual({ nodes: 1, words: 2 });
  });

  it("reports that the content is identical when only node ids differ", () => {
    // Same text, different ids: the honest answer for a human reader is "the
    // same thing", even though the canonical documents are not equal.
    const summary = conflictSummary(
      record({
        localDocument: docWithText("isti tekst", "a"),
        serverDocument: docWithText("isti tekst", "b"),
      }),
    );

    expect(summary.contentEqual).toBe(true);
    expect(summary.local).toEqual(summary.server);
  });

  it("reports differing content as differing", () => {
    expect(conflictSummary(record()).contentEqual).toBe(false);
  });

  it("never claims equality while the server version is unknown", () => {
    const summary = conflictSummary(record({ serverDocument: null }));

    expect(summary.serverAvailable).toBe(false);
    expect(summary.server).toBeNull();
    // "We did not look" is not "they are the same".
    expect(summary.contentEqual).toBe(false);
  });

  it("still counts the local version when the server side is missing", () => {
    const summary = conflictSummary(
      record({ localDocument: docWithText("jedan dva tri"), serverDocument: null }),
    );

    expect(summary.local).toEqual({ nodes: 1, words: 3 });
  });

  it("counts an empty document as one block and no words", () => {
    const summary = conflictSummary(
      record({
        localDocument: emptyDocument(uuidSeq("a")),
        serverDocument: emptyDocument(uuidSeq("b")),
      }),
    );

    expect(summary.local).toEqual({ nodes: 1, words: 0 });
    expect(summary.contentEqual).toBe(true);
  });

  it("does not fuse words across blocks", () => {
    const empty = emptyDocument(uuidSeq("a"));
    const two: CanonicalDocument = {
      ...empty,
      nodes: [
        paragraphNode(empty.nodes[0].id, [textNode("kraj")]),
        paragraphNode(newNodeId(uuidSeq("e")), [textNode("početak")]),
      ],
    };

    expect(conflictSummary(record({ localDocument: two })).local).toEqual({
      nodes: 2,
      words: 2,
    });
  });

  it("is a reading aid only: it resolves nothing", () => {
    // Even identical content leaves the record unresolved — the author still
    // has to choose. This is the constitution's "no silent last-write-wins".
    const identical = record({
      localDocument: docWithText("isto", "a"),
      serverDocument: docWithText("isto", "b"),
    });

    expect(conflictSummary(identical).contentEqual).toBe(true);
    expect(isResolvedConflict(identical)).toBe(false);
  });
});

describe("withLatestLocalDocument", () => {
  it("advances 'my version' to the newest durable local text", () => {
    // The author kept typing between the refused commit and the editor going
    // read-only; that text is journalled and is what a rebase must keep.
    const newer = docWithText("moja verzija, dopunjena", "c");
    const effective = withLatestLocalDocument(record(), newer);

    expect(effective.localDocument).toBe(newer);
    const resolution = resolveConflict(effective, "rebase");
    expect(resolution.ok && resolution.nextDocument).toBe(newer);
  });

  it("leaves the stored record untouched — it stays the evidence", () => {
    const original = record();
    const before = original.localDocument;
    withLatestLocalDocument(original, docWithText("nešto novije", "c"));

    expect(original.localDocument).toBe(before);
  });

  it("returns the record itself when there is nothing newer", () => {
    const original = record();

    expect(withLatestLocalDocument(original, null)).toBe(original);
    expect(withLatestLocalDocument(original, undefined)).toBe(original);
    expect(withLatestLocalDocument(original, original.localDocument)).toBe(original);
  });

  it("treats a structurally identical document as nothing newer", () => {
    const original = record();
    const copy: CanonicalDocument = JSON.parse(JSON.stringify(original.localDocument));

    expect(withLatestLocalDocument(original, copy)).toBe(original);
  });

  it("makes the panel count the text the author actually has", () => {
    const newer = docWithText("jedan dva tri četiri", "c");
    const summary = conflictSummary(withLatestLocalDocument(record(), newer));

    expect(summary.local).toEqual({ nodes: 1, words: 4 });
  });

  it("keeps the server side and both revisions exactly as recorded", () => {
    const original = record();
    const effective = withLatestLocalDocument(original, docWithText("novije", "c"));

    expect(effective.serverDocument).toBe(original.serverDocument);
    expect(effective.serverRevision).toBe(original.serverRevision);
    expect(effective.localBaseRevision).toBe(original.localBaseRevision);
    expect(effective.detectedAt).toBe(original.detectedAt);
  });
});
