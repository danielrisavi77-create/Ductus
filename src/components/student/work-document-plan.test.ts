import { describe, expect, it } from "vitest";

import type { OpenOutcome } from "@/client/evidence-ingest";
import { LOCAL_DEMO_DOCUMENT_ID } from "@/lib/journal/local-scope";

import { assignmentParam, type WorkContextRead } from "./work-context-read";
import {
  openWorkStep, pastDue, workDocumentPlan,
  type WorkDocumentPlan, type WorkDocumentPlanInput, type WorkDocumentRead,
} from "./work-document-plan";

// #711 F1 (contract 6391402093 §8). Every id, name and date below is invented.
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DOC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SCOPE = "e".repeat(64);
const DUE = "2026-11-30T22:59:00.000Z";
const OPENS = "2026-11-02T08:00:00.000Z";

function ready(assignmentId = ID): WorkContextRead {
  return {
    kind: "ready",
    course: "Izmišljeni kolegij",
    wordRange: null,
    notice: {
      assignmentId,
      versionNo: 1,
      title: "Izmišljeni zadatak o knjižnicama",
      instructions: "Upute za izmišljeni zadatak.",
      workType: "essay",
      evidenceProfile: "basic",
      opensAt: OPENS,
      dueAt: DUE,
      aiPurposes: [],
      wordMin: null,
      wordMax: null,
      acknowledgedAt: "2026-11-03T09:00:00.000Z",
    },
  };
}

const CONTEXTS: Record<string, WorkContextRead> = {
  ready: ready(),
  noticeFirst: { kind: "noticeFirst" },
  none: { kind: "none" },
};
const DOCS: Record<string, WorkDocumentRead> = {
  document: { kind: "document", documentId: DOC },
  notOpened: { kind: "notOpened" },
  notAccepting: { kind: "notAccepting" },
  none: { kind: "none" },
};
const PARAMS: Record<string, string | string[] | undefined> = {
  absent: undefined,
  valid: ID,
  malformed: "1; DROP",
  empty: "",
  repeated: [ID, OTHER_ID],
  uppercase: ID.toUpperCase(),
};

function input(over: Partial<WorkDocumentPlanInput> = {}): WorkDocumentPlanInput {
  const rawParam = "rawParam" in over ? over.rawParam : ID;
  return {
    rawParam,
    assignmentId: assignmentParam(rawParam),
    signedIn: true,
    signInAgain: false,
    scope: SCOPE,
    context: ready(),
    doc: DOCS.document,
    ...over,
  };
}

const plan = (over: Partial<WorkDocumentPlanInput> = {}) => workDocumentPlan(input(over));

/** Every combination of context × doc × signedIn × param (and signInAgain, scope). */
function everyInput(): WorkDocumentPlanInput[] {
  const all: WorkDocumentPlanInput[] = [];
  for (const rawParam of Object.values(PARAMS)) {
    for (const context of Object.values(CONTEXTS)) {
      for (const doc of Object.values(DOCS)) {
        for (const [signedIn, signInAgain] of [[true, false], [false, false], [false, true]] as const) {
          for (const scope of [SCOPE, null]) {
            all.push({ rawParam, assignmentId: assignmentParam(rawParam), signedIn, signInAgain, scope, context, doc });
          }
        }
      }
    }
  }
  return all;
}

const OFF = { comments: false, live: false, submission: false };

