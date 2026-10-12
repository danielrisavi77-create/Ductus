"use client";

import { useRef, useState, type FormEvent } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { createCourse, type CourseCreation, type CoursePolicy } from "./course-create";
import styles from "./CourseForm.module.css";

// This form has no identity fields. Only the verified B-7 role on the server
// and F-6a POST API can authorize or create a course.
export default function CourseForm() {
  const [name, setName] = useState("");
  const [academicYear, setAcademicYear] = useState("2026/2027");
  const [aiPolicy, setAiPolicy] = useState<CoursePolicy>("partially_allowed");
  const [result, setResult] = useState<CourseCreation | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setResult(null);
    setPending(true);
    try {
      setResult(await createCourse({ name, academicYear, aiPolicy }));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const error = result && result.kind !== "created" ? t.teacherCourses.errors[result.kind] : null;
  return (
    <form className={styles.form} onSubmit={submit}>
      <fieldset className={styles.fields} disabled={pending}>
        <label className={styles.field}>
          <span>{t.teacherCourses.nameLabel}</span>
          <input
            className={styles.control}
            name="name"
            value={name}
            onChange={(event) => { setName(event.target.value); setResult(null); }}
            required
            maxLength={160}
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>{t.teacherCourses.yearLabel}</span>
          <input
            className={styles.control}
            name="academicYear"
            value={academicYear}
            onChange={(event) => { setAcademicYear(event.target.value); setResult(null); }}
            required
            pattern="[0-9]{4}/[0-9]{4}"
            maxLength={9}
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>{t.teacherCourses.policyLabel}</span>
          <select
            className={styles.control}
            name="aiPolicy"
            value={aiPolicy}
            onChange={(event) => { setAiPolicy(event.target.value as CoursePolicy); setResult(null); }}
            required
          >
            <option value="prohibited">{t.teacherCourses.policyProhibited}</option>
            <option value="partially_allowed">{t.teacherCourses.policyPartial}</option>
            <option value="encouraged">{t.teacherCourses.policyEncouraged}</option>
          </select>
        </label>
        <button className="btn" type="submit">{pending ? t.teacherCourses.pending : t.teacherCourses.submit}</button>
      </fieldset>
      {error ? <p className={styles.notice} role="alert">{error}</p> : null}
      {result?.kind === "created" ? (
        <p className={styles.notice} role="status" aria-live="polite">
          {t.teacherCourses.created} <code>{result.id}</code>
        </p>
      ) : null}
    </form>
  );
}
