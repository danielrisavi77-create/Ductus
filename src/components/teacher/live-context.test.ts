import { describe, expect, it } from "vitest";

import { validateDocument, type CanonicalDocument } from "@/domain/document";
import type { TeacherCourse } from "@/server/institution/teacher-courses";

import { assignmentWorksHref, headingAnchor, liveContext, liveOutline, sectionHeading, studentName } from "./live-context";

// Archivum T05 (DAN-344, #923 contract 6430008106 §4). Invented ids, names and text.
const COURSE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ASSIGNMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const courses: TeacherCourse[] = [{
  id: COURSE,
  name: "Izmišljeni kolegij o gradovima",
  academicYear: "2026/2027",
  assignments: [{
    id: ASSIGNMENT, title: "Izmišljeni zadatak o prometu", workType: "seminar_paper",
    opensAt: "2026-11-02T08:00:00.000Z", dueAt: "2026-11-30T22:59:00.000Z", currentVersion: 1, enrolledStudents: 3,
  }],
}];
const works = [{ studentId: STUDENT, documentId: "izmisljeni-rad-1" }];

describe("liveContext (T05)", () => {
  it("names the course, assignment, work type and student only from the teacher's reads", () => {
    expect(liveContext(courses, works, ASSIGNMENT.toUpperCase(), "izmisljeni-rad-1")).toEqual({
      assignmentId: ASSIGNMENT,
      course: "Izmišljeni kolegij o gradovima",
      motif: "research",
      title: "Izmišljeni zadatak o prometu",
      workType: "Seminarski rad",
      studentId: STUDENT,
    });
  });

  it("gives nothing for an assignment that is not the teacher's or a work that is not its", () => {
    expect(liveContext(courses, works, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0", "izmisljeni-rad-1")).toBeNull();
    expect(liveContext(courses, works, ASSIGNMENT, "drugi-rad")).toBeNull();
    expect(liveContext([], works, ASSIGNMENT, "izmisljeni-rad-1")).toBeNull();
    expect(liveContext(courses, [], ASSIGNMENT, "izmisljeni-rad-1")).toBeNull();
  });

  it("leaves out a work type the catalogue does not name", () => {
    const odd = [{ ...courses[0]!, assignments: [{ ...courses[0]!.assignments[0]!, workType: "nepoznato" }] }];
    expect(liveContext(odd, works, ASSIGNMENT, "izmisljeni-rad-1")?.workType).toBeNull();
  });

  it("links back to the works of the assignment", () => {
    expect(assignmentWorksHref(ASSIGNMENT)).toBe(`/nastavnik/brz-put?zadatak=${ASSIGNMENT}`);
  });
});

function doc(): CanonicalDocument {
  const node = (n: number, type: string, text: string, level?: number) => ({
    id: `1111111${n}-1111-4111-8111-111111111111`, type, ...(level ? { level } : {}),
    children: [{ type: "text", text, marks: [] }],
  });
  const result = validateDocument({
    schemaVersion: 1,
    nodes: [
      node(1, "paragraph", "Uvodna rečenica prije naslova."),
      node(2, "heading", "Uvod", 1),
      node(3, "paragraph", "Prvi odlomak."),
      node(4, "heading", "Okvir", 2),
      node(5, "paragraph", "Drugi odlomak."),
    ],
  });
  if (!result.ok) throw new Error("invalid synthetic document");
  return result.doc;
}

describe("the outline and the section of a passage (T05)", () => {
  it("lists the headings of the text on screen, in order", () => {
    expect(liveOutline(doc())).toEqual([
      { nodeId: "11111112-1111-4111-8111-111111111111", level: 1, text: "Uvod" },
      { nodeId: "11111114-1111-4111-8111-111111111111", level: 2, text: "Okvir" },
    ]);
    expect(liveOutline(null)).toEqual([]);
    expect(headingAnchor("x")).toBe("naslov-x");
  });

  it("finds the nearest heading before a passage, or none", () => {
    expect(sectionHeading(doc(), "11111115-1111-4111-8111-111111111111")).toBe("Okvir");
    expect(sectionHeading(doc(), "11111113-1111-4111-8111-111111111111")).toBe("Uvod");
    expect(sectionHeading(doc(), "11111112-1111-4111-8111-111111111111")).toBe("Uvod");
    expect(sectionHeading(doc(), "11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(sectionHeading(doc(), "nepoznat")).toBeNull();
    expect(sectionHeading(null, "x")).toBeNull();
  });
});

describe("studentName (T05)", () => {
  const student = (id: string, givenName: string | null, surname: string | null) =>
    ({ id, givenName, surname, work: "writing", lastChangeAt: null, record: null }) as const;
  it("names the student of the work and nobody else", () => {
    const students = [student("s-1", "Ana", "Izmišljena"), student("s-2", null, null)];
    expect(studentName(students, "s-1")).toBe("Ana Izmišljena");
    expect(studentName(students, "s-2")).toBeNull();
    expect(studentName(students, "s-3")).toBeNull();
  });
});
