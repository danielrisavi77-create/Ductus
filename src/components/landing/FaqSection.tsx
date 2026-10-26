import { messagesHr as t } from "@/lib/i18n/messages.hr";

import access from "./Access.module.css";
import styles from "./Wow.module.css";

const l = t.landing.faq;

/** Short answers as native disclosure elements: keyboard and screen readers work without script. */
export default function FaqSection() {
  return (
    <section className={styles.block} aria-labelledby="faq-title">
      <p className={styles.eyebrow}>{l.eyebrow}</p>
      <h2 id="faq-title" className={styles.blockTitle}>
        {l.title}
      </h2>
      <div className={access.faq}>
        {Object.entries(l.items).map(([key, item]) => (
          <details key={key} className={access.faqItem}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
