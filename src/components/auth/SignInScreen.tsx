import Link from "next/link";

import AppHeader from "@/components/shell/AppHeader";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import styles from "./SignInScreen.module.css";

export type SignInScreenProps = {
  /** The login route with a checked returnTo (signInHref). */
  href: string;
};

/** Official AAI@EduHr help: identity problems belong to the home institution. */
const AAI_HELP_URL = "https://www.aaiedu.hr/kontakt";

/**
 * Archivum sign-in (owner's design package of 26 Oct 2026, DAN-344), laid out
 * on the existing tokens of app/globals.css; the colours follow whatever
 * palette main has. AAI@EduHr stays the one way in for students and teachers
 * (D-09, D-16): no role picker, no e-mail, no password field. The button is a
 * plain link; the login route answers with a redirect to the provider. Help
 * and the code note are <details>, so the page works without JavaScript.
 */
export default function SignInScreen({ href }: SignInScreenProps) {
  return (
    <div className={styles.screen}>
      <AppHeader
        end={
          <Link className={styles.back} href="/">
            <span aria-hidden="true">←</span>{" "}
            {t.prijava.back}
          </Link>
        }
      />
      <main id="sadrzaj" tabIndex={-1} className={styles.main}>
        <section className={styles.intro} aria-labelledby="prijava-naslov">
          <p className={styles.eyebrow}>{t.prijava.eyebrow}</p>
          <h1 id="prijava-naslov" className={styles.title}>
            {t.prijava.heading} <br />
            {t.prijava.headingMore} <em className={styles.accent}>{t.prijava.headingAccent}</em>
          </h1>
          <p className={styles.lead}>
            {t.prijava.lead}{" "}
            <br />
            {t.prijava.leadMore}
          </p>
          <div className={styles.book} aria-hidden="true">
            <div className={styles.stack}>
              <div className={styles.bookBack} />
              <div className={`sheet ${styles.paper}`} data-sheet-theme="light">
                <div className={styles.paperMeta}>
                  <span>{t.prijava.paperMeta}</span>{" "}
                  <span>01</span>
                </div>
                <p className={styles.paperTitle}>
                  {t.prijava.paperTitle}{" "}
                  <br />
                  <em className={styles.accent}>{t.prijava.paperTitleAccent}</em>
                </p>
                <div className={styles.inkLines}>
                  <i />
                  <i />
                  <i />
                </div>
                <p className={styles.paperNote}>{t.prijava.paperNote}</p>
              </div>
            </div>
            <div className={styles.bookCaption}>
              <span>{t.prijava.paperStudent}</span>{" "}
              <span>{t.prijava.paperTeacher}</span>
            </div>
          </div>
        </section>
        <section className={styles.panel} aria-labelledby="prijava-kartica">
          <p className={styles.eyebrow}>{t.prijava.cardEyebrow}</p>
          <h2 id="prijava-kartica" className={styles.panelTitle}>
            {t.prijava.cardTitle}{" "}
            <br />
            <em className={styles.accent}>{t.prijava.cardTitleAccent}</em>
          </h2>
          <p className={styles.body}>{t.prijava.cardBody}</p>
          <a className={styles.button} href={href}>
            <span className={styles.aai} aria-hidden="true">
              aai
            </span>{" "}
            <span className={styles.buttonLabel}>{t.prijava.button}</span>{" "}
            <span aria-hidden="true">→</span>
          </a>
          <p className={styles.note}>
            <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
              <rect x="1" y="5" width="8" height="6.5" rx="1.5" fill="none" stroke="currentColor" />
              <path d="M3 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" />
            </svg>
            {t.prijava.passwordNote}
          </p>
          <div className={styles.role}>
            <h3 className={styles.roleTitle}>{t.prijava.roleTitle}</h3>
            <p className={styles.small}>{t.prijava.roleBody}</p>
          </div>
          <details className={styles.details}>
            <summary>{t.prijava.codeSummary}</summary>
            <p className={styles.small}>{t.prijava.codeNote}</p>
          </details>
        </section>
      </main>
      <footer className={styles.footer}>
        <p className={styles.footerNote}>{t.prijava.footer}</p>
        <details className={styles.help}>
          <summary>{t.prijava.helpSummary}</summary>
          <div className={styles.helpBody}>
            <h3 className={styles.roleTitle}>{t.prijava.helpAaiTitle}</h3>
            <p className={styles.small}>{t.prijava.helpAaiBody}</p>
            <a className={styles.link} href={AAI_HELP_URL} rel="noopener noreferrer">
              {t.prijava.helpAaiLink}
            </a>
            <h3 className={styles.roleTitle}>{t.prijava.helpAccessTitle}</h3>
            <p className={styles.small}>{t.prijava.helpAccessBody}</p>
          </div>
        </details>
      </footer>
    </div>
  );
}
