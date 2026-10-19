"use client";

/**
 * The length part of the status bar on /rad (FE-D6, design editor-v11):
 * "označeno 12 riječi · 210 / 2 000–2 500 riječi · ≈ 1 str.". It reads the
 * provider and the editor and writes nothing. While the journal is still
 * being read it says so instead of showing a count it does not have yet.
 *
 * Not a live region: the count changes with every word, which a screen
 * reader would read out over the typing. The save chip beside it keeps its
 * own polite announcement.
 */

import { useEffect, useState } from "react";

import { countTextWords, lengthLine, type WordRange } from "@/lib/i18n/length-line";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { useLocalEditor, useLocalStatus } from "./LocalDocument";

/** Words in the editor's current selection; 0 for a caret or no editor. */
function useSelectedWords(): number {
  const editor = useLocalEditor();
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const { from, to, empty } = editor.state.selection;
      setSelected(empty ? 0 : countTextWords(editor.state.doc.textBetween(from, to, " ", " ")));
    };
    read();
    editor.on("selectionUpdate", read);
    editor.on("update", read);
    return () => {
      editor.off("selectionUpdate", read);
      editor.off("update", read);
    };
  }, [editor]);
  return selected;
}

export function LocalStatusLength({ range }: { range: WordRange | null }) {
  const { loading, words } = useLocalStatus();
  const selectedWords = useSelectedWords();
  if (loading) return <span className="status-length">{t.workspace.statusLoading}</span>;
  const line = lengthLine(words, selectedWords, range);
  return (
    <span className="status-length">
      {line.selected ? <span className="status-length__selected">{line.selected} · </span> : null}
      <b className="status-length__count">{line.count}</b>
      {line.rest}
    </span>
  );
}
