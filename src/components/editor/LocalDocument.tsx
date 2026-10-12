"use client";

/**
 * The local-only writing surface on /rad (F-3 step 1b, plan #197).
 *
 * One provider owns the editor, the Web Lock and the `LocalDocumentSaver`;
 * the sheet (`LocalEditor`) and the word count (`LocalWordCount`) only render
 * what it holds. Nothing here touches the network.
 *
 * - One writer per document: the tab holding the Web Lock journals; any other
 *   tab shows the blocked notice, stays read-only and reads the journal again
 *   once the lock is free (#197 attack 4).
 * - Every change calls `edit()` at once; the canonical candidate is built and
 *   proposed after a debounce and on `pagehide` or a hidden page (attack 1).
 * - Block ids belong to the identity plugin (#226): it mints them and strips
 *   pasted ones (attack 11). The stored document enters only through
 *   `replaceWithStoredDocument`, so a reload gives back the same ids and a
 *   stored document with a repeated id, or with text the editor would change
 *   on entry, is refused, never repaired: the editor shows the journal's text
 *   or nothing.
 * - Text the journal would store differently (NUL, a lone surrogate) is made
 *   storable in the editor itself (`StorableInput`), so the editor never
 *   shows other text than the journal holds once a save has succeeded.
 */

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import type { CanonicalDocument } from "@/domain/document";
import { chipContent, type ChipContent } from "@/domain/sync/labels";
import type { SyncState } from "@/domain/sync/states";
import { countWords, NODE_ID_ATTRIBUTE, tiptapToCanonical } from "@/editor/interop";
import { replaceWithStoredDocument } from "@/editor/identity";
import { createEditorExtensions } from "@/editor/schema";
import { StorableInput } from "@/editor/storable-input";
import { storableDocument } from "@/editor/storable-text";
import { wordsHr } from "@/lib/i18n/hr";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";
import {
  LocalDocumentSaver, type SaverFailure, type SaverSnapshot,
} from "@/lib/journal/local-document-saver";

/** Quiet time after the last change before a candidate is proposed. */
const DEBOUNCE_MS = 400;
const EXPORT_FILE_NAME = "ductus-rad.txt";

type Phase = "loading" | "blocked" | "ready" | "recovery" | "unavailable";
type Failure = SaverFailure | "invalid";

type LocalDocumentValue = {
  editor: Editor | null;
  phase: Phase;
  snapshot: SaverSnapshot | null;
  words: number;
  invalid: boolean;
};

const LocalDocumentContext = createContext<LocalDocumentValue | null>(null);

function useLocalDocument(): LocalDocumentValue {
  const value = useContext(LocalDocumentContext);
  if (!value) throw new Error("LocalEditor and LocalWordCount need a LocalDocumentProvider");
  return value;
}

/**
 * Whether the candidate holds exactly the ids the editor holds. The identity
 * plugin (#226) gives every block its id, so interop never mints one; if it
 * did, the journal would hold ids the editor lacks and a reload would not
 * give the same blocks back, so such a candidate is refused, not written back.
 */
function sameIds(editor: Editor, doc: CanonicalDocument): boolean {
  const { doc: shownDoc } = editor.state;
  if (shownDoc.childCount !== doc.nodes.length) return false;
  let same = true;
  shownDoc.forEach((node, _offset, index) => {
    if (node.attrs[NODE_ID_ATTRIBUTE] !== doc.nodes[index]!.id) same = false;
  });
  return same;
}

