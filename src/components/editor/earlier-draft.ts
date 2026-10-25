/**
 * The earlier draft offer on `/rad?zadatak=` (#711 F1b, contract 6391402093
 * §4; owner decisions O2 and O3 on #711). Before F1 a signed-in person wrote
 * into one local document of this device (`LOCAL_DEMO_DOCUMENT_ID`), which is
 * now the free draft on `/rad`. On the student's own work of an assignment
 * that text is offered only to read and copy: nothing here writes it into the
 * work, moves it or deletes it. It enters the work only as the student's own
 * paste.
 *
 * Pure: `earlierDraftText` and `EarlierDraftView` take everything as
 * arguments, so the unit tests render them with `renderToStaticMarkup`;
 * written with `createElement` for the same reason as `SubmissionView`.
 */

import { createElement as h } from "react";

import type { CanonicalDocument } from "@/domain/document";
import { messagesHr } from "@/lib/i18n/messages.hr";

const t = messagesHr.workspace;

/**
 * The plain text of the earlier draft, its blocks separated by an empty line
 * (as "Izvezi tekst" writes them), or null when it holds no visible text.
 */
export function earlierDraftText(document: CanonicalDocument | null | undefined): string | null {
  if (!document || !Array.isArray(document.nodes)) return null;
  const blocks = document.nodes.map((node) => node.children.map((child) => child.text).join(""));
  const text = blocks.join("\n\n");
  return text.trim() === "" ? null : text;
}

/** What the last copy did: nothing yet, copied, or the clipboard refused. */
export type CopyState = "idle" | "copied" | "failed";

export function EarlierDraftView({ text, copy, onCopy, onExport }: {
  text: string;
  copy: CopyState;
  onCopy: () => void;
  onExport: () => void;
}) {
  const status = copy === "copied" ? t.earlierDraftCopied : copy === "failed" ? t.earlierDraftCopyFailed : "";
  return h("details", { className: "earlier-draft" },
    h("summary", null, t.earlierDraftSummary),
    h("p", null, t.earlierDraftExplain),
    h("div", { className: "earlier-draft__text" },
      ...text.split("\n\n").map((block, i) => h("p", { key: i }, block))),
    h("p", { role: "status", className: "earlier-draft__status" }, status),
    h("div", { className: "earlier-draft__actions" },
      copy === "failed"
        ? h("button", { type: "button", className: "btn", onClick: onExport }, messagesHr.editor.exportText)
        : h("button", { type: "button", className: "btn", onClick: onCopy }, t.earlierDraftCopy),
      h("a", { className: "btn", href: "/rad" }, t.earlierDraftOpen)),
  );
}
