/**
 * The capture profile of evidence segments v2 (docs/BACKEND.md 4.13 t. 6):
 * one constant shared by the client's capture and the server, stored on the
 * package by `app.open_student_work` and compared with every segment's
 * `evidenceProfileId`.
 */
export const EVIDENCE_PROFILE_ID = "standard-v1";
