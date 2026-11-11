"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { readLogoutHold, shellLogoutStep } from "@/client/logout-hold";
import { browserSignOutDeps, followLogoutNatively, signOutHere } from "@/client/logout-request";
import type { SessionMark } from "@/client/session-marks";
import LogoutDialog from "@/components/editor/LogoutDialog";
import type { LogoutPlan } from "@/components/editor/logout-plan";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

export type ShellLogoutProps = {
  /** This person's journal scope; null opens the dialog without a number. */
  scope: string | null;
  /** The session this page was rendered under; null without a session cookie. */
  session: SessionMark | null;
  className?: string;
  buttonClassName?: string;
  /** Before the button (who is signed in); `children` go before its label. */
  lead?: ReactNode;
  children?: ReactNode;
};

/**
 * Sign-out from a shell page without the editor (D-118): reads per click what
 * this person's journal holds; nothing posts at once, else the dialog names
 * it. The same request as the editor's (DAN-99): the session ends on this
 * device whatever the route answers, and without an answer the dialog says
 * so. Nothing is deleted here; without JS the form posts (I5).
 */
const NOTHING_HELD: LogoutPlan = { unsaved: false, pending: 0, copies: 0, kept: false };

export default function ShellLogout({ scope, session, className, buttonClassName, lead, children }: ShellLogoutProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<LogoutPlan | null>(null);
  const [signedOutHere, setSignedOutHere] = useState(false);

  // No answer: ended here all the same, and the dialog says so. A later
  // click finds the session ended and goes to `/` without posting.
  const unanswered = () => {
    setPlan((open) => open ?? NOTHING_HELD);
    setSignedOutHere(true);
    setBusy(false);
  };
  const post = () => {
    setBusy(true);
    void signOutHere(session, browserSignOutDeps())
      .then((reached) => (reached ? followLogoutNatively() : unanswered()), unanswered);
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || plan) return;
    setBusy(true);
    void readLogoutHold(scope, { session }).then((read) => {
      const step = shellLogoutStep(read);
      // The page's session has ended: `/` renders under the browser's cookie.
      if (step.kind === "leave") {
        window.location.assign("/");
        return;
      }
      if (step.kind === "plain") {
        post();
        return;
      }
      setBusy(false);
      setPlan(step.plan);
    });
  };

  // Focus goes back to "Odjava" once the dialog has closed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (plan) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      buttonRef.current?.focus();
    }
  }, [plan]);

  return (
    <>
      <form method="post" action="/api/auth/logout" className={className} onSubmit={onSubmit}>
        {lead}
        <button ref={buttonRef} type="submit" className={buttonClassName} disabled={busy}>
          {children}
          {busy ? t.auth.loggingOut : t.shell.signOut}
        </button>
      </form>
      {plan ? (
        <LogoutDialog
          plan={plan}
          working={busy}
          signedOutHere={signedOutHere}
          onConfirm={post}
          onStay={() => setPlan(null)}
          onExport={() => {}}
          copies={plan.copies}
        />
      ) : null}
    </>
  );
}
