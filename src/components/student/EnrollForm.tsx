"use client";

import { useRef, useState, type FormEvent } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { enrollWithCode, type Enrollment } from "./enroll-code";
import styles from "./AssignmentNotice.module.css";

const e = t.student.enroll;
// An API route that starts an OIDC login: a real navigation, not a Link.
export const SIGN_IN_HREF = `/api/auth/login?returnTo=${encodeURIComponent("/upis")}`;

export default function EnrollForm() {
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Enrollment | null>(null);
  const busy = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    setResult(await enrollWithCode(code));
    busy.current = false;
    setSending(false);
  }

  if (result?.kind === "enrolled") return <p role="status">{e.enrolled}</p>;
  return (
    <form className={styles.ack} onSubmit={submit}>
      <label htmlFor="kod">{e.label}</label>
      <p className={styles.hint} id="kod-opis">{e.hint}</p>
      <input
        id="kod"
        name="code"
        autoComplete="off"
        spellCheck={false}
        maxLength={64}
        aria-describedby="kod-opis"
        value={code}
        disabled={sending}
        onChange={(event) => setCode(event.target.value)}
      />
      <button type="submit" disabled={sending || !code.trim()}>{sending ? e.sending : e.submit}</button>
      {result ? <p role="alert">{e.errors[result.kind]}</p> : null}
      {/* The cookie can outlive a session the server closed; give a way back in. */}
      {result?.kind === "unauthorized" ? <p><a href={SIGN_IN_HREF}>{t.student.signIn}</a></p> : null}
    </form>
  );
}
