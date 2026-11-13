"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { WORK_LANGUAGES, type WorkLanguage } from "@/domain/assignment/work-language";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { saveWorkLanguageException, workLanguageExceptionHref, type WorkLanguageExceptionSave } from "./work-language";
import styles from "./TeacherSetup.module.css";

const w = t.teacher.workLanguageException;
const names = t.workspace.upute.workLanguages;

export interface WorkLanguageExceptionCardProps {
  assignmentId: string;
  /** The work's document id, for the page link only. */
  documentId: string;
  /** For the POST only; never shown. */
  studentId: string;
  assignmentLanguage: WorkLanguage;
  /** The exception as read; null means the work follows its assignment. */
  exception: WorkLanguage | null;
  /** Initial outcome; only tests pass it, to render a state without a click. */
  initial?: WorkLanguageExceptionSave | null;
}

// DAN-386 (M2.10-P02d, contract on #1836 c.6858305983): one work's language,
// apart from its assignment's. A save sets the exception as chosen, so after
// a confirmed save the card stays usable; a conflict, a refusal or an
// unconfirmed reply locks it and offers a fresh read, never a resend.
export default function WorkLanguageExceptionCard({
  assignmentId, documentId, studentId, assignmentLanguage, exception, initial = null,
}: WorkLanguageExceptionCardProps) {
  const [chosen, setChosen] = useState<WorkLanguage | null>(exception);
  const [result, setResult] = useState<WorkLanguageExceptionSave | null>(initial);
  const [pending, setPending] = useState(false);
  // The exception in force: the one read, or the one a confirmed save returned.
  const [inForce, setInForce] = useState<WorkLanguage | null>(exception);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const locked = pending || (result !== null && result.kind !== "saved" && result.kind !== "invalid");
  const changed = chosen !== inForce;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || locked || !changed) return;
    inFlight.current = true;
    setPending(true);
    const language = chosen;
    void saveWorkLanguageException(assignmentId, studentId, language).then((reply) => {
      inFlight.current = false;
      if (!alive.current) return;
      setPending(false);
      // The server answers with the language after the change; with no exception that is the assignment's.
      if (reply.kind === "saved") setInForce(language);
      setResult(reply);
    });
  }

  const effective = inForce ?? assignmentLanguage;
  const error = result && result.kind !== "saved" ? w.errors[result.kind] : null;
  const page = workLanguageExceptionHref(assignmentId, documentId) ?? "/nastavnik";
  const choices: readonly (WorkLanguage | null)[] = [null, ...WORK_LANGUAGES];
  return (
    <form className={styles.card} onSubmit={submit} aria-labelledby="jezik-rada-studenta">
      <h2 id="jezik-rada-studenta">{w.link}</h2>
      <p className={styles.hint}>{w.lead}</p>
      <p className={styles.hint}>{w.assignmentLanguage.replace("{language}", names[assignmentLanguage])}</p>
      <p className={styles.hint}>{w.current.replace("{language}", names[effective])}</p>
      <fieldset className={styles.tools} disabled={locked}>
        <legend className="visually-hidden">{w.link}</legend>
        {choices.map((language) => (
          <label key={language ?? "zadatak"} className={styles.check}>
            <input type="radio" name="jezik-rada-studenta" value={language ?? ""} checked={chosen === language}
              onChange={() => { setChosen(language); setResult(null); }} />
            <span>{language === null ? w.asAssignment.replace("{language}", names[assignmentLanguage]) : names[language]}</span>
          </label>
        ))}
      </fieldset>
      {changed && chosen !== null ? <p className={styles.hint}>{w.exceptionNote}</p> : null}
      <button className="btn" type="submit" disabled={locked || !changed}>{pending ? w.pending : w.save}</button>
      {result?.kind === "saved" ? <p className={styles.notice} role="status">{w.saved.replace("{language}", names[result.language])}</p> : null}
      {error ? <p className={styles.notice} role="alert">{error}</p> : null}
      {locked && !pending ? <p><a href={page}>{w.reload}</a></p> : null}
    </form>
  );
}