export function LocalDocumentProvider({
  scope, documentId, children,
}: { scope: string; documentId: string; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [snapshot, setSnapshot] = useState<SaverSnapshot | null>(null);
  const [words, setWords] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const saverRef = useRef<LocalDocumentSaver | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const readyRef = useRef(false);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Builds and proposes the candidate for what the editor holds now.
  const flushRef = useRef(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    const editor = editorRef.current;
    const saver = saverRef.current;
    if (!dirtyRef.current || !editor || editor.isDestroyed || !saver || !readyRef.current) return;
    dirtyRef.current = false;
    const candidate = tiptapToCanonical(editor.getJSON());
    // `StorableInput` keeps unstorable text out of the editor; should any
    // remain, the journal would hold other text than shown, so it is refused.
    if (!candidate.ok || !sameIds(editor, candidate.doc) ||
        storableDocument(candidate.doc) !== candidate.doc) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setWords(countWords(candidate.doc));
    void saver.propose(candidate.doc);
  });

  const editor = useEditor({
    extensions: [...createEditorExtensions(t.editor.placeholder), StorableInput],
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: () => ({
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": t.workspace.documentLabel,
        "aria-readonly": readyRef.current ? "false" : "true",
        class: "manuscript",
      }),
    },
    onUpdate: () => {
      if (!readyRef.current) return;
      saverRef.current?.edit();
      dirtyRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => flushRef.current(), DEBOUNCE_MS);
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    const flush = () => flushRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const flush = flushRef.current;
    let disposed = false;
    let release: (() => void) | null = null;
    const abort = new AbortController();
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    // Checked here, not left to Dexie: browsers report a missing IndexedDB
    // under different error names, and the author must see the same notice.
    if (!locks || typeof indexedDB === "undefined" || !indexedDB) {
      setPhase("unavailable");
      return;
    }

    // Runs while this tab holds the lock; resolving releases it.
    const write = async (lock: Lock | null): Promise<void> => {
      if (!lock || disposed) return;
      setPhase("loading");
      const journal = new AtomicDexieJournal(scope);
      const saver = new LocalDocumentSaver(journal, documentId);
      // The cleanup's flush may still emit after `setSnapshot(null)`; what the
      // old saver reports then must not come back as the next lock's notice.
      const unsubscribe = saver.subscribe((next) => {
        if (!disposed) setSnapshot(next);
      });
      try {
        const result = await saver.load();
        if (disposed) return;
        saverRef.current = saver;
        setSnapshot(saver.snapshot());
        if (result.kind !== "unavailable" && result.document) {
          // The only way stored ids enter the editor (#226): validated, never
          // re-minted. A refused document is a journal this tab cannot trust,
          // so it stays untouched and the editor stays empty and read-only.
          if (storableDocument(result.document) !== result.document ||
              !replaceWithStoredDocument(editor.view, result.document).ok) {
            setPhase("recovery");
            return;
          }
          setWords(countWords(result.document));
        }
        if (result.kind !== "ready") {
          setPhase(result.kind);
          return;
        }
        readyRef.current = true;
        editor.setEditable(true, false);
        setPhase("ready");
        await new Promise<void>((resolve) => {
          release = resolve;
          if (disposed) resolve();
        });
      } finally {
        await saver.settled();
        unsubscribe();
        journal.close();
      }
    };

    locks.request(`ductus-journal:${scope}:${documentId}`, { ifAvailable: true }, (lock) => {
      if (lock) return write(lock);
      if (disposed) return undefined;
      setPhase("blocked");
      // A refused wait would leave this tab blocked for good; say instead
      // that this device does not save (an abort on cleanup is disposed).
      return void locks.request(`ductus-journal:${scope}:${documentId}`, { signal: abort.signal }, write)
        .catch(() => {
          if (!disposed) setPhase("unavailable");
        });
    }).catch(() => {
      if (!disposed) setPhase("unavailable");
    });

    return () => {
      flush();
      disposed = true;
      readyRef.current = false;
      saverRef.current = null;
      // A notice belongs to the saver it came from, not to the next document.
      setSnapshot(null);
      setInvalid(false);
      // Read-only until the next lock is held, so nothing typed in between is
      // lost to the next load (the editor may outlive this effect).
      if (!editor.isDestroyed) editor.setEditable(false, false);
      abort.abort();
      release?.();
    };
  }, [editor, scope, documentId]);

  const value: LocalDocumentValue = { editor, phase, snapshot, words, invalid };
  return <LocalDocumentContext.Provider value={value}>{children}</LocalDocumentContext.Provider>;
}

