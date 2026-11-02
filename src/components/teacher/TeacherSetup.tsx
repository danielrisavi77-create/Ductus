"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { formatDateHr, formatDateTimeHr } from "@/lib/i18n/hr";
import { wordRangeHr } from "@/lib/i18n/length-line";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import {
  AI_PURPOSES,
  WORK_TYPES,
  assignmentBody,
  createAssignment,
  parseWordRange,
  type AiPurpose,
  type AssignmentCreation,
  type WorkType,
} from "./assignment-create";
import { createCourse, type CourseCreation, type CoursePolicy } from "./course-create";
import { createCourseThenCode, enrollmentCodeExpiry, type EnrollmentCodeCreation } from "./enrollment-code-create";
import type { ExistingCourse } from "./existing-course";
import styles from "./TeacherSetup.module.css";

const YEARS = Object.keys(t.teacher.course.years) as (keyof typeof t.teacher.course.years)[];
const POLICIES = Object.keys(t.teacher.course.policies) as CoursePolicy[];

function PreviewRange({ text }: { text: string | null }) {
  return text ? <span> · {text}</span> : null;
}

// Only a code the route returned is shown; the server keeps just its hash, so
// this is the one time it can be read (#576).
function CourseCode({ issued, pending }: { issued: { code: string; validUntil: string } | null; pending: boolean }) {
  const ec = t.teacher.enrollmentCode;
  return (
    <div className={styles.code} role="status">
      {issued ? (
        <>
          <p className={styles.listHead}>{t.teacher.course.code}: <code>{issued.code}</code></p>
          <p className={styles.hint}>{ec.validUntil} {formatDateTimeHr(issued.validUntil)}</p>
          <p className={styles.hint}>{ec.shownOnce}</p>
        </>
      ) : pending ? null : <p className={styles.hint}>{ec.courseKept}</p>}
    </div>
  );
}

// The course an assignment joins when it is not created here (DAN-310): read
// only, and no enrollment code is issued, so the course's code stays as it is.
function CourseSummary({ course }: { course: ExistingCourse }) {
  const c = t.teacher.course;
  return (
    <section className={styles.card} aria-labelledby="kolegij">
      <h2 id="kolegij">{c.heading}</h2>
      <p className={styles.listHead}>{course.name}</p>
      <p className={styles.hint}>
        {c.years[course.academicYear as keyof typeof c.years] ?? course.academicYear} · {c.policies[course.aiPolicy]}
      </p>
      <p className={styles.hint}>{t.teacher.existingCourse.codeKept}</p>
    </section>
  );
}

