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

import { useLocalEditor, useLocalSignedOut } from "./LocalDocument";
import {
  blocksOf, citationText, compareEntries, EMPTY_FIELDS, entryText, FIELD_MAX, formErrors, PAGE_MAX, pageFits, sourceFromFields, storable, suffixPlan, writeSource,
  type SourceField, type SourceFields, type SourceKind,
} from "./sources";
import styles from "./SourcesPanel.module.css";

const t = messagesHr.workspace.sources;
const pageTooLong = t.pageTooLong.replace("{n}", String(PAGE_MAX));
// The page of a citation: within its limit and kept by the sheet exactly as typed (QA on #866).
const pageValid = (page: string) => pageFits(page) && storable(page);

type Added = { entry: string; source: Extract<ReturnType<typeof sourceFromFields>, { ok: true }>["source"] };

// Contract on #866: the form writes only on a trusted click or key; a script's click writes nothing.
const trusted = (action: () => void) => (event: { isTrusted: boolean }) => {
  if (event.isTrusted) action();
};

export default function SourcesPanel() {
  const signedOut = useLocalSignedOut();
  // The panel keeps nobody's sources or form after the session ends (as CommentPanel).
  return signedOut ? <div className={styles.panel}><p className={styles.note}>{t.readOnly}</p></div> : <SourcesForm />;
}

function SourcesForm() {
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
  // DAN-484: a value over its limit or one the sheet would change is shown as
  // it is typed or pasted, never cut; an empty field only after a click.
  const problems = formErrors(check, page, tried);
  const invalid = new Set<SourceField>(problems.flatMap((p) => ("field" in p ? [p.field] : p.kind === "yearInvalid" ? ["year" as const] : [])));
  // The work as it would be written now, with the letter of its year (DAN-484);
  // the write plans again from the sheet at the click.
  const plan = useEditorState({
    editor, selector: ({ editor: e }) => (e === null || !check.ok ? null : suffixPlan(blocksOf(e.state.doc), check.source)),
  }) ?? null;
  // With every letter of the year taken nothing would be written, so no preview is shown.
  const shown = check.ok && plan?.kind !== "full" ? (plan?.kind === "write" ? plan.source : check.source) : null;

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
    if (!check.ok || !pageValid(page) || !canWrite()) return;
    if (writeSource(editor, check.source, cite ? page : null, true) === null) return;
    relist(check.source);
    close();
  };

  // The list follows the letters the sheet now holds: an earlier work may have become "a".
  const relist = (extra?: Added["source"]) => {
    if (editor === null) return;
    const blocks = blocksOf(editor.state.doc);
    setAdded((list) => {
      const next: Added[] = [];
      for (const work of [...list.map((item) => item.source), ...(extra ? [extra] : [])]) {
        const found = suffixPlan(blocks, work);
        const source = found.kind === "write" && found.duplicate ? found.source : work;
        const entry = entryText(source);
        if (!next.some((item) => item.entry === entry)) next.push({ entry, source });
      }
      return next.sort((a, b) => compareEntries(a.entry, b.entry));
    });
  };

  const cite = (item: Added) => {
    if (pageValid(listPage) && canWrite() && writeSource(editor, item.source, listPage, false) !== null) relist();
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
      onClick={trusted(onClick)}
    >
      {label}
    </button>
  );

  const errors = problems.map((p) => {
    switch (p.kind) {
      case "missing": return t.required.replace("{field}", t[p.field]);
      case "yearInvalid": return t.yearInvalid;
      case "tooLong": return t.tooLong.replace("{field}", t[p.field]).replace("{n}", String(FIELD_MAX[p.field]));
      case "unstorable": return t.unstorable.replace("{field}", t[p.field]);
      case "pageTooLong": return pageTooLong;
      case "pageUnstorable": return t.pageUnstorable;
    }
  });

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
            <input value={page} aria-invalid={pageValid(page) ? undefined : "true"} onChange={(event) => setPage(event.target.value)} />
          </label>
          {errors.length > 0 ? (
            // The role sits around the list: on the list itself it takes away its items (axe, DAN-484).
            <div role="alert"><ul className={styles.errors}>{errors.map((text) => <li key={text}>{text}</li>)}</ul></div>
          ) : null}
          {shown !== null ? (
            <section className={styles.preview} aria-labelledby={`${id}-preview`}>
              <h3 id={`${id}-preview`} className={styles.label}>{t.preview}</h3>
              <p data-preview="citation">{citationText(shown, page)}</p>
              <p data-preview="entry">{entryText(shown)}</p>
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
              <input value={listPage} aria-invalid={pageValid(listPage) ? undefined : "true"} onChange={(event) => setListPage(event.target.value)} />
            </label>
            {pageValid(listPage) ? null : (
              <p className={styles.errors} role="alert">{pageFits(listPage) ? t.pageUnstorable : pageTooLong}</p>
            )}
            <ul className={styles.list}>
              {added.map((item) => (
                <li key={item.entry}>
                  <p>{item.entry}</p>
                  <button
                    type="button"
                    className={styles.secondary}
                    aria-label={`${t.cite}: ${item.entry}`}
                    aria-disabled={editable ? undefined : "true"}
                    onClick={trusted(() => cite(item))}
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
