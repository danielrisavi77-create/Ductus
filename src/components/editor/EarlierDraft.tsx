"use client";

/**
 * Offers the earlier draft of this device on the student's own work of an
 * assignment (#711 F1b, contract 6391402093 §4). It opens the journal of the
 * signed-in person's own scope, the same one `LocalDocumentProvider` opened,
 * and only reads the free draft (`LOCAL_DEMO_DOCUMENT_ID`): no lock of that
 * document, no write, no `releaseSalvage`, no `destroyForLogout`. A read that
 * fails (no IndexedDB, a journal error, a sign-out under way) shows nothing
 * and touches nothing. Another person's draft and the local demo journal are
 * other databases and are never opened here. Once the session ends the offer
 * and its text leave the page at once (D-118). Nothing writes the text into
 * the editor: it enters the work only as the student's own paste (PRODUCT §5
 * rule 8, D-132).
 */

import { useEffect, useState } from "react";

import { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";
import { LOCAL_DEMO_DOCUMENT_ID } from "@/lib/journal/local-scope";

import { EarlierDraftView, earlierDraftText, type CopyState } from "./earlier-draft";
import { useLocalSignedOut } from "./LocalDocument";

const EXPORT_FILE_NAME = "ductus-raniji-tekst.txt";

function exportText(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = EXPORT_FILE_NAME;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function EarlierDraft({ scope }: { scope: string }) {
  const signedOut = useLocalSignedOut();
  const [text, setText] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    let live = true;
    let journal: AtomicDexieJournal | null = null;
    try {
      journal = new AtomicDexieJournal(scope);
    } catch {
      return;
    }
    const opened = journal;
    opened.read(LOCAL_DEMO_DOCUMENT_ID)
      .then((contents) => {
        if (live) setText(earlierDraftText(contents.snapshot?.document));
      }, () => {})
      .finally(() => opened.close());
    return () => {
      live = false;
    };
  }, [scope]);

  if (signedOut || text === null) return null;
  const onCopy = () => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) {
      setCopy("failed");
      return;
    }
    clipboard.writeText(text).then(() => setCopy("copied"), () => setCopy("failed"));
  };
  return <EarlierDraftView text={text} copy={copy} onCopy={onCopy} onExport={() => exportText(text)} />;
}
