import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { courseMotif } from "./course-motif";
import type { MyAssignmentsRead } from "./my-assignments-read";
import { noticeCourse, type NoticeCourse as Course } from "./notice-course";
import styles from "./AssignmentNotice.module.css";

/** The eyebrow of S03_upute.png: "Kolegij", the course name and its motif. */
export function CourseEyebrow({ course }: { course: Course | null }) {
  if (course === null) return null;
  return (
    <div className={styles.course} data-motif={courseMotif(course.id)}>
      <p className={styles.eyebrow}>{t.student.courseEyebrow}</p>
      <p className={styles.courseName}>{course.name}</p>
    </div>
  );
}

// The page hands in the read without awaiting it and renders this inside a
// Suspense with no fallback: the notice never waits for it, and a read that
// is slow or not ready only leaves the eyebrow out. readMyAssignments never
// rejects (any failure is "unavailable").
export default async function NoticeCourse({ read, assignmentId }: { read: Promise<MyAssignmentsRead>; assignmentId: string }) {
  return <CourseEyebrow course={noticeCourse(await read, assignmentId)} />;
}
