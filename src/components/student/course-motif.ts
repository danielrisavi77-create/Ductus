/**
 * DAN-344 (owner, 26. 10. 2026.): the decorative motif of a course card on
 * /zadaci, one of the package's two course images (public/motivi). The
 * schema has no course category, so the motif says nothing about the course:
 * it only varies the cards and stays the same for a course on every visit.
 * The rule: the last hexadecimal digit of the course's UUID, even → "city",
 * odd → "research". Anything that is not a UUID gets "city".
 */
export type CourseMotif = "city" | "research";

export function courseMotif(courseId: string): CourseMotif {
  const last = /^[0-9a-f-]{36}$/i.test(courseId) ? parseInt(courseId.slice(-1), 16) : 0;
  return last % 2 === 0 ? "city" : "research";
}
