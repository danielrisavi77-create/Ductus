import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./HowItWorks.module.css";

const t = messagesHr.howItWorks;

const SEEN_ROWS = ["live", "replay", "compare"] as const;

/**
 * "Kako Ductura radi" (DAN-431, J-02), after
 * docs/design/ductura/m11-javno-reference/j02-kako-radi.html. Static: no
 * props, no state, no read; every reader gets the same page. The order of the
 * sections is the keyboard order of the reference. Data location (P-01 to
 * P-04) and the check button (no route yet) are left out on purpose.
 */
export default function HowItWorks() {
  return (
    <div className={`page ${styles.page}`}>
      <header className={styles.heading}>
        <h1>{t.title}</h1>
        <p className={styles.lead}>{t.lead}</p>
      </header>

      <div className={styles.pair}>
        <section className={styles.panel} aria-labelledby="kr-biljezi">
          <h2 id="kr-biljezi">{t.recorded.heading}</h2>
          <ul className={styles.facts}>
            <li>
              {t.recorded.changes} <span className={styles.openMark}>{t.recorded.changesConditional}</span>
            </li>
            <li>{t.recorded.sources}</li>
            <li>{t.recorded.versions}</li>
            <li>{t.recorded.access}</li>
          </ul>
        </section>
        <section className={styles.panel} aria-labelledby="kr-ne-biljezi">
          <h2 id="kr-ne-biljezi">{t.notRecorded.heading}</h2>
          <ul className={styles.facts}>
            <li>{t.notRecorded.keys}</li>
            <li>{t.notRecorded.outside}</li>
            <li>{t.notRecorded.rhythm}</li>
            <li>{t.notRecorded.authorship}</li>
          </ul>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="kr-vidi">
        <h2 id="kr-vidi">{t.seen.heading}</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-labelledby="kr-vidi">
            <thead>
              <tr>
                <th scope="col">{t.seen.columns.view}</th>
                <th scope="col">{t.seen.columns.you}</th>
                <th scope="col">{t.seen.columns.mentor}</th>
                <th scope="col">{t.seen.columns.others}</th>
              </tr>
            </thead>
            <tbody>
              {SEEN_ROWS.map((row) => (
                <tr key={row}>
                  <th scope="row">{t.seen.rows[row]}</th>
                  <td className={styles.yes}>{t.seen.yes}</td>
                  <td className={styles.yes}>{t.seen.yes}</td>
                  <td className={styles.no}>{t.seen.no}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.meta}>{t.seen.othersNote}</p>
      </section>

      <section className={styles.panel} aria-labelledby="kr-sprema">
        <h2 id="kr-sprema">{t.saving.heading}</h2>
        <ul className={styles.facts}>
          <li>{t.saving.device}</li>
          <li>{t.saving.server}</li>
          <li>{t.saving.offline}</li>
          <li>{t.saving.submitted}</li>
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="kr-provjera">
        <h2 id="kr-provjera">{t.check.heading}</h2>
        <p>{t.check.body}</p>
      </section>

      <section className={styles.panel} aria-labelledby="kr-pravila">
        <h2 id="kr-pravila">{t.rules.heading}</h2>
        <p>{t.rules.body}</p>
      </section>
    </div>
  );
}
