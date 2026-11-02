"use client";

import { useSyncExternalStore } from "react";

import {
  readSheetTheme, SHEET_THEME_DEFAULT, writeSheetTheme, type SheetTheme,
} from "@/lib/ui/sheet-theme";

/**
 * One sheet theme per page, shared by the sheet (SheetFrame) and whatever
 * switches it: the "Prikaz" menu of the toolbar on /rad (FE-D5), the switch
 * above the sheet elsewhere. The server and the hydrating render use the default
 * (paper), so hydration matches; the stored choice follows right after.
 */

let current: SheetTheme | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function snapshot(): SheetTheme {
  if (current === null) current = readSheetTheme(storage());
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function setSheetTheme(next: SheetTheme): void {
  current = next;
  // Blocked storage: the choice holds for this page only.
  writeSheetTheme(storage(), next);
  for (const listener of listeners) listener();
}

export function useSheetTheme(): SheetTheme {
  return useSyncExternalStore(subscribe, snapshot, () => SHEET_THEME_DEFAULT);
}
