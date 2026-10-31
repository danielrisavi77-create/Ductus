import Script from "next/script";
import type { ReactNode } from "react";

import { THEME_SCRIPT } from "@/components/shell/theme";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { fontVariables } from "./fonts";

import "./fonts/fonts.css";
import "./globals.css";

export const metadata = {
  title: t.app.name,
};

const enableReactGrab =
  process.env.NODE_ENV === "development" &&
  process.env.DUCTUS_DEV_REACT_GRAB === "1" &&
  !process.env.CI;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme choice is on the whole document (Z-13a): dark until the
    // inline script, before the body is painted, finds a stored light choice.
    <html lang="hr" className={fontVariables} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {enableReactGrab && (
          <Script
            id="ductus-react-grab"
            src="https://unpkg.com/react-grab@0.2.0/dist/index.global.js"
            integrity="sha384-PXOWAzllLihCpnqFflLZrth6D6UsI8PqPYbA6qYnE44Cld6haJIBjLZR4onqH+3z"
            crossOrigin="anonymous"
            data-options='{"telemetry":false,"freezeReactUpdates":false}'
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body>
        <a className="skip-link" href="#sadrzaj">
          {t.shell.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
