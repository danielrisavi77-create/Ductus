"use client";

import { useLayoutEffect } from "react";

import { applyKeptTheme } from "./theme";

/**
 * DAN-313: the 404 that a page throws with `notFound()` is drawn in the
 * browser, after the inline theme script would have run, so it applies the
 * kept theme itself, like a 404 for an address that does not exist (Z-13a).
 */
export default function ThemeRestore() {
  useLayoutEffect(() => {
    applyKeptTheme(document.documentElement, () => window.localStorage);
  }, []);
  return null;
}
