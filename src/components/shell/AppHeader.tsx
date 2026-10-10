import Link from "next/link";
import type { ReactNode } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

export type AppHeaderProps = {
  /** Course, assignment or other context next to the brand. */
  context?: ReactNode;
  /** Right-hand side, e.g. the signed-in person (F-5). */
  end?: ReactNode;
};

/** Top bar of the plain screens (notice, confirmations, teacher lists). */
export default function AppHeader({ context, end }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="app-header__start">
          <Link className="brand brand--small" href="/">
            {t.app.name}
          </Link>
          {context ? <span className="app-header__context">{context}</span> : null}
        </div>
        <div className="app-header__end">
          <span className="demo-badge">{t.shell.demoBadge}</span>
          {end}
        </div>
      </div>
    </header>
  );
}
