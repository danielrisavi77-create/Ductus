import { describe, expect, it } from "vitest";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { messagesHr } from "@/lib/i18n/messages.hr";

// DAN-227, #476 row 1: the S3 notice text follows D-142 and D-143 and the
// contract on #476 (6264090492, amended by 6264107382 and 6264128457).
// AssignmentNotice renders recorded, notRecorded and teacher with
// Object.values, so the key order below is the order on screen.
const s = messagesHr.student;

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

const notice = () =>
  [s.step, s.recordedHeading, s.notRecordedHeading, s.teacherHeading, s.teacherExtended, s.retention, s.note, s.checkbox,
    s.notConsent, s.confirmed, ...strings(s.recorded), ...strings(s.notRecorded), ...strings(s.teacher)];

describe("S3 notice text (D-142, D-143)", () => {
  it("no longer says single inputs are not recorded", () => {
    for (const text of strings(s.notRecorded)) {
      expect(text).not.toContain("Pojedinačni unosi");
      expect(text).not.toContain("ritam pisanja");
    }
  });

  it("names the key and how long it is held as not recorded, and no measure from time", () => {
    expect(s.notRecorded.inputs).toContain("tipka");
    expect(s.notRecorded.inputs).toContain("držana");
    expect(s.notRecorded.inputs).toContain("nikad se ne računaju brzina, ritam ni bilo kakva mjera");
    // D-63: the replay skips long pauses without their length, so pauses are not "never computed".
    expect(s.notRecorded.inputs).not.toContain("pauze");
    expect(s.notRecorded.inputs).toContain("preskače duge stanke i ne navodi koliko su trajale");
  });

  it("announces every change character by character, only for the live view and the replay", () => {
    expect(s.recorded.live.startsWith("U ovom zadatku bilježit će se")).toBe(true);
    expect(s.recorded.live).toContain("znak po znak");
    expect(s.recorded.live).toContain("prikazu uživo");
    expect(s.recorded.live).toContain("reprodukciji");
  });

  it("tells the student the mentor sees the work live, deleted text included", () => {
    expect(s.teacherHeading).toBe("Što vidi nastavnik (mentor)");
    expect(s.teacher.state).toContain("uživo");
    expect(s.teacher.state).toContain("obrisati");
    // Live does not reach the mentor while the student is offline.
    expect(s.teacher.state).toContain("bez mreže vidjet će tek kad se veza vrati");
    expect(s.checkbox).toContain("što vidi nastavnik (mentor)");
  });

  it("gives the replay to the mentor and the same replay to the student (D-154)", () => {
    expect(s.teacher.replay.startsWith("Nastavnik (mentor) zadatka moći će")).toBe(true);
    expect(s.teacher.replay).toContain("znak po znak");
    expect(s.teacher.replay).toContain("Istu reprodukciju svog rada vidjet ćete i Vi.");
    for (const text of notice()) expect(text).not.toMatch(/reprodukciju ne vidiš|Samo nastavnik/);
  });

  it("states the purpose and never grading or ranking", () => {
    expect(s.teacher.purpose).toContain("služit će");
    expect(s.teacher.purpose).toContain("nikad ocjeni");
    expect(s.teacher.purpose).toContain("rangiranju");
  });

  it("keeps the on-screen order of the lists", () => {
    expect(Object.keys(s.recorded)).toEqual(["steps", "live", "chain", "versions"]);
    expect(Object.keys(s.notRecorded)).toEqual(["inputs", "outside", "device"]);
    expect(Object.keys(s.teacher)).toEqual(["state", "replay", "purpose", "history", "noVerdict"]);
  });

  it("claims nothing the contract leaves open", () => {
    for (const text of notice()) {
      expect(text).not.toMatch(/nitko drugi|odmah|svakih \d|minuta\b/i);
      expect(text).not.toMatch(/\d+\s*%/);
    }
  });

  it("describes the chain as a digital fingerprint linked to the previous one, without hash or chain", () => {
    expect(s.recorded.chain).toBe("Svaki korak spremanja dobiva digitalni otisak povezan s prethodnim, pa se svaka kasnija izmjena zapisa vidi.");
    expect(s.recorded.chain).not.toMatch(/hash|lanac/i);
    expect(findForbiddenTerms(s.recorded.chain)).toEqual([]);
  });

  it("passes the forbidden-terms check in every student string", () => {
    for (const text of strings(s)) expect({ text, found: findForbiddenTerms(text) }).toEqual({ text, found: [] });
  });
});
