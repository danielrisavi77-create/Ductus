import AppHeader from "@/components/shell/AppHeader";
import styles from "@/components/student/AssignmentNotice.module.css";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// FE-D8 (#476 row 05): shown while the notice is read on the server.
export default function AssignmentNoticeLoading() {
  return (
    <>
      <AppHeader context={t.student.title} />
      <main id="sadrzaj" tabIndex={-1} className={`page ${styles.screen}`}>
        <section className={styles.card} aria-busy="true">
          <p className={styles.status} role="status">{t.student.loading}</p>
        </section>
      </main>
    </>
  );
}
