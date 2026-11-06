/**
 * Browser side of the teacher roles suite (DAN-581, plan #1592 C1): the
 * production `TeacherRoles` mounted on a bare page with invented people,
 * inside the App Router context Next gives it, so each `router.refresh()` is
 * counted here. It is bundled by `teacher-roles-harness.ts` and never shipped.
 */

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";

import TeacherRoles, { type TeacherRolesView } from "../../src/components/admin/TeacherRoles";

declare global {
  interface Window {
    __roles?: { refreshes: number };
  }
}

const VIEW: TeacherRolesView = {
  pending: [{ personId: "00000000-0000-4000-8000-000000000001", name: "Osoba A (test)", revokedAt: null }],
  confirmed: [
    { personId: "00000000-0000-4000-8000-000000000003", name: "Osoba C (test)", confirmedAt: "2026-09-01T10:00:00Z", forReview: false },
  ],
};

const seen = { refreshes: 0 };
window.__roles = seen;

const nothing = () => undefined;
const router: AppRouterInstance = {
  back: nothing,
  forward: nothing,
  prefetch: nothing,
  push: nothing,
  replace: nothing,
  refresh: () => {
    seen.refreshes += 1;
  },
};

createRoot(document.getElementById("root")!).render(
  h(AppRouterContext.Provider, { value: router }, h(TeacherRoles, { view: VIEW })),
);
