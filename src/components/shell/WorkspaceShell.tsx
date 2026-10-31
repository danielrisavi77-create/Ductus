import Link from "next/link";
import type { ReactNode } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import ShellRail from "./ShellRail";
import styles from "./WorkspaceShell.module.css";

export type WorkspaceMode = "writing" | "teacher-view";

export type WorkspaceShellProps = {
  /** Course and kind of work, shown next to the brand. */
  context?: ReactNode;
  /** Which of the two views is open; the other is a link. */
  mode?: WorkspaceMode;
  /**
   * Where each view lives. A view without an address is a visibly disabled
   * button that says why, never a link that leads nowhere: the teacher's view
   * exists only for the student's own assignment work (#732 item 7).
   */
  writingHref?: string;
  teacherViewHref?: string;
  /** Extra controls at the end of the top bar, after the view switch. */
  barExtra?: ReactNode;
  /** Shown under the top bar, e.g. the offline notice (F-8). */
  banner?: ReactNode;
  /** Left rail: structure, tables, footnotes, progress. */
  rail: ReactNode;
  /** Right rail: instructions, sources, comments. */
  panel: ReactNode;
  /** Status bar: save state, word count, deadline. */
  status: ReactNode;
  /** The sheet and its toolbar. */
  children: ReactNode;
  /** Drawn instead of `children` when `mode` is "teacher-view": a read-only sheet, no toolbar. */
  teacherView?: ReactNode;
};

/**
 * The writing workspace of design editor-v11 (docs/design/ductura/README.md
 * §5.1, FE-D1), inside the design v3 shell (#476 6314969336, "Pisanje"): a
 * work header with the course and assignment on the left and the view switch
 * on the right (brand, demo label and account live in the shell), a 174 px
 * structure rail, a sheet of at most 720 px, a 284 px right panel with tabs,
 * and the status bar, framed with `--radius`.
 *
 * The DOM order is the same at every width: sheet (`main`), instructions,
 * structure. On a wide screen `grid-template-areas` puts the structure rail
 * on the left, beside the sheet the skip link leads to; below 1100 px both
 * rails are sections under the sheet that open with a button, in DOM order.
 */
export default function WorkspaceShell({
  context,
  mode = "writing",
  writingHref,
  teacherViewHref,
  barExtra,
  banner,
  rail,
  panel,
  status,
  children,
  teacherView,
}: WorkspaceShellProps) {
  return (
    <div className={`workspace ${styles.workspace}`}>
      {/* A named region: the course and assignment and the bar's links are
          inside a landmark like the rest of the page (axe "region", #711 F1). */}
      <section className="workspace__bar" aria-label={t.workspace.barLabel}>
        {context ? <p className="brand-line brand-line__context">{context}</p> : null}
        <nav className="modes" aria-label={t.workspace.viewModes}>
          <ModeLink href={writingHref} current={mode === "writing"} off={t.workspace.soon}>
            {t.workspace.modeWriting}
          </ModeLink>
          <ModeLink href={teacherViewHref} current={mode === "teacher-view"} off={t.workspace.teacherViewOff}>
            {t.workspace.modeTeacherView}
          </ModeLink>
        </nav>
        {barExtra}
      </section>
      {banner}
      <div className="workspace__body">
        <main id="sadrzaj" tabIndex={-1} className="workspace__main">
          {mode === "teacher-view" ? teacherView : children}
        </main>
        <ShellRail className="workspace__panel" label={t.workspace.sidePanel}>
          {panel}
        </ShellRail>
        <ShellRail className="workspace__rail" label={t.workspace.structureLabel}>
          {rail}
        </ShellRail>
      </div>
      <footer className="workspace__status" aria-label={t.workspace.status}>
        {status}
      </footer>
    </div>
  );
}

type ModeLinkProps = { href?: string; current: boolean; off: string; children: ReactNode };

/**
 * One entry of the view switch. Without an address it is a button that stays
 * in the Tab order and says it is unavailable (`aria-disabled`) and why
 * (`off`), so a keyboard or screen reader user learns the view exists.
 */
function ModeLink({ href, current, off, children }: ModeLinkProps) {
  if (href === undefined) {
    return (
      <button type="button" className="modes__item" aria-disabled="true">
        {children} <span className="soon">{off}</span>
      </button>
    );
  }
  return (
    <Link className="modes__item" href={href} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}

export type RailSectionProps = {
  title: string;
  count?: ReactNode;
  children: ReactNode;
};

/** One titled group in the left rail. */
export function RailSection({ title, count, children }: RailSectionProps) {
  return (
    <section className="rail-section">
      <h2 className="rail-section__title">
        {title}
        {count !== undefined ? <span className="rail-section__count">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}
