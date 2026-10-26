import Link from "next/link";

import SheetFrame from "@/components/shell/SheetFrame";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import AccessExplorer from "./AccessExplorer";
import FaqSection from "./FaqSection";
import { FLOW_STEPS } from "./flowSteps";
import styles from "./Landing.module.css";
import Rewind from "./Rewind";
import TwoSides from "./TwoSidesLazy";

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
            <a href="#tijek-rada">{l.flow.link}</a>
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

        <TwoSides />
        <Rewind />
        <AccessExplorer />

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

        {/* Announcements only (FE-H2a): no control, nothing that acts as if a step works. */}
        <section id="tijek-rada" className={styles.section} aria-labelledby="tijek-rada-naslov">
          <p className={styles.eyebrow}>{l.flow.link}</p>
          <h2 id="tijek-rada-naslov" className={styles.sectionTitle}>
            {l.flow.title}
          </h2>
          <p className={styles.lead}>{l.flow.lead}</p>
          <ol className={styles.flow}>
            {FLOW_STEPS.map(({ key, soon }, index) => {
              const step = l.flow.steps[key];
              return (
                <li key={key} className={styles.flowCard} data-soon={soon ? "true" : undefined}>
                  <div className={styles.flowHead}>
                    <span className={styles.flowNo} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.flowName}>{step.name}</span>
                    {soon ? <span className={styles.soon}>{l.flow.soon}</span> : null}
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              );
            })}
          </ol>
        </section>

        <FaqSection />

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
