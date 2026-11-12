"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isStale, parsePublicStatus, POLL_MS, type PublicStatus } from "@/lib/status/public-status";

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
  const inFlight = useRef(false);
  const alive = useRef(new AbortController());

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/status", { cache: "no-store", signal: alive.current.signal });
      const parsed = response.ok ? parsePublicStatus(await response.json()) : null;
      if (alive.current.signal.aborted) return;
      if (parsed) {
        setStatus(parsed);
        setLastOk(performance.now());
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      if (!alive.current.signal.aborted) setFailed(true);
    } finally {
      inFlight.current = false;
      if (!alive.current.signal.aborted) setNow(performance.now());
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    alive.current = controller;
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    const tick = setInterval(() => setNow(performance.now()), TICK_MS);
    return () => {
      controller.abort();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const phase: StatusPhase = status
    ? { kind: "filled", status, stale: isStale(lastOk, now) }
    : failed
      ? { kind: "error" }
      : { kind: "loading" };
  return <StatusView phase={phase} onRetry={() => void load()} />;
}
