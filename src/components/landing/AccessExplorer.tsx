"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { nextTab } from "./accessTabs";
import access from "./Access.module.css";
import styles from "./Wow.module.css";

const l = t.landing.access;
const ROLE_KEYS = ["student", "mentor", "institution"] as const;

/**
 * What each role sees of a student's work (PRODUCT §5 rules 5, 7 and 17). A
 * plain tab list: one panel at a time, arrow keys move between the roles. No
 * data is read from the visitor and nothing is sent.
 */
export default function AccessExplorer() {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTab(index, event.key, ROLE_KEYS.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  const role = l.roles[ROLE_KEYS[active] ?? "student"];

  return (
    <section className={styles.block} aria-labelledby="access-title">
      <p className={styles.eyebrow}>{l.eyebrow}</p>
      <h2 id="access-title" className={styles.blockTitle}>
        {l.title}
      </h2>
      <p className={styles.lead}>{l.lead}</p>
      <div className={access.tabs} role="tablist" aria-label={l.tablistLabel}>
        {ROLE_KEYS.map((key, index) => (
          <button
            key={key}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`access-tab-${key}`}
            aria-selected={index === active}
            aria-controls="access-panel"
            tabIndex={index === active ? 0 : -1}
            className={access.tab}
            onClick={() => setActive(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {l.roles[key].name}
          </button>
        ))}
      </div>
      <div
        className={access.panel}
        role="tabpanel"
        id="access-panel"
        aria-labelledby={`access-tab-${ROLE_KEYS[active] ?? "student"}`}
      >
        <div>
          <h3 className={access.listTitle}>{l.sees}</h3>
          <ul className={access.list}>
            {role.sees.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className={access.listTitle}>{l.doesNot}</h3>
          <ul className={access.list}>
            {role.not.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className={styles.small}>{l.note}</p>
    </section>
  );
}
