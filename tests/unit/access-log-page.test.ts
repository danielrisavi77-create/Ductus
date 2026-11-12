import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { accessLogDaysOf } from "@/domain/privacy/access-log-days";
import { messagesHr } from "@/lib/i18n/messages.hr";

// DAN-294 (S-42, contract on #1836, c.6814737263): the page's states with its
// readers replaced. Invented ids and names only.
const state: {
  token?: string;
  read: unknown;
  doc: unknown;
  log: unknown;
  logCalls: { documentId: string; pages: number }[];
} = { read: null, doc: null, log: null, logCalls: [] };

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.token ? { value: state.token } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("@/components/shell/AppShell", () => ({
  default: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("@/components/shell/shell-session", () => ({ shellSession: () => ({ tag: state.token ? "oznaka" : null, at: 1 }) }));
vi.mock("@/components/shell/shell-role", () => ({ readShellRole: async () => null }));
vi.mock("@/server/auth/activity", () => ({ pageActivity: () => undefined }));
vi.mock("@/server/auth/principal", () => ({
  sessionPrincipal: async () => (state.token ? { kind: "signed-in", scope: null } : { kind: "signed-out" }),
}));
vi.mock("@/server/db", () => ({
  withActor: async () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/components/student/work-context-read", async (actual) => ({
  ...(await actual<object>()),
  readWorkContext: async () => state.read,
}));
vi.mock("@/server/evidence/work-document-read", () => ({ readWorkDocument: async () => state.doc }));
vi.mock("@/server/privacy/my-access-log-pages", async (actual) => ({
  ...(await actual<object>()),
  readMyAccessLogPages: async (_token: unknown, _withActor: unknown, documentId: string, pages: number) => {
    state.logCalls.push({ documentId, pages });
    return state.log;
  },
}));

const { default: Page } = await import("../../app/rad/[assignmentId]/dnevnik-pristupa/page");

const a = messagesHr.accessLog;
const WORK = "0f0e0d0c-0b0a-4908-8706-050403020100";
const HERE = `/rad/${WORK}/dnevnik-pristupa`;
const ready = { kind: "ready", course: "Kolegij X", notice: { title: "Zadatak Y" } };
const days = accessLogDaysOf([
  { entry_id: "00000000-0000-4000-8000-000000000002", opened_at: new Date("2026-11-10T13:10:00Z"), surface: "live_view",
    reader_role: "mentor", reader_given_name: "Nastavnik", reader_family_name: "B" },
  { entry_id: "00000000-0000-4000-8000-000000000001", opened_at: new Date("2026-11-09T10:40:00Z"), surface: "replay",
    reader_role: "teacher", reader_given_name: "Nastavnik", reader_family_name: "C" },
])!;

async function render(raw: string, query: { stranica?: string | string[] } = {}) {
  const element = await Page({ params: Promise.resolve({ assignmentId: raw }), searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  state.token = "T".repeat(43);
  state.read = ready;
  state.doc = { kind: "document", documentId: "dokument-1" };
  state.log = { kind: "ok", days, more: false, truncated: false };
  state.logCalls = [];
});

describe("DAN-294 S-42 page states", () => {
  it("an invalid work address reads no log", async () => {
    const out = await render("..%2F..");
    expect(out).toContain(a.invalid);
    expect(state.logCalls).toEqual([]);
  });

  it("without a session: the sign-in text and a plain sign-in link back to this page", async () => {
    state.token = undefined;
    const out = await render(WORK);
    expect(out).toContain(a.signInFirst);
    expect(out).toContain(`href="/api/auth/login?returnTo=${encodeURIComponent(HERE)}"`);
    expect(state.logCalls).toEqual([]);
  });

  it("an unacknowledged notice goes to the assignment first", async () => {
    state.read = { kind: "noticeFirst" };
    await expect(render(WORK)).rejects.toThrow(`REDIRECT /zadatak/${WORK}`);
  });

  it("a work not started says so and reads no log", async () => {
    state.doc = { kind: "notOpened" };
    const out = await render(WORK);
    expect(out).toContain(a.notStarted);
    expect(out).not.toContain(a.note);
    expect(state.logCalls).toEqual([]);
  });

  it.each([
    ["another student's or an unknown work", { kind: "none" }, ready],
    ["a work not accepting", { kind: "notAccepting" }, ready],
    ["no work context", { kind: "document", documentId: "dokument-1" }, { kind: "none" }],
  ])("%s: not available, no row, no note, no log read", async (_name, doc, read) => {
    state.doc = doc;
    state.read = read;
    const out = await render(WORK);
    expect(out).toContain(a.notFound);
    expect(out).not.toContain(a.note);
    expect(out).not.toContain("<li");
    expect(state.logCalls).toEqual([]);
  });

  it("filled: the note, the rows, and an older link at the next page that lands on the last day read", async () => {
    state.log = { kind: "ok", days, more: true, truncated: false };
    const out = await render(WORK, { stranica: "2" });
    expect(state.logCalls).toEqual([{ documentId: "dokument-1", pages: 2 }]);
    expect(out).toContain(a.note);
    expect(out.match(/<li /g)).toHaveLength(2);
    expect(out).toContain(`href="${HERE}?stranica=3#dan-2026-11-09"`);
    expect(out).toContain('id="dan-2026-11-09"');
    expect(out).not.toContain(a.truncated);
  });

  it("empty: the note and the empty text, no older link", async () => {
    state.log = { kind: "ok", days: [], more: false, truncated: false };
    const out = await render(WORK);
    expect(out).toContain(a.note);
    expect(out).toContain(a.empty);
    expect(out).not.toContain(a.older);
  });

  it("at the last page allowed a full log says older openings exist and offers no link", async () => {
    state.log = { kind: "ok", days, more: false, truncated: true };
    const out = await render(WORK, { stranica: "20" });
    expect(out).toContain(a.truncated);
    expect(out).not.toContain(a.older);
  });

  it("a failed read: an alert and a retry at the same page, no row and no note", async () => {
    state.log = { kind: "unavailable" };
    const out = await render(WORK, { stranica: "3" });
    expect(out).toContain(`role="alert">${a.unavailable}`);
    expect(out).toContain(`href="${HERE}?stranica=3">${a.retry}`);
    expect(out).not.toContain("<li");
    expect(out).not.toContain(a.note);
  });

  it("a session ended between reads: the sign-in text with its link", async () => {
    state.log = { kind: "unauthorized" };
    const out = await render(WORK);
    expect(out).toContain(a.signInFirst);
    expect(out).toContain(`href="/api/auth/login?returnTo=${encodeURIComponent(HERE)}"`);
    expect(out).not.toContain("<li");
  });

  it("the log read answering not_found shows not available, no row", async () => {
    state.log = { kind: "not_found" };
    const out = await render(WORK);
    expect(out).toContain(a.notFound);
    expect(out).not.toContain("<li");
  });

  it.each([[["2", "3"]], ["0"], ["2abc"]])("?stranica=%j reads one page", async (stranica) => {
    await render(WORK, { stranica });
    expect(state.logCalls).toEqual([{ documentId: "dokument-1", pages: 1 }]);
  });
});
