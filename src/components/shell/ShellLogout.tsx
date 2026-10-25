"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { readLogoutHold, shellLogoutStep } from "@/client/logout-hold";
import LogoutDialog from "@/components/editor/LogoutDialog";
import type { LogoutPlan } from "@/components/editor/logout-plan";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

export type ShellLogoutProps = {
  /** This person's journal scope from the server; null asks the dialog without a number. */
  scope: string | null;
  className?: string;
  buttonClassName?: string;
  /** Shown in the form before the button (who is signed in). */
  lead?: ReactNode;
  /** Shown in the button before its label (the icon). */
  children?: ReactNode;
};

/**
 * Signing out from a page in the shell without the editor (D-118). Before the
 * POST it reads, once per click, what this person's journal on this device
 * still holds; with nothing it signs out at once, otherwise the dialog names
 * it. Either way the same POST ends the session and nothing is deleted here.
 * Without JavaScript the form posts directly (I5).
 */
export default function ShellLogout({ scope, className, buttonClassName, lead, children }: ShellLogoutProps) {
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
    void readLogoutHold(scope).then((read) => {
      const step = shellLogoutStep(read);
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
