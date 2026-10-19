import Link from "next/link";

import SheetFrame from "@/components/shell/SheetFrame";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import styles from "./Landing.module.css";

/** Every way in leads to the sign-in screen (owner, #476); it offers AAI@EduHr only (D-09). */
export const SIGN_IN_PATH = "/prijava";

const l = t.landing;

/**
 * Public home page for a visitor without a session (FE-H1, #476). The shell is
 * dark (D-115); the preview's sheet uses the writer's own sheet switch, so the
 * white sheet is the same mechanism as on /rad (D-123). The preview is drawn
 * in markup with invented text, never an image of real work.
 */
export default function Landing() {
  return (
    <div className={styles.landing}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerStart}>
            <Link className="brand brand--small" href="/">
              {t.app.name}
            </Link>
            <span className="demo-badge">{t.shell.demoBadge}</span>
          </div>
          <nav className={styles.nav} aria-label={l.sectionsNav}>
            <a href="#kako-radi">{l.howItWorksLink}</a>
            <a href="#za-koga">{l.forWhomLink}</a>
          </nav>
          {/* A plain link: the sign-in screen is its own route (FE-D3). */}
          <a className="btn" href={SIGN_IN_PATH}>
            {t.auth.signIn}
          </a>
        </div>
      </header>

      <main id="sadrzaj" tabIndex={-1} className={styles.main}>
        <section className={styles.hero} aria-labelledby="pocetna-naslov">
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>{l.eyebrow}</p>
            <h1 id="pocetna-naslov" className={styles.title}>
              {l.title} <em>{l.titleAccent}</em>
            </h1>
            <p className={styles.intro}>{l.intro}</p>
            <p className={styles.intro}>{t.home.lead}</p>
            <div className={styles.actions}>
              <a className="btn" href={SIGN_IN_PATH}>
                {l.enter}
              </a>
              <a className={styles.ghost} href="#kako-radi">
                {l.howItWorksLink}
              </a>
            </div>
            <p className={styles.small}>{l.aaiOnly}</p>
          </div>

          <figure className={styles.preview} aria-label={l.previewLabel}>
            <div className={styles.window}>
            <div className={styles.previewBar}>
              <span className={styles.previewBrand}>{t.app.name}</span>
              <span className={styles.previewCourse}>{l.previewCourse}</span>
            </div>
            <div className={styles.previewBody}>
              <div className={styles.previewSheet}>
                <SheetFrame>
                  <p className={styles.sheetTitle}>{l.previewTitle}</p>
                  <p className={styles.sheetSection}>{l.previewSection}</p>
                  <p className={styles.sheetText}>{l.previewParagraph1}</p>
                  <p className={styles.sheetText}>
                    {l.previewParagraph2Start}
                    <span className="comment-mark">{l.previewParagraph2Marked}</span>
                    {l.previewParagraph2End}
                  </p>
                </SheetFrame>
              </div>
              <div className={styles.comment}>
                <p className={styles.commentHead}>
                  <strong>{l.previewCommentAuthor}</strong> <span>{l.previewCommentPlace}</span>
                </p>
                <p>{l.previewComment}</p>
              </div>
            </div>
            </div>
            <figcaption className={styles.small}>{l.previewNote}</figcaption>
          </figure>
        </section>

        <section id="za-koga" className={styles.section} aria-labelledby="za-koga-naslov">
          <p className={styles.eyebrow}>{l.forWhomLink}</p>
          <h2 id="za-koga-naslov" className={styles.sectionTitle}>
            {l.forWhomTitle}
          </h2>
          <p className={styles.lead}>{l.forWhomLead}</p>
          <div className={styles.roles}>
            <article className={styles.role}>
              <p className={styles.eyebrow}>{l.studentEyebrow}</p>
              <h3>{l.studentTitle}</h3>
              <p>{l.studentBody}</p>
              <ul>
                {Object.values(l.studentPoints).map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
            <article className={styles.role}>
              <p className={styles.eyebrow}>{l.teacherEyebrow}</p>
              <h3>{l.teacherTitle}</h3>
              <p>{l.teacherBody}</p>
              <ul>
                {Object.values(l.teacherPoints).map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section id="kako-radi" className={styles.section} aria-labelledby="kako-radi-naslov">
          <p className={styles.eyebrow}>{l.howItWorksLink}</p>
          <h2 id="kako-radi-naslov" className={styles.sectionTitle}>
            {l.howTitle}
          </h2>
          <ol className={styles.steps}>
            {(
              [
                [l.steps.assignmentTitle, l.steps.assignmentBody],
                [l.steps.writingTitle, l.steps.writingBody],
                [l.steps.commentsTitle, l.steps.commentsBody],
                [l.steps.submitTitle, l.steps.submitBody],
              ] as const
            ).map(([title, body], index) => (
              <li key={title} className={styles.step}>
                <span className={styles.stepNo} aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.closing} aria-labelledby="zakljucak-naslov">
          <h2 id="zakljucak-naslov" className={styles.sectionTitle}>
            {l.closingTitle} <em>{l.closingAccent}</em>
          </h2>
          <a className="btn" href={SIGN_IN_PATH}>
            {t.auth.signIn}
          </a>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>
          {t.app.name} · {l.footerNote}
        </span>
        <span>{t.shell.demoBadge}</span>
      </footer>
    </div>
  );
}
