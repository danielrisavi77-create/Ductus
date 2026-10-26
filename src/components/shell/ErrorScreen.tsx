import Link from "next/link";
import { createElement as h } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import styles from "./ErrorScreen.module.css";

export type ErrorScreenProps = {
  title: string;
  body: string;
  /** "Pokušaj ponovno" for a render error; absent on a missing page. */
  onRetry?: () => void;
};

/**
 * #732 item 3: the body of the error and not-found pages, under the plain
 * AppHeader. One h1 and no session or database read, so it still renders when
 * those fail. Written with createElement, like the other screens tested by
 * static render.
 */
export default function ErrorScreen({ title, body, onRetry }: ErrorScreenProps) {
  return h(
    "main",
    { id: "sadrzaj", tabIndex: -1, className: "page" },
    h("h1", null, title),
    h("p", { role: onRetry ? "alert" : undefined }, body),
    h(
      "p",
      { className: styles.actions },
      onRetry ? h("button", { type: "button", className: "btn", onClick: onRetry }, t.auth.retry) : null,
      h(Link, { className: onRetry ? `btn ${styles.quiet}` : "btn", href: "/" }, t.auth.home),
    ),
  );
}
