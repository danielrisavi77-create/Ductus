"use client";

import { useEffect } from "react";

import { resumePendingLogout } from "@/client/pending-logout";
import { browserMarkStore, observeSession, SESSION_END_CHANNEL } from "@/client/session-marks";

/**
 * Tells the other tabs of this browser which session cookie this page was
 * rendered under (F-5, D-118). A sign-in through the login route replaces the
 * cookie without a sign-out; the first page rendered after it ends the
 * earlier session here, so its tabs stop showing that person's text.
 *
 * It also finishes a sign-out whose server part is still missing (#1330):
 * once the page loads and whenever the connection comes back. Only after this
 * page's own session was observed. Its server-rendered tag also guards the
 * retry when recording that session in browser storage fails.
 */
export default function SessionObserver({ tag, at }: { tag: string | null; at: number }) {
  useEffect(() => {
    const ended = observeSession(browserMarkStore(), tag, at);
    if (ended !== null && typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(SESSION_END_CHANNEL);
      channel.postMessage(ended);
      channel.close();
    }
    const resume = () => resumePendingLogout(tag);
    resume();
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [tag, at]);
  return null;
}
