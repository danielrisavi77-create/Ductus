import { createElement as h } from "react";

/**
 * #732 item 4: the body a route shows while its page reads the database, in
 * the pattern of app/zadatak/[id]/loading.tsx; the loading.tsx puts it under
 * the plain AppHeader. Not AppShell: the fallback has no session to mark for
 * the other tabs (SessionObserver, D-118), so it reads none and claims none.
 * Written with createElement, like the other screens tested by static render.
 */
export default function RouteLoading({ label }: { label: string }) {
  return h(
    "main",
    { id: "sadrzaj", tabIndex: -1, className: "page", "aria-busy": "true" },
    h("p", { role: "status" }, label),
  );
}
