"use client";

import { useRef, useState, type FormEvent } from "react";

import { formatDateHr } from "@/lib/i18n/hr";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import {
  AI_PURPOSES,
  WORK_TYPES,
  assignmentBody,
  createAssignment,
  type AiPurpose,
  type AssignmentCreation,
  type WorkType,
} from "./assignment-create";
import { createCourse, type CourseCreation, type CoursePolicy } from "./course-create";
import styles from "./TeacherSetup.module.css";

const YEARS = Object.keys(t.teacher.course.years) as (keyof typeof t.teacher.course.years)[];
const POLICIES = Object.keys(t.teacher.course.policies) as CoursePolicy[];

// Screen 2 of the design handoff. No identity fields: the verified B-7 role on
// the server decides who may create a course or an assignment.
export default function TeacherSetup() {
  const c = t.teacher.course;
  const a = t.teacher.assignment;
  const tools = t.teacher.tools;

  const [name, setName] = useState("");
  const [academicYear, setAcademicYear] = useState<string>(YEARS[0]!);
  const [aiPolicy, setAiPolicy] = useState<CoursePolicy>("partially_allowed");
  const [course, setCourse] = useState<{ id: string; policy: CoursePolicy } | null>(null);
  const [courseResult, setCourseResult] = useState<CourseCreation | "nameMissing" | null>(null);

  const [title, setTitle] = useState("");
  const [workType, setWorkType] = useState<WorkType>("seminar_paper");
  const [opensAt, setOpensAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [purposes, setPurposes] = useState<AiPurpose[]>([...AI_PURPOSES]);
  const [assignmentResult, setAssignmentResult] = useState<AssignmentCreation | null>(null);

  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const requestId = useRef<string | null>(null);

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

  // Any edit after a refusal is a new body, so it gets a new retry key.
  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      requestId.current = null;
      setAssignmentResult(null);
    };
  }

  const coursePolicy = course?.policy ?? aiPolicy;
  const allowed = coursePolicy === "prohibited" ? [] : AI_PURPOSES.filter((p) => purposes.includes(p));
  const published = assignmentResult?.kind === "available";

  function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!course || published) return;
    const body = assignmentBody({ title, instructions, workType, opensAt, dueAt, aiPurposes: purposes }, course.policy);
    if (!body) return setAssignmentResult({ kind: "invalid" });
    requestId.current ??= crypto.randomUUID();
    const key = requestId.current;
    void guarded(async () => setAssignmentResult(await createAssignment(course.id, body, key)));
  }

  const courseNotice =
    courseResult === "nameMissing" ? c.nameMissing
    : courseResult && courseResult.kind !== "available" ? c.errors[courseResult.kind] : null;
  const assignmentError =
    assignmentResult && assignmentResult.kind !== "available" ? a.errors[assignmentResult.kind] : null;
  const date = (local: string) => (local ? formatDateHr(local) : "…");

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
          {course ? (
            // No invented code: the route for create_enrollment_code does not exist yet.
            <div className={styles.code}>
              <p className={styles.listHead}>
                {c.code} <span className="soon">{t.workspace.soon}</span>
              </p>
              <p className={styles.hint}>{c.codeSoon}</p>
            </div>
          ) : null}
        </form>

        <form className={styles.card} onSubmit={submitAssignment} aria-labelledby="zadatak">
          <h2 id="zadatak">{a.heading}</h2>
          <fieldset className={styles.fields} disabled={pending || published}>
            <label className={styles.field}>
              <span>{a.title}</span>
              <input className={styles.control} value={title} maxLength={200} autoComplete="off"
                onChange={(e) => edit(setTitle)(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>{a.workType}</span>
              <select className={styles.control} value={workType}
                onChange={(e) => edit(setWorkType)(e.target.value as WorkType)}>
                {WORK_TYPES.map((w) => <option key={w} value={w}>{a.workTypes[w]}</option>)}
              </select>
            </label>
            <div className={styles.pair}>
              <label className={styles.field}>
                <span>{a.opensAt}</span>
                <input className={styles.control} type="datetime-local" value={opensAt}
                  onChange={(e) => edit(setOpensAt)(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>{a.dueAt}</span>
                <input className={styles.control} type="datetime-local" value={dueAt}
                  onChange={(e) => edit(setDueAt)(e.target.value)} />
              </label>
            </div>
            <label className={styles.field}>
              <span>{a.instructions}</span>
              <textarea className={styles.control} rows={4} value={instructions}
                onChange={(e) => edit(setInstructions)(e.target.value)} />
            </label>

            <fieldset className={styles.tools}>
              <legend>{tools.heading}</legend>
              <p className={styles.hint}>{coursePolicy === "prohibited" ? tools.courseProhibits : tools.narrowOnly}</p>
              <p className={styles.listHead}>{tools.allowed}</p>
              {AI_PURPOSES.map((p) => (
                <label key={p} className={styles.check}>
                  <input type="checkbox" checked={allowed.includes(p)} disabled={coursePolicy === "prohibited"}
                    onChange={(e) => edit(setPurposes)(e.target.checked
                      ? [...purposes, p] : purposes.filter((x) => x !== p))} />
                  <span>{tools.purposes[p]}</span>
                </label>
              ))}
              {Object.values(tools.conditions).map((text) => <p key={text} className={styles.hint}>{text}</p>)}
              <p className={styles.listHead}>{tools.banned}</p>
              <ul className={styles.banned}>
                {AI_PURPOSES.filter((p) => !allowed.includes(p)).map((p) => (
                  <li key={p}><s>{tools.purposes[p]}</s></li>
                ))}
              </ul>
              <p className={styles.hint}>{tools.alwaysBannedHead}</p>
              <ul className={styles.banned}>
                {Object.values(tools.alwaysBanned).map((text) => <li key={text}>{text}</li>)}
              </ul>
              <p className={styles.hint}>{tools.source}</p>
            </fieldset>

            <button className="btn" type="submit" disabled={!course}>
              {published ? a.published : pending && course ? a.pending : a.publish}
            </button>
          </fieldset>
          <p className={styles.hint}>{course ? a.studentsNotified : a.needCourse}</p>
          <p className={styles.hint}>{a.newVersion}</p>
          {assignmentError ? <p className={styles.notice} role="alert">{assignmentError}</p> : null}
          {published ? <p className={styles.notice} role="status">{a.publishedNotice}</p> : null}
        </form>
      </div>

      <aside className={styles.preview} aria-labelledby="pregled">
        <h2 id="pregled">{t.teacher.preview.heading}</h2>
        <p className={styles.hint}>{t.teacher.preview.step}</p>
        <h3>{title.trim() || t.teacher.preview.untitled}</h3>
        <p className={styles.hint}>
          {a.workTypes[workType]} · {t.teacher.preview.opensFrom} {date(opensAt)} · {t.teacher.preview.due} {date(dueAt)}
        </p>
        {instructions.trim() ? <p className={styles.brief}>{instructions}</p> : null}
        <p className={styles.listHead}>{tools.allowed}</p>
        <ul className={styles.summary}>
          {allowed.map((p) => <li key={p}><span aria-hidden="true">✓ </span>{tools.purposes[p]}</li>)}
        </ul>
        <p className={styles.listHead}>{tools.banned}</p>
        <ul className={styles.summary}>
          {[...AI_PURPOSES.filter((p) => !allowed.includes(p)).map((p) => tools.purposes[p]),
            ...Object.values(tools.alwaysBanned)].map((text) => (
            <li key={text}><span aria-hidden="true">× </span>{text}</li>
          ))}
        </ul>
        {Object.values(tools.conditions).map((text) => <p key={text} className={styles.hint}>{text}</p>)}
        <p className={styles.hint}>{tools.source}</p>
        <p className={styles.hint}>{t.teacher.preview.rest}</p>
      </aside>
    </div>
  );
}
