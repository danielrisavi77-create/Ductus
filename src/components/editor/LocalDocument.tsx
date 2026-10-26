"use client";

/**
 * The local-only writing surface on /rad (F-3 step 1b, plan #197).
 *
 * One provider owns the editor, the Web Lock and the `LocalDocumentSaver`;
 * the sheet (`LocalEditor`) and the status bar (`useLocalStatus`) only render
 * what it holds. The one request it starts is the live view's publisher
 * (`src/client/live-publisher.ts`, B-LIVE step 4): for a signed-in person it
 * sends the last state of the document, stops before the sign-out fence and
 * starts again on "Ostani". It is not the evidence: the journal, the drain
 * and the save state know nothing of it.
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
 * - Signing out (F-5, D-118) always ends the session: writing stops, the
 *   typed text reaches the journal, the logout route answers, and only then
 *   is a journal with nothing unconfirmed deleted. Work the server has not
 *   confirmed stays in this person's journal, which only their next sign-in
 *   opens. "Odjava" first stops writing and opens a dialog (FE-D7) with the
 *   number of saved steps the journal still holds; text the device could not
 *   store is the one thing sign-out would lose, so the dialog says so and
 *   offers the export. "Odjavi se" signs out all the same; "Ostani" resumes.
 * - A tab whose session has ended, here or by a sign-in that replaced the
 *   cookie, stops for good and clears the sheet (src/client/session-marks.ts).
 */

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode,
} from "react";

