"use client";

import { useReducer, useRef, useSyncExternalStore, type FormEvent } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { formatDateHr, formatDateTimeHr } from "@/lib/i18n/hr";
import { wordRangeHr } from "@/lib/i18n/length-line";
import { AI_PURPOSES } from "@/components/teacher/assignment-create";

import type { NoticeView } from "./assignment-notice-read";
import { acknowledgeNotice, initialNotice, noticeStep, type NoticeEvent, type NoticeState } from "./notice-gate";
import type { NoticeWindow } from "./notice-window";
import styles from "./AssignmentNotice.module.css";

const s = t.student;
const tools = t.teacher.tools;
const workTypes: Record<string, string> = t.teacher.assignment.workTypes;

const never = () => () => {};

function reduce(state: NoticeState, event: NoticeEvent): NoticeState {
  return noticeStep(state, event).state;
}

// The parts below are components of their own so that the interface text
// scan reads each one apart (tests/unit/forbidden-terms-unreadable.test.ts).

function Confirmed({ text, editor, assignmentId }: { text: string; editor: boolean; assignmentId: string }) {
  return (
    <div className={styles.done}>
      <p role="status">{text}</p>
      {editor ? <p><a className="btn" href={`/rad?zadatak=${encodeURIComponent(assignmentId)}`}>{s.openEditor}</a></p> : null}
    </div>
  );
}

function TimingNote({ text }: { text: string }) {
  return <p className={styles.window} role="status">{text}</p>;
}

function ToolsCard({ view }: { view: NoticeView }) {
  const allowed = AI_PURPOSES.filter((p) => view.aiPurposes.includes(p));
  const banned = [...AI_PURPOSES.filter((p) => !allowed.includes(p)).map((p) => tools.purposes[p]),
    ...Object.values(tools.alwaysBanned)];
  return (
    <section className={styles.card} aria-labelledby="alati">
      <p className={styles.brief}>{view.instructions}</p>
      <div className={styles.rule}>
        <h2 id="alati">{s.toolsHeading}</h2>
        {allowed.length ? (
          <>
            <p className={styles.listHead}>{tools.allowed}</p>
            <ul className={styles.marks}>
              {allowed.map((p) => <li key={p}><span aria-hidden="true" className={styles.yes}>✓</span>{tools.purposes[p]}</li>)}
            </ul>
            {Object.values(tools.conditions).map((text) => <p key={text}>{text}</p>)}
          </>
        ) : (
          <p>{s.noTools}</p>
        )}
        <p className={styles.listHead}>{tools.banned}</p>
        <ul className={styles.marks}>
          {banned.map((text) => <li key={text}><span aria-hidden="true" className={styles.no}>×</span>{text}</li>)}
        </ul>
        <p className={styles.source}>{tools.source}</p>
      </div>
    </section>
  );
}

function RecordCard({ extended }: { extended: boolean }) {
  return (
    <section className={styles.card} aria-labelledby="biljezi">
      <h2 id="biljezi">{s.recordedHeading}</h2>
      <ul>{Object.values(s.recorded).map((text) => <li key={text}>{text}</li>)}</ul>
      <h2>{s.notRecordedHeading}</h2>
      <ul>{Object.values(s.notRecorded).map((text) => <li key={text}>{text}</li>)}</ul>
      <h2>{s.teacherHeading}</h2>
      <ul>
        {Object.values(s.teacher).map((text) => <li key={text}>{text}</li>)}
        {extended ? <li>{s.teacherExtended}</li> : null}
      </ul>
      <div className={styles.rule}>
        <p>{s.retention}</p>
        <p>{s.note}</p>
      </div>
    </section>
  );
}

// S3 of the design handoff, laid out as demo-tok-v2 step 3 (FE-D8). The
// editor link appears only once the server has recorded the acknowledgment;
// nothing else here talks to it. The whole notice stays on the page before
// the confirmation, not behind a dialog as in the prototype.
export default function AssignmentNotice({ view, timing }: { view: NoticeView; timing: NoticeWindow }) {
  const [state, dispatch] = useReducer(reduce, view.acknowledgedAt, initialNotice);
  const sending = useRef(false);
  // Dates are shown in the reader's time zone, so only in the browser: the
  // server renders "…" and hydration never disagrees with it.
  const inBrowser = useSyncExternalStore(never, () => true, () => false);
  const day = (iso: string) => (inBrowser ? formatDateHr(iso) : "…");
  const time = (iso: string) => (inBrowser ? formatDateTimeHr(iso) : "…");

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !noticeStep(state, { type: "confirm" }).send) return;
    sending.current = true;
    dispatch({ type: "confirm" });
    const result = await acknowledgeNotice(view.assignmentId, view.versionNo);
    sending.current = false;
    dispatch({ type: "settled", result });
  }

  // Already confirmed on an earlier visit: the way on to writing comes first.
  const returning = view.acknowledgedAt !== null;
  const done = state.phase === "acknowledged"
    ? <Confirmed text={s.confirmed.replace("{time}", time(state.at))} editor={timing !== "notOpen"} assignmentId={view.assignmentId} />
    : null;
  const note = timing === "notOpen" ? s.notOpen.replace("{time}", time(view.opensAt))
    : timing === "pastDue" ? s.pastDue.replace("{time}", time(view.dueAt)) : null;
  const rangeText = wordRangeHr({ min: view.wordMin, max: view.wordMax });

  return (
    <article className={styles.notice} aria-labelledby="zadatak">
      <header className={styles.head}>
        <p className={styles.kicker}>{s.step}</p>
        <h1 id="zadatak">{view.title}</h1>
        <p className={styles.meta}>
          {workTypes[view.workType] ? `${workTypes[view.workType]} · ` : null}
          {s.opensFrom} {day(view.opensAt)} · {s.due} {time(view.dueAt)}
          {rangeText ? ` · ${rangeText}` : null}
        </p>
      </header>
      {note ? <TimingNote text={note} /> : null}
      {returning ? done : null}
      <ToolsCard view={view} />
      <RecordCard extended={view.evidenceProfile === "extended"} />
      {returning ? null : done}
      {state.phase === "acknowledged" || timing === "notOpen" ? null : (
        <form className={styles.ack} onSubmit={confirm}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={state.phase === "reading" && state.checked}
              disabled={state.phase === "sending"}
              onChange={() => dispatch({ type: "toggle" })}
            />
            {s.checkbox}
          </label>
          <button className="btn" type="submit" disabled={!(state.phase === "reading" && state.checked)}>
            {state.phase === "sending" ? s.confirming : s.confirm}
          </button>
          <p className={styles.hint}>{s.notConsent}</p>
          {state.phase === "reading" && state.error ? <p className={styles.error} role="alert">{s.errors[state.error]}</p> : null}
        </form>
      )}
    </article>
  );
}
