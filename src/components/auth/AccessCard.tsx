import Link from "next/link";
import { createElement as h } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import type { AccessKind } from "./access-kind";
import styles from "./AccessCard.module.css";
import { signInHref, signInTarget } from "./sign-in-link";

export type AccessCardProps = {
  kind: AccessKind;
  /** The page to come back to after sign-in; checked again by the login route. */
  returnTo: string;
  /** What the page shows once signed in, for "Prijavite se da vidite …". */
  what: keyof typeof t.access.what;
};

/** The only way in (D-09): a real navigation to the login route, never a prefetchable Link. */
function signInButton(returnTo: string) {
  return h(
    "a",
    { className: styles.button, href: signInHref(signInTarget(returnTo)) },
    h("span", { className: styles.aai, "aria-hidden": "true" }, "aai"),
    " ",
    h("span", { className: styles.label }, t.prijava.button),
    " ",
    h("span", { "aria-hidden": "true" }, "→"),
  );
}

/**
 * DAN-378 (M1.8), in place of a page's content inside the shell: Z-03 for a
 * closed session, a plain "not signed in" for no session, and Z-05 for a
 * signed-in person without the role. Z-05 offers no sign-in (#1233) and says
 * nothing of the requested item, only of the own account. Written with
 * createElement, like the other screens tested by static render.
 */
export default function AccessCard({ kind, returnTo, what }: AccessCardProps) {
  if (kind === "denied") {
    return h(
      "section",
      { className: styles.card, "aria-labelledby": "pristup-naslov" },
      h("h1", { id: "pristup-naslov" }, t.access.deniedTitle),
      h("p", null, t.access.deniedBody),
      // Until the own pending teacher role can be read (contract, #1091
      // c.6561758305), both a student and an unconfirmed teacher read both.
      h("p", null, t.access.deniedPending),
      h("p", { className: styles.next }, t.access.deniedNext),
      h("p", { className: styles.actions }, h(Link, { className: "btn", href: "/" }, t.access.backToOwn)),
    );
  }
  const expired = kind === "expired";
  return h(
    "section",
    { className: styles.card, "aria-labelledby": "pristup-naslov" },
    h("h1", { id: "pristup-naslov" }, expired ? t.access.expiredTitle : t.access.signedOutTitle),
    h(
      "p",
      { role: "status" },
      expired ? t.access.expiredBody : t.access.signedOutBody.replace("{what}", t.access.what[what]),
    ),
    signInButton(returnTo),
  );
}
