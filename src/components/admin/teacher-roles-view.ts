import { messagesHr } from "@/lib/i18n/messages.hr";
import type { PersonName, TeacherRoles } from "@/server/institution/teacher-roles";

import type { TeacherRolesView } from "./TeacherRoles";

/**
 * DAN-581 (A-02): the read's two lists as the screen shows them. A name stays
 * in the nominative, given name first, on its own line ("Osoba"); a person
 * whose name the identity provider never gave is shown as such, never as an
 * empty line or an identifier. The read's order (by surname) is kept.
 */
export function displayName(name: PersonName): string {
  return name === null ? messagesHr.teacherRoles.unnamed : `${name.givenName} ${name.familyName}`;
}

export function teacherRolesView(roles: TeacherRoles): TeacherRolesView {
  return {
    pending: roles.pending.map(({ personId, name, revokedAt }) => ({ personId, name: displayName(name), revokedAt })),
    confirmed: roles.confirmed.map(({ personId, name, confirmedAt, forReview }) => (
      { personId, name: displayName(name), confirmedAt, forReview }
    )),
  };
}
