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
  closeReply,
  copyPart,
  logoutText,
  nextDiscardStep,
  settleDiscard,
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
  const copy = copyPart(copies, Boolean(onRestoreCopy && onDiscardCopy));
  const [discard, setDiscard] = useState<DiscardStep>("idle");
  const step = (event: DiscardEvent) => setDiscard((now) => nextDiscardStep(now, event));
  const keepRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  // While a discard runs or is asked, nothing else in the dialog runs beside it.
  const busy = working || discard === "working";
  // The question needs the copy: when the copies are gone it goes too.
  const asking = copy !== null && discard === "confirm";
  const copyShown = copy !== null;
  useEffect(() => {
    if (!copyShown && discard === "confirm") step("keep");
  }, [copyShown, discard]);
  // Set when Escape took the question back, so the close the browser may
  // send after it opens the dialog again instead of counting as "Ostani".
  const withdrawn = useRef(false);

  // The question takes the focus to "Zadrži kopiju". Once the question or a
  // discard is over, its buttons are gone or back, so the focus returns to
  // the copy, or to "Ostani" without one.
  const refocus = useRef(false);
  useEffect(() => {
    if (discard === "confirm") {
      refocus.current = true;
      keepRef.current?.focus();
    } else if (discard === "working") refocus.current = true;
    else if (refocus.current) {
      refocus.current = false;
      (discardRef.current ?? stayRef.current)?.focus();
    }
  }, [discard]);

  const askDiscard = () => {
    withdrawn.current = false;
    step("ask");
  };
  const keepCopy = () => step("keep");
  const confirmDiscard = () => {
    if (!onDiscardCopy || discard !== "confirm") return;
    withdrawn.current = false;
    step("confirm");
    // A discard that throws, rejects or hangs ends as failed (D-118).
    settleDiscard(onDiscardCopy).then(
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
    withdrawn.current = asking;
    if (asking) keepCopy();
    else if (!busy) onStay();
  };
  // The browser may close the dialog on its own: Chromium stops honouring
  // `preventDefault` on a repeated Escape without a new user activation
  // (close watcher rule). While this component is mounted the dialog is
  // wanted, so a close it did not ask for is mended (`closeReply`). When it
  // opens again the focus goes back where it was meant to be, never to the
  // first button, which while asking is the one that discards.
  const onClose = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open || unmounting.current) return;
    if (closeReply({ busy, asking, withdrawn: withdrawn.current }) === "stay") {
      onStay();
      return;
    }
    withdrawn.current = false;
    dialog.showModal();
    (keepRef.current ?? discardRef.current ?? stayRef.current)?.focus();
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
            {!copy.actions ? null : asking ? (
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
