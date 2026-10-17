"use client";

import { useRef, useState, type FormEvent } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { createCourse, type CourseCreation, type CoursePolicy } from "./course-create";
import styles from "./TeacherSetup.module.css";

const YEARS = Object.keys(t.teacher.course.years) as (keyof typeof t.teacher.course.years)[];
const POLICIES = Object.keys(t.teacher.course.policies) as CoursePolicy[];

// Screen 2 of the design handoff. No identity fields: the verified B-7 role on
// the server decides who may create a course.
export default function TeacherSetup() {
  const c = t.teacher.course;

  const [name, setName] = useState("");
  const [academicYear, setAcademicYear] = useState<string>(YEARS[0]!);
  const [aiPolicy, setAiPolicy] = useState<CoursePolicy>("partially_allowed");
  const [course, setCourse] = useState<{ id: string; policy: CoursePolicy } | null>(null);
  const [courseResult, setCourseResult] = useState<CourseCreation | "nameMissing" | null>(null);

  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  async function guarded(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function submitCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return setCourseResult("nameMissing");
    void guarded(async () => {
      const result = await createCourse({ name: name.trim(), academicYear, aiPolicy });
      setCourseResult(result);
      if (result.kind === "available") setCourse({ id: result.id, policy: aiPolicy });
    });
  }

  const courseNotice =
    courseResult === "nameMissing" ? c.nameMissing
    : courseResult && courseResult.kind !== "available" ? c.errors[courseResult.kind] : null;

  return (
    <div className={styles.layout}>
      <div className={styles.forms}>
        <form className={styles.card} onSubmit={submitCourse} aria-labelledby="kolegij">
          <h2 id="kolegij">{c.heading}</h2>
          <fieldset className={styles.fields} disabled={pending || course !== null}>
            <label className={styles.field}>
              <span>{c.name}</span>
              <input className={styles.control} value={name} maxLength={160} autoComplete="off"
                onChange={(e) => { setName(e.target.value); setCourseResult(null); }} />
            </label>
            <label className={styles.field}>
              <span>{c.year}</span>
              <select className={styles.control} value={academicYear} onChange={(e) => setAcademicYear(e.target.value)}>
                {YEARS.map((y) => <option key={y} value={y}>{c.years[y]}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>{c.policy}</span>
              <select className={styles.control} value={aiPolicy}
                onChange={(e) => setAiPolicy(e.target.value as CoursePolicy)}>
                {POLICIES.map((p) => <option key={p} value={p}>{c.policies[p]}</option>)}
              </select>
            </label>
            <button className="btn" type="submit">{pending && !course ? c.pending : c.submit}</button>
          </fieldset>
          {courseNotice ? <p className={styles.notice} role="alert">{courseNotice}</p> : null}
          {course ? <p className={styles.notice} role="status">{c.created}</p> : null}
        </form>
      </div>
    </div>
  );
}
