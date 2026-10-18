/**
 * Hears, in one part of a page, that the session the page was rendered under
 * has ended (F-5, D-118): a sign-out in another tab (channel), another person
 * signing in (storage), or a page restored from the back-forward cache that
 * missed both (pageshow). It needs neither IndexedDB nor Web Locks, so a part
 * of the page that shows this person's data can stop on its own even where
 * the journal cannot open (F-093).
 */

import { browserMarkStore, hasEnded, SESSION_END_CHANNEL, type MarkStore, type SessionMark } from "./session-marks";

type Listeners = Pick<Window, "addEventListener" | "removeEventListener">;
type Channel = Pick<BroadcastChannel, "close"> & { onmessage: ((event: MessageEvent) => void) | null };

export type SessionEndEnv = {
  store: MarkStore | null;
  target: Listeners | null;
  openChannel: (() => Channel) | null;
};

export type SessionWatch = {
  /** Whether the session has ended; checks the browser's record again. */
  ended: () => boolean;
  close: () => void;
};

function browserEnv(): SessionEndEnv {
  return {
    store: browserMarkStore(),
    target: typeof window === "undefined" ? null : window,
    openChannel: typeof BroadcastChannel === "undefined" ? null : () => new BroadcastChannel(SESSION_END_CHANNEL),
  };
}

/**
 * Calls `onEnd` once, when the session of `mark` has ended. Without a mark
 * (no session cookie behind the page) nothing is watched and `ended` is false.
 */
export function watchSessionEnd(
  mark: SessionMark | null, onEnd: () => void, env: SessionEndEnv = browserEnv(),
): SessionWatch {
  if (mark === null) return { ended: () => false, close: () => {} };
  let done = false;
  let closed = false;
  const end = () => {
    if (done) return;
    done = true;
    if (!closed) onEnd();
  };
  const ended = () => {
    if (!done && hasEnded(env.store, mark)) end();
    return done;
  };
  const recheck = () => void ended();
  const channel = env.openChannel?.() ?? null;
  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === mark.tag) end();
    };
  }
  env.target?.addEventListener("storage", recheck);
  env.target?.addEventListener("pageshow", recheck);
  ended();
  return {
    ended,
    close: () => {
      closed = true;
      channel?.close();
      env.target?.removeEventListener("storage", recheck);
      env.target?.removeEventListener("pageshow", recheck);
    },
  };
}
