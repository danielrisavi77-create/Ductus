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
  /**
   * The page reads the mark (`liveSessionToken`): the sign-out is the
   * editor's request, and without the route's confirmation the dialog says
   * so and offers it again (DAN-99, F-285). Elsewhere the form posts as before.
   */
  endsOnDevice?: boolean;
  className?: string;
  buttonClassName?: string;
  /** Before the button (who is signed in); `children` go before its label. */
  lead?: ReactNode;
  children?: ReactNode;
};

const NOTHING_HELD: LogoutPlan = { unsaved: false, pending: 0, copies: 0, kept: false };

/**
 * Sign-out from a shell page without the editor (D-118): reads per click what
 * this person's journal holds; nothing posts at once, else the dialog names
 * it. Where the page reads the mark, the same request as the editor's
 * (DAN-99): only the route's confirmation ends the session here and follows
 * on to the provider. Without it nothing has ended (F-285): the dialog says
 * the sign-out is unconfirmed and offers it again. Elsewhere the form posts.
 * Nothing is deleted here; without JS the form posts (I5).
 */
export default function ShellLogout({ scope, session, endsOnDevice = false, className, buttonClassName, lead, children }: ShellLogoutProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<LogoutPlan | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  // Only the latest attempt may change what the dialog shows.
  const attempt = useRef(0);

  // No confirmation: nothing ended, the session stays signed in, and the
  // dialog says so with the request offered again (F-285).
  const unanswered = (mine: number) => {
    if (mine !== attempt.current) return;
    setPlan((open) => open ?? NOTHING_HELD);
    setUnconfirmed(true);
    setBusy(false);
  };
  const post = () => {
    setBusy(true);
    // `submit()` fires no submit event, so onSubmit does not run again.
    if (!endsOnDevice) {
      formRef.current?.submit();
      return;
    }
    const mine = ++attempt.current;
    void signOutHere(session, browserSignOutDeps())
      .then((reached) => (reached && mine === attempt.current ? followLogoutNatively() : unanswered(mine)), () => unanswered(mine));
  };
  const stay = () => {
    attempt.current += 1;
    setUnconfirmed(false);
    setPlan(null);
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
      <form ref={formRef} method="post" action="/api/auth/logout" className={className} onSubmit={onSubmit}>
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
          signedOutHere={false}
          unconfirmed={unconfirmed}
          onConfirm={post}
          onStay={stay}
          onExport={() => {}}
          copies={plan.copies}
        />
      ) : null}
    </>
  );
}
