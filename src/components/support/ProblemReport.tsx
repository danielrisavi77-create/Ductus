"use client";

/**
 * "Prijavi problem" (Z-10, DAN-431): a button in the shell and a native modal
 * `<dialog>` that posts one report to `POST /api/support/problem-report`
 * (#1919). The form asks for no name; the description stays in the form
 * when sending fails, and one send runs at a time (`singleFlight`), so a
 * double click or a resend makes no second request. Once the session the
 * page was opened under ends (sign-out, or another person signing in in
 * another tab), nothing more is sent and the description leaves the form.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";

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
  type FailureReason,
  type SendOutcome,
} from "./problem-report-client";

const t = messagesHr.support;

export type ProblemReportStep =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "sent"; reference: string }
  | { kind: "failed"; lead: string; message: string; maybeRecorded: boolean }
  | { kind: "ended"; delivery: EndedDelivery; reference?: string };

/**
 * What became of the report when the session ended: not sent, may have been
 * recorded (it left before the session ended), or received with a reference.
 * Only the first may say it was not sent (Grok review, #1967).
 */
export type EndedDelivery = "notSent" | "maybe" | "received";

/** The text under the field for a description that cannot be sent yet. */
export function checkMessage(check: DescriptionCheck, length: number): string | null {
  if (check === "ok") return null;
  if (check === "tooLong") {
    return t.check.tooLong.replace("{n}", String(length)).replace("{max}", String(PROBLEM_REPORT_DESCRIPTION_MAX));
  }
  return t.check[check];
}

/**
 * Answers after which the report may still have been recorded: these must not
 * say it was not sent, or the person sends it twice (Grok review, #1967). A
 * lost connection is one of them: it may drop after the report was recorded
 * and before the answer arrived (Codex, #1967).
 */
const MAYBE_RECORDED: ReadonlySet<FailureReason> = new Set(["network", "timeout", "unknown"]);

/** The step a finished send leads to. */
export function stepAfter(outcome: SendOutcome): ProblemReportStep {
  if (outcome.kind === "sent") return { kind: "sent", reference: outcome.reference };
  if (outcome.kind === "ended") return { kind: "ended", delivery: "notSent" };
  const maybeRecorded = MAYBE_RECORDED.has(outcome.reason);
  return {
    kind: "failed",
    lead: maybeRecorded ? t.keptLead : t.failedLead,
    message: t.failure[outcome.reason],
    maybeRecorded,
  };
}

/** The ended step for a send whose answer came after the session ended. */
export function endedAfter(outcome: SendOutcome): ProblemReportStep {
  if (outcome.kind === "sent") return { kind: "ended", delivery: "received", reference: outcome.reference };
  if (outcome.kind === "failed" && MAYBE_RECORDED.has(outcome.reason)) return { kind: "ended", delivery: "maybe" };
  return { kind: "ended", delivery: "notSent" };
}

/** The ended step when the session ends while the dialog is in `step`. */
export function endedFrom(step: ProblemReportStep): ProblemReportStep {
  if (step.kind === "ended" || step.kind === "sent") return step;
  if (step.kind === "sending" || (step.kind === "failed" && step.maybeRecorded)) return { kind: "ended", delivery: "maybe" };
  return { kind: "ended", delivery: "notSent" };
}

/** The text for an ended dialog, by what became of the report. */
export function endedMessage(step: { delivery: EndedDelivery; reference?: string }): string {
  if (step.delivery === "received") return t.endedReceived.replace("{reference}", step.reference ?? "");
  if (step.delivery === "maybe") return t.endedMaybe;
  return t.ended;
}

type ProblemReportProps = {
  buttonClassName?: string;
  /** The session the page was rendered under; null without a session cookie. */
  session: SessionMark | null;
};

export default function ProblemReport({ buttonClassName, session }: ProblemReportProps) {
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
      {/* Below 800 px the side bar is `visibility: hidden` until opened, and a
          modal dialog still inherits that from its ancestors, so it lives in
          <body> (Codex, #1967). `open` is only ever true in the browser. */}
      {open ? createPortal(<ProblemReportDialog session={session} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}

export function ProblemReportDialog({ session, onClose }: { session: SessionMark | null; onClose: () => void }) {
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
  const watchRef = useRef<SessionWatch | null>(null);
  const tag = session?.tag ?? null;
  const at = session?.at ?? 0;

  // The session this dialog was opened under (F-5, D-118): once it ends, the
  // description is not this browser's person's to send any more (Codex, #1967).
  useLayoutEffect(() => {
    const watch = watchSessionEnd(tag === null ? null : { tag, at }, () => {
      setDescription("");
      setStep(endedFrom);
    });
    watchRef.current = watch;
    return () => {
      watch.close();
      if (watchRef.current === watch) watchRef.current = null;
    };
  }, [tag, at]);

  // One send at a time for this dialog (stable across renders). The session
  // is checked again right before posting and once the answer is in, so a
  // late answer does not cover the ended state.
  const current = useCallback(() => !(watchRef.current?.ended() ?? false), []);
  const [send] = useState(() =>
    singleFlight(async (body: string, stillCurrent: () => boolean) => {
      setStep({ kind: "sending" });
      const outcome = await sendProblemReport(body, undefined, undefined, stillCurrent);
      setStep(stillCurrent() ? stepAfter(outcome) : endedAfter(outcome));
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

  // Once sent or ended, the form (and the focused button) is gone: focus the
  // new heading.
  useEffect(() => {
    if (step.kind === "sent" || step.kind === "ended") headingRef.current?.focus();
  }, [step.kind]);

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
    if (body !== null) void send(body, current);
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
        {step.kind === "ended" ? (
          <>
            <p className={styles.text} role="alert">
              {endedMessage(step)}
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={onClose}>
                {t.close}
              </button>
            </div>
          </>
        ) : step.kind === "sent" ? (
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
                  {step.lead} {step.message}
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
