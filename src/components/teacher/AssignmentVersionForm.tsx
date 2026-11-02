"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { formatDateTimeHr } from "@/lib/i18n/hr";
import { wordRangeHr } from "@/lib/i18n/length-line";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { AI_PURPOSES, type AiPurpose } from "./assignment-create";
import {
  checkVersion,
  draftOf,
  publishVersion,
  type ChangedField,
  type CurrentVersion,
  type VersionBody,
  type VersionContent,
  type VersionDraft,
  type VersionPublish,
} from "./assignment-version";
import own from "./AssignmentVersionForm.module.css";
import styles from "./TeacherSetup.module.css";

const n = t.teacher.newVersion;
const tools = t.teacher.tools;
const never = () => () => {};

function valueOf(field: ChangedField, v: CurrentVersion | VersionContent): string[] {
  switch (field) {
    case "title": return [v.title];
    case "instructions": return [v.instructions.trim() ? v.instructions : n.empty];
    case "opensAt": return [formatDateTimeHr(v.opensAt)];
    case "dueAt": return [formatDateTimeHr(v.dueAt)];
    case "aiPurposes": return v.aiPurposes.length ? v.aiPurposes.map((p) => tools.purposes[p]) : [n.noPurposes];
    case "wordRange": return [wordRangeHr({ min: v.wordMin, max: v.wordMax }) ?? n.empty];
  }
}

function Values({ lines }: { lines: string[] }) {
  return lines.length === 1 ? <p className={styles.brief}>{lines[0]}</p> : (
    <ul className={styles.summary}>{lines.map((line) => <li key={line}>{line}</li>)}</ul>
  );
}

