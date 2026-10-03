import type { ReactNode } from "react";

export const metadata = {
  title: "Ductus",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hr">
      <body>{children}</body>
    </html>
  );
}
