"use client";

/**
 * The sign-out dialog (FE-D7, design demo-tok-v2 "Odjava", D-118). A native
 * modal `<dialog>`: the page behind it is inert, Tab stays inside, and Escape
 * or a click on the backdrop means "Ostani". It opens with the focus on
 * "Ostani", the choice that changes nothing. Its text comes from
 * `logoutText` and speaks only of this device.
 */

import { useEffect, useId, useRef, type MouseEvent, type SyntheticEvent } from "react";

import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./LogoutDialog.module.css";
import { logoutText, type LogoutPlan } from "./logout-plan";

const t = messagesHr.auth;

export type LogoutDialogProps = {
  plan: LogoutPlan;
  /** A sign-out is running; the dialog cannot be left meanwhile. */
  working: boolean;
  /** The last sign-out did not reach the server; nothing was deleted. */
  failed: boolean;
  onConfirm: () => void;
  onStay: () => void;
  onExport: () => void;
};

export default function LogoutDialog({ plan, working, failed, onConfirm, onStay, onExport }: LogoutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  // Set when React removes the dialog, so its own close is not mended.
  const unmounting = useRef(false);
  const titleId = useId();
  const textId = useId();
  const { text, note, offerExport } = logoutText(plan);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    // Development runs the effect twice (Strict Mode); the second run is a mount again.
    unmounting.current = false;
    if (!dialog.open) dialog.showModal();
    stayRef.current?.focus();
    return () => {
      unmounting.current = true;
      if (dialog.open) dialog.close();
    };
  }, []);

  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!working) onStay();
  };
  // The browser may close the dialog on its own: Chromium stops honouring
  // `preventDefault` on a repeated Escape without a new user activation
  // (close watcher rule). While this component is mounted the dialog is
  // wanted, so a close it did not ask for is mended: during a sign-out the
  // dialog opens again, otherwise the close counts as "Ostani".
  const onClose = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open || unmounting.current) return;
    if (working) dialog.showModal();
    else onStay();
  };
  // Only the backdrop: the content fills the dialog, so a click inside it
  // never has the dialog itself as its target.
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget && !working) onStay();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={onCancel}
      onClose={onClose}
      onClick={onBackdrop}
    >
      <div className={styles.body}>
        <h2 id={titleId} className={styles.title}>{t.logoutTitle}</h2>
        <p id={textId} className={styles.text}>{text}</p>
        {note ? <p className={styles.note}>{note}</p> : null}
        {/* The live region exists before its text, so the failure is announced. */}
        <div role="alert">{failed ? <p className={styles.error}>{t.logoutFailed}</p> : null}</div>
        <div className={styles.actions}>
          <button type="button" className={styles.confirm} onClick={onConfirm} disabled={working}>
            {working ? t.loggingOut : t.logoutConfirm}
          </button>
          {offerExport ? (
            <button type="button" className={styles.secondary} onClick={onExport} disabled={working}>
              {messagesHr.editor.exportText}
            </button>
          ) : null}
          <button ref={stayRef} type="button" className={styles.stay} onClick={onStay} disabled={working}>
            {t.logoutStay}
          </button>
        </div>
      </div>
    </dialog>
  );
}
