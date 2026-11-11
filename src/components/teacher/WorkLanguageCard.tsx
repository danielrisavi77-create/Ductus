"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { WORK_LANGUAGES, type WorkLanguage } from "@/domain/assignment/work-language";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { saveAssignmentWorkLanguage, type WorkLanguageSave } from "./work-language";
import styles from "./TeacherSetup.module.css";

const w = t.teacher.workLanguage;
const names = t.workspace.upute.workLanguages;

export interface WorkLanguageCardProps {
  assignmentId: string;
  versionNo: number;
  current: WorkLanguage;
  /** Initial outcome; only tests pass it, to render a state without a click. */
  initial?: WorkLanguageSave | null;
}

// DAN-386 (M2.10-P02c, contract on #1836 c.6791532518): the assignment's work
// language, separate from the interface language (F-06, D-67). A change is a
// new version saved against the one read; after a save, a conflict or an
// unconfirmed reply the card locks and offers a fresh read, never a resend.
export default function WorkLanguageCard({ assignmentId, versionNo, current, initial = null }: WorkLanguageCardProps) {
  const [chosen, setChosen] = useState<WorkLanguage>(current);
  const [result, setResult] = useState<WorkLanguageSave | null>(initial);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const next = versionNo + 1;
  const saved = result?.kind === "saved";
  // Only an invalid choice may be corrected and sent again; every other outcome needs a fresh read.
  const locked = pending || (result !== null && result.kind !== "invalid");
  const changed = chosen !== current;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || locked || !changed) return;
    inFlight.current = true;
    setPending(true);
    void saveAssignmentWorkLanguage(assignmentId, versionNo, chosen).then((reply) => {
      inFlight.current = false;
      if (!alive.current) return;
      setPending(false);
      setResult(reply);
    });
  }

  const error = result && result.kind !== "saved" ? w.errors[result.kind] : null;
  return (
    <form className={styles.card} onSubmit={submit} aria-labelledby="jezik-rada">
      <h2 id="jezik-rada">{w.heading}</h2>
      <p className={styles.hint}>{w.lead}</p>
      <p className={styles.hint}>{w.current.replace("{language}", names[current])}</p>
      <fieldset className={styles.tools} disabled={locked}>
        <legend className="visually-hidden">{w.heading}</legend>
        {WORK_LANGUAGES.map((language) => (
          <label key={language} className={styles.check}>
            <input type="radio" name="jezik-rada" value={language} checked={chosen === language}
              onChange={() => { setChosen(language); setResult(null); }} />
            <span>{names[language]}</span>
          </label>
        ))}
      </fieldset>
      {changed && !saved ? <p className={styles.hint}>{w.consequence.replace("{n}", String(next))}</p> : null}
      {saved ? null : (
        <button className="btn" type="submit" disabled={locked || !changed}>
          {pending ? w.pending : changed ? w.save.replace("{language}", names[chosen]) : w.saveIdle}
        </button>
      )}
      {result?.kind === "saved" ? <p className={styles.notice} role="status">{w.saved.replace("{n}", String(result.version))}</p> : null}
      {error ? <p className={styles.notice} role="alert">{error}</p> : null}
      {locked && !pending ? <p><a href={`/nastavnik/zadatak/${assignmentId}/uredi`}>{w.reload}</a></p> : null}
    </form>
  );
}
