import type { ReactNode } from "react";
import { Instrument_Sans, JetBrains_Mono, Newsreader } from "next/font/google";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import "./globals.css";

// next/font downloads the files at build time and serves them from our own
// origin, so the student's browser never contacts Google.
const ui = Instrument_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-ui",
  display: "swap",
});
const display = Newsreader({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-display",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: t.app.name,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hr" className={`${ui.variable} ${display.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#sadrzaj">
          {t.shell.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
