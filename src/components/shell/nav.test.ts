import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { homeHref, navFor } from "./nav";

// #802 part B, QA (4): "Početna" leads to each role's own space.
describe("homeHref", () => {
  it("leads a teacher to /nastavnik, a student to /rad and no role to /", () => {
    expect(homeHref("teacher")).toBe("/nastavnik");
    expect(homeHref("student")).toBe("/rad");
    expect(homeHref(null)).toBe("/");
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

  it("gives no item without a role", () => {
    expect(navFor(null)).toEqual([]);
  });

  it("lists only routes that exist in app/, so no item leads to a 404", () => {
    for (const { href } of [...navFor("teacher"), ...navFor("student")]) {
      expect(existsSync(join(process.cwd(), "app", href, "page.tsx")), href).toBe(true);
    }
  });
});
