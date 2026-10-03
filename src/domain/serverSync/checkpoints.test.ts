import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_NAME_MAX_LENGTH,
  CHECKPOINT_STATUSES,
  UNSYNCED_CHANGES_NOTE,
  checkpointCreatedMessage,
  checkpointNameErrorCode,
  formatCheckpointDate,
  parseCheckpointList,
  parseCheckpointOutcome,
  parseCheckpointRow,
  validateCheckpointName,
} from "./checkpoints";

describe("validateCheckpointName", () => {
  it("trims the author's name without rewriting it", () => {
    expect(validateCheckpointName("  Prije lekture  ")).toEqual({
      ok: true,
      value: "Prije lekture",
    });
  });

  it("preserves inner whitespace, which is the author's", () => {
    expect(validateCheckpointName("Treće  poglavlje")).toEqual({
      ok: true,
      value: "Treće  poglavlje",
    });
  });

  it("refuses a name that is empty once trimmed", () => {
    for (const input of ["", "   ", "\n\t "]) {
      expect(validateCheckpointName(input)).toEqual({ ok: false, reason: "empty" });
    }
  });

  it("refuses anything that is not a string at all", () => {
    for (const input of [null, undefined, 7, {}, ["a"]]) {
      expect(validateCheckpointName(input)).toEqual({ ok: false, reason: "empty" });
    }
  });

  it("accepts exactly the maximum length and refuses one more", () => {
    const atLimit = "n".repeat(CHECKPOINT_NAME_MAX_LENGTH);
    expect(validateCheckpointName(atLimit)).toEqual({ ok: true, value: atLimit });
    expect(validateCheckpointName(`${atLimit}n`)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("counts code points, so Postgres will not refuse what this accepts", () => {
    // 120 code points, 240 UTF-16 units: `.length` would call this too long.
    const emoji = "🙂".repeat(CHECKPOINT_NAME_MAX_LENGTH);
    expect(validateCheckpointName(emoji).ok).toBe(true);
    expect(validateCheckpointName(`${emoji}🙂`).ok).toBe(false);
  });

  it("maps each rejection to its own Croatian error code", () => {
    expect(checkpointNameErrorCode("empty")).toBe("naziv-prazan");
    expect(checkpointNameErrorCode("too_long")).toBe("naziv-dug");
  });
});

describe("parseCheckpointOutcome", () => {
  it("reads a created checkpoint", () => {
    expect(
      parseCheckpointOutcome({
        status: "created",
        checkpointId: "33333333-3333-4333-8333-333333333333",
        revision: 7,
      }),
    ).toEqual({
      status: "created",
      checkpointId: "33333333-3333-4333-8333-333333333333",
      revision: 7,
    });
  });

  it("accepts revision 0 — a document with nothing committed yet", () => {
    expect(
      parseCheckpointOutcome({ status: "created", checkpointId: "a", revision: 0 }),
    ).toEqual({ status: "created", checkpointId: "a", revision: 0 });
  });

  it("reads the payload-free statuses", () => {
    for (const status of ["not_found", "unauthenticated", "invalid_name"] as const) {
      expect(parseCheckpointOutcome({ status })).toEqual({ status });
    }
  });

  it("covers every status the RPC declares", () => {
    for (const status of CHECKPOINT_STATUSES) {
      const raw =
        status === "created"
          ? { status, checkpointId: "a", revision: 1 }
          : { status };
      expect(parseCheckpointOutcome(raw).status).toBe(status);
    }
  });

  it("refuses a created answer with no usable id", () => {
    for (const checkpointId of ["", 7, null, undefined, {}]) {
      expect(
        parseCheckpointOutcome({ status: "created", checkpointId, revision: 1 }).status,
      ).toBe("invalid");
    }
  });

  it("refuses a revision that a later call could not rely on", () => {
    for (const revision of [-1, 1.5, "2", null, undefined, Number.POSITIVE_INFINITY]) {
      expect(
        parseCheckpointOutcome({ status: "created", checkpointId: "a", revision }).status,
      ).toBe("invalid");
    }
  });

  it("refuses anything that is not a plain object", () => {
    for (const raw of [null, undefined, "created", 1, [], new Date()]) {
      expect(parseCheckpointOutcome(raw)).toEqual({ status: "invalid" });
    }
  });

  it("does not let an inherited property pose as a status", () => {
    const raw = Object.create({ status: "created", checkpointId: "a", revision: 1 });
    expect(parseCheckpointOutcome(raw)).toEqual({ status: "invalid" });
  });

  it("refuses a status it does not know, including prototype members", () => {
    for (const status of ["restored", "constructor", "toString", ""]) {
      expect(parseCheckpointOutcome({ status })).toEqual({ status: "invalid" });
    }
  });

  it("ignores extra keys, so a later migration does not break this client", () => {
    expect(
      parseCheckpointOutcome({
        status: "created",
        checkpointId: "a",
        revision: 2,
        createdAt: "2026-09-19T10:00:00.000Z",
      }),
    ).toEqual({ status: "created", checkpointId: "a", revision: 2 });
  });
});

describe("parseCheckpointRow", () => {
  const row = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Prije lekture",
    revision: 3,
    created_at: "2026-09-19T08:30:00.000Z",
  };

  it("reads a well-formed row", () => {
    expect(parseCheckpointRow(row)).toEqual({
      id: row.id,
      name: row.name,
      revision: 3,
      createdAt: row.created_at,
    });
  });

  it("drops a row that is missing what a bookmark needs", () => {
    for (const broken of [
      { ...row, id: "" },
      { ...row, name: "" },
      { ...row, revision: -1 },
      { ...row, revision: "3" },
      { ...row, created_at: "" },
      { ...row, created_at: 1 },
      null,
      [],
    ]) {
      expect(parseCheckpointRow(broken)).toBeNull();
    }
  });

  it("keeps the readable rows of a list and drops the rest, in order", () => {
    const list = parseCheckpointList([row, { ...row, id: "" }, { ...row, id: "b", revision: 9 }]);
    expect(list.map((entry) => entry.id)).toEqual([row.id, "b"]);
  });

  it("treats a non-array as an empty list rather than throwing", () => {
    for (const raw of [null, undefined, {}, "rows"]) {
      expect(parseCheckpointList(raw)).toEqual([]);
    }
  });

  it("never carries the checkpointed document into the list", () => {
    const withDocument = { ...row, document: { schemaVersion: 1, nodes: [] } };
    expect(Object.keys(parseCheckpointRow(withDocument) ?? {}).sort()).toEqual([
      "createdAt",
      "id",
      "name",
      "revision",
    ]);
  });
});

describe("what the author is told", () => {
  it("names the revision rather than claiming a generic save", () => {
    const message = checkpointCreatedMessage("Prije lekture", 7);
    expect(message).toContain("Prije lekture");
    expect(message).toContain("revizija 7");
    expect(message.toLowerCase()).not.toContain("spremljeno");
  });

  it("states plainly that unsent changes are not in the checkpoint", () => {
    expect(UNSYNCED_CHANGES_NOTE).toBe("Nesinkronizirane promjene nisu uključene.");
  });

  it("formats the date in Croatian", () => {
    const formatted = formatCheckpointDate("2026-09-19T08:30:00.000Z");
    expect(formatted).not.toBe("2026-09-19T08:30:00.000Z");
    expect(formatted).toMatch(/2026/);
  });

  it("shows an unreadable instant as it is rather than as an invalid date", () => {
    expect(formatCheckpointDate("kada god")).toBe("kada god");
  });
});
