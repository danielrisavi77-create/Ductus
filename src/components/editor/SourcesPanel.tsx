"use client";

/**
 * The "Literatura" tab of the right panel (DAN-343, design editor-v11 "Brzi
 * izvor", INTEGRACIJA §3 point 3). The form describes a book or a journal
 * article; "Dodaj i citiraj" writes the citation at the cursor and the entry
 * into the bibliography, "Samo u Literaturu" only the entry. The text comes
 * from the citation domain alone (`sources.ts`). The list of sources lives
 * only while the sheet is open; what was written stays in the text.
 * While the sheet may not be written in, every writing button says so with
 * `aria-disabled` and does nothing, as in the toolbar.
 */

import { useEditorState } from "@tiptap/react";
import { useId, useRef, useState } from "react";

import { messagesHr } from "@/lib/i18n/messages.hr";

import { useLocalEditor } from "./LocalDocument";
import {
  citationText, compareEntries, EMPTY_FIELDS, entryText, sourceFromFields, writeSource,
  type SourceField, type SourceFields, type SourceKind,
} from "./sources";
import styles from "./SourcesPanel.module.css";

const t = messagesHr.workspace.sources;

type Added = { entry: string; source: Extract<ReturnType<typeof sourceFromFields>, { ok: true }>["source"] };

export default function SourcesPanel() {
  const editor = useLocalEditor();
  const editable = useEditorState({
    editor, selector: ({ editor: e }) => e !== null && !e.isDestroyed && e.isEditable,
  }) ?? false;
  const id = useId();
  const addRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<SourceFields>(EMPTY_FIELDS);
  const [page, setPage] = useState("");
  const [tried, setTried] = useState(false);
  const [added, setAdded] = useState<readonly Added[]>([]);
  const [listPage, setListPage] = useState("");

  const check = sourceFromFields(fields);
  const invalid = new Set<SourceField>(tried && !check.ok ? [...check.missing, ...(check.yearInvalid ? ["year" as const] : [])] : []);

  // Checked again at the click: a sign-out stops writing without a render.
  const canWrite = () => editable && editor !== null && !editor.isDestroyed && editor.isEditable;

  const close = () => {
    setOpen(false);
    setFields(EMPTY_FIELDS);
    setPage("");
    setTried(false);
    requestAnimationFrame(() => addRef.current?.focus());
  };

  const commit = (cite: boolean) => {
    setTried(true);
    if (!check.ok || !canWrite()) return;
    const entry = entryText(check.source);
    if (!writeSource(editor, cite ? citationText(check.source, page) : null, entry)) return;
    const source = check.source;
    setAdded((list) => (list.some((item) => item.entry === entry) ? list : [...list, { entry, source }].sort((a, b) => compareEntries(a.entry, b.entry))));
    close();
  };

  const cite = (item: Added) => {
    if (canWrite()) writeSource(editor, citationText(item.source, listPage), null);
  };

  const set = (field: keyof SourceFields) => (value: string) => setFields((f) => ({ ...f, [field]: value }));
  const input = (field: SourceField, label: string, numeric = false) => (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        value={fields[field]}
        inputMode={numeric ? "numeric" : undefined}
        aria-invalid={invalid.has(field) ? "true" : undefined}
        onChange={(event) => set(field)(event.target.value)}
      />
    </label>
  );
  const writing = (label: string, onClick: () => void, primary = false) => (
    <button
      type="button"
      className={primary ? styles.primary : styles.secondary}
      aria-disabled={editable ? undefined : "true"}
      onClick={onClick}
    >
      {label}
    </button>
  );

  const errors = tried && !check.ok ? [
    ...check.missing.map((field) => t.required.replace("{field}", t[field])),
    ...(check.yearInvalid ? [t.yearInvalid] : []),
  ] : [];

  return (
    <div className={styles.panel}>
      {editable ? null : <p className={styles.note}>{t.readOnly}</p>}
      {open ? (
        <form className={styles.form} aria-labelledby={`${id}-form`} onSubmit={(event) => event.preventDefault()}>
          <h2 id={`${id}-form`} className={styles.label}>{t.formTitle}</h2>
          <fieldset className={styles.kinds}>
            <legend>{t.type}</legend>
            {(["book", "article"] as const satisfies readonly SourceKind[]).map((kind) => (
              <label key={kind}>
                <input
                  type="radio" name={`${id}-kind`} value={kind}
                  checked={fields.kind === kind} onChange={() => set("kind")(kind)}
                />
                {t[kind]}
              </label>
            ))}
          </fieldset>
          {input("family", t.family)}
          {input("given", t.given)}
          <fieldset className={styles.group}>
            <legend>{t.secondAuthor}</legend>
            {input("family2", t.family2)}
            {input("given2", t.given2)}
          </fieldset>
          {input("year", t.year, true)}
          {input("title", t.title)}
          {fields.kind === "book" ? (
            <>{input("place", t.place)}{input("publisher", t.publisher)}</>
          ) : (
            <>{input("journal", t.journal)}{input("volume", t.volume)}{input("issue", t.issue)}{input("pages", t.pages)}</>
          )}
          <label className={styles.field}>
            <span>{t.citePage}</span>
            <input value={page} onChange={(event) => setPage(event.target.value)} />
          </label>
          {errors.length > 0 ? (
            <ul className={styles.errors} role="alert">{errors.map((text) => <li key={text}>{text}</li>)}</ul>
          ) : null}
          {check.ok ? (
            <section className={styles.preview} aria-labelledby={`${id}-preview`}>
              <h3 id={`${id}-preview`} className={styles.label}>{t.preview}</h3>
              <p data-preview="citation">{citationText(check.source, page)}</p>
              <p data-preview="entry">{entryText(check.source)}</p>
            </section>
          ) : null}
          <div className={styles.actions}>
            {writing(t.addAndCite, () => commit(true), true)}
            {writing(t.addOnly, () => commit(false))}
            <button type="button" className={styles.secondary} onClick={close}>{t.cancel}</button>
          </div>
        </form>
      ) : (
        <button ref={addRef} type="button" className={styles.primary} onClick={() => setOpen(true)}>{t.add}</button>
      )}
      <section className={styles.part} aria-labelledby={`${id}-list`}>
        <h2 id={`${id}-list`} className={styles.label}>{t.listTitle}</h2>
        {added.length === 0 ? <p className="rail-empty">{t.empty}</p> : (
          <>
            <label className={styles.field}>
              <span>{t.citePage}</span>
              <input value={listPage} onChange={(event) => setListPage(event.target.value)} />
            </label>
            <ul className={styles.list}>
              {added.map((item) => (
                <li key={item.entry}>
                  <p>{item.entry}</p>
                  <button
                    type="button"
                    className={styles.secondary}
                    aria-label={`${t.cite}: ${item.entry}`}
                    aria-disabled={editable ? undefined : "true"}
                    onClick={() => cite(item)}
                  >
                    {t.cite}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
