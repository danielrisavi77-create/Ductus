import AppHeader from "@/components/shell/AppHeader";
import RouteLoading from "@/components/shell/RouteLoading";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// #732 item 4: shown while the teacher's courses are read.
export default function TeacherHomeLoading() {
  return (
    <>
      <AppHeader context={t.teacherCourses.title} />
      <RouteLoading label={t.workspace.panelLoading} />
    </>
  );
}
