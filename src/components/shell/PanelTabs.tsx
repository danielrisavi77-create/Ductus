"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type PanelTab = {
  /** Stable key, also part of the element ids. */
  id: string;
  label: string;
  content: ReactNode;
};

export type PanelTabsProps = {
  /** Name of the tab list for assistive technology. */
  label: string;
  tabs: readonly PanelTab[];
  /** The tab open on first render; the first tab when absent or unknown. */
  initial?: string;
};

/**
 * The tabs of the right panel (design editor-v11 §5.1): a sticky strip of
 * text tabs, the open one underlined in the primary colour and set in bold, so
 * the choice never rests on colour alone.
 *
 * Every panel stays mounted and the closed ones are `hidden`: a panel may own
 * work that must not stop when another tab is open (the comment panel marks
 * its anchors in the text and watches the session).
 *
 * Keyboard (WAI-ARIA tabs pattern, automatic activation): the list is one Tab
 * stop; Left/Right move and open, Home/End go to the ends.
 */
export default function PanelTabs({ label, tabs, initial }: PanelTabsProps) {
  const base = useId();
  const first = tabs.some((tab) => tab.id === initial) ? initial : tabs[0]?.id;
  const [open, setOpen] = useState(first);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === open);
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const id = tabs[next].id;
    setOpen(id);
    buttons.current.get(id)?.focus();
  };

  return (
    <div className="panel-tabs">
      <div role="tablist" aria-label={label} className="panel-tabs__list" onKeyDown={move}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) buttons.current.set(tab.id, element);
              else buttons.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={tab.id === open}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={tab.id === open ? 0 : -1}
            className="panel-tabs__tab"
            onClick={() => setOpen(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          className="panel-tabs__panel"
          hidden={tab.id !== open}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
