"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { readLogoutHold, shellLogoutStep } from "@/client/logout-hold";
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
 * it. The same POST either way; nothing is deleted here; without JS it posts (I5).
 */
export default function ShellLogout({ scope, session, className, buttonClassName, lead, children }: ShellLogoutProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<LogoutPlan | null>(null);

  // `submit()` fires no submit event, so this handler does not run again.
  const post = () => {
    setBusy(true);
    formRef.current?.submit();
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
          failed={false}
          onConfirm={post}
          onStay={() => setPlan(null)}
          onExport={() => {}}
          copies={plan.copies}
        />
      ) : null}
    </>
  );
}
