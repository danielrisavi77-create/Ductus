import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-477 (M2.6-P01; DAN-349 part 3, #916 variant A; contract on #1091,
 * c.6566072183): the works a teacher mentors, for the list and the detail of
 * T07. Who asks comes only from the session cookie bound into withActor; the
 * database decides who sees which mentorship (RLS mentorship_read and
 * institution.actor_mentorship_role). The row RLS also shows a student their
 * own mentorships, so the read keeps only those where the actor is the
 * mentor. Every other caller, another institution's mentorship, an ended one,
 * an id that names nothing and a malformed id read the same: an empty list
 * and the same 404. Nothing here writes; no time, activity or count of a work
 * is read.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const NAME_MAX = 255;
const NO_STORE = { "cache-control": "no-store" };
/** The work types of institution.mentorship. */
const WORK_TYPES = new Set(["bachelor_thesis", "master_thesis", "specialist_thesis", "doctoral_thesis"]);

export type MentoredWorkType = "bachelor_thesis" | "master_thesis" | "specialist_thesis" | "doctoral_thesis";
export type MentoredWorkState = "not_started" | "in_progress" | "submitted";

export interface MentoredWork {
  mentorshipId: string;
  assignmentId: string;
  /** Null until the student starts the work. */
  documentId: string | null;
  /** Null when the account has no name pair (#757 D1); never a stand-in. */
  student: { givenName: string; familyName: string } | null;
  title: string;
  workType: MentoredWorkType;
  workState: MentoredWorkState;
}

export type MentoredWorksRead =
  | { kind: "ok"; works: MentoredWork[] }
  | { kind: "unauthorized" | "unavailable" };

export type MentoredWorkRead =
  | { kind: "ok"; work: MentoredWork }
  | { kind: "unauthorized" | "not_found" | "unavailable" };

export interface MentoredWorksDeps {
  withActor: WithActor;
  sessionToken?: string;
}

type Row = Record<string, unknown>;

// One row per mentorship with an assignment: its current version, and the
// student's name, document and submission from the functions that already
// decide for every assignment (#947). A second row for a mentorship would
// mean a second assignment or document: the parser refuses it.
const SQL = `
SELECT m.id::text AS mentorship_id, a.id::text AS assignment_id, v.title, m.work_type,
       w.document_id, n.given_name, n.family_name, s.submitted
  FROM institution.mentorship m
  JOIN institution.assignment a ON a.mentorship_id = m.id AND a.institution_id = m.institution_id
  JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version
  LEFT JOIN LATERAL (SELECT x.given_name, x.family_name FROM app.teacher_assignment_names(a.id) x
                      WHERE x.student_id = m.student_id) n ON true
  LEFT JOIN LATERAL (SELECT x.document_id FROM app.assignment_works(a.id) x
                      WHERE x.student_id = m.student_id) w ON true
  LEFT JOIN LATERAL (SELECT x.submitted FROM app.assignment_submissions(a.id) x
                      WHERE x.student_id = m.student_id) s ON true
 WHERE m.institution_id = app.current_institution_id()
   AND m.ended_at IS NULL
   AND institution.actor_mentorship_role(m.id) = 'teacher'
   AND ($1::uuid IS NULL OR m.id = $1::uuid)
 ORDER BY m.started_at DESC, m.id`;

function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

function isName(value: unknown): value is string {
  // Code points, as length() in the database counts (F-149).
  return typeof value === "string" && value.length >= 1 && [...value].length <= NAME_MAX;
}

/** A document id as `evidence.document` allows it: 1 to 256 characters, trimmed, no control characters. */
function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/** One row as a mentored work, or null when it is not what the read returns. */
export function mentoredWorkOf(row: Row): MentoredWork | null {
  const { mentorship_id: mentorshipId, assignment_id: assignmentId, title, work_type: workType } = row;
  if (typeof mentorshipId !== "string" || !UUID.test(mentorshipId)
    || typeof assignmentId !== "string" || !UUID.test(assignmentId)
    || typeof title !== "string" || title === ""
    || typeof workType !== "string" || !WORK_TYPES.has(workType)) return null;
  let student: MentoredWork["student"];
  if (isName(row.given_name) && isName(row.family_name)) {
    student = { givenName: row.given_name, familyName: row.family_name };
  } else if (row.given_name === null && row.family_name === null) {
    student = null;
  } else {
    return null;
  }
  const documentId = row.document_id;
  if (documentId !== null && !isDocumentId(documentId)) return null;
  // A submission row exists for every student of an open mentorship (null only
  // if the functions disagree, which is no answer); a submission needs a work.
  if (typeof row.submitted !== "boolean") return null;
  if (row.submitted && documentId === null) return null;
  const workState: MentoredWorkState = row.submitted ? "submitted" : documentId === null ? "not_started" : "in_progress";
  return { mentorshipId, assignmentId, documentId, student, title, workType: workType as MentoredWorkType, workState };
}

