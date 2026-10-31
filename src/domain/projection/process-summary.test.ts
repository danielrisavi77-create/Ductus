import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { EDIT_STEP_FORMAT_V1 } from "../document/edit-step";
import { sha256WebCrypto } from "../forensics/crypto";
import type { EvidenceChainHeadV2 } from "../forensics/evidence-chain-v2";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  type EvidenceSourceV2,
  type EvidenceStepV2,
} from "../forensics/evidence-segment-v2";
import { canonicalizeJcs } from "../forensics/jcs";
import {
  EVIDENCE_KINDS,
  projectProcessSummary,
  PROCESS_SUMMARY_FORMAT_V1,
  type ProcessSummaryV1,
} from "./process-summary";

// Synthetic only: invented documents, sessions and Lorem ipsum text.
type EventSpec = { source: EvidenceSourceV2; text: string; steps?: EvidenceStepV2[] };
type SegmentSpec = {
  from: string;
  to: string;
  events: EventSpec[];
  sessionId?: string;
  skipEvents?: number;
  rewindEvents?: number;
  documentHashBreak?: boolean;
};

const THRESHOLDS = { sessionBreakAboveMinutes: 30, pasteListedAboveCharacters: 200 };
const at = (time: string) => `2026-10-20T${time}:00.000Z`;
const hash = (n: number) => n.toString(16).padStart(64, "0");
const typed = (text = "Lorem ipsum"): EventSpec => ({ source: "editor", text });
const pasted = (text: string): EventSpec => ({ source: "paste", text });

async function buildPackage(
  specs: SegmentSpec[],
  documentId = "doc-ana",
): Promise<{ payloads: string[]; head: EvidenceChainHeadV2 | null }> {
  const payloads: string[] = [];
  let previousHash: string | null = null;
  let sequenceTo = 0;
  let documentHash = 1;
  for (const [index, spec] of specs.entries()) {
    const sequenceFrom = sequenceTo + 1 + (spec.skipEvents ?? 0) - (spec.rewindEvents ?? 0);
    if (spec.documentHashBreak) documentHash += 1000;
    const initialDocumentHash = hash(documentHash);
    const events = spec.events.map((event, offset) => ({
      sequence: sequenceFrom + offset,
      source: event.source,
      steps: event.steps ?? [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: event.text }] } }],
      beforeDocumentHash: hash(documentHash),
      afterDocumentHash: hash(++documentHash),
    }));
    sequenceTo = sequenceFrom + events.length - 1;
    const canonical = canonicalEvidenceSegmentV2({
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      canonicalization: EVIDENCE_CANONICALIZATION_V2,
      hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
      documentId,
      sessionId: spec.sessionId ?? `${documentId}-session`,
      segmentId: `${documentId}-segment-${index + 1}`,
      sequenceFrom,
      sequenceTo,
      observedStartedAt: spec.from,
      observedEndedAt: spec.to,
      initialDocumentHash,
      finalDocumentHash: hash(documentHash),
      predecessorSegmentHash: previousHash,
      events,
      captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
      evidenceProfileId: "standard-v1",
    });
    payloads.push(canonical);
    previousHash = await sha256WebCrypto(canonical);
  }
  return {
    payloads,
    head: previousHash === null ? null : { segmentHash: previousHash, segmentCount: payloads.length },
  };
}

async function summarize(specs: SegmentSpec[], thresholds = THRESHOLDS): Promise<ProcessSummaryV1> {
  const result = await projectProcessSummary({ ...(await buildPackage(specs)), thresholds });
  if (!result.ok) throw new Error(`no summary: ${result.reason}`);
  return result.summary;
}

const minuteSegment = (time: string, events: EventSpec[] = [typed()]): SegmentSpec => ({
  from: at(time),
  to: at(time),
  events,
});

afterEach(() => vi.restoreAllMocks());