import type { CanonicalDocument } from "@/domain/document";
import {
  browserMarkStore, endAfterLogout, hasEnded, SESSION_END_CHANNEL, type SessionMark,
} from "@/client/session-marks";
import { localChip, type LocalChip } from "@/domain/sync/labels";
import type { SyncState } from "@/domain/sync/states";
import { countWords, NODE_ID_ATTRIBUTE, tiptapToCanonical } from "@/editor/interop";
import { startFreshHistory } from "@/editor/history";
import { replaceWithStoredDocument } from "@/editor/identity";
import { createEditorExtensions } from "@/editor/schema";
import { ArrowCollapse } from "@/editor/arrow-collapse";
import { StorableInput } from "@/editor/storable-input";
import { storableDocument } from "@/editor/storable-text";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { createLivePublisher, type LivePublisher } from "@/client/live-publisher";
import { editorSignOutPlan } from "@/client/logout-hold";
import { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";
import {
  LocalDocumentSaver, type SaverFailure, type SaverSnapshot,
} from "@/lib/journal/local-document-saver";

import LogoutDialog from "./LogoutDialog";
import { endRun } from "./run-refs";
import { nothingHeld, type LogoutPlan } from "./logout-plan";

/** Quiet time after the last change before a candidate is proposed. */
const DEBOUNCE_MS = 400;
const EXPORT_FILE_NAME = "ductus-rad.txt";

type Phase = "loading" | "blocked" | "ready" | "recovery" | "unavailable" | "signed-out";

type Failure = SaverFailure | "invalid";

/** States in which the sheet may hold text the journal does not. */
const NOT_STORED: readonly SyncState[] = ["EDITING", "SAVING_LOCAL", "ERROR", "RECOVERY_REQUIRED"];

/** What the tab holding the document's lock does for a sign-out. */
type LockedLogout = {
  /** Stops writing, lets the typed text reach the journal; true if some of it did not. */
  quiesce: () => Promise<boolean>;
  resume: () => void;
  /** Deletes the journal unless it holds unconfirmed work (D-118). */
  clear: () => Promise<void>;
};

type LocalDocumentValue = {
  editor: Editor | null;
  phase: Phase;
  snapshot: SaverSnapshot | null;
  words: number;
  invalid: boolean;
  /**
   * Stops writing and says what a sign-out would leave behind (FE-D7), or
   * "leave" when the page's session has ended.
   */
  prepareSignOut: () => Promise<LogoutPlan | "leave">;
  /** Writing goes on after the dialog was left with "Ostani". */
  staySignedIn: () => void;
  /** Ends the session; resolves true once the logout route has answered. */
  signOut: () => Promise<boolean>;
};

const LocalDocumentContext = createContext<LocalDocumentValue | null>(null);

function useLocalDocument(): LocalDocumentValue {
  const value = useContext(LocalDocumentContext);
  if (!value) throw new Error("LocalEditor and the status bar need a LocalDocumentProvider");
  return value;
}

/**
 * The editor of the provider, for the toolbar and the heading list (F-8).
 * They change the document only through editor commands, which reach the
 * journal the same way typing does (`onUpdate`); whether writing is allowed
 * is the editor's own `isEditable`, which only this provider sets.
 */
export function useLocalEditor(): Editor | null {
  return useLocalDocument().editor;
}

/**
 * True once this tab has stopped for good because the session ended, here or
 * elsewhere (D-118). Anything else that shows this person's work, such as the
 * comment panel, must drop it at that moment, as the sheet does.
 */
export function useLocalSignedOut(): boolean {
  return useLocalDocument().phase === "signed-out";
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
  scope, documentId, session = null, livePublish = false, children,
}: {
  scope: string;
  documentId: string;
  session?: SessionMark | null;
  /**
   * True only when the page read that this student acknowledged the current
   * notice of the assignment (PRODUCT §5 rules 6 and 14, F-121): without it
   * the publisher is never made, so no text leaves the tab.
   */
  livePublish?: boolean;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [snapshot, setSnapshot] = useState<SaverSnapshot | null>(null);
  const [words, setWords] = useState(0);
  const [invalid, setInvalid] = useState(false);
  // Set while this tab holds the lock with an editable document.
  const logoutRef = useRef<LockedLogout | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  // Whose journal the sheet shows (`scope` and document), or null while it is empty.
  const sheetOwnerRef = useRef<string | null>(null);
  const markTag = session?.tag ?? null;
  const markAt = session?.at ?? 0;
  const saverRef = useRef<LocalDocumentSaver | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const readyRef = useRef(false);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The live view's publisher (B-LIVE step 4): only while a signed-in tab
  // holds the lock and may write. It is not the evidence and never sets SYNCED.
  const publisherRef = useRef<LivePublisher | null>(null);

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
    publisherRef.current?.offer(candidate.doc);
  });

  const editor = useEditor({
    // ArrowCollapse: a plain arrow on a selection across blocks moves the
    // caret in the editor state at once, never after the next letter (DAN-247).
    extensions: [...createEditorExtensions(t.editor.placeholder), StorableInput, ArrowCollapse],
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
    // The sheet still shows another journal: this page is now another
    // person's or document's, though no end of the session reached this tab.
    // It is emptied before anything else, with nothing to undo (F-086).
    const owner = `${scope}\n${documentId}`;
    if (sheetOwnerRef.current !== null && sheetOwnerRef.current !== owner) {
      sheetOwnerRef.current = null;
      if (!editor.isDestroyed) startFreshHistory(editor.view, "empty");
      setWords(0);
    }
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
    // The session of this page has ended: what was typed still goes to this
    // person's journal, then the sheet is emptied so the next person at the
    // browser neither reads nor writes it. The lock is kept, so this tab
    // never opens the journal again; it goes with the page.
    const stop = () => {
      // Nothing more is published for a session that has ended.
      publisherRef.current?.stop();
      flush();
      disposed = true;
      readyRef.current = false;
      abort.abort();
      if (!editor.isDestroyed) {
        editor.setEditable(false, false);
        startFreshHistory(editor.view, "empty");
      }
      sheetOwnerRef.current = null;
      setWords(0);
      setPhase("signed-out");
    };
    const ended = () => markTag !== null && hasEnded(browserMarkStore(), { tag: markTag, at: markAt });
    if (ended()) {
      stop();
      return;
    }
    const channel = markTag === null || typeof BroadcastChannel === "undefined"
      ? null : new BroadcastChannel(SESSION_END_CHANNEL);
    channelRef.current = channel;
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        if (event.data === markTag) stop();
      };
    }
    // Another tab recorded an ended or a newer session; a page restored from
    // the back-forward cache missed both.
    const recheck = () => {
      if (!disposed && ended()) stop();
    };
    window.addEventListener("storage", recheck);
    window.addEventListener("pageshow", recheck);

    // Runs while this tab holds the lock; resolving releases it.
    const write = async (lock: Lock | null): Promise<void> => {
      if (!lock || disposed) return;
      // An end this tab did not hear (it was not listening yet) was recorded
      // before the tab that signed out let go of the lock.
      if (ended()) {
        stop();
        return;
      }
      setPhase("loading");
      let journal = new AtomicDexieJournal(scope);
      // An earlier sign-out was cut off after its fence: finish it before
      // anything is read. The fence exists only when nothing was unsynced,
      // so this deletes no work (journal contract, sign-in).
      try {
        if (await journal.hasPendingLogout()) {
          await journal.destroyForLogout();
          journal = new AtomicDexieJournal(scope);
        }
      } catch {
        journal.close();
        if (!disposed) setPhase("unavailable");
        return;
      }
      if (disposed) {
        journal.close();
        return;
      }
      const saver = new LocalDocumentSaver(journal, documentId);
      // The cleanup's flush may still emit after `setSnapshot(null)`; what the
      // old saver reports then must not come back as the next lock's notice.
      const unsubscribe = saver.subscribe((next) => {
        if (!disposed) setSnapshot(next);
      });
      // This run's own values: the refs are shared with the next run (F-125 t. 2).
      let publisher: LivePublisher | null = null;
      let locked: LockedLogout | null = null;
      try {
        const result = await saver.load();
        if (disposed) return;
        // Undo never reaches past this load: not into an earlier person's
        // or document's sheet, nor into the one emptied when a session ended.
        startFreshHistory(editor.view, "keep");
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
        sheetOwnerRef.current = owner;
        if (result.kind !== "ready") {
          setPhase(result.kind);
          return;
        }
        readyRef.current = true;
        editor.setEditable(true, false);
        setPhase("ready");
        // Only a signed-in person who acknowledged the notice publishes; the
        // local demo journal never does.
        publisher = markTag === null || !livePublish
          ? null : createLivePublisher({ documentId, current: () => !ended() });
        publisherRef.current = publisher;
        const own = publisher;
        if (own && result.document) own.offer(result.document);
        own?.start();
        locked = {
          quiesce: async () => {
            // Nothing typed after this point is accepted.
            flush();
            // Publishing stops before the sign-out fence (BACKEND 4.12 t. 8).
            own?.stop();
            readyRef.current = false;
            editor.setEditable(false, false);
            await saver.settled();
            // A first save that failed leaves the journal empty while the
            // sheet holds text; only the saver's state tells.
            const saved = saver.snapshot();
            return !editor.isEmpty && (saved.failure !== null || NOT_STORED.includes(saved.state));
          },
          resume: () => {
            if (disposed) return;
            readyRef.current = true;
            editor.setEditable(true, false);
            own?.start();
          },
          clear: async () => {
            try {
              await journal.destroyForLogout();
            } catch {
              // Unconfirmed work, or a deletion cut off after its fence: the
              // journal stays this person's, and their next sign-in finishes
              // a fenced deletion (above).
            }
          },
        };
        logoutRef.current = locked;
        await new Promise<void>((resolve) => {
          release = resolve;
          if (disposed) resolve();
        });
      } finally {
        endRun({ publisher: publisherRef, logout: logoutRef }, { publisher, logout: locked });
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
      channel?.close();
      channelRef.current = null;
      window.removeEventListener("storage", recheck);
      window.removeEventListener("pageshow", recheck);
    };
  }, [editor, scope, documentId, markTag, markAt, livePublish]);

  // Writing stays stopped from here until "Ostani" or the end of the
  // session, so the count the dialog shows cannot grow behind it (I2).
  // The whole scope, as the shell counts it (O2): every document of this person.
  // A page whose session has ended stops and reads nothing (leave).
  const prepareSignOut = (): Promise<LogoutPlan | "leave"> => {
    const locked = logoutRef.current;
    return editorSignOutPlan(locked && (() => locked.quiesce()), scope, { session });
  };

  const staySignedIn = () => logoutRef.current?.resume();

  const signOut = async (): Promise<boolean> => {
    const locked = logoutRef.current;
    // Nothing was deleted and the session may still be open; the dialog says so.
    if (!(await postLogout())) return false;
    // The session has ended: every tab of it stops, and so does the session
    // the browser held last if it was another one.
    const ended = endAfterLogout(browserMarkStore(), markTag);
    for (const tag of ended) channelRef.current?.postMessage(tag);
    if (editor && !editor.isDestroyed) {
      editor.setEditable(false, false);
      startFreshHistory(editor.view, "empty");
    }
    sheetOwnerRef.current = null;
    await (locked ? locked.clear() : clearWithoutEditor(scope, documentId));
    return true;
  };

  const value: LocalDocumentValue = {
    editor, phase, snapshot, words, invalid, prepareSignOut, staySignedIn, signOut,
  };
  return <LocalDocumentContext.Provider value={value}>{children}</LocalDocumentContext.Provider>;
}

