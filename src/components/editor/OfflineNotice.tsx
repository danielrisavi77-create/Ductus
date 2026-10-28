"use client";

/**
 * "Bez mreže" on /rad (F-8, DAN-211; design editor-v11: banner and status-bar
 * mark, text and icon, never colour alone).
 *
 * It says only that the browser has no network. Whether the text is on the
 * device is the save chip's to say; the banner repeats it only while the chip
 * shows a local state, and never says anything about the server. Writing
 * goes on as before: the editor and the journal do not read the network.
 */

import { useOnline } from "@/client/online-status";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { useLocalSavingOnDevice } from "./LocalDocument";

/**
 * Under the top bar. The live region exists before its text does, so going
 * offline is announced once; coming back empties it.
 */
export function OfflineBanner() {
  const online = useOnline();
  const saving = useLocalSavingOnDevice();
  return (
    <div className="offline-banner" role="status">
      {online ? null : <p>{saving ? t.network.offlineSaving : t.network.offlineNotSaving}</p>}
    </div>
  );
}

/** Beside the save chip in the status bar; not live, the banner announces. */
export function OfflineChip() {
  if (useOnline()) return null;
  return (
    <span className="offline-chip">
      <OfflineIcon />
      {t.network.offline}
    </span>
  );
}

/** A struck-through signal: decoration only, the text carries the meaning. */
function OfflineIcon() {
  return (
    <svg className="offline-chip__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M2 6.5a9 9 0 0 1 12 0M4.5 9a5.5 5.5 0 0 1 7 0M7 11.5a2 2 0 0 1 2 0M2 2l12 12"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
