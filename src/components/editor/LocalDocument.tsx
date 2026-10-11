"use client";

/**
 * The local-only writing surface on /rad (F-3 step 1b, plan #197).
 *
 * One provider owns the editor, the Web Lock and the `LocalDocumentSaver`;
 * the sheet (`LocalEditor`) and the word count (`LocalWordCount`) only render
 * what it holds. Nothing here touches the network. The save chip is step 1b-3.
 *
 * - One writer per document: the tab holding the Web Lock journals; any other
 *   tab stays empty and read-only and reads the journal once the lock is free
 *   (#197 attack 4). Every state but `ready` is read-only; the notices that
 *   say why (blocked, recovery, unavailable, a failed save) are step 1b-2b.
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
import { countWords, NODE_ID_ATTRIBUTE, tiptapToCanonical } from "@/editor/interop";
import { replaceWithStoredDocument } from "@/editor/identity";
import { createEditorExtensions } from "@/editor/schema";
import { StorableInput } from "@/editor/storable-input";
import { storableDocument } from "@/editor/storable-text";
import { wordsHr } from "@/lib/i18n/hr";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";
import { LocalDocumentSaver } from "@/lib/journal/local-document-saver";

/** Quiet time after the last change before a candidate is proposed. */
const DEBOUNCE_MS = 400;

type Phase = "loading" | "blocked" | "ready" | "recovery" | "unavailable";

type LocalDocumentValue = {
  editor: Editor | null;
  phase: Phase;
  words: number;
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
  const [words, setWords] = useState(0);
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
      return;
    }
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
      try {
        const result = await saver.load();
        if (disposed) return;
        saverRef.current = saver;
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
        journal.close();
      }
    };

    locks.request(`ductus-journal:${scope}:${documentId}`, { ifAvailable: true }, (lock) => {
      if (lock) return write(lock);
      if (disposed) return undefined;
      setPhase("blocked");
      return void locks.request(`ductus-journal:${scope}:${documentId}`, { signal: abort.signal }, write)
        .catch(() => undefined);
    }).catch(() => {
      if (!disposed) setPhase("unavailable");
    });

    return () => {
      flush();
      disposed = true;
      readyRef.current = false;
      saverRef.current = null;
      // Read-only until the next lock is held, so nothing typed in between is
      // lost to the next load (the editor may outlive this effect).
      if (!editor.isDestroyed) editor.setEditable(false, false);
      abort.abort();
      release?.();
    };
  }, [editor, scope, documentId]);

  const value: LocalDocumentValue = { editor, phase, words };
  return <LocalDocumentContext.Provider value={value}>{children}</LocalDocumentContext.Provider>;
}

/** The sheet: the editor itself, read-only in every phase but `ready`. */
export function LocalEditor() {
  const { editor, phase } = useLocalDocument();
  // `data-phase` is for tests and styling only; it carries no text.
  return <EditorContent editor={editor} className="editor-surface" data-phase={phase} />;
}

/** Word count for the status bar; the save chip joins it in step 1b-3. */
export function LocalWordCount() {
  return <span>{wordsHr(useLocalDocument().words)}</span>;
}
