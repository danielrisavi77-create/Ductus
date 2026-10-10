import Link from "next/link";
import type { ReactNode } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

export type WorkspaceMode = "writing" | "teacher-view";

export type WorkspaceShellProps = {
  /** Course and kind of work, shown next to the brand. */
  context?: ReactNode;
  /** Which of the two views is open; the other is a link. */
  mode?: WorkspaceMode;
  /**
   * Where each view lives. A view without an address is shown as plain text,
   * not as a link that leads nowhere: the teacher's view arrives with F-8.
   */
  writingHref?: string;
  teacherViewHref?: string;
  /** Extra controls in the top bar, before the view switch. */
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
};

/**
 * The writing workspace from design v6 (D-89): 46 px top bar, 236 px left
 * rail, sheet of at most 756 px, 322 px right rail, 34 px status bar. Below
 * 1100 px the rails stack under the sheet so the text keeps its width.
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
}: WorkspaceShellProps) {
  return (
    <div className="workspace">
      <header className="workspace__bar">
        <div className="brand-line">
          <Link className="brand brand--small" href="/">
            {t.app.name}
          </Link>
          {context ? <span className="brand-line__context">{context}</span> : null}
        </div>
        {barExtra}
        <nav className="modes" aria-label={t.workspace.viewModes}>
          <ModeLink href={writingHref} current={mode === "writing"}>
            {t.workspace.modeWriting}
          </ModeLink>
          <ModeLink href={teacherViewHref} current={mode === "teacher-view"}>
            {t.workspace.modeTeacherView}
          </ModeLink>
        </nav>
        <span className="demo-badge demo-badge--small">{t.shell.demoBadgeShort}</span>
      </header>
      {banner}
      <div className="workspace__body">
        <aside className="workspace__rail" aria-label={t.workspace.structureLabel}>
          {rail}
        </aside>
        <main id="sadrzaj" tabIndex={-1} className="workspace__main">
          {children}
        </main>
        <aside className="workspace__panel" aria-label={t.workspace.sidePanel}>
          {panel}
        </aside>
      </div>
      <footer className="workspace__status" aria-label={t.workspace.status}>
        {status}
      </footer>
    </div>
  );
}

type ModeLinkProps = { href?: string; current: boolean; children: ReactNode };

/** One entry of the view switch; without an address it is not a link. */
function ModeLink({ href, current, children }: ModeLinkProps) {
  if (href === undefined) {
    return <span className="modes__item">{children}</span>;
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
