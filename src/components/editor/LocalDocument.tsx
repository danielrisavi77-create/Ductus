"use client";

/**
 * The local-only writing surface on /rad (F-3 step 1b, plan #197).
 *
 * One provider owns the editor, the Web Lock and the `LocalDocumentSaver`;
 * the sheet (`LocalEditor`) and the status bar (`LocalStatus`) only render
 * what it holds. Nothing here touches the network: the chip can at most say
 * "Spremljeno na uređaju", and only once the saver says so.
 *
 * - One writer per document: the tab holding the Web Lock journals; any other
 *   tab shows the blocked notice, stays read-only and reads the journal again
 *   once the lock is free (#197 attack 4).
 * - Every change calls `edit()` at once; the canonical candidate is built and
 *   proposed after a debounce and on `pagehide` or a hidden page (attack 1).
 * - Ids minted for new blocks are written back into the editor, so a block
 *   keeps its identity from one candidate to the next.
 * - Pasted blocks lose their `nodeId`: ids are minted here, never taken from
 *   the clipboard (attack 11).
 */

import { Fragment, Slice, type Node as PmNode } from "@tiptap/pm/model";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import type { CanonicalDocument } from "@/domain/document";
import { chipContent } from "@/domain/sync/labels";
import { canonicalToTiptap, countWords, NODE_ID_ATTRIBUTE, tiptapToCanonical } from "@/editor/interop";
import { createEditorExtensions } from "@/editor/schema";
import { wordsHr } from "@/lib/i18n/hr";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";
import {
  LocalDocumentSaver, type SaverFailure, type SaverSnapshot,
} from "@/lib/journal/local-document-saver";

/** Quiet time after the last change before a candidate is proposed. */
const DEBOUNCE_MS = 400;
/** Marks the transaction that writes minted ids back; it is not an edit. */
const ID_WRITE_BACK = "ductusNodeIdWriteBack";
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
  if (!value) throw new Error("LocalEditor and LocalStatus need a LocalDocumentProvider");
  return value;
}

function withoutNodeIds(fragment: Fragment): Fragment {
  const nodes: PmNode[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      nodes.push(node);
      return;
    }
    const attrs = NODE_ID_ATTRIBUTE in node.attrs ? { ...node.attrs, [NODE_ID_ATTRIBUTE]: null } : node.attrs;
    nodes.push(node.type.create(attrs, withoutNodeIds(node.content), node.marks));
  });
  return Fragment.fromArray(nodes);
}

/** Gives every top-level block the id the candidate carries for it. */
function writeBackIds(editor: Editor, doc: CanonicalDocument): void {
  const { state } = editor;
  if (state.doc.childCount !== doc.nodes.length) return;
  const tr = state.tr;
  state.doc.forEach((node, offset, index) => {
    const id = doc.nodes[index]!.id;
    if (node.attrs[NODE_ID_ATTRIBUTE] !== id) {
      tr.setNodeMarkup(offset, undefined, { ...node.attrs, [NODE_ID_ATTRIBUTE]: id });
    }
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false).setMeta(ID_WRITE_BACK, true));
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
    if (!candidate.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    writeBackIds(editor, candidate.doc);
    setWords(countWords(candidate.doc));
    void saver.propose(candidate.doc);
  });

  const editor = useEditor({
    extensions: createEditorExtensions(t.editor.placeholder),
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
      transformPasted: (slice) => new Slice(withoutNodeIds(slice.content), slice.openStart, slice.openEnd),
    },
    onUpdate: ({ transaction }) => {
      if (transaction.getMeta(ID_WRITE_BACK) || !readyRef.current) return;
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
      const unsubscribe = saver.subscribe(setSnapshot);
      try {
        const result = await saver.load();
        if (disposed) return;
        saverRef.current = saver;
        setSnapshot(saver.snapshot());
        if (result.kind !== "unavailable" && result.document) {
          editor.commands.setContent(canonicalToTiptap(result.document), { emitUpdate: false });
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
      abort.abort();
      release?.();
    };
  }, [editor, scope, documentId]);

  const value: LocalDocumentValue = { editor, phase, snapshot, words, invalid };
  return <LocalDocumentContext.Provider value={value}>{children}</LocalDocumentContext.Provider>;
}

/** What the author is told: never more than the saver claims. */
function shown({ phase, snapshot, invalid }: LocalDocumentValue) {
  const failure: Failure | null = invalid ? "invalid"
    : snapshot?.failure ?? (phase === "unavailable" ? "unavailable" : null);
  const state = invalid || (phase === "unavailable" && !snapshot) ? "ERROR" : snapshot?.state ?? "EDITING";
  return { failure, chip: chipContent(state, phase === "blocked") };
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
  const { editor, phase, snapshot } = value;
  const { failure } = shown(value);
  const alert = phase === "recovery" ? t.editor.recovery : failure ? FAILURE_TEXT[failure] : null;
  const canExport = editor !== null && (alert !== null) && !editor.isEmpty;
  return (
    <>
      {/* Live regions exist before their text does, so it is announced; the chip is not live. */}
      <div className="editor-notice" role="alert">
        {alert ? <p>{alert}</p> : null}
      </div>
      <div className="editor-notice" role="status">
        {phase === "blocked" ? <p>{t.editor.blockedHint}</p> : null}
        {phase === "ready" && snapshot?.capacity === "near" ? <p>{t.editor.capacityNear}</p> : null}
      </div>
      {canExport ? (
        <button type="button" className="btn editor-export" onClick={() => exportText(editor)}>
          {t.editor.exportText}
        </button>
      ) : null}
      <EditorContent editor={editor} className="editor-surface" />
    </>
  );
}

/** Save state and word count for the status bar. */
export function LocalStatus() {
  const value = useLocalDocument();
  const { chip } = shown(value);
  return (
    <>
      {value.phase === "loading" ? null : (
        <span className="sync-chip" data-tone={chip.tone}>
          <span className="sync-chip__dot" aria-hidden="true" />
          {chip.text}
        </span>
      )}
      <span>{wordsHr(value.words)}</span>
    </>
  );
}
