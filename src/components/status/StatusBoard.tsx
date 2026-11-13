"use client";

import { useEffect, useRef, useState } from "react";

import { isStaleAt, type Moment, POLL_MS, type PublicStatus } from "@/lib/status/public-status";

import { onWake, statusLoader } from "./status-loader";
import StatusView, { type StatusPhase } from "./StatusView";

const TICK_MS = 5_000;

const moment = (): Moment => ({ mono: performance.now(), wall: Date.now() });

/**
 * Fetches /api/status every POLL_MS and marks the last answer stale once no
 * new one has come for STALE_AFTER_MS (DAN-429). Age is measured on this
 * page's own clocks (isStaleAt), never against the server's checkedAt. When
 * the page comes back from sleep or the network returns, it asks at once.
 */
export default function StatusBoard() {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastOk, setLastOk] = useState<Moment | null>(null);
  const [now, setNow] = useState(moment);
  const load = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const controller = new AbortController();
    const mounted = statusLoader(controller.signal, {
      ok: (parsed) => {
        setStatus(parsed);
        setLastOk(moment());
        setFailed(false);
      },
      fail: () => setFailed(true),
      settled: () => setNow(moment()),
    });
    load.current = mounted;
    void mounted();
    const poll = setInterval(() => void mounted(), POLL_MS);
    const tick = setInterval(() => setNow(moment()), TICK_MS);
    const stopWake = onWake(window, document, () => {
      setNow(moment());
      void mounted();
    });
    return () => {
      controller.abort();
      stopWake();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const phase: StatusPhase = status
    ? { kind: "filled", status, stale: isStaleAt(lastOk, now) }
    : failed
      ? { kind: "error" }
      : { kind: "loading" };
  return <StatusView phase={phase} onRetry={() => void load.current()} />;
}