/** The rows as mentored works, or null when any row is malformed or repeats a mentorship. */
export function mentoredWorksOf(rows: readonly Row[]): MentoredWork[] | null {
  const works: MentoredWork[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const work = mentoredWorkOf(row);
    if (work === null || seen.has(work.mentorshipId)) return null;
    seen.add(work.mentorshipId);
    works.push(work);
  }
  return works;
}

async function query(sessionToken: string, withActor: WithActor, mentorshipId: string | null): Promise<MentoredWorksRead> {
  let rows: Row[] | null;
  try {
    rows = await withActor(sessionToken, async (tx) => {
      // The read itself raises nothing when no mentorship matches, so an
      // ended or unknown session is asked for first, in the same transaction.
      const actor = (await tx.query<Row>("SELECT user_id, institution_id FROM app.current_actor()")).rows[0];
      if (actor === undefined || actor.user_id === null || actor.institution_id === null) return null;
      return (await tx.query<Row>(SQL, [mentorshipId])).rows;
    });
  } catch (error) {
    const code = codeOf(error);
    if (code === "ZD401") return { kind: "unauthorized" };
    console.error("mentored works read failed", code !== undefined && SQLSTATE.test(code) ? code : "unknown");
    return { kind: "unavailable" };
  }
  if (rows === null) return { kind: "unauthorized" };
  const works = mentoredWorksOf(rows);
  if (works === null) {
    console.error("mentored works read failed", "row_malformed");
    return { kind: "unavailable" };
  }
  return { kind: "ok", works };
}

/** Every open mentorship of the actor as mentor; the same empty list for anyone else. */
export async function readMentoredWorks(sessionToken: string | undefined, withActor: WithActor): Promise<MentoredWorksRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  return query(sessionToken, withActor, null);
}

/** One mentorship of the actor as mentor; the same not_found for anything else, a malformed id without asking. */
export async function readMentoredWork(
  sessionToken: string | undefined,
  withActor: WithActor,
  mentorshipId: string,
): Promise<MentoredWorkRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  if (!UUID.test(mentorshipId)) return { kind: "not_found" };
  const read = await query(sessionToken, withActor, mentorshipId);
  if (read.kind !== "ok") return read;
  const [work] = read.works;
  if (work === undefined) return { kind: "not_found" };
  return work.mentorshipId === mentorshipId && read.works.length === 1 ? { kind: "ok", work } : { kind: "unavailable" };
}

const STATUS = { unauthorized: 401, not_found: 404, unavailable: 503 } as const;

function guard(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return refuse(405, "method_not_allowed");
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return refuse(403, "forbidden");
  return null;
}

/** GET /api/teacher/mentorships */
export async function handleMentoredWorksRequest(request: Request, deps: MentoredWorksDeps): Promise<Response> {
  const refused = guard(request);
  if (refused !== null) return refused;
  const read = await readMentoredWorks(deps.sessionToken, deps.withActor);
  if (read.kind !== "ok") return refuse(STATUS[read.kind], read.kind);
  return Response.json({ works: read.works }, { status: 200, headers: NO_STORE });
}

/** GET /api/teacher/mentorships/[mentorshipId] */
export async function handleMentoredWorkRequest(
  request: Request,
  deps: MentoredWorksDeps,
  mentorshipId: string,
): Promise<Response> {
  const refused = guard(request);
  if (refused !== null) return refused;
  const read = await readMentoredWork(deps.sessionToken, deps.withActor, mentorshipId);
  if (read.kind !== "ok") return refuse(STATUS[read.kind], read.kind);
  return Response.json({ work: read.work }, { status: 200, headers: NO_STORE });
}
