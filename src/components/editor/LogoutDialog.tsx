"use client";

/**
 * The sign-out dialog (FE-D7, design demo-tok-v2 "Odjava", D-118). A native
 * modal `<dialog>`: the page behind it is inert, Tab stays inside, and Escape
 * or a click on the backdrop means "Ostani". It opens with the focus on
 * "Ostani", the choice that changes nothing. Its text comes from
 * `logoutText` and speaks only of this device.
 *
 * When the device keeps copies outside the work (3d-2c, P3 and P4 a), the
 * dialog names them and offers "Vrati tekst u rad" and "Odbaci kopiju".
 * "Odjavi se" stays available and leaves every copy on this device (D-118).
 * Discarding asks again in the dialog; Escape then only takes the question
 * back. Restoring is the caller's: the text goes back through the editor.
 */

import { useEffect, useId, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";

import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./LogoutDialog.module.css";
import {
  copyText,
  logoutText,
  nextDiscardStep,
  type DiscardEvent,
  type DiscardStep,
  type LogoutPlan,
} from "./logout-plan";

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
  /** Copies kept outside the work; 0 or absent shows no copy part. */
  copies?: number;
  /** Puts the newest copy back into the work. */
  onRestoreCopy?: () => void;
  /** Discards the newest copy; settles once it is gone or has failed. */
  onDiscardCopy?: () => Promise<void>;
};

export default function LogoutDialog({
  plan,
  working,
  failed,
  onConfirm,
  onStay,
  onExport,
  copies = 0,
  onRestoreCopy,
  onDiscardCopy,
}: LogoutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  // Set when React removes the dialog, so its own close is not mended.
  const unmounting = useRef(false);
  const titleId = useId();
  const textId = useId();
  const { text, note, offerExport } = logoutText(plan);
  const copy = onRestoreCopy && onDiscardCopy ? copyText(copies) : null;
  const [discard, setDiscard] = useState<DiscardStep>("idle");
  const step = (event: DiscardEvent) => setDiscard((now) => nextDiscardStep(now, event));
  const keepRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  // While a discard runs or is asked, nothing else in the dialog runs beside it.
  const busy = working || discard === "working";
  const asking = discard === "confirm";

  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  // Once a discard settles its buttons are back or gone, so the focus that
  // sat on a disabled button returns to the copy, or to "Ostani" without one.
  const settling = useRef(false);
  useEffect(() => {
    if (discard === "working") settling.current = true;
    else if (settling.current) {
      settling.current = false;
      (discardRef.current ?? stayRef.current)?.focus();
    }
  }, [discard]);

  const askDiscard = () => step("ask");
  const keepCopy = () => {
    step("keep");
    discardRef.current?.focus();
  };
  const confirmDiscard = () => {
    if (!onDiscardCopy || discard !== "confirm") return;
    step("confirm");
    onDiscardCopy().then(
      () => step("done"),
      () => step("error"),
    );
  };

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
    if (asking) keepCopy();
    else if (!busy) onStay();
  };
  // The browser may close the dialog on its own: Chromium stops honouring
  // `preventDefault` on a repeated Escape without a new user activation
  // (close watcher rule). While this component is mounted the dialog is
  // wanted, so a close it did not ask for is mended: during a sign-out the
  // dialog opens again, otherwise the close counts as "Ostani".
  const onClose = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open || unmounting.current) return;
    if (busy || asking) dialog.showModal();
    else onStay();
  };
  // Only the backdrop: the content fills the dialog, so a click inside it
  // never has the dialog itself as its target.
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget && !busy && !asking) onStay();
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
        {copy ? (
          <section className={styles.copy} aria-label={t.copyTitle}>
            <p className={styles.text}>{copy.text}</p>
            <p className={styles.note}>{copy.note}</p>
            {copy.newestOnly ? <p className={styles.note}>{copy.newestOnly}</p> : null}
            {asking ? (
              <>
                <p className={styles.text}>{t.copyDiscardAsk}</p>
                <div className={styles.actions}>
                  <button type="button" className={styles.secondary} onClick={confirmDiscard}>
                    {t.copyDiscardConfirm}
                  </button>
                  <button ref={keepRef} type="button" className={styles.stay} onClick={keepCopy}>
                    {t.copyKeep}
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.actions}>
                <button type="button" className={styles.secondary} onClick={onRestoreCopy} disabled={busy}>
                  {t.copyRestore}
                </button>
                <button ref={discardRef} type="button" className={styles.secondary} onClick={askDiscard} disabled={busy}>
                  {t.copyDiscard}
                </button>
              </div>
            )}
          </section>
        ) : null}
        {/* The live region exists before its text, so the failure is announced. */}
        <div role="alert">
          {failed ? <p className={styles.error}>{t.logoutFailed}</p> : null}
          {discard === "failed" ? <p className={styles.error}>{t.copyDiscardFailed}</p> : null}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.confirm} onClick={onConfirm} disabled={busy || asking}>
            {working ? t.loggingOut : t.logoutConfirm}
          </button>
          {offerExport ? (
            <button type="button" className={styles.secondary} onClick={onExport} disabled={busy || asking}>
              {messagesHr.editor.exportText}
            </button>
          ) : null}
          <button ref={stayRef} type="button" className={styles.stay} onClick={onStay} disabled={busy || asking}>
            {t.logoutStay}
          </button>
        </div>
      </div>
    </dialog>
  );
}