/** Why saving stopped, as far as the saver or the provider knows. */
function failureOf({ phase, snapshot, invalid }: LocalDocumentValue): Failure | null {
  return invalid ? "invalid" : snapshot?.failure ?? (phase === "unavailable" ? "unavailable" : null);
}

const FAILURE_TEXT: Record<Failure, string> = {
  quota: t.editor.failureQuota,
  unavailable: t.editor.failureUnavailable,
  limit: t.editor.failureLimit,
  stale: t.editor.failureStale,
  unknown: t.editor.failureUnknown,
  invalid: t.editor.failureInvalid,
  corrupt: t.editor.recovery,
};

function exportText(editor: Editor): void {
  const text = editor.getText({ blockSeparator: "\n\n" });
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = EXPORT_FILE_NAME;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The sheet: notices, the export escape hatch and the editor itself. */
export function LocalEditor() {
  const value = useLocalDocument();
  const { editor, phase } = value;
  const failure = failureOf(value);
  const alert = phase === "recovery" ? t.editor.recovery : failure ? FAILURE_TEXT[failure] : null;
  const canExport = editor !== null && (alert !== null) && !editor.isEmpty;
  return (
    <>
      {/* Live regions exist before their text does, so it is announced. */}
      <div className="editor-notice" role="alert">
        {alert ? <p>{alert}</p> : null}
      </div>
      <div className="editor-notice" role="status">
        {phase === "blocked" ? <p>{t.editor.blockedHint}</p> : null}
      </div>
      {canExport ? (
        <button type="button" className="btn editor-export" onClick={() => exportText(editor)}>
          {t.editor.exportText}
        </button>
      ) : null}
      {/* `data-phase` is for tests and styling only; it carries no text. */}
      <EditorContent editor={editor} className="editor-surface" data-phase={phase} />
    </>
  );
}

type Chip = ChipContent & { state: SyncState | "blocked" };

/**
 * What the save chip says, or null while the journal is still being read.
 * Order matters: a blocked tab journals nothing, a refused document and any
 * failure outrank whatever the saver last reported, so the chip never says
 * "Spremljeno na uređaju" while a notice says saving has stopped (#197
 * attacks 5 and 9). Only the saver's own state, reached after `saveLocal`
 * resolved, can say it.
 */
function chipOf(value: LocalDocumentValue): Chip | null {
  if (value.phase === "blocked") return { ...chipContent("EDITING", true), state: "blocked" };
  const failure = failureOf(value);
  const state: SyncState | null = value.phase === "recovery" || failure === "corrupt"
    ? "RECOVERY_REQUIRED"
    : failure ? "ERROR"
    : value.phase === "ready" && value.snapshot ? value.snapshot.state
    : null;
  return state ? { ...chipContent(state), state } : null;
}

/**
 * The save state in the status bar (#197 step 1 and line 53). The chip itself
 * is not live: it changes when typing starts and again when it pauses, which
 * a screen reader would read out over the typing. The polite region beside it
 * says only that the text is now on the device (attack 14); a failure is
 * announced by the alert above the sheet, a blocked tab by its status notice.
 */
export function LocalSaveChip() {
  const chip = chipOf(useLocalDocument());
  return (
    <>
      {chip ? (
        // `data-state` is for tests only; the label carries the meaning.
        <span className="sync-chip" data-tone={chip.tone} data-state={chip.state}>
          <span className="sync-chip__dot" aria-hidden="true" />
          {chip.text}
        </span>
      ) : null}
      <span className="visually-hidden" role="status">
        {chip?.state === "LOCAL_DURABLE" ? chip.text : null}
      </span>
    </>
  );
}

/** Word count for the status bar. */
export function LocalWordCount() {
  return <span>{wordsHr(useLocalDocument().words)}</span>;
}
