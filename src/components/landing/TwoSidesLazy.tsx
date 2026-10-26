"use client";

import dynamic from "next/dynamic";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import styles from "./Wow.module.css";

/** The editor is heavy and needs the browser, so it loads when the page does, never on the server. */
const TwoSides = dynamic(() => import("./TwoSides"), {
  ssr: false,
  loading: () => <p className={styles.small}>{t.landing.wow.loading}</p>,
});

export default function TwoSidesLazy() {
  return <TwoSides />;
}
