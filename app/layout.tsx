import type { ReactNode } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { fontVariables } from "./fonts";

import "./fonts/fonts.css";
import "./globals.css";

export const metadata = {
  title: t.app.name,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hr" className={fontVariables}>
      <body>
        <a className="skip-link" href="#sadrzaj">
          {t.shell.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
