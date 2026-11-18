"use client";

import { useEffect, useState, type MouseEvent } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import styles from "./SignInScreen.module.css";

export type SignInLinkProps = {
  /** The login route with a checked returnTo (signInHref). */
  href: string;
  /** The button's text: the sign-in itself, or "Pokušaj ponovno". */
  label: string;
};

/** A click that opens the link in this tab: a plain primary click, no modifier. */
function navigatesHere(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The AAI@EduHr button of /prijava (S-01 state 1, "preusmjeravanje"). It stays
 * a plain link that the browser follows with or without JavaScript (D-09: the
 * login route answers with a redirect to the provider); the click handler
 * never prevents it and only says, in a status line that is in the page from
 * the start, that the redirect is under way. A page restored from the back
 * cache starts again without that line. Unlike the reference the button is not
 * disabled meanwhile, so a navigation the person stops leaves it usable.
 */
export default function SignInLink({ href, label }: SignInLinkProps) {
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <div className={styles.signIn}>
      <a
        className={styles.button}
        href={href}
        // Never disabled: a stopped navigation must leave the link usable.
        onClick={(event) => {
          if (navigatesHere(event)) setRedirecting(true);
        }}
      >
        <span className={styles.aai} aria-hidden="true">
          aai
        </span>{" "}
        <span className={styles.buttonLabel}>{label}</span>{" "}
        <span aria-hidden="true">→</span>
      </a>
      <div className={styles.redirect} role="status">
        {redirecting ? (
          <>
            <p className={styles.redirectTitle}>{t.prijava.redirecting}</p>
            <div className={styles.bar} aria-hidden="true">
              <span />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
