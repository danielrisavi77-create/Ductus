import AppHeader from "@/components/shell/AppHeader";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import styles from "./SignInScreen.module.css";

export type SignInScreenProps = {
  /** The login route with a checked returnTo (signInHref). */
  href: string;
};

/**
 * Prijava v5 (docs/design/ductura/prijava-v5.dc.html) with AAI@EduHr as the
 * one way in (D-09): no e-mail sign-in, no work passport, no panel on what is
 * kept (#476 row 3). The button is a plain link; the login route answers with
 * a redirect to the provider.
 */
export default function SignInScreen({ href }: SignInScreenProps) {
  return (
    <div className={styles.screen}>
      <AppHeader />
      <main id="sadrzaj" tabIndex={-1} className={styles.main}>
        <div className={styles.hero}>
          <h1 className={styles.title}>
            {t.prijava.title} <span className={styles.accent}>{t.prijava.titleAccent}</span>
          </h1>
          <p className={styles.lead}>{t.prijava.lead}</p>
          <p className={styles.motto}>{t.prijava.motto}</p>
        </div>
        <section className={styles.card} aria-labelledby="prijava-kartica">
          <h2 id="prijava-kartica" className={styles.cardTitle}>
            {t.prijava.cardTitle}
          </h2>
          <p className={styles.cardBody}>{t.prijava.cardBody}</p>
          <a className={styles.button} href={href}>
            {t.prijava.button}
            <span aria-hidden="true">→</span>
          </a>
          <p className={styles.note}>
            <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
              <rect x="1" y="5" width="8" height="6.5" rx="1.5" fill="none" stroke="currentColor" />
              <path d="M3 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" />
            </svg>
            {t.prijava.passwordNote}
          </p>
          <hr className={styles.rule} />
          <p className={styles.small}>{t.prijava.codeNote}</p>
          <p className={styles.small}>{t.prijava.help}</p>
        </section>
      </main>
    </div>
  );
}
