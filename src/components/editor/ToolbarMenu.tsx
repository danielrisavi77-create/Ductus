"use client";

/**
 * A menu button inside the editor toolbar (FE-D5; WAI-ARIA menu button).
 *
 * Enter and Space open it through the button's own click, ArrowDown and
 * ArrowUp open it on the first or the last item. Inside, the arrows move and
 * wrap, Home and End go to the ends, Escape closes and returns focus to the
 * button; leaving the menu with Tab or a click elsewhere closes it. Items are
 * never Tab stops of their own.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { menuKey, openerKey } from "./toolbar-menu";

export type MenuItem = {
  key: string;
  label: string;
  glyph?: ReactNode;
  role: "menuitemcheckbox" | "menuitemradio";
  checked: boolean;
  disabled?: boolean;
};

/** What the menu does after an item is chosen. */
export type AfterSelect = "keep" | "close" | "close-return";

type Props = {
  label: string;
  menuLabel: string;
  /** Names the items as one group, e.g. the sheet theme. */
  groupLabel?: string;
  items: readonly MenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: string) => AfterSelect;
  /** The toolbar's roving key and Tab stop for this button. */
  roving: string;
  tabIndex: number;
  className?: string;
};

export default function ToolbarMenu({
  label, menuLabel, groupLabel, items, open, onOpenChange, onSelect, roving, tabIndex, className,
}: Props) {
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']")[active]?.focus();
  }, [open, active]);

  const openAt = (which: "first" | "last") => {
    setActive(which === "first" ? 0 : Math.max(0, items.length - 1));
    onOpenChange(true);
  };

  const close = (returnFocus: boolean) => {
    onOpenChange(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const choose = (key: string) => {
    const after = onSelect(key);
    if (after !== "keep") close(after === "close-return");
  };

  const list = items.map((item, index) => (
    <button
      key={item.key}
      type="button"
      role={item.role}
      className="editor-menu__item"
      data-item={item.key}
      aria-checked={item.checked}
      aria-disabled={item.disabled ? "true" : undefined}
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      onFocus={() => setActive(index)}
      onClick={() => choose(item.key)}
      onKeyDown={(event) => {
        const action = menuKey(event.key, index, items.length);
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        if (action.kind === "move") setActive(action.to);
        else close(true);
      }}
    >
      {item.glyph ? <span className="editor-menu__glyph" aria-hidden="true">{item.glyph}</span> : null}
      <span>{item.label}</span>
      {/* Checked is said by aria-checked; the mark repeats it beyond colour. */}
      {item.checked ? <span className="editor-menu__check" aria-hidden="true">✓</span> : null}
    </button>
  ));

  return (
    <div
      ref={wrapRef}
      className={["editor-menu", className].filter(Boolean).join(" ")}
      onBlur={(event) => {
        if (open && !wrapRef.current?.contains(event.relatedTarget as Node | null)) onOpenChange(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="btn editor-toolbar__button editor-menu__button"
        data-roving={roving}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        tabIndex={tabIndex}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? close(false) : openAt("first"))}
        onKeyDown={(event) => {
          const which = openerKey(event.key);
          if (!which) return;
          event.preventDefault();
          openAt(which);
        }}
      >
        {label}
        <span className="editor-menu__caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div id={id} role="menu" aria-label={menuLabel} className="editor-menu__list">
          {groupLabel ? (
            <div role="group" aria-label={groupLabel}>
              <div className="editor-menu__heading" aria-hidden="true">{groupLabel}</div>
              {list}
            </div>
          ) : list}
        </div>
      ) : null}
    </div>
  );
}