/**
 * POST to the logout route; true only for its redirect, which comes after
 * the session was closed and the cookie cleared. A lost request or response
 * is false, and the caller deletes nothing.
 */
async function postLogout(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", redirect: "manual", cache: "no-store" });
    return response.type === "opaqueredirect";
  } catch {
    return false;
  }
}

/**
 * After sign-out, from a tab that does not write the document: deletes the
 * journal if no other tab holds the document and nothing is unconfirmed.
 * Anything else leaves it to this person's next sign-in.
 */
async function clearWithoutEditor(scope: string, documentId: string): Promise<void> {
  if (typeof indexedDB === "undefined" || !indexedDB) return;
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return;
  try {
    await locks.request(`ductus-journal:${scope}:${documentId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      const journal = new AtomicDexieJournal(scope);
      try {
        await journal.destroyForLogout();
      } finally {
        journal.close();
      }
    });
  } catch {
    // Kept, under this person's scope only (D-118).
  }
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
  const alert = phase === "signed-out" ? t.auth.signedOutElsewhere
    : phase === "recovery" ? t.editor.recovery : failure ? FAILURE_TEXT[failure] : null;
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

/** What the save chip says, or null while the journal is still being read. */
function chipOf(value: LocalDocumentValue): LocalChip | null {
  const failure = failureOf(value);
  return localChip({
    blocked: value.phase === "blocked",
    recoveryRequired: value.phase === "recovery" || failure === "corrupt",
    failed: failure !== null,
    saverState: value.phase === "ready" ? value.snapshot?.state ?? null : null,
  });
}

/**
 * The save state in the status bar (#197 step 1 and line 53). The chip itself
 * is not live: it changes when typing starts and again when it pauses, which
 * a screen reader would read out over the typing. The polite region beside it
 * says only that the text is now on the device (attack 14), and only once
 * something was typed in this tab: opening a document that is already stored
 * changes nothing worth announcing. A failure is announced by the alert above
 * the sheet, a blocked tab by its status notice.
 */
export function LocalSaveChip() {
  const chip = chipOf(useLocalDocument());
  const [edited, setEdited] = useState(false);
  if (!edited && (chip?.state === "EDITING" || chip?.state === "SAVING_LOCAL")) setEdited(true);
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
        {edited && chip?.state === "LOCAL_DURABLE" ? chip.text : null}
      </span>
    </>
  );
}

/** States in which this tab is putting the text on the device. */
const SAVING_ON_DEVICE: readonly LocalChip["state"][] = ["EDITING", "SAVING_LOCAL", "LOCAL_DURABLE"];

/**
 * True while this tab writes the document and its saves reach the journal:
 * the same condition under which the chip may show a local state, so the
 * offline notice (F-8) never says text is saved on the device while the
 * chip or a notice says saving has stopped.
 */
export function useLocalSavingOnDevice(): boolean {
  const state = chipOf(useLocalDocument())?.state;
  return state !== undefined && SAVING_ON_DEVICE.includes(state);
}

/**
 * Read-only view for the status bar (FE-D6): whether the journal is still
 * being read, and the words of the document as last proposed to it.
 */
export function useLocalStatus(): { loading: boolean; words: number } {
  const { phase, words } = useLocalDocument();
  return { loading: phase === "loading", words };
}

/**
 * The sign-out button of the workspace bar (F-5, D-118) and its dialog
 * (FE-D7). Disabled only while writing stops or a sign-out runs: whatever the
 * journal or the tab holds, the dialog always offers "Odjavi se", so the
 * session can always be ended (I1). Without script the form posts to the
 * logout route directly, which ends it as well.
 */
export function LocalLogout() {
  const { editor, prepareSignOut, staySignedIn, signOut } = useLocalDocument();
  const [preparing, setPreparing] = useState(false);
  const [plan, setPlan] = useState<LogoutPlan | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (preparing || plan) return;
    setPreparing(true);
    setFailed(false);
    void prepareSignOut()
      // Writing has stopped either way; an unknown count shows no number.
      .catch((): LogoutPlan => ({ unsaved: false, pending: null }))
      .then((next) => {
        // The page's session has ended: `/` renders under the browser's cookie.
        if (next === "leave") {
          window.location.assign("/");
          return;
        }
        setPreparing(false);
        // Nothing at all stays on this device: no dialog (O1, #476 c.6396707923).
        if (nothingHeld(next)) confirm();
        else setPlan(next);
      });
  };
  const confirm = () => {
    if (working) return;
    setWorking(true);
    setFailed(false);
    const failure = () => {
      // Without a dialog yet, a failed sign-out opens one that says so.
      setPlan((open) => open ?? { unsaved: false, pending: 0 });
      setFailed(true);
      setWorking(false);
    };
    void signOut().then((done) => {
      if (done) window.location.assign("/");
      else failure();
    }, failure);
  };
  const stay = () => {
    setPlan(null);
    setFailed(false);
    staySignedIn();
  };
  // Focus goes back to "Odjava" once the dialog has closed: while the modal
  // is open, the button behind it is inert and cannot take focus.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (plan) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      buttonRef.current?.focus();
    }
  }, [plan]);
  return (
    <>
      <form method="post" action="/api/auth/logout" onSubmit={onSubmit}>
        <button ref={buttonRef} type="submit" className="btn" disabled={preparing || working}>
          {preparing || working ? t.auth.loggingOut : t.auth.logout}
        </button>
      </form>
      {plan ? (
        <LogoutDialog
          plan={plan}
          working={working}
          failed={failed}
          onConfirm={confirm}
          onStay={stay}
          copies={plan.copies}
          onExport={() => {
            if (editor && !editor.isDestroyed) exportText(editor);
          }}
        />
      ) : null}
    </>
  );
}
