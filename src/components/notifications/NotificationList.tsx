"use client";

import { useState } from "react";

import { notificationMessages as t } from "./messages";
import { NotificationIcon } from "./NotificationIcon";
import { emptyNotificationState, notificationHref, visibleNotifications, type NotificationFilter, type NotificationItem, type NotificationRead } from "./notification-list";
import styles from "./NotificationList.module.css";

/**
 * Presentational part of DAN-305. It has no data source or route yet. The
 * caller must provide only authorised information and must enforce access
 * again at the destination. Filtering never changes a notification's status.
 */
export default function NotificationList({
  read,
  audience,
}: {
  read: NotificationRead;
  audience: "student" | "teacher";
}) {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const lead = audience === "student" ? t.studentLead : t.teacherLead;
  const retryHref = read.kind === "unavailable" && read.retryHref ? notificationHref(read.retryHref) : null;

  return (
    <div className={styles.view}>
      <header className={styles.heading}>
        <h1>{t.heading}</h1>
        <p>{lead}</p>
      </header>

      {read.kind === "loading" ? (
        <State icon="bell" title={t.loadingTitle} body={t.loadingBody} role="status" />
      ) : read.kind === "unavailable" ? (
        <State icon="info" title={t.unavailableTitle} body={t.unavailableBody} role="alert">
          {retryHref && <a className={styles.textButton} href={retryHref}>{t.retry}</a>}
        </State>
      ) : (
        <>
          <div className={styles.filters} role="group" aria-label={t.filter}>
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              {t.all}
            </button>
            <button type="button" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>
              {t.unread}
            </button>
          </div>
          <Items items={read.items} complete={read.complete} filter={filter} showAll={() => setFilter("all")} />
        </>
      )}
    </div>
  );
}

function Items({ items, complete, filter, showAll }: {
  items: readonly NotificationItem[];
  complete: boolean;
  filter: NotificationFilter;
  showAll: () => void;
}) {
  const shown = visibleNotifications(items, filter);
  const empty = emptyNotificationState(items, complete, filter);
  if (empty) {
    const filtered = filter === "unread" && items.length > 0;
    const title = {
      empty: t.emptyTitle,
      noUnread: t.unreadEmptyTitle,
      partialEmpty: t.partialEmptyTitle,
      partialUnread: t.partialUnreadTitle,
    }[empty];
    const body = empty === "empty" ? t.emptyBody : empty === "noUnread" ? t.unreadEmptyBody : t.partialBody;
    return (
      <State icon="bell" title={title} body={body} role="status">
        {filtered && <button className={styles.textButton} type="button" onClick={showAll}>{t.showAll}</button>}
      </State>
    );
  }

  return (
    <section aria-label={t.heading}>
      <ul className={styles.list}>
        {shown.map((item) => <NotificationCard key={item.id} item={item} />)}
      </ul>
      {!complete && <p className={styles.partial}>{t.partialBody}</p>}
    </section>
  );
}

function NotificationCard({ item }: { item: NotificationItem }) {
  const href = item.action && notificationHref(item.action.href);
  return (
    <li className={styles.card}>
      <span className={styles.new}>{item.unread && <><span aria-hidden="true" />{t.new}</>}</span>
      <span className={styles.iconBox}><NotificationIcon name={item.kind} /></span>
      <div className={styles.copy}>
        <h2>{item.title}</h2>
        {item.context && <p>{item.context}</p>}
        {item.detail && <p>{item.detail}</p>}
        <small>{item.time}</small>
      </div>
      {href && item.action && (
        <a className={styles.open} href={href}>
          {item.action.label}<NotificationIcon name="arrow" />
        </a>
      )}
    </li>
  );
}

function State({ icon, title, body, role, children }: {
  icon: "bell" | "info";
  title: string;
  body: string;
  role: "status" | "alert";
  children?: React.ReactNode;
}) {
  return (
    <section className={styles.state} role={role}>
      <NotificationIcon name={icon} />
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </section>
  );
}
