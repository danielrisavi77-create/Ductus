"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { enrollWithCode, SIGN_IN_HREF, type Enrollment } from "./enroll-code";
import { courseHref } from "./open-assignment";
import styles from "./Enroll.module.css";

const e = t.student.enroll;

export default function EnrollForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Enrollment | null>(null);
  const busy = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    const next = await enrollWithCode(code);
    setResult(next);
    // PRODUCT §5 rule 6: the next screen is the notice of the open assignment,
    // found on the server for this course. An already enrolled student gets the
    // same reply and the same way there.
    if (next.kind === "enrolled") {
      router.replace(courseHref(next.courseId));
      return;
    }
    busy.current = false;
    setSending(false);
  }

  if (result?.kind === "enrolled") return <p className={styles.status} role="status">{e.opening}</p>;
  return (
    // No `name` on the input: a submit before hydration must not put the code in the URL.
    <form className={styles.form} onSubmit={submit} aria-busy={sending}>
      <p className={styles.hint} id="kod-opis">{e.hint}</p>
      <label className={styles.label} htmlFor="kod">{e.label}</label>
      <div className={styles.row}>
        <input
          id="kod"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          aria-describedby="kod-opis"
          aria-invalid={result ? true : undefined}
          value={code}
          disabled={sending}
          onChange={(event) => setCode(event.target.value)}
        />
        <button type="submit" disabled={sending || !code.trim()}>{sending ? e.sending : e.submit}</button>
      </div>
      {result ? <p className={styles.error} role="alert">{e.errors[result.kind]}</p> : null}
      {/* The cookie can outlive a session the server closed; give a way back in. */}
      {result?.kind === "unauthorized" ? <p><a href={SIGN_IN_HREF}>{t.student.signIn}</a></p> : null}
    </form>
  );
}
