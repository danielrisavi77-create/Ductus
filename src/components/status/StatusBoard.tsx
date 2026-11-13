"use client";

import { useEffect, useRef, useState } from "react";

import { isStale, POLL_MS, type PublicStatus } from "@/lib/status/public-status";

import { statusLoader } from "./status-loader";
import StatusView, { type StatusPhase } from "./StatusView";

const TICK_MS = 10_000;

/**
 * Fetches /api/status every POLL_MS and marks the last answer stale once no
 * new one has come for STALE_AFTER_MS (DAN-429). Age is measured on this
 * page's monotonic clock, so a skewed server or client clock does not matter.
 */
export default function StatusBoard() {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const load = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const controller = new AbortController();
    const mounted = statusLoader(controller.signal, {
      ok: (parsed) => {
        setStatus(parsed);
        setLastOk(performance.now());
        setFailed(false);
      },
      fail: () => setFailed(true),
      settled: () => setNow(performance.now()),
    });
    load.current = mounted;
    void mounted();
    const poll = setInterval(() => void mounted(), POLL_MS);
    const tick = setInterval(() => setNow(performance.now()), TICK_MS);
    return () => {
      controller.abort();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const phase: StatusPhase = status
    ? { kind: "filled", status, stale: isStale(lastOk, now) }
    : failed
      ? { kind: "error" }
      : { kind: "loading" };
  return <StatusView phase={phase} onRetry={() => void load.current()} />;
}
