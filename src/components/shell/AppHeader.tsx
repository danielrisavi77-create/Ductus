import type { ReactNode } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

export type AppHeaderProps = {
  /** Course, assignment or other context next to the brand. */
  context?: ReactNode;
  /** Right-hand side, e.g. the signed-in person (F-5). */
  end?: ReactNode;
};

/**
 * Top bar of the plain screens (notice, confirmations, teacher lists).
 *
 * A server component with no client reference (DAN-570): every loading.tsx
 * renders it, and Next.js gives the client chunks of a loading boundary a
 * <script> without the request nonce, which the page policy refuses; the
 * page then never finished hydrating on WebKit. The brand is therefore a
 * plain link (a full load of "/"), not next/link. loading-boundary.test.ts
 * keeps every boundary free of client modules.
 */
export default function AppHeader({ context, end }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="app-header__start">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- DAN-570: next/link here would put a client chunk without the nonce into every loading boundary. */}
          <a className="brand brand--small" href="/">
            {t.app.name}
          </a>
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
