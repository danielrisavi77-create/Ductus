"use client";

/**
 * "Prijavi problem" (Z-10, DAN-431): a button in the shell and a native modal
 * `<dialog>` that posts one report to `POST /api/support/problem-report`
 * (#1919). The form asks for no name; the description stays in the form
 * when sending fails, and one send runs at a time (`singleFlight`), so a
 * double click or a resend makes no second request.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type SyntheticEvent } from "react";

import {
  PROBLEM_REPORT_CATEGORIES,
  PROBLEM_REPORT_DESCRIPTION_MAX,
  type ProblemReportCategory,
} from "@/domain/support/problem-report";
import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./ProblemReport.module.css";
import {
  APP_VERSION,
  buildProblemReportBody,
  checkDescription,
  descriptionLength,
  sendProblemReport,
  singleFlight,
  type DescriptionCheck,
  type SendOutcome,
} from "./problem-report-client";

const t = messagesHr.support;

export type ProblemReportStep =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "sent"; reference: string }
  | { kind: "failed"; message: string };

/** The text under the field for a description that cannot be sent yet. */
export function checkMessage(check: DescriptionCheck, length: number): string | null {
  if (check === "ok") return null;
  if (check === "tooLong") {
    return t.check.tooLong.replace("{n}", String(length)).replace("{max}", String(PROBLEM_REPORT_DESCRIPTION_MAX));
  }
  return t.check[check];
}

/** The step a finished send leads to. */
export function stepAfter(outcome: SendOutcome): ProblemReportStep {
  return outcome.kind === "sent"
    ? { kind: "sent", reference: outcome.reference }
    : { kind: "failed", message: t.failure[outcome.reason] };
}

export default function ProblemReport({ buttonClassName }: { buttonClassName?: string }) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Focus goes back to "Prijavi problem" once the dialog has closed.
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      openerRef.current?.focus();
    }
  }, [open]);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className={buttonClassName}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {t.open}
      </button>
      {open ? <ProblemReportDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ProblemReportDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const fieldId = useId();
  const hintId = useId();
  const checkId = useId();
  const [category, setCategory] = useState<ProblemReportCategory>("technical");
  const [description, setDescription] = useState("");
  const [shownCheck, setShownCheck] = useState(false);
  const [step, setStep] = useState<ProblemReportStep>({ kind: "editing" });
  // One send at a time for this dialog (stable across renders).
  const [send] = useState(() =>
    singleFlight(async (body: string) => {
      setStep({ kind: "sending" });
      const outcome = await sendProblemReport(body);
      setStep(stepAfter(outcome));
      return outcome;
    }),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    headingRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const sending = step.kind === "sending";
  const check = checkDescription(description);
  const length = descriptionLength(description);
  const problem = shownCheck ? checkMessage(check, length) : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (check !== "ok") {
      setShownCheck(true);
      fieldRef.current?.focus();
      return;
    }
    const body = buildProblemReportBody({
      category,
      description,
      pathname: window.location.pathname,
      syncState: null,
      userAgent: navigator.userAgent,
    });
    if (body !== null) void send(body);
  };

  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!sending) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-busy={sending}
      onCancel={onCancel}
    >
      <div className={styles.body}>
        <h2 ref={headingRef} id={titleId} className={styles.title} tabIndex={-1}>
          {step.kind === "sent" ? t.sentTitle : t.title}
        </h2>
        {step.kind === "sent" ? (
          <>
            <p className={styles.text} role="status">
              {t.sentReference.replace("{reference}", step.reference)}
            </p>
            <p className={styles.note}>{t.sentNote}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={onClose}>
                {t.close}
              </button>
            </div>
          </>
        ) : (
          <div className={styles.columns}>
            <form className={styles.form} onSubmit={onSubmit} noValidate>
              <p className={styles.note}>{t.intro}</p>
              <fieldset className={styles.choices} disabled={sending}>
                <legend className={styles.legend}>{t.categoryLegend}</legend>
                {PROBLEM_REPORT_CATEGORIES.map((value) => (
                  <label key={value} className={styles.choice}>
                    <input
                      type="radio"
                      name="problem-category"
                      value={value}
                      checked={category === value}
                      onChange={() => setCategory(value)}
                    />
                    <span>
                      {t.category[value].label}
                      <span className={styles.who}>{t.category[value].who}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className={styles.field}>
                <label htmlFor={fieldId} className={styles.legend}>
                  {t.description}
                </label>
                <textarea
                  ref={fieldRef}
                  id={fieldId}
                  className={styles.input}
                  rows={5}
                  value={description}
                  readOnly={sending}
                  aria-invalid={problem !== null}
                  aria-describedby={problem !== null ? `${checkId} ${hintId}` : hintId}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <p id={hintId} className={styles.note}>
                  {t.counter.replace("{n}", String(length)).replace("{max}", String(PROBLEM_REPORT_DESCRIPTION_MAX))}
                </p>
                {problem !== null ? (
                  <p id={checkId} className={styles.error}>
                    {problem}
                  </p>
                ) : null}
              </div>
              {step.kind === "failed" ? (
                <p className={styles.error} role="alert">
                  {t.failedLead} {step.message}
                </p>
              ) : null}
              {sending ? (
                <p className={styles.note} role="status">
                  {t.sending}
                </p>
              ) : null}
              <div className={styles.actions}>
                <button type="submit" className={styles.primary} disabled={sending}>
                  {step.kind === "failed" ? t.retry : t.send}
                </button>
                <button type="button" className={styles.quiet} disabled={sending} onClick={onClose}>
                  {t.close}
                </button>
              </div>
            </form>
            <aside className={styles.section} aria-label={t.attachedTitle}>
              <h3 className={styles.legend}>{t.attachedTitle}</h3>
              <ul className={styles.list}>
                <li>{t.attachedPage}</li>
                <li>{t.attachedBrowser}</li>
                <li>{t.attachedVersion.replace("{version}", APP_VERSION)}</li>
              </ul>
              <p className={styles.note}>{t.noContent}</p>
            </aside>
          </div>
        )}
      </div>
    </dialog>
  );
}
