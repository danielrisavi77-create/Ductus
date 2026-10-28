/**
 * Whether the browser reports a network (F-8, DAN-211).
 *
 * `navigator.onLine === false` means there is no network for certain; `true`
 * only means the device has one, not that the server answers. So this tells
 * the author that the device is offline and nothing more: it never says
 * anything about the server, and no save state is derived from it.
 */

import { useSyncExternalStore } from "react";

/** The part of `window` this module reads; a test passes its own. */
export type OnlineSource = {
  readonly navigator: { readonly onLine: boolean };
  addEventListener(type: "online" | "offline", listener: () => void): void;
  removeEventListener(type: "online" | "offline", listener: () => void): void;
};

/** True unless the browser says it has no network. */
export function readOnline(source: OnlineSource): boolean {
  return source.navigator.onLine !== false;
}

/** Calls `onChange` whenever the browser gains or loses its network. */
export function subscribeOnline(source: OnlineSource, onChange: () => void): () => void {
  source.addEventListener("online", onChange);
  source.addEventListener("offline", onChange);
  return () => {
    source.removeEventListener("online", onChange);
    source.removeEventListener("offline", onChange);
  };
}

// Defined once: React subscribes again whenever `subscribe` is a new
// function, and the notice re-renders on every save while the author types.
const subscribeWindow = (onChange: () => void) => subscribeOnline(window, onChange);
const readWindow = () => readOnline(window);
const readServer = () => true;

/**
 * The browser's network as React state. The server render, and the first
 * render after it, say online, so an offline notice never comes from the
 * server and appears only once the browser itself reports no network.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeWindow, readWindow, readServer);
}
