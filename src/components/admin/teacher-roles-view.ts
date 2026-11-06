import { messagesHr } from "@/lib/i18n/messages.hr";
import type { PersonName, TeacherRoles } from "@/server/institution/teacher-roles";

import type { TeacherRolesView } from "./TeacherRoles";

const t = messagesHr.teacherRoles;

/** The name in the nominative on its own line ("Osoba: …", #1091 c.6674436818); none is a fixed text. */
const nameText = (name: PersonName) => (name === null ? t.unnamed : `${name.givenName} ${name.familyName}`);

/**
 * DAN-581 PR 3 (A-02): the lists of `readTeacherRoles` as `TeacherRoles`
 * shows them. The server already sorted them (surname first, unnamed people
 * last), so the order is kept; only the fields the lists show are passed on.
 */
export function teacherRolesView(roles: TeacherRoles): TeacherRolesView {
  return {
    pending: roles.pending.map(({ personId, name, revokedAt }) => ({ personId, name: nameText(name), revokedAt })),
    confirmed: roles.confirmed.map(({ personId, name, confirmedAt, forReview }) => ({
      personId, name: nameText(name), confirmedAt, forReview,
    })),
  };
}
