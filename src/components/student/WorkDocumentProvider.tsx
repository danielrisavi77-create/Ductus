"use client";

/**
 * The /rad sheet's `LocalDocumentProvider` with a session mark that survives
 * the page's own soft navigations (#732 item 7): switching to "Kako vidi
 * nastavnik" and back keeps the writing session running, so the work is not
 * loaded or opened again (no second POST /api/evidence/open). See `stableMark`.
 */

import { useState, type ComponentProps } from "react";

import type { SessionMark } from "@/client/session-marks";
import { LocalDocumentProvider } from "@/components/editor/LocalDocument";

import { stableMark } from "./stable-mark";

export default function WorkDocumentProvider({ session = null, ...props }: ComponentProps<typeof LocalDocumentProvider>) {
  const [kept, setKept] = useState<SessionMark | null>(session);
  const mark = stableMark(kept, session);
  // Updated during render, so the provider never sees a passing new mark.
  if (mark !== kept) setKept(mark);
  return <LocalDocumentProvider {...props} session={mark} />;
}
