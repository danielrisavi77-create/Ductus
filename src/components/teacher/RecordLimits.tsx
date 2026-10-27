import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./LiveWorkView.module.css";

const t = messagesHr.recordLimits;

/**
 * What the record cannot show (K-3 text; PLAN-DEMO point 8, D-80 point 3,
 * owner on #87 6266445027 point 3), with the two invented histories of the
 * demo. A fixed text, the same for every work and every reader. `folded`
 * (Archivum T05, DAN-344): the title and one short line at the foot of the
 * teacher's view, the whole text one click away; nothing of it is dropped.
 */
export default function RecordLimits({ folded = false }: { folded?: boolean }) {
  const body = (
    <>
      <p>{t.lead}</p>
      <h3>{t.exampleTitle}</h3>
      <ul>
        <li>{t.exampleA}</li>
        <li>{t.exampleB}</li>
      </ul>
      <p>{t.conclusion}</p>
    </>
  );
  if (folded) {
    return (
      <details className={styles.limitsFold}>
        <summary>
          <h2 id="record-limits-title">{t.title}<span aria-hidden="true"> →</span></h2>
          <span className={styles.note}>{messagesHr.liveView.limitsShort}</span>
        </summary>
        <section className={styles.limits} aria-labelledby="record-limits-title">{body}</section>
      </details>
    );
  }
  return (
    <section className={styles.limits}>
      <h2 id="record-limits-title">{t.title}</h2>
      {body}
    </section>
  );
}
