import type {
  AcademicYearsRead, InstitutionCourse, InstitutionCoursesRead,
} from "@/server/institution/institution-courses";

/**
 * DAN-591 (A-03; contract #1091 c.6708627828, plan #1688): the year the page
 * reads and the page's one answer from its two reads.
 */

/** `?godina=` as one string; a repeated or absent parameter is no choice. */
export function yearParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The year to read: the asked one only when it is one of the institution's
 * own years, otherwise the newest (the list comes newest first). Anything
 * else in the address is never read and never shown.
 */
export function chosenYear(years: readonly string[], asked: string | undefined): string | null {
  if (years.length === 0) return null;
  return asked !== undefined && years.includes(asked) ? asked : years[0]!;
}

export type CoursesPage =
  | { kind: "ok"; years: string[]; year: string | null; courses: InstitutionCourse[] }
  | { kind: "unauthorized" | "notFound" | "unavailable" };

/**
 * The years and the courses are two transactions. A list is shown only when
 * both succeeded: a session that closed between them gives the courses'
 * "unauthorized" (the card), a role revoked between them its "notFound" (the
 * 404), never an empty year. The database refusing a year from its own list
 * (ZD422) is a fault, so the page says it cannot read, not that it is hidden.
 */
export function coursesPage(years: AcademicYearsRead, courses: InstitutionCoursesRead | null): CoursesPage {
  if (years.kind !== "ok") return { kind: years.kind };
  if (years.years.length === 0) return { kind: "ok", years: [], year: null, courses: [] };
  if (courses === null || courses.kind === "invalid") return { kind: "unavailable" };
  if (courses.kind !== "ok") return { kind: courses.kind };
  if (!years.years.includes(courses.academicYear)) return { kind: "unavailable" };
  return { kind: "ok", years: years.years, year: courses.academicYear, courses: courses.courses };
}

/** "2026/2027" as the interface writes it: "2026./2027.". */
export function yearLabel(year: string): string {
  return year.split("/").map((part) => `${part}.`).join("/");
}

/** The address of a year, the slash encoded. */
export function yearHref(href: string, year: string): string {
  return `${href}?godina=${encodeURIComponent(year)}`;
}
