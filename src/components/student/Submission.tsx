"use client";

/**
 * The student's submission (F-10, #476 contract 6384297464). Opens the work
 * through `POST /api/evidence/open`, shows exactly the text of its current
 * revision on the server, and submits that revision and nothing else
 * (QA criterion 1). One request at a time (criterion 2); with revision 0 no
 * request goes to the submission route (criterion 4, contract §5). A refusal
 * that names an unacknowledged notice sends the student to the notice
 * (criterion 6). Once the session ends in this browser nothing more is sent
 * and the text, receipt and summary leave the page (criterion 7, D-118).
 * DAN-699 (#1876): while this device holds text of the work the server does
 * not have, or a recorder that stopped, nothing is submitted; the device is
 * read again on the click, right before the request.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { openWork, type OpenedWork } from "@/client/evidence-ingest";
import { fetchProcessSummary } from "@/client/process-summary";
import { watchSessionEnd, type SessionWatch } from "@/client/session-end";
import type { SessionMark } from "@/client/session-marks";
import { submitWork } from "@/client/submission";
import { readDocumentHold, submitWhenClear } from "@/client/submission-hold";
import { verifyDocumentSnapshot } from "@/domain/document/snapshot";

import { OUTCOME_ID, SubmissionView, type SubmissionState } from "./SubmissionView";

/**
 * The submission of one session: when the page is rendered under another
 * session without a reload, it starts again from nothing, so no text, receipt
 * or summary of the session before stays on it, even when the end of that
 * session never reached this tab (review 6386405994 on #653; as CommentPanel, F-088).
 */
export default function Submission({ assignmentId, session, scope }: Props) {
  return <SessionSubmission key={session.tag} assignmentId={assignmentId} session={session} scope={scope} />;
}

type Props = {
  assignmentId: string;
  session: SessionMark;
  /** The journal scope of this sign-in; null reads as unknown and holds the submission (DAN-699). */
  scope: string | null;
};

