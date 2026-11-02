"use client";

import type { ReactNode } from "react";

import { useSheetTheme } from "@/components/shell/useSheetTheme";

import styles from "./Landing.module.css";

/**
 * The margin note beside the preview sheet. It follows the sheet theme the
 * visitor picked (D-123), so a white sheet never carries a dark note.
 */
export default function PreviewComment({ children }: { children: ReactNode }) {
  const theme = useSheetTheme();
  return (
    <div className={styles.comment} data-sheet-theme={theme}>
      {children}
    </div>
  );
}
