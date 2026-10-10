"use client";

import { useId, useState, type ReactNode } from "react";

export type ShellRailProps = {
  /** `workspace__rail` or `workspace__panel`: places it in the grid. */
  className: string;
  /** Landmark name, also the text of the toggle below 1100 px. */
  label: string;
  children: ReactNode;
};

/**
 * One side rail of the workspace. On a wide screen it stands beside the sheet
 * and its toggle is not rendered (CSS). Below 1100 px it sits under the sheet
 * as a section that opens with a real button, so Tab, the screen reader and
 * the eye meet the same order: sheet, instructions, structure.
 */
export default function ShellRail({ className, label, children }: ShellRailProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <aside className={className} aria-label={label}>
      <button
        type="button"
        className="rail-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      <div id={bodyId} className="rail-body" data-open={open ? "true" : "false"}>
        {children}
      </div>
    </aside>
  );
}
