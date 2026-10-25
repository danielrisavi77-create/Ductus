"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import styles from "./AppShell.module.css";
import { accountPlace, homeHref, navFor, type ShellRole } from "./nav";
import SessionObserver from "./SessionObserver";
import ShellLogout from "./ShellLogout";
import type { ShellSession } from "./shell-session";
import { readTheme, saveTheme, THEME_SCRIPT } from "./theme";

const ICONS = {
  menu: "M3 6h18M3 12h18M3 18h18",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1",
  moon: "M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z",
  logout: "M10 3H3v18h7m5-14 5 5-5 5M8 12h12",
  chevron: "m9 5 7 7-7 7",
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

function Logo() {
  return (
    <svg className={styles.logo} viewBox="0 0 28 34" aria-hidden="true">
      <path d="M5 6c7 1 12-1 17-4v7c-5 4-10 5-17 4M5 15c7 1 12-1 17-4v7c-5 4-10 5-17 4M5 24c7 1 12-1 17-4v7c-5 4-10 5-17 4" />
    </svg>
  );
}

/** Flips the theme on the shell element itself, so React never holds a copy that could disagree. */
function ThemeToggle() {
  const toggle = (event: { currentTarget: HTMLElement }) => {
    const shell = event.currentTarget.closest<HTMLElement>(`.${styles.shell}`);
    if (!shell) return;
    const next = shell.getAttribute("data-theme") === "light" ? "dark" : "light";
    shell.setAttribute("data-theme", next);
    saveTheme(window.localStorage, next);
  };
  return (
    <button type="button" className={styles.iconButton} aria-label={t.shell.theme} onClick={toggle}>
      <span className={styles.toLight}><Icon name="sun" /></span>
      <span className={styles.toDark}><Icon name="moon" /></span>
    </button>
  );
}

export type AppShellProps = {
  /** The role the server read for this page; null shows no navigation and no role label. */
  role: ShellRole | null;
  /**
   * The session cookie this page was rendered under (`shellSession`). The
   * shell marks it for the other tabs, so a sign-in that returns to any page
   * in the shell ends the earlier session's tabs (D-118, F-113 t.1).
   */
  session: ShellSession;
  /**
   * Journal scope the sign-out reads before posting (D-118). A scope means a
   * signed-in person, so the sign-out shows with it, with or without a role;
   * null: no sign-out unless the page brings its own `account`.
   */
  scope: string | null;
  /** The href of the navigation item this page belongs to, if any. */
  current?: string;
  /** Breadcrumb, first to last; the last is the page itself. */
  crumbs: readonly string[];
  /**
   * The account control in place of the sign-out form, for a page whose
   * sign-out has more to do (the workspace's LocalLogout, D-118), or a way to
   * sign in again. Shown even without a role.
   */
  account?: ReactNode;
  /** The page brings its own `<main id="sadrzaj">` (the workspace, FE-D1). */
  ownMain?: boolean;
  children: ReactNode;
};

/**
 * The design v3 shell (#476 6314969336): side navigation, top bar and the
 * page in `<main id="sadrzaj">`. It shows only static labels and the role
 * (I2); signing out is the same POST as everywhere and works without
 * JavaScript (I5). Below 800 px the side bar is a drawer behind ☰.
 */
export default function AppShell({ role, session, scope, current, crumbs, account, ownMain = false, children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const items = navFor(role);
  const home = homeHref(role);
  const place = accountPlace(scope, account !== undefined);

  // The inline script runs only when the server's HTML is parsed; after a
  // client-side navigation the new shell reads the saved theme here, before
  // it is painted.
  useLayoutEffect(() => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      // Storage blocked: the shell stays dark.
    }
    shell.current?.setAttribute("data-theme", readTheme(storage));
  }, []);

  useEffect(() => {
    if (!open) return;
    sidebar.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A modal dialog (the workspace's sign-out, D-118) takes its own Esc.
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      setOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // From 800 px the side bar is no drawer, so an open one must not leave the
  // shade and an inert page behind.
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 800px)");
    const onChange = () => {
      if (wide.matches) setOpen(false);
    };
    onChange();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open]);

  const close = () => {
    setOpen(false);
    menuButton.current?.focus();
  };

  return (
    <div ref={shell} className={styles.shell} data-theme="dark" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <SessionObserver tag={session.tag} at={session.at} />
      {/* Without JavaScript ☰ cannot open the drawer, so on a phone the side
          bar, and with it signing out, stays in the page above the content (I5). */}
      <noscript>
        <style>{`@media (max-width: 799.98px) { .${styles.sidebar} { position: static; width: auto; transform: none; visibility: visible; } .${styles.menuButton} { display: none; } }`}</style>
      </noscript>
      {open ? <div className={styles.shade} onClick={close} aria-hidden="true" /> : null}
      <aside ref={sidebar} className={styles.sidebar} data-open={open} aria-label={t.shell.sideNav} id="bocna-navigacija">
        <Link className={styles.brand} href={home} aria-label={t.shell.home}>
          <Logo />
          <span>{t.app.name}</span>
        </Link>
        {role !== null ? (
          <>
            <p className={styles.space}>{t.shell.space[role]}</p>
            <nav aria-label={t.shell.workNav}>
              <ul className={styles.nav}>
                {items.map((item) => (
                  <li key={item.href}>
                    <Link
                      className={styles.navItem}
                      href={item.href}
                      aria-current={item.href === current ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </>
        ) : null}
        <div className={styles.bottom}>
          <p className={styles.note}>
            <strong>{t.shell.demoBadge}</strong>
            {t.shell.demoNote}
          </p>
          {place === "own" ? (
            <div className={styles.account}>
              {role !== null ? <span className={styles.who}>{t.shell.role[role]}</span> : null}
              {account}
            </div>
          ) : place === "signOut" ? (
            // A signed-in person always has a way out, also without a role
            // read for this page (#802 part B); the role label only with one.
            <ShellLogout
              scope={scope}
              className={styles.account}
              buttonClassName={styles.signOut}
              lead={role !== null ? <span className={styles.who}>{t.shell.role[role]}</span> : null}
            >
              <Icon name="logout" />
            </ShellLogout>
          ) : null}
        </div>
      </aside>
      <div className={styles.area}>
        <header className={styles.topbar}>
          <button
            ref={menuButton}
            type="button"
            className={`${styles.iconButton} ${styles.menuButton}`}
            aria-label={open ? t.shell.closeNav : t.shell.openNav}
            aria-expanded={open}
            aria-controls="bocna-navigacija"
            onClick={() => setOpen((was) => !was)}
          >
            <Icon name="menu" />
          </button>
          {/* "Početna" stays in the top bar at every width, also while the
              side bar is a closed drawer (#802 part B). */}
          <nav aria-label={t.shell.breadcrumb} className={styles.crumbs}>
            <Link
              className={styles.homeCrumb}
              href={home}
              aria-current={crumbs.length === 0 ? "page" : undefined}
            >
              {t.shell.homeCrumb}
            </Link>
            {crumbs.map((crumb, i) => (
              <span key={i} className={styles.crumb} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                <Icon name="chevron" />
                {crumb}
              </span>
            ))}
          </nav>
          <div className={styles.actions}>
            <span className={styles.demo}>{t.shell.demoBadge}</span>
            <ThemeToggle />
          </div>
        </header>
        {ownMain ? (
          <div className={styles.content} inert={open}>{children}</div>
        ) : (
          <main id="sadrzaj" tabIndex={-1} className={styles.content} inert={open}>
            {children}
          </main>
        )}
      </div>
    </div>
  );
}