describe("one function for everyone who may see the summary (#384 A)", () => {
  it("takes no input that names who asks, and rejects an unknown field", async () => {
    expect(projectProcessSummary.length).toBe(1);
    const stored = await buildPackage([minuteSegment("10:00")]);
    for (const extra of ["viewerRole", "asRole", "includeRaw", "since", "profile"]) {
      await expect(
        projectProcessSummary({ ...stored, thresholds: THRESHOLDS, [extra]: "x" } as never),
      ).rejects.toThrow(/exactly payloads, head and thresholds/);
    }
    await expect(
      projectProcessSummary({ ...stored, thresholds: { ...THRESHOLDS, perViewer: 1 } } as never),
    ).rejects.toThrow(/invalid thresholds/);
  });

  it("has no branch on who asks anywhere in the module", () => {
    const source = readFileSync(new URL("./process-summary.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(role|roles|teacher|student|mentor|viewer|actor|principal)\b/i);
  });

  it("gives the same canonical bytes for the same stored state, and reads no clock", async () => {
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now must not be read");
    });
    const specs = [minuteSegment("10:00", [typed(), pasted("L".repeat(250))]), minuteSegment("11:00")];
    const first = await summarize(specs);
    const second = await summarize(specs);
    expect(canonicalizeJcs(first)).toBe(canonicalizeJcs(second));
  });

  it("returns a closed shape: an added field fails this test", async () => {
    const summary = await summarize([minuteSegment("10:00", [pasted("L".repeat(201))])]);
    expect(summary).toEqual({
      summaryFormat: PROCESS_SUMMARY_FORMAT_V1,
      sessions: {
        evidenceKind: "observed",
        breakAboveMinutes: 30,
        count: 1,
        items: [{ from: at("10:00"), to: at("10:00") }],
      },
      pastes: {
        evidenceKind: "observed",
        listedAboveCharacters: 200,
        listed: [{ at: { from: at("10:00"), to: at("10:00") }, characters: 201, origin: "not_observed" }],
        smallerCount: 0,
      },
      gaps: { evidenceKind: "observed", items: [] },
      recordState: "complete",
    });
    for (const item of [summary.sessions, summary.pastes, summary.gaps]) {
      expect(EVIDENCE_KINDS).toContain(item.evidenceKind);
    }
  });

  it("carries no forbidden term in any key or value, in Croatian or English", async () => {
    const summary = await summarize([
      minuteSegment("10:00", [pasted("L".repeat(250)), pasted("ipsum")]),
      { ...minuteSegment("12:00"), skipEvents: 3 },
    ]);
    const words = JSON.stringify(summary)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_{}[\]":,]/g, " ");
    expect(findForbiddenTerms(words, "en")).toEqual([]);
    expect(findForbiddenTerms(words, "hr")).toEqual([]);
  });
});

describe("falsification pairs: the record cannot tell these apart (#384 30, 31)", () => {
  it("Ana typing and Boris retyping the same amounts give the same summary", async () => {
    const ana = [minuteSegment("10:00", [typed("Lorem ipsum dolor")]), minuteSegment("14:00", [typed("sit amet")])];
    const boris = [minuteSegment("10:00", [typed("Vivamus porta ex")]), minuteSegment("14:00", [typed("nec odio")])];
    const anaResult = await projectProcessSummary({ ...(await buildPackage(ana, "doc-ana")), thresholds: THRESHOLDS });
    const borisResult = await projectProcessSummary({
      ...(await buildPackage(boris, "doc-boris")),
      thresholds: THRESHOLDS,
    });
    expect(canonicalizeJcs(anaResult)).toBe(canonicalizeJcs(borisResult));
  });

  it("dictation, composition and typing are not told apart in the summary", async () => {
    const summaries = await Promise.all(
      (["editor", "keyless-input", "composition"] as const).map((source) =>
        summarize([minuteSegment("10:00", [{ source, text: "L".repeat(300) }])]),
      ),
    );
    expect(new Set(summaries.map((summary) => canonicalizeJcs(summary))).size).toBe(1);
    expect(summaries[0].pastes).toMatchObject({ listed: [], smallerCount: 0 });
  });

  it("pasting one's notes and pasting external AI text keep the same unobserved origin (#55)", async () => {
    // The source outside Ductus is deliberately only a fixture label, never
    // evidence. Both documents contain the same observed clipboard events.
    const observed = [minuteSegment("10:00", [pasted("L".repeat(250)), pasted("ipsum")])];
    const results = await Promise.all(["own-notes", "external-ai"].map(async (documentId) =>
      projectProcessSummary({ ...(await buildPackage(observed, documentId)), thresholds: THRESHOLDS }),
    ));
    for (const result of results) {
      // Equality alone would also accept two equally judgemental summaries.
      expect(result).toEqual({
        ok: true,
        summary: {
          summaryFormat: PROCESS_SUMMARY_FORMAT_V1,
          sessions: { evidenceKind: "observed", breakAboveMinutes: 30, count: 1,
            items: [{ from: at("10:00"), to: at("10:00") }] },
          pastes: { evidenceKind: "observed", listedAboveCharacters: 200,
            listed: [{ at: { from: at("10:00"), to: at("10:00") }, characters: 250, origin: "not_observed" }],
            smallerCount: 1 },
          gaps: { evidenceKind: "observed", items: [] },
          recordState: "complete",
        },
      });
    }
    expect(canonicalizeJcs(results[0])).toBe(canonicalizeJcs(results[1]));
  });

  it("an accidental outage and deliberate offline writing never reveal the unobserved reason (#55)", async () => {
    // A time interval alone is not a gap. With an actual sequence gap, both
    // histories must expose the same discontinuity without inventing a cause.
    for (const skipEvents of [0, 2]) {
      const observed = [minuteSegment("10:00"), { ...minuteSegment("12:00"), skipEvents }];
      const results = await Promise.all(["outage", "deliberate-offline"].map(async (documentId) =>
        projectProcessSummary({ ...(await buildPackage(observed, documentId)), thresholds: THRESHOLDS }),
      ));
      for (const result of results) {
        expect(result).toEqual({
          ok: true,
          summary: {
            summaryFormat: PROCESS_SUMMARY_FORMAT_V1,
            sessions: { evidenceKind: "observed", breakAboveMinutes: 30, count: 2,
              items: [{ from: at("10:00"), to: at("10:00") }, { from: at("12:00"), to: at("12:00") }] },
            pastes: { evidenceKind: "observed", listedAboveCharacters: 200, listed: [], smallerCount: 0 },
            gaps: { evidenceKind: "observed", items: skipEvents === 0 ? [] : [
              { previousEndedAt: at("10:00"), nextStartedAt: at("12:00") },
            ] },
            recordState: skipEvents === 0 ? "complete" : "has_gaps",
          },
        });
      }
      expect(canonicalizeJcs(results[0])).toBe(canonicalizeJcs(results[1]));
    }
  });
});

