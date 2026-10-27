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
 *
 * After a submission the server confirmed, what this device holds of the
 * work is offered for deletion the same way, with two clicks (F-154, owner
 * decision 1.3). "Odjavi se" still leaves it on this device (D-118).
 */

import { useEffect, useId, useRef, useState, type MouseEvent, type RefObject, type SyntheticEvent } from "react";

import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./LogoutDialog.module.css";
import {
  closeReply,
  afterSubmissionPart,
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
  /**
   * Deletes what this device holds of the submitted work (F-154, owner
   * decision 1.3); settles once it is gone or has failed. Given only for a
   * submission the server confirmed in this page session.
   */
  onDiscardAfterSubmission?: () => Promise<void>;
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
  onDiscardAfterSubmission,
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
  // F-154: the same two clicks for what was written after the submission.
  const after = afterSubmissionPart(plan, Boolean(onDiscardAfterSubmission));
  const [afterDiscard, setAfterDiscard] = useState<DiscardStep>("idle");
  const afterStep = (event: DiscardEvent) => setAfterDiscard((now) => nextDiscardStep(now, event));
  const afterKeepRef = useRef<HTMLButtonElement>(null);
  const afterDiscardRef = useRef<HTMLButtonElement>(null);
  // While a discard runs or is asked, nothing else in the dialog runs beside it.
  const busy = working || discard === "working" || afterDiscard === "working";
  // The question needs the copy: when the copies are gone it goes too.
  const askingCopy = copy !== null && discard === "confirm";
  const askingAfter = after !== null && afterDiscard === "confirm";
  const asking = askingCopy || askingAfter;
  const copyShown = copy !== null;
  useEffect(() => {
    if (!copyShown && discard === "confirm") step("keep");
  }, [copyShown, discard]);
  const afterShown = after !== null;
  useEffect(() => {
    if (!afterShown && afterDiscard === "confirm") afterStep("keep");
  }, [afterShown, afterDiscard]);
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
  const afterRefocus = useRef(false);
  useEffect(() => {
    if (afterDiscard === "confirm") {
      afterRefocus.current = true;
      afterKeepRef.current?.focus();
    } else if (afterDiscard === "working") afterRefocus.current = true;
    else if (afterRefocus.current) {
      afterRefocus.current = false;
      (afterDiscardRef.current ?? stayRef.current)?.focus();
    }
  }, [afterDiscard]);

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
  const askAfter = () => {
    withdrawn.current = false;
    afterStep("ask");
  };
  const keepAfter = () => afterStep("keep");
  const confirmAfter = () => {
    if (!onDiscardAfterSubmission || afterDiscard !== "confirm") return;
    withdrawn.current = false;
    afterStep("confirm");
    settleDiscard(onDiscardAfterSubmission).then(
      () => afterStep("done"),
      () => afterStep("error"),
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
    if (askingCopy) keepCopy();
    else if (askingAfter) keepAfter();
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
    (keepRef.current ?? afterKeepRef.current ?? discardRef.current ?? afterDiscardRef.current ?? stayRef.current)?.focus();
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
                <button type="button" className={styles.secondary} onClick={onRestoreCopy} disabled={busy || asking}>
                  {t.copyRestore}
                </button>
                <button ref={discardRef} type="button" className={styles.secondary} onClick={askDiscard} disabled={busy || asking}>
                  {t.copyDiscard}
                </button>
              </div>
            )}
          </section>
        ) : null}
        {after ? (
          <AfterSubmissionPart
            title={after.title}
            asking={askingAfter}
            failed={afterDiscard === "failed"}
            disabled={busy || asking}
            keepRef={afterKeepRef}
            discardRef={afterDiscardRef}
            onAsk={askAfter}
            onKeep={keepAfter}
            onConfirm={confirmAfter}
          />
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

/**
 * The part for what was written after the submission (F-154): one button,
 * then the question with "Da, obriši izmjene" and "Zadrži izmjene". Its own
 * element, so the dialog's text keeps few readings for the term scan.
 */
function AfterSubmissionPart({
  title, asking, failed, disabled, keepRef, discardRef, onAsk, onKeep, onConfirm,
}: {
  title: string;
  asking: boolean;
  /** The last discard failed; the rows stay on this device. */
  failed: boolean;
  disabled: boolean;
  keepRef: RefObject<HTMLButtonElement | null>;
  discardRef: RefObject<HTMLButtonElement | null>;
  onAsk: () => void;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className={styles.copy} aria-label={title}>
      {asking ? (
        <>
          <p className={styles.text}>{t.afterSubmissionDiscardAsk}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={onConfirm}>
              {t.afterSubmissionDiscardConfirm}
            </button>
            <button ref={keepRef} type="button" className={styles.stay} onClick={onKeep}>
              {t.afterSubmissionKeep}
            </button>
          </div>
        </>
      ) : (
        <div className={styles.actions}>
          <button ref={discardRef} type="button" className={styles.secondary} onClick={onAsk} disabled={disabled}>
            {t.afterSubmissionDiscard}
          </button>
        </div>
      )}
      {/* The live region exists before its text, so the failure is announced. */}
      <div role="alert">{failed ? <p className={styles.error}>{t.afterSubmissionDiscardFailed}</p> : null}</div>
    </section>
  );
}