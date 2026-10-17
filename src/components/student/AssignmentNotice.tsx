"use client";

import { useReducer, useRef, useSyncExternalStore, type FormEvent } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { formatDateHr, formatDateTimeHr } from "@/lib/i18n/hr";
import { AI_PURPOSES } from "@/components/teacher/assignment-create";

import type { NoticeView } from "./assignment-notice-read";
import { acknowledgeNotice, initialNotice, noticeStep, type NoticeEvent, type NoticeState } from "./notice-gate";
import styles from "./AssignmentNotice.module.css";

const s = t.student;
const tools = t.teacher.tools;

const never = () => () => {};

function reduce(state: NoticeState, event: NoticeEvent): NoticeState {
  return noticeStep(state, event).state;
}

// S3 of the design handoff (screen 3). The editor link appears only once the
// server has recorded the acknowledgment; nothing else here talks to it.
export default function AssignmentNotice({ view }: { view: NoticeView }) {
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

  const allowed = AI_PURPOSES.filter((p) => view.aiPurposes.includes(p));
  const banned = [...AI_PURPOSES.filter((p) => !allowed.includes(p)).map((p) => tools.purposes[p]),
    ...Object.values(tools.alwaysBanned)];

  return (
    <article className={styles.notice} aria-labelledby="zadatak">
      <p className={styles.hint}>{s.step}</p>
      <h1 id="zadatak">{view.title}</h1>
      <p className={styles.hint}>
        {t.teacher.assignment.workTypes[view.workType]} · {s.opensFrom} {day(view.opensAt)} · {s.due}{" "}
        {time(view.dueAt)}
      </p>
      <p className={styles.brief}>{view.instructions}</p>

      <section aria-labelledby="alati">
        <h2 id="alati">{s.toolsHeading}</h2>
        {allowed.length ? (
          <>
            <p className={styles.listHead}>{tools.allowed}</p>
            <ul>{allowed.map((p) => <li key={p}>{tools.purposes[p]}</li>)}</ul>
            {Object.values(tools.conditions).map((text) => <p key={text}>{text}</p>)}
          </>
        ) : (
          <p>{s.noTools}</p>
        )}
        <p className={styles.listHead}>{tools.banned}</p>
        <ul>{banned.map((text) => <li key={text}>{text}</li>)}</ul>
        <p className={styles.hint}>{tools.source}</p>
      </section>

      <section aria-labelledby="biljezi">
        <h2 id="biljezi">{s.recordedHeading}</h2>
        <ul>{Object.values(s.recorded).map((text) => <li key={text}>{text}</li>)}</ul>
        <h2>{s.notRecordedHeading}</h2>
        <ul>{Object.values(s.notRecorded).map((text) => <li key={text}>{text}</li>)}</ul>
        <h2>{s.teacherHeading}</h2>
        <ul>{Object.values(s.teacher).map((text) => <li key={text}>{text}</li>)}</ul>
        <p>{s.retention}</p>
        <p>{s.note}</p>
      </section>

      {state.phase === "acknowledged" ? (
        <div className={styles.done}>
          <p role="status">{s.confirmed.replace("{time}", time(state.at))}</p>
          <p><a href="/rad">{s.openEditor}</a></p>
        </div>
      ) : (
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
          <button type="submit" disabled={!(state.phase === "reading" && state.checked)}>
            {state.phase === "sending" ? s.confirming : s.confirm}
          </button>
          <p className={styles.hint}>{s.notConsent}</p>
          {state.phase === "reading" && state.error ? <p role="alert">{s.errors[state.error]}</p> : null}
        </form>
      )}
    </article>
  );
}
