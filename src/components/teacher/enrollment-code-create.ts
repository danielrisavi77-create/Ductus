// DAN-36 (#576): the teacher asks the real route (#575) for a course's enrolment
// code. The server stores only a hash, so the code exists in this one response;
// there is no read-back route and nothing here keeps it beyond component state.
import type { CourseCreation } from "./course-create";

export type EnrollmentCodeCreation =
  | { kind: "available"; code: string; validUntil: string }
  | { kind: "invalid" | "unauthorized" | "forbidden" | "unavailable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The `datetime-local` value in the teacher's own zone, as one absolute instant
 * and the offset that produced it. No default and no normalization: a calendar
 * date that does not exist (30 February) or a minute skipped by the spring
 * clock change returns null instead of silently becoming another minute. In
 * the repeated autumn hour the first occurrence is taken and its offset shown.
 */
export function enrollmentCodeExpiry(local: string): { validUntil: string; offset: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const parts = local.split(/[-T:]/).map(Number);
  const at = new Date(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!);
  if (parts[0]! < 1 || Number.isNaN(at.getTime())) return null;
  const read = [at.getFullYear(), at.getMonth() + 1, at.getDate(), at.getHours(), at.getMinutes()];
  if (read.some((value, index) => value !== parts[index])) return null;
  const minutes = -at.getTimezoneOffset();
  const offset = `${minutes >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
  return { validUntil: at.toISOString(), offset };
}

/**
 * One non-idempotent attempt: every 200 replaces the previous code on the
 * server. An unknown outcome is reported as such and never retried here.
 * Error bodies are ignored; the time bounds stay the server's to decide.
 */
export async function createEnrollmentCode(
  courseId: string, validUntil: string, send: typeof fetch = fetch,
): Promise<EnrollmentCodeCreation> {
  if (!UUID.test(courseId) || !INSTANT.test(validUntil) || !Number.isFinite(Date.parse(validUntil)) ||
      new Date(validUntil).toISOString() !== validUntil) {
    return { kind: "invalid" };
  }
  try {
    const response = await send(`/api/institution/courses/${courseId}/enrollment-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify({ validUntil }),
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if ([400, 413, 415, 422].includes(response.status)) return { kind: "invalid" };
    if (response.status !== 200) return { kind: "unavailable" };
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        !("code" in data) || typeof data.code !== "string" || !CODE.test(data.code)) {
      return { kind: "unavailable" };
    }
    return { kind: "available", code: data.code, validUntil };
  } catch {
    return { kind: "unavailable" };
  }
}

export interface CourseThenCode {
  /** The course already saved by an earlier attempt of this screen, if any. */
  courseId: string | null;
  createCourse: () => Promise<CourseCreation>;
  /** Called once the course is known, before the code is asked for. */
  onCourse: (result: CourseCreation) => void;
  validUntil: string;
  /** False once the screen is gone: no further request is sent. */
  active: () => boolean;
  send?: typeof fetch;
}

/**
 * The single teacher action "Stvori kolegij": create the course only when none
 * is saved yet, then ask once for its code. A failed code never re-creates the
 * course; the next attempt starts from the saved course id.
 */
export async function createCourseThenCode(input: CourseThenCode): Promise<EnrollmentCodeCreation | null> {
  let courseId = input.courseId;
  if (!courseId) {
    const course = await input.createCourse();
    if (!input.active()) return null;
    input.onCourse(course);
    if (course.kind !== "available") return null;
    courseId = course.id;
  }
  const code = await createEnrollmentCode(courseId, input.validUntil, input.send);
  return input.active() ? code : null;
}
