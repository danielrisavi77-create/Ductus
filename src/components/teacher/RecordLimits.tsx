import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./LiveWorkView.module.css";

const t = messagesHr.recordLimits;

/**
 * What the record cannot show (K-3 text; PLAN-DEMO point 8, D-80 point 3,
 * owner on #87 6266445027 point 3), with the two invented histories of the
 * demo. A fixed text, the same for every work and every reader.
 */
export default function RecordLimits() {
  return (
    <section className={styles.limits}>
      <h2 id="record-limits-title">{t.title}</h2>
      <p>{t.lead}</p>
      <h3>{t.exampleTitle}</h3>
      <ul>
        <li>{t.exampleA}</li>
        <li>{t.exampleB}</li>
      </ul>
      <p>{t.conclusion}</p>
    </section>
  );
}
