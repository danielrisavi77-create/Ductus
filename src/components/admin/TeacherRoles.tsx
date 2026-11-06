"use client";

/**
 * DAN-581 (A-02, plan #1592, docs/design/ductura/m2-reference): the two lists
 * of the administrator's "Korisnici i uloge" and the dialog that confirms or
 * revokes a teacher role. The server decides who may do it and what the lists
 * hold; this only shows them and sends one request per confirmed dialog. The
 * "Za pregled" mark is D-200 P7: a lost right at sign-in revokes nothing.
 * Dialog behaviour follows LogoutDialog: a native modal, Escape and the
 * backdrop mean "Odustani", and the focus starts on the choice that changes
 * nothing. While a request runs the dialog cannot be left.
 */

import { useRouter } from "next/navigation";
import { useEffect, useId, useReducer, useRef, type MouseEvent, type SyntheticEvent } from "react";

import { zagrebParts } from "@/components/summary/zagreb-time";
import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./TeacherRoles.module.css";
import { confirmTeacherRole, revokeTeacherRole, teacherRoleOutcomeText, type TeacherRoleAction } from "./teacher-role-action";
import { IDLE, dialogOpen, nextRoleStep, outcomeRole, refreshAfter } from "./teacher-roles-flow";

const t = messagesHr.teacherRoles;

export type PendingTeacher = { personId: string; name: string; revokedAt: string | null };
export type ConfirmedTeacher = { personId: string; name: string; confirmedAt: string; forReview: boolean };
export type TeacherRolesView = { pending: readonly PendingTeacher[]; confirmed: readonly ConfirmedTeacher[] };

/** A fixed Europe/Zagreb date, so the server and the browser render the same text. */
const dateOf = (iso: string) => zagrebParts(iso)?.date ?? "";

export default function TeacherRoles({ view }: { view: TeacherRolesView }) {
  const router = useRouter();
  const [step, dispatch] = useReducer(nextRoleStep, IDLE);
  const inFlight = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const safeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const open = dialogOpen(step);
  const working = step.kind === "working";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (open) safeRef.current?.focus();
  }, [open, step.kind]);

  const ask = (action: TeacherRoleAction, personId: string, name: string) =>
    dispatch({ type: "ask", action, personId, name });
  const leave = () => dispatch({ type: step.kind === "asking" ? "cancel" : "close" });
  const send = async () => {
    if (step.kind !== "asking" || inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "send" });
    const run = step.action === "confirm" ? confirmTeacherRole : revokeTeacherRole;
    const { kind } = await run(step.personId);
    inFlight.current = false;
    dispatch({ type: "settle", outcome: kind });
    if (refreshAfter(kind)) router.refresh();
  };
  const check = () => {
    dispatch({ type: "close" });
    router.refresh();
  };

  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!working) leave();
  };
  // A close the browser made on its own (Chromium's repeated Escape) is
  // mended while the dialog is still wanted, as in LogoutDialog.
  const onClose = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (working) dialog.showModal();
    else if (open) leave();
  };
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget && !working) leave();
  };

  const shown = step.kind === "done" && !open ? step : null;
  const line = shown ? teacherRoleOutcomeText(shown.action, shown.outcome) : null;
  const role = shown ? outcomeRole(shown.outcome) : null;
  const target = step.kind === "idle" ? null : step;
  const copy = target?.action === "revoke" ? t.revokeDialog : t.confirmDialog;
  const unknown = step.kind === "done" && step.outcome === "unknown";

  return (
    <div className={styles.lists}>
      {/* Both live regions exist before their text, so the outcome is announced. */}
      <div role="status">{role === "status" ? <p className={styles.status}>{line}</p> : null}</div>
      <div role="alert">{role === "alert" ? <p className={styles.alert}>{line}</p> : null}</div>

      <h2 className={styles.heading}>{t.pending.heading}</h2>
      <p className={styles.note}>{t.pending.note}</p>
      {view.pending.length === 0 ? (
        <div className={styles.card}><p>{t.pending.empty}</p><p className={styles.note}>{t.pending.emptyNote}</p></div>
      ) : (
        <ul className={styles.list}>
          {view.pending.map((p) => (
            <li key={p.personId} className={styles.item}>
              <span className={styles.who}>{p.name}</span>
              {p.revokedAt ? <span className={styles.facts}>{t.pending.revokedOn} {dateOf(p.revokedAt)}</span> : null}
              <span className={styles.actions}>
                <button type="button" className={styles.primary} disabled={working} onClick={() => ask("confirm", p.personId, p.name)}>
                  {t.confirmAction}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className={styles.heading}>{t.confirmed.heading}</h2>
      {view.confirmed.length === 0 ? (
        <div className={styles.card}><p>{t.confirmed.empty}</p></div>
      ) : (
        <ul className={styles.list}>
          {view.confirmed.map((c) => (
            <li key={c.personId} className={styles.item}>
              <span className={styles.who}>{c.name}</span>
              <span className={styles.facts}>{t.confirmed.confirmedOn} {dateOf(c.confirmedAt)}</span>
              {c.forReview ? (
                <span className={styles.flag}><strong>{t.review.mark}</strong>{t.review.note}</span>
              ) : null}
              <span className={styles.actions}>
                <button type="button" className={styles.secondary} disabled={working} onClick={() => ask("revoke", c.personId, c.name)}>
                  {t.revokeAction}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onCancel={onCancel} onClose={onClose} onClick={onBackdrop}>
        {target ? (
          <div className={styles.body}>
            <h2 id={titleId} className={styles.title}>{copy.title}</h2>
            <p className={styles.note}>{t.person}: <strong>{target.name}</strong></p>
            {unknown ? (
              <>
                <p role="alert" className={styles.alert}>{teacherRoleOutcomeText(target.action, "unknown")}</p>
                <div className={styles.choices}>
                  <button type="button" className={styles.primary} onClick={check}>{t.check}</button>
                  <button ref={safeRef} type="button" className={styles.secondary} onClick={leave}>{t.close}</button>
                </div>
              </>
            ) : (
              <>
                <ul className={styles.points}>{copy.points.map((point) => <li key={point}>{point}</li>)}</ul>
                <div className={styles.choices}>
                  <button type="button" className={styles.primary} disabled={working} onClick={send}>
                    {target.action === "revoke" ? t.revokeAction : t.confirmAction}
                  </button>
                  <button ref={safeRef} type="button" className={styles.secondary} disabled={working} onClick={leave}>{t.cancel}</button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
