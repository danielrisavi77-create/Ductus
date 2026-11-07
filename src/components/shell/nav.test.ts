import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { homeHref, navFor } from "./nav";

// #802 part B, QA (4), and D-202 t. 2: the brand and "Početna" lead to the
// home of the signed-in person's role.
describe("homeHref", () => {
  it("leads a teacher to /nastavnik, a student to S01 on /zadaci (D-180) and no role to /", () => {
    expect(homeHref("teacher")).toBe("/nastavnik");
    expect(homeHref("student")).toBe("/zadaci");
    expect(homeHref(null)).toBe("/");
  });

  it("never leads to the workspace, the package's homeHref (D-202 t. 2)", () => {
    for (const role of ["teacher", "student", null] as const) {
      expect(homeHref(role).startsWith("/rad"), String(role)).toBe(false);
    }
  });

  it("leads only to routes that exist", () => {
    for (const role of ["teacher", "student", null] as const) {
      const href = homeHref(role);
      expect(existsSync(join(process.cwd(), "app", href, "page.tsx")), href).toBe(true);
    }
  });
});

// I3 and QA criterion (e) of the shell contract (#476 6314969336).
describe("navFor", () => {
  it("gives a teacher only teacher items and a student only student items", () => {
    const teacher = navFor("teacher").map((item) => item.href);
    const student = navFor("student").map((item) => item.href);
    expect(teacher.every((href) => href.startsWith("/nastavnik"))).toBe(true);
    expect(student.some((href) => href.startsWith("/nastavnik"))).toBe(false);
    expect(teacher.filter((href) => student.includes(href))).toEqual([]);
  });

  it("gives a student her assignments and, from DAN-344 (S02), her courses", () => {
    const student = navFor("student").map((item) => item.href);
    expect(student.slice(0, 2)).toEqual(["/zadaci", "/zadaci/kolegiji"]);
  });

  it("gives a teacher, from DAN-492 (N-16), the works the teacher mentors", () => {
    expect(navFor("teacher")).toContainEqual({ href: "/nastavnik/mentorstva", label: "Radovi uz mentora" });
  });

  it("gives a student, from DAN-309 (B2), her works right after her courses", () => {
    const student = navFor("student").map((item) => item.href);
    expect(student.slice(0, 3)).toEqual(["/zadaci", "/zadaci/kolegiji", "/zadaci/radovi"]);
    expect(student).toContain("/rad");
    expect(student).toContain("/upis");
  });

  it("gives no item without a role", () => {
    expect(navFor(null)).toEqual([]);
  });

  it("lists only routes that exist in app/, so no item leads to a 404", () => {
    for (const { href } of [...navFor("teacher"), ...navFor("student"), ...navFor("admin")]) {
      expect(existsSync(join(process.cwd(), "app", href, "page.tsx")), href).toBe(true);
    }
  });

  it("gives an administrator the users (DAN-581, A-02) and then the faculty rules (DAN-590, A-04) after the overview", () => {
    expect(navFor("admin")).toEqual([
      { href: "/ustanova", label: "Pregled ustanove" },
      { href: "/ustanova/korisnici", label: "Korisnici" },
      { href: "/ustanova/pravila", label: "Pravila fakulteta" },
    ]);
    expect(navFor("teacher").concat(navFor("student")).some((item) => item.href.startsWith("/ustanova"))).toBe(false);
  });
});