function SessionSubmission({ assignmentId, session, scope }: Props) {
  const [state, setState] = useState<SubmissionState>({ phase: "loading" });
  const [ended, setEnded] = useState(false);
  const [focusOutcome, setFocusOutcome] = useState(0);
  const watchRef = useRef<SessionWatch | null>(null);
  const workRef = useRef<OpenedWork | null>(null);
  const sendingRef = useRef(false);
  const generation = useRef(0);
  const noticePath = `/zadatak/${encodeURIComponent(assignmentId)}`;

  const { tag, at } = session;
  useLayoutEffect(() => {
    const watch = watchSessionEnd({ tag, at }, () => setEnded(true));
    watchRef.current = watch;
    return () => {
      watch.close();
      if (watchRef.current === watch) watchRef.current = null;
    };
  }, [tag, at]);
  const current = useCallback(() => !(watchRef.current?.ended() ?? false), []);

  // Only the last summary read started counts (Codex 4367324508): an older
  // answer arriving later never replaces a newer one.
  const summaryTicket = useRef(0);
  const loadSummary = useCallback(async (documentId: string, mine: number) => {
    const ticket = ++summaryTicket.current;
    const summary = await fetchProcessSummary(documentId, current);
    if (mine !== generation.current || ticket !== summaryTicket.current) return;
    setState((s) => (s.phase === "ready" ? { ...s, summary } : s));
  }, [current]);

  // The device check (DAN-699); only the last one started counts, as for the summary.
  const deviceTicket = useRef(0);
  const checkDevice = useCallback(async (documentId: string, mine: number) => {
    const ticket = ++deviceTicket.current;
    setState((s) => (s.phase === "ready" ? { ...s, device: "checking" } : s));
    const device = await readDocumentHold(scope, documentId);
    if (mine !== generation.current || ticket !== deviceTicket.current) return;
    setState((s) => (s.phase === "ready" ? { ...s, device } : s));
  }, [scope]);

  // The read itself; `mine` is the generation of the load that started it.
  const read = useCallback(async (mine: number) => {
    if (!current()) return;
    const opened = await openWork(assignmentId);
    if (mine !== generation.current || !current()) return;
    if (opened.status === "not_accepting") {
      // The notice of this assignment is not acknowledged: its first screen (PRODUCT §5 rule 6).
      window.location.assign(noticePath);
      return;
    }
    if (opened.status !== "opened") {
      const reason = opened.status === "unauthenticated" ? "signedOut" : opened.status === "not_found" ? "notFound" : "unavailable";
      setState({ phase: "closed", reason });
      return;
    }
    const snapshot = await verifyDocumentSnapshot(opened.work.document);
    if (mine !== generation.current) return;
    if (!snapshot.ok || snapshot.sha256 !== opened.work.documentHash) {
      setState({ phase: "closed", reason: "unreadable" });
      return;
    }
    workRef.current = opened.work;
    setState({
      phase: "ready", document: snapshot.document, revision: opened.work.currentRevision,
      sending: false, outcome: null, summary: null, device: "checking",
    });
    void loadSummary(opened.work.documentId, mine);
    void checkDevice(opened.work.documentId, mine);
  }, [assignmentId, checkDevice, current, loadSummary, noticePath]);

  // "Učitaj ponovno": back to "loading", then the read.
  const load = useCallback(() => {
    const mine = ++generation.current;
    workRef.current = null;
    setState({ phase: "loading" });
    return read(mine);
  }, [read]);

  // Another assignment starts from "loading" in the render that first sees it.
  const [readFor, setReadFor] = useState(assignmentId);
  if (readFor !== assignmentId) {
    setReadFor(assignmentId);
    setState({ phase: "loading" });
  }
  useEffect(() => {
    if (ended) return;
    const mine = ++generation.current;
    workRef.current = null;
    void read(mine);
  }, [read, ended]);

  const submit = useCallback(async () => {
    const work = workRef.current;
    // One request at a time, and never for revision 0 (no text on the server).
    if (sendingRef.current || work === null || work.currentRevision === 0 || !current() || !navigator.onLine) return;
    sendingRef.current = true;
    const mine = generation.current;
    setState((s) => (s.phase === "ready" ? { ...s, sending: true } : s));
    // A check made on load says nothing of text saved since: the device is
    // read again here, and anything but clear sends no request (DAN-699).
    deviceTicket.current += 1;
    const gated = await submitWhenClear(
      () => readDocumentHold(scope, work.documentId),
      () => submitWork({ documentId: work.documentId, revision: work.currentRevision }, current),
    );
    sendingRef.current = false;
    if (mine !== generation.current) return;
    if (gated.kind === "held") {
      setState((s) => (s.phase === "ready" ? { ...s, sending: false, device: gated.device } : s));
      return;
    }
    const { outcome } = gated;
    if (outcome.kind === "notAcknowledged") {
      window.location.assign(noticePath);
      return;
    }
    setState((s) => (s.phase === "ready" ? { ...s, sending: false, outcome } : s));
    setFocusOutcome((n) => n + 1);
  }, [current, noticePath, scope]);

  // The outcome of a submission takes the focus once it is drawn (#385 H8).
  useEffect(() => {
    if (focusOutcome > 0) document.getElementById(OUTCOME_ID)?.focus();
  }, [focusOutcome]);

  // Without a network the button waits and says why (#385 H7).
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const recheck = useCallback(() => {
    const work = workRef.current;
    if (work && !sendingRef.current) void checkDevice(work.documentId, generation.current);
  }, [checkDevice]);

  const reloadSummary = useCallback(() => {
    const work = workRef.current;
    if (work) void loadSummary(work.documentId, generation.current);
  }, [loadSummary]);

  // D-118: once the session has ended here, the work leaves the page.
  const shown: SubmissionState = ended ? { phase: "closed", reason: "signedOut" } : state;
  return (
    <SubmissionView
      state={shown}
      offline={!online}
      handlers={{ onSubmit: () => void submit(), onReload: () => void load(), onReloadSummary: reloadSummary, onRecheck: recheck }}
    />
  );
}
