import { messagesHr } from "@/lib/i18n/messages.hr";
import type { InstitutionOverview as Overview } from "@/server/institution/institution-overview";

import styles from "./InstitutionOverview.module.css";

const t = messagesHr.institutionOverview;
const ORDER = ["confirmedTeachers", "teacherCandidates", "teachersWithoutAffiliation", "courses", "students"] as const;
const number = new Intl.NumberFormat("hr-HR");

/**
 * DAN-313 (A-01): the counts of the administrator's own institution, each
 * with what it counts. No action, no person and no course name; a count of
 * zero is shown only when the database answered zero.
 */
export default function InstitutionOverview({ overview }: { overview: Overview }) {
  return (
    <section className={styles.sheet} aria-labelledby="ustanova-naziv">
      <h2 id="ustanova-naziv" className={styles.name}>{overview.institutionName ?? t.unnamed}</h2>
      <dl className={styles.counts} aria-label={t.countsLabel}>
        {ORDER.map((key) => (
          <div key={key} className={styles.count}>
            <dt className={styles.label}>{t.counts[key].label}</dt>
            <dd className={styles.value}>{number.format(overview[key])}</dd>
            <dd className={styles.note}>{t.counts[key].note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
