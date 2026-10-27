export type NotificationKind = "comment" | "version" | "submission";
export type NotificationFilter = "all" | "unread";

/**
 * Display values must come from an authorised server-side reader. In
 * particular, context and target access have to be checked by the caller;
 * neither an item id nor an internal URL establishes permission.
 */
export type NotificationItem = Readonly<{
  id: string;
  kind: NotificationKind;
  title: string;
  context?: string;
  detail?: string;
  time: string;
  unread: boolean;
  action?: Readonly<{ href: string; label: string }>;
}>;

export type NotificationRead =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "unavailable"; retryHref?: string }>
  | Readonly<{ kind: "ready"; items: readonly NotificationItem[]; complete: boolean }>;

export function visibleNotifications(items: readonly NotificationItem[], filter: NotificationFilter) {
  return filter === "unread" ? items.filter((item) => item.unread) : items;
}

export function emptyNotificationState(items: readonly NotificationItem[], complete: boolean, filter: NotificationFilter) {
  if (visibleNotifications(items, filter).length > 0) return null;
  if (!complete) return filter === "unread" ? "partialUnread" : "partialEmpty";
  return filter === "unread" && items.length > 0 ? "noUnread" : "empty";
}

/** Reject external or malformed URLs; target resources must still authorise. */
export function notificationHref(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/u.test(href)) return null;
  try {
    const base = "https://ductus.invalid";
    return new URL(href, base).origin === base ? href : null;
  } catch {
    return null;
  }
}
