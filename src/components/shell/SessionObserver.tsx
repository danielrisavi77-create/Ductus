"use client";

import { useEffect } from "react";

import { browserMarkStore, observeSession, SESSION_END_CHANNEL } from "@/client/session-marks";

/**
 * Tells the other tabs of this browser which session cookie this page was
 * rendered under (F-5, D-118). A sign-in through the login route replaces the
 * cookie without a sign-out; the first page rendered after it ends the
 * earlier session here, so its tabs stop showing that person's text.
 */
export default function SessionObserver({ tag, at }: { tag: string | null; at: number }) {
  useEffect(() => {
    const ended = observeSession(browserMarkStore(), tag, at);
    if (ended !== null && typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(SESSION_END_CHANNEL);
      channel.postMessage(ended);
      channel.close();
    }
  }, [tag, at]);
  return null;
}