describe("workDocumentPlan (contract §2 table)", () => {
  it("assignment: signed in, ready context and the student's document", () => {
    expect(plan()).toEqual({
      kind: "assignment",
      journal: { scope: SCOPE, documentId: DOC },
      assignmentId: ID,
      dueAt: DUE,
      comments: true, live: true, submission: true,
    });
  });

  it("opening: ready context, the work not opened yet", () => {
    expect(plan({ doc: DOCS.notOpened })).toEqual({ kind: "opening", journal: null, assignmentId: ID, ...OFF });
  });

  it("notYetOpen: ready context, the assignment not accepting work, with the notice's opening time", () => {
    expect(plan({ doc: DOCS.notAccepting })).toEqual({ kind: "notYetOpen", journal: null, opensAt: OPENS, ...OFF });
  });

  it("free (P1): signed in without zadatak, the person's own local document, nothing leaves the browser", () => {
    for (const context of Object.values(CONTEXTS)) {
      for (const doc of Object.values(DOCS)) {
        expect(plan({ rawParam: undefined, context, doc })).toEqual({
          kind: "free", journal: { scope: SCOPE, documentId: LOCAL_DEMO_DOCUMENT_ID }, ...OFF,
        });
      }
    }
  });

  it("localDemo: no session cookie keeps the local demo journal as before, with or without zadatak (A18)", () => {
    for (const rawParam of Object.values(PARAMS)) {
      expect(plan({ rawParam, signedIn: false, context: CONTEXTS.none, doc: DOCS.none })).toEqual({
        kind: "localDemo", journal: { scope: SCOPE, documentId: LOCAL_DEMO_DOCUMENT_ID }, ...OFF,
      });
    }
    // A refused local configuration opens no journal.
    expect(plan({ signedIn: false, scope: null })).toEqual({ kind: "localDemo", journal: null, ...OFF });
  });

  it("signInAgain: a cookie that cannot be checked opens no journal, whatever the reads say", () => {
    for (const rawParam of Object.values(PARAMS)) {
      expect(plan({ rawParam, signedIn: false, signInAgain: true, scope: null })).toEqual({
        kind: "signInAgain", journal: null, ...OFF,
      });
    }
  });

  it("unavailable: every other signed-in case with zadatak, the same plan carrying no id", () => {
    const expected = { kind: "unavailable", journal: null, ...OFF };
    // Foreign, unknown, other institution, closed membership, teacher (A2, A6, A7): both reads none.
    expect(plan({ context: CONTEXTS.none, doc: DOCS.none })).toEqual(expected);
    // A failed or refused document read under a ready context (B-a).
    expect(plan({ doc: DOCS.none })).toEqual(expected);
    // noticeFirst never reaches the plan (the page redirects first); if it did, no editor.
    for (const doc of Object.values(DOCS)) expect(plan({ context: CONTEXTS.noticeFirst, doc })).toEqual(expected);
    // Signed in without a journal fails closed.
    expect(plan({ scope: null })).toEqual(expected);
    // A context of another assignment than the one in the address.
    expect(plan({ context: ready(OTHER_ID) })).toEqual(expected);
  });

  it("document without a ready context is unavailable, never an editor (reads disagree)", () => {
    for (const context of [CONTEXTS.none, CONTEXTS.noticeFirst]) {
      expect(plan({ context, doc: DOCS.document }).kind).toBe("unavailable");
    }
  });

  it("a malformed, empty, repeated or non-canonical zadatak is unavailable, not free", () => {
    for (const rawParam of [PARAMS.malformed, PARAMS.empty, PARAMS.repeated, `${ID} `]) {
      for (const doc of Object.values(DOCS)) {
        expect(plan({ rawParam, doc }).kind).toBe("unavailable");
      }
    }
    // An id the page did not derive from the address is not trusted either.
    expect(plan({ rawParam: PARAMS.malformed, assignmentId: ID }).kind).toBe("unavailable");
  });

  it("a server document id the journal would refuse, or the fixed local id, is unavailable", () => {
    for (const documentId of ["", " ", "x".repeat(129), LOCAL_DEMO_DOCUMENT_ID]) {
      expect(plan({ doc: { kind: "document", documentId } }).kind).toBe("unavailable");
    }
    expect(plan({ doc: { kind: "document", documentId: "x".repeat(128) } }).kind).toBe("assignment");
  });

  it("property: with zadatak in the address a signed-in plan never carries LOCAL_DEMO_DOCUMENT_ID", () => {
    let checked = 0;
    for (const value of everyInput()) {
      if (value.rawParam === undefined || !value.signedIn) continue;
      const result = workDocumentPlan(value);
      expect(result.journal?.documentId).not.toBe(LOCAL_DEMO_DOCUMENT_ID);
      expect(JSON.stringify(result)).not.toContain(LOCAL_DEMO_DOCUMENT_ID);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("property: only an assignment plan has comments, live or submission, and only with B1's id", () => {
    for (const value of everyInput()) {
      const result: WorkDocumentPlan = workDocumentPlan(value);
      if (result.kind === "assignment") {
        expect(value.signedIn && value.context.kind === "ready" && value.doc.kind === "document").toBe(true);
        expect(result.journal.documentId).toBe(DOC);
      } else {
        expect([result.comments, result.live, result.submission]).toEqual([false, false, false]);
      }
      // Only an editor plan has a journal; unavailable, opening and notYetOpen never do.
      if (["unavailable", "opening", "notYetOpen", "signInAgain"].includes(result.kind)) {
        expect(result.journal).toBeNull();
      }
    }
  });

  it("free has no comments, live or submission", () => {
    const result = plan({ rawParam: undefined });
    expect(result.kind).toBe("free");
    expect([result.comments, result.live, result.submission]).toEqual([false, false, false]);
  });

  it("unavailable is one identical value for every case (A2: same answer)", () => {
    const seen = new Set<string>();
    for (const value of everyInput()) {
      const result = workDocumentPlan(value);
      if (result.kind === "unavailable") seen.add(JSON.stringify(result));
    }
    expect([...seen]).toEqual([JSON.stringify({ kind: "unavailable", journal: null, ...OFF })]);
  });
});

describe("openWorkStep (contract §2, first opening)", () => {
  const opened: OpenOutcome = {
    status: "opened",
    work: { documentId: DOC } as Extract<OpenOutcome, { status: "opened" }>["work"],
  };

  it("opened refreshes once, and a second opened after the refresh is an error, not a loop", () => {
    expect(openWorkStep(opened, false, true)).toEqual({ kind: "refresh" });
    expect(openWorkStep(opened, true, true)).toEqual({ kind: "error" });
    expect(openWorkStep(opened, false, false)).toEqual({ kind: "refresh" });
  });

  it("each refusal has its own step", () => {
    expect(openWorkStep({ status: "not_accepting" }, false, true)).toEqual({ kind: "notAccepting" });
    expect(openWorkStep({ status: "not_found" }, false, true)).toEqual({ kind: "unavailable", signIn: false });
    expect(openWorkStep({ status: "unauthenticated" }, false, true)).toEqual({ kind: "unavailable", signIn: true });
    expect(openWorkStep({ status: "upgrade_required" }, false, true)).toEqual({ kind: "reload" });
  });

  it("unavailable is offline without a network and an error with one (A19 included)", () => {
    expect(openWorkStep({ status: "unavailable" }, false, false)).toEqual({ kind: "offline" });
    expect(openWorkStep({ status: "unavailable" }, false, true)).toEqual({ kind: "error" });
    expect(openWorkStep({ status: "unavailable" }, true, false)).toEqual({ kind: "offline" });
    expect(openWorkStep({ status: "unavailable" }, true, true)).toEqual({ kind: "error" });
  });

  it("no outcome ever opens an editor by itself", () => {
    const outcomes: OpenOutcome[] = [
      opened, { status: "not_accepting" }, { status: "not_found" }, { status: "unauthenticated" },
      { status: "upgrade_required" }, { status: "unavailable" },
    ];
    for (const outcome of outcomes) {
      for (const refreshed of [false, true]) {
        for (const online of [false, true]) {
          const step = openWorkStep(outcome, refreshed, online);
          expect(["refresh", "notAccepting", "unavailable", "reload", "offline", "error"]).toContain(step.kind);
          expect(JSON.stringify(step)).not.toContain(DOC);
        }
      }
    }
  });
});

describe("pastDue (contract §5)", () => {
  const due = Date.parse(DUE);

  it("false before the due date and exactly at it, true only strictly after", () => {
    expect(pastDue(DUE, due - 60_000)).toBe(false);
    expect(pastDue(DUE, due - 1)).toBe(false);
    expect(pastDue(DUE, due)).toBe(false);
    expect(pastDue(DUE, due + 1)).toBe(true);
    expect(pastDue(DUE, due + 86_400_000)).toBe(true);
  });

  it("an invalid date or time is false", () => {
    for (const bad of ["", "nije datum", "2026-02-30T10:00:00.000Z", "2026-13-01T10:00:00.000Z", "2026", "2026-11-30"]) {
      expect(pastDue(bad, due + 86_400_000)).toBe(false);
    }
    expect(pastDue(DUE, Number.NaN)).toBe(false);
    expect(pastDue(DUE, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
