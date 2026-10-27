import { createElement as h, type ReactNode } from "react";

import { messagesHr } from "@/lib/i18n/messages.hr";

import styles from "./EmptyHome.module.css";

const t = messagesHr.student.home.empty;

/**
 * DAN-344, Archivum S01_prazna: the first arrival on /zadaci, a read that
 * loaded and found no own course. Never the unavailable state. `enroll` is
 * the existing EnrollForm, passed in by the page so this stays a server
 * render: same route, same outcomes, no logic of its own. The folio picture
 * is a decorative background. Written with `createElement`, so unit tests
 * need no JSX compiler.
 */
export default function EmptyHome({ enroll }: { enroll: ReactNode }) {
  return h("div", { className: styles.empty },
    h("div", { className: styles.top },
      h("section", { className: styles.first, "aria-labelledby": "prazno-naslov" },
        h("div", { className: styles.folio, "aria-hidden": "true" }),
        h("h2", { id: "prazno-naslov", className: styles.heading }, t.heading),
        h("p", { className: styles.body }, t.body)),
      h("section", { className: styles.code, "aria-labelledby": "prazno-kod" },
        h("h2", { id: "prazno-kod", className: styles.codeHeading }, t.codeHeading),
        enroll)),
    h("section", { className: styles.next, "aria-labelledby": "prazno-dalje" },
      h("h2", { id: "prazno-dalje", className: styles.nextHeading }, t.nextHeading),
      h("ol", { className: styles.steps },
        t.steps.map((step, i) =>
          h("li", { key: step.title, className: styles.step },
            h("span", { className: styles.number, "aria-hidden": "true" }, String(i + 1)),
            h("span", null,
              h("strong", { className: styles.stepTitle }, step.title),
              h("span", { className: styles.stepBody }, step.body)))))));
}