describe("sessions by P-01 (#384 D)", () => {
  it("a pause of exactly 30 minutes continues a session, 31 ends it", async () => {
    const summary = await summarize(["10:00", "10:29", "10:59", "11:30"].map((time) => minuteSegment(time)));
    expect(summary.sessions.count).toBe(2);
    expect(summary.sessions.items).toEqual([
      { from: at("10:00"), to: at("10:59") },
      { from: at("11:30"), to: at("11:30") },
    ]);
  });

  it("takes the threshold from configuration", async () => {
    const specs = ["10:00", "10:40"].map((time) => minuteSegment(time));
    expect((await summarize(specs)).sessions.count).toBe(2);
    const faculty = await summarize(specs, { ...THRESHOLDS, sessionBreakAboveMinutes: 45 });
    expect(faculty.sessions).toMatchObject({ breakAboveMinutes: 45, count: 1 });
  });

  it("ignores the client sessionId in both directions", async () => {
    const sameId = await summarize([
      { ...minuteSegment("10:00"), sessionId: "one" },
      { ...minuteSegment("13:00"), sessionId: "one" },
    ]);
    expect(sameId.sessions.count).toBe(2);
    const twoTabs = await summarize([
      { from: at("10:00"), to: at("10:10"), events: [typed()], sessionId: "tab-a" },
      { from: at("10:05"), to: at("10:12"), events: [typed()], sessionId: "tab-b" },
    ]);
    expect(twoTabs.sessions.items).toEqual([{ from: at("10:00"), to: at("10:12") }]);
  });

  it("a clock moved back makes no negative session and no merge across days", async () => {
    const summary = await summarize([
      minuteSegment("10:00"),
      { from: "2026-10-18T09:00:00.000Z", to: "2026-10-18T09:05:00.000Z", events: [typed()] },
      minuteSegment("10:20"),
    ]);
    expect(summary.sessions.count).toBe(3);
    for (const item of summary.sessions.items) expect(Date.parse(item.to)).toBeGreaterThanOrEqual(Date.parse(item.from));
  });

  it("an empty package and a one-minute package give a summary without errors", async () => {
    const empty = await summarize([]);
    expect(empty).toMatchObject({ sessions: { count: 0, items: [] }, pastes: { listed: [], smallerCount: 0 } });
    expect(empty.recordState).toBe("complete");
    expect((await summarize([minuteSegment("10:00")])).sessions.count).toBe(1);
  });
});