// The changes the next version makes, each with its value now and after publishing.
function Changes({ current, body, changes }: { current: CurrentVersion; body: VersionBody; changes: ChangedField[] }) {
  return (
    <dl className={own.changes}>
      {changes.map((field) => (
        <div key={field}>
          <dt className={styles.listHead}>{n.fields[field]}</dt>
          <dd>
            <p className={styles.hint}>{n.before}</p>
            <Values lines={valueOf(field, current)} />
            <p className={styles.hint}>{n.after}</p>
            <Values lines={valueOf(field, body)} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Times are read on this device's clock, so the form exists only in the
 * browser: the server renders the frame and hydration never disagrees.
 */
export default function AssignmentVersionForm({ current }: { current: CurrentVersion }) {
  const inBrowser = useSyncExternalStore(never, () => true, () => false);
  return inBrowser ? <VersionEditor current={current} /> : <p className={styles.hint}>…</p>;
}

function VersionEditor({ current }: { current: CurrentVersion }) {
  const a = t.teacher.assignment;
  const next = current.versionNo + 1;
  const [draft, setDraft] = useState<VersionDraft>(() => draftOf(current));
  const [result, setResult] = useState<VersionPublish | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const check = checkVersion(current, draft);
  const published = result?.kind === "published";
  // A stale version is never sent again: only a fresh read of the page may publish.
  const conflict = result?.kind === "conflict";
  const locked = pending || published || conflict;

  function edit<K extends keyof VersionDraft>(key: K, value: VersionDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (!conflict) setResult(null);
  }

  function togglePurpose(p: AiPurpose, on: boolean) {
    edit("aiPurposes", on ? [...draft.aiPurposes, p] : draft.aiPurposes.filter((x) => x !== p));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || locked || check.kind !== "ready") return;
    inFlight.current = true;
    setPending(true);
    const body = check.body;
    void publishVersion(current.assignmentId, body).then((reply) => {
      inFlight.current = false;
      if (!alive.current) return;
      setPending(false);
      setResult(reply);
    });
  }

  const error = result && result.kind !== "published" ? n.errors[result.kind] : null;
  const blocked = check.kind === "invalid" ? n.errors.invalid
    : check.kind === "widening" ? n.widening
    : check.kind === "unchanged" ? n.unchanged : null;

  return (
    <form className={styles.layout} onSubmit={submit} aria-labelledby="izmjene">
      <section className={styles.card} aria-labelledby="izmjene">
        <h2 id="izmjene">{a.heading}</h2>
        <p className={styles.hint}>{n.current.replace("{n}", String(current.versionNo))}</p>
        <fieldset className={styles.fields} disabled={pending || published}>
          <label className={styles.field}>
            <span>{a.title}</span>
            <input className={styles.control} value={draft.title} maxLength={200} autoComplete="off"
              onChange={(e) => edit("title", e.target.value)} />
          </label>
          <div className={styles.pair}>
            <label className={`${styles.field} ${own.time}`}>
              <span>{a.opensAt}</span>
              <input className={styles.control} type="datetime-local" value={draft.opensAt}
                onChange={(e) => edit("opensAt", e.target.value)} />
            </label>
            <label className={`${styles.field} ${own.time}`}>
              <span>{a.dueAt}</span>
              <input className={styles.control} type="datetime-local" value={draft.dueAt}
                onChange={(e) => edit("dueAt", e.target.value)} />
            </label>
          </div>
          <label className={styles.field}>
            <span>{a.instructions}</span>
            <textarea className={styles.control} rows={4} value={draft.instructions}
              onChange={(e) => edit("instructions", e.target.value)} />
          </label>
          <div className={styles.pair}>
            <label className={styles.field}>
              <span>{a.wordMin}</span>
              <input className={styles.control} type="text" inputMode="numeric" autoComplete="off"
                value={draft.wordMin} onChange={(e) => edit("wordMin", e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>{a.wordMax}</span>
              <input className={styles.control} type="text" inputMode="numeric" autoComplete="off"
                value={draft.wordMax} onChange={(e) => edit("wordMax", e.target.value)} />
            </label>
          </div>
          <p className={styles.hint}>{n.wordsHint}</p>
          <fieldset className={styles.tools}>
            <legend>{tools.heading}</legend>
            <p className={styles.hint}>{n.purposesHint}</p>
            {AI_PURPOSES.map((p) => (
              <label key={p} className={styles.check}>
                <input type="checkbox" checked={draft.aiPurposes.includes(p) && current.aiPurposes.includes(p)}
                  disabled={!current.aiPurposes.includes(p)}
                  onChange={(e) => togglePurpose(p, e.target.checked)} />
                <span>{tools.purposes[p]}</span>
              </label>
            ))}
            <p className={styles.hint}>{tools.source}</p>
          </fieldset>
          <p className={styles.hint}>{n.fixed}</p>
        </fieldset>
      </section>

      <aside className={styles.preview} aria-labelledby="promjene">
        <h2 id="promjene">{n.previewHeading}</h2>
        {published ? null : <p className={styles.hint}>{n.lead.replace("{n}", String(next))}</p>}
        {check.kind === "ready" ? <Changes current={current} body={check.body} changes={check.changes} /> : null}
        {blocked && !published ? <p className={styles.notice} role="status">{blocked}</p> : null}
        {check.kind === "ready" && !published ? (
          <p className={`${styles.hint} ${own.consequence}`}>{n.consequence.replace("{n}", String(next))}</p>
        ) : null}
        <button className="btn" type="submit" disabled={locked || check.kind !== "ready"}>
          {pending ? n.pending : n.publish.replace("{n}", String(next))}
        </button>
        {error ? <p className={styles.notice} role="alert">{error}</p> : null}
        {conflict ? <p><a href={`/nastavnik/zadatak/${current.assignmentId}/uredi`}>{n.reload}</a></p> : null}
        {result?.kind === "published" ? (
          <>
            <p className={styles.notice} role="status">{n.published.replace("{n}", String(result.versionNo))}</p>
            <p><Link href="/nastavnik">{t.teacher.backCourses}</Link></p>
          </>
        ) : null}
      </aside>
    </form>
  );
}
