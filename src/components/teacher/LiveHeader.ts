/**
 * The header and the left rail of the teacher's live view (Archivum T05,
 * DAN-344, #923 contract 6430008106 §4). Pure, and written with
 * `createElement` like `SummaryCard`, so the unit tests render them without
 * the Next.js compiler. Every part comes from `LiveContext` (the page's own
 * reads), the student's name from the fast path read, and the outline from
 * the text on screen; a part that did not arrive is left out, never filled in.
 */

import { createElement as h, type ReactNode } from "react";

import { messagesHr } from "@/lib/i18n/messages.hr";

import { assignmentWorksHref, headingAnchor, type LiveContext, type OutlineEntry } from "./live-context";
import styles from "./LiveWorkView.module.css";

const t = messagesHr.liveView;

/** The course, the assignment as the page's one h1, and "name · type · Rad u nastajanju"; without a context only the hidden "Rad uživo". */
export function LiveHeader({ context, name }: { context: LiveContext | null; name: string | null }): ReactNode {
  if (!context) return h("h1", { className: "visually-hidden" }, t.context);
  const meta = [name, context.workType, t.writing].filter((part): part is string => part !== null);
  return h(
    "header",
    { className: styles.head, "data-motif": context.motif },
    h("p", { className: styles.eyebrow }, context.course),
    h("h1", { className: styles.title }, context.title),
    h(
      "p",
      { className: styles.meta },
      ...meta.map((part, i) => h(
        "span",
        { key: part },
        i > 0 ? h("span", { className: styles.dot, "aria-hidden": "true" }, "·") : null,
        part,
      )),
    ),
  );
}

/** "← Radovi zadatka" (only with a context) and "Struktura rada" as links to the headings on screen. */
export function LiveRail({ context, outline, onPick }: {
  context: LiveContext | null;
  outline: readonly OutlineEntry[];
  onPick: () => void;
}): ReactNode {
  return h(
    "nav",
    { className: styles.rail, "aria-label": t.outline },
    context
      ? h("a", { className: styles.back, href: assignmentWorksHref(context.assignmentId) },
        h("span", { "aria-hidden": "true" }, "← "), t.backToWorks)
      : null,
    outline.length > 0 ? h("h2", { className: styles.railTitle }, t.outline) : null,
    outline.length > 0
      ? h(
        "ol",
        { className: styles.outline },
        ...outline.map((entry) => h(
          "li",
          { key: entry.nodeId, "data-level": entry.level },
          h("a", { href: `#${headingAnchor(entry.nodeId)}`, onClick: onPick }, entry.text),
        )),
      )
      : null,
  );
}
