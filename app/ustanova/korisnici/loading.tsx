import AppHeader from "@/components/shell/AppHeader";
import RouteLoading from "@/components/shell/RouteLoading";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// DAN-581 (A-02): shown while the page reads the teacher roles; a wait,
// never an empty list or an older one.
export default function TeacherRolesLoading() {
  return (
    <>
      <AppHeader context={t.teacherRoles.title} />
      <RouteLoading label={t.teacherRoles.loading} />
    </>
  );
}