// Screen 2 of the design handoff. No identity fields: the verified B-7 role on
// the server decides who may create a course or an assignment.
// DAN-310 (M2.4-P01): with `existingCourse` the assignment joins that course
// and the course form is replaced by its summary.
export default function TeacherSetup({ existingCourse = null }: { existingCourse?: ExistingCourse | null }) {
  const c = t.teacher.course;
  const a = t.teacher.assignment;
  const tools = t.teacher.tools;
  const ec = t.teacher.enrollmentCode;

  const [name, setName] = useState("");
  const [academicYear, setAcademicYear] = useState<string>(YEARS[0]!);
  const [aiPolicy, setAiPolicy] = useState<CoursePolicy>(existingCourse?.aiPolicy ?? "partially_allowed");
  const [course, setCourse] = useState<{ id: string; policy: CoursePolicy } | null>(
    existingCourse ? { id: existingCourse.id, policy: existingCourse.aiPolicy } : null);
  const [courseResult, setCourseResult] = useState<CourseCreation | "nameMissing" | null>(null);
  const savedCourse = useRef<string | null>(null);
  const [validUntilLocal, setValidUntilLocal] = useState("");
  const [codeResult, setCodeResult] = useState<EnrollmentCodeCreation | "missing" | null>(null);
  const expiry = enrollmentCodeExpiry(validUntilLocal);
  const expiryInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [workType, setWorkType] = useState<WorkType>("seminar_paper");
  const [opensAt, setOpensAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [wordMin, setWordMin] = useState("");
  const [wordMax, setWordMax] = useState("");
  const [purposes, setPurposes] = useState<AiPurpose[]>([...AI_PURPOSES]);
  const [assignmentResult, setAssignmentResult] = useState<AssignmentCreation | null>(null);

  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const request = useRef<{ body: string; id: string } | null>(null);
  // A response that arrives after the screen is gone sends nothing further.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

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
    if (inFlight.current) return;
    if (!savedCourse.current && !name.trim()) return setCourseResult("nameMissing");
    // A deadline already past on this device is refused before any request; the server still decides the rest.
    if (!expiry || Date.parse(expiry.validUntil) <= Date.now()) {
      setCodeResult(validUntilLocal ? { kind: "invalid" } : "missing");
      expiryInput.current?.focus();
      return;
    }
    const draft = { name: name.trim(), academicYear, aiPolicy };
    const validUntil = expiry.validUntil;
    void guarded(async () => {
      // An earlier code is not shown while a new one is asked for: its fate is unknown until the reply.
      setCodeResult(null);
      const code = await createCourseThenCode({
        courseId: savedCourse.current,
        createCourse: () => createCourse(draft),
        onCourse: (result) => {
          setCourseResult(result);
          if (result.kind !== "available") return;
          savedCourse.current = result.id;
          setCourse({ id: result.id, policy: draft.aiPolicy });
        },
        validUntil,
        active: () => alive.current,
      });
      if (!code) return;
      setCodeResult(code);
      if (code.kind === "invalid") expiryInput.current?.focus();
    });
  }

  // A retry key belongs to the serialized body, not the raw form text.
  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setAssignmentResult(null);
    };
  }

  const coursePolicy = course?.policy ?? aiPolicy;
  const allowed = coursePolicy === "prohibited" ? [] : AI_PURPOSES.filter((p) => purposes.includes(p));
  const bannedPurposes = AI_PURPOSES.filter((p) => !allowed.includes(p));
  const published = assignmentResult?.kind === "available";
  const previewRange = parseWordRange(wordMin, wordMax);
  const previewRangeText = previewRange ? wordRangeHr({ min: previewRange.wordMin, max: previewRange.wordMax }) : null;

  function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!course || published) return;
    const body = assignmentBody({ title, instructions, workType, opensAt, dueAt, aiPurposes: purposes, wordMin, wordMax }, course.policy);
    if (!body) return setAssignmentResult({ kind: "invalid" });
    const serialized = JSON.stringify(body);
    if (request.current?.body !== serialized) request.current = { body: serialized, id: crypto.randomUUID() };
    const key = request.current.id;
    void guarded(async () => setAssignmentResult(await createAssignment(course.id, body, key)));
  }

  const courseNotice =
    courseResult === "nameMissing" ? c.nameMissing
    : courseResult && courseResult.kind !== "available" ? c.errors[courseResult.kind] : null;
  const assignmentError =
    assignmentResult && assignmentResult.kind !== "available" ? a.errors[assignmentResult.kind] : null;
  const date = (local: string) => (local ? formatDateHr(local) : "…");
  const issued = codeResult !== null && codeResult !== "missing" && codeResult.kind === "available" ? codeResult : null;
  const codeError = codeResult === "missing" ? ec.errors.missing
    : codeResult && codeResult.kind !== "available" ? ec.errors[codeResult.kind] : null;
  // The instant and offset the request will carry, so a repeated autumn hour is never ambiguous.
  const selectedExpiry = expiry ? `${ec.selected} ${formatDateTimeHr(expiry.validUntil)} (UTC${expiry.offset})` : "";
  const courseLabel = pending ? (course ? ec.pending : c.pending) : !course ? c.submit : issued ? ec.replace : ec.retry;

  return (
    <div className={styles.layout}>
      <div className={styles.forms}>
        {existingCourse ? <CourseSummary course={existingCourse} /> : (
        /* noValidate: the Croatian messages below answer a missing or impossible deadline, not the browser. */
        <form className={styles.card} onSubmit={submitCourse} aria-labelledby="kolegij" noValidate>
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
          </fieldset>
          <fieldset className={styles.fields} disabled={pending}>
            <label className={styles.field}>
              <span>{ec.validUntil}</span>
              <input ref={expiryInput} className={styles.control} type="datetime-local" required
                value={validUntilLocal} aria-describedby="kod-rok-pomoc kod-rok-odabrano kod-greska"
                aria-invalid={codeResult === "missing" || codeResult?.kind === "invalid" || undefined}
                onChange={(event) => { setValidUntilLocal(event.target.value); if (!issued) setCodeResult(null); }} />
            </label>
            <p id="kod-rok-pomoc" className={styles.hint}>{ec.expiryHelp}</p>
            <p id="kod-rok-odabrano" className={styles.hint}>
              {selectedExpiry}
            </p>
            <button className="btn" type="submit">{courseLabel}</button>
          </fieldset>
          {courseNotice ? <p className={styles.notice} role="alert">{courseNotice}</p> : null}
          {codeError ? <p id="kod-greska" className={styles.notice} role="alert">{codeError}</p> : null}
          {course ? (
            <>
              <p className={styles.notice} role="status">{c.created}</p>
              <CourseCode issued={issued} pending={pending} />
            </>
          ) : null}
        </form>
        )}

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
            <div className={styles.pair}>
              <label className={styles.field}>
                <span>{a.wordMin}</span>
                <input className={styles.control} type="text" inputMode="numeric" autoComplete="off"
                  value={wordMin} onChange={(e) => edit(setWordMin)(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>{a.wordMax}</span>
                <input className={styles.control} type="text" inputMode="numeric" autoComplete="off"
                  value={wordMax} onChange={(e) => edit(setWordMax)(e.target.value)} />
              </label>
            </div>
            <p className={styles.hint}>{a.wordRangeHint}</p>

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
              {/* DAN-345: with every purpose allowed there is no empty list, only the sentence. */}
              {bannedPurposes.length ? (
                <ul className={styles.banned}>
                  {bannedPurposes.map((p) => (
                    <li key={p}><s>{tools.purposes[p]}</s></li>
                  ))}
                </ul>
              ) : (
                <p className={styles.hint}>{tools.bannedNone}</p>
              )}
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
          <p className={styles.hint}>
            {existingCourse ? t.teacher.existingCourse.studentsNotified : course ? a.studentsNotified : a.needCourse}
          </p>
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
          <PreviewRange text={previewRangeText} />
        </p>
        {instructions.trim() ? <p className={styles.brief}>{instructions}</p> : null}
        <p className={styles.listHead}>{tools.allowed}</p>
        {/* DAN-345: nothing allowed reads as the student's notice does, not as an empty list. */}
        {allowed.length ? (
          <ul className={styles.summary}>
            {allowed.map((p) => <li key={p}><span aria-hidden="true">✓ </span>{tools.purposes[p]}</li>)}
          </ul>
        ) : (
          <p className={styles.hint}>{t.student.noTools}</p>
        )}
        <p className={styles.listHead}>{tools.banned}</p>
        <ul className={styles.summary}>
          {[...bannedPurposes.map((p) => tools.purposes[p]),
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