describe("pastes by P-02 (#384 E)", () => {
  it("lists more than 200 code points and only counts the rest", async () => {
    const summary = await summarize([
      minuteSegment("10:00", [pasted("L".repeat(199)), pasted("L".repeat(200)), pasted("L".repeat(201))]),
    ]);
    expect(summary.pastes.listed.map((paste) => paste.characters)).toEqual([201]);
    expect(summary.pastes.smallerCount).toBe(2);
  });

  // E1 (#823): the kind of block a paste brings changes no number.
  it("counts a pasted list as the same text pasted as paragraphs", async () => {
    const blocks = (type: string) => ({
      source: "paste" as const, text: "",
      steps: [{ stepType: "replace", from: 0, to: 0, slice: { content: ["L".repeat(120), "L".repeat(90)].map((text) =>
        ({ type, attrs: { nodeId: null }, content: [{ type: "text", text }] })) } }],
    });
    const asList = await summarize([minuteSegment("10:00", [blocks("bulletItem")])]);
    const asParagraphs = await summarize([minuteSegment("10:00", [blocks("paragraph")])]);
    expect(asList.pastes.listed.map((paste) => paste.characters)).toEqual([210]);
    expect(asList).toEqual(asParagraphs);
  });

  it("counts code points, not bytes or UTF-16 units", async () => {
    const summary = await summarize([
      minuteSegment("10:00", [
        pasted("č".repeat(200)),
        pasted("\u{1F600}".repeat(200)),
        pasted("č".repeat(100)),
        pasted("č".repeat(201)),
      ]),
    ]);
    expect(summary.pastes.listed.map((paste) => paste.characters)).toEqual([201]);
    expect(summary.pastes.smallerCount).toBe(3);
  });

  it("never joins split pastes, keeps chain order and the segment minutes", async () => {
    const summary = await summarize([
      { from: at("10:00"), to: at("10:02"), events: [pasted("L".repeat(200)), pasted("L".repeat(200)), pasted("L".repeat(200))] },
      minuteSegment("11:00", [pasted("L".repeat(900)), pasted("L".repeat(300))]),
    ]);
    expect(summary.pastes.smallerCount).toBe(3);
    expect(summary.pastes.listed).toEqual([
      { at: { from: at("11:00"), to: at("11:00") }, characters: 900, origin: "not_observed" },
      { at: { from: at("11:00"), to: at("11:00") }, characters: 300, origin: "not_observed" },
    ]);
  });

  it("does not show drop, cut, autocorrect or unattributed changes as pastes", async () => {
    const others = (["drop", "cut", "system-replacement", "unattributed"] as const).map((source) => ({
      source,
      text: "L".repeat(500),
    }));
    const summary = await summarize([minuteSegment("10:00", others)]);
    expect(summary.pastes).toMatchObject({ listed: [], smallerCount: 0 });
  });
});

describe("gaps and record state (#384 F, G)", () => {
  it("every discontinuity of the chain is a gap item and the record has gaps", async () => {
    const summary = await summarize([
      minuteSegment("10:00"),
      { ...minuteSegment("10:10"), skipEvents: 4 },
      { ...minuteSegment("10:20"), rewindEvents: 1 },
      { ...minuteSegment("10:30"), documentHashBreak: true },
    ]);
    expect(summary.gaps.items).toEqual([
      { previousEndedAt: at("10:00"), nextStartedAt: at("10:10") },
      { previousEndedAt: at("10:10"), nextStartedAt: at("10:20") },
      { previousEndedAt: at("10:20"), nextStartedAt: at("10:30") },
    ]);
    expect(summary.recordState).toBe("has_gaps");
  });

  it("a gap stays when a later continuous segment arrives", async () => {
    const summary = await summarize([
      minuteSegment("10:00"),
      { ...minuteSegment("10:10"), skipEvents: 2 },
      minuteSegment("10:20"),
    ]);
    expect(summary.gaps.items).toHaveLength(1);
    expect(summary.recordState).toBe("has_gaps");
  });

  it("gives no summary at all when the chain does not verify", async () => {
    const stored = await buildPackage([minuteSegment("10:00"), minuteSegment("10:05")]);
    const wrongHead = { segmentHash: hash(7), segmentCount: 2 };
    expect(await projectProcessSummary({ ...stored, head: wrongHead, thresholds: THRESHOLDS })).toEqual({
      ok: false,
      reason: "head_mismatch",
    });
    const tampered = [stored.payloads[0].replace("Lorem", "Lorex"), stored.payloads[1]];
    const result = await projectProcessSummary({ payloads: tampered, head: stored.head, thresholds: THRESHOLDS });
    expect(result.ok).toBe(false);
    const reordered = [stored.payloads[1], stored.payloads[0]];
    expect((await projectProcessSummary({ payloads: reordered, head: stored.head, thresholds: THRESHOLDS })).ok).toBe(
      false,
    );
  });

  it("does not cut a long list short", async () => {
    const specs = Array.from({ length: 120 }, (_, index) => ({
      from: new Date(Date.UTC(2026, 9, 1, 0, index * 31)).toISOString(),
      to: new Date(Date.UTC(2026, 9, 1, 0, index * 31)).toISOString(),
      events: [pasted("L".repeat(250))],
    }));
    const summary = await summarize(specs);
    expect(summary.pastes.listed).toHaveLength(120);
    expect(summary.sessions.count).toBe(120);
  });
});
