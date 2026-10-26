import type { WithActor } from "@/server/db/with-actor";

import { readTeacherCourses } from "./teacher-courses";

/**
 * Where a signed-in person's own page is, for "/" and "/prijava" (DAN-325,
 * #802). The role comes only from the database, through the same read as
 * `/nastavnik` (institution.list_teacher_courses): a confirmed teacher role at
 * the session's institution answers, even with no course at all; ZD403 says
 * there is none. A person who is both a teacher and a student goes to the
 * teacher's page; the workspace stays one link away.
 *
 * - `signed-out`: no cookie, a malformed one, or a session that is closed or
 *   expired.
 * - `unverified`: the database could not be asked or answered unexpectedly.
 *   No role is guessed, so nothing redirects.
 */
export type HomeTarget =
  | { kind: "page"; path: "/rad" | "/nastavnik" }
  | { kind: "signed-out" }
  | { kind: "unverified" };

export async function homeTarget(sessionToken: string | undefined, withActor: WithActor): Promise<HomeTarget> {
  const read = await readTeacherCourses(sessionToken, withActor);
  switch (read.kind) {
    case "ok":
      return { kind: "page", path: "/nastavnik" };
    case "not_found":
      return { kind: "page", path: "/rad" };
    case "unauthorized":
      return { kind: "signed-out" };
    case "unavailable":
      return { kind: "unverified" };
  }
}
