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
  own: unknown;
  log: unknown;
  logCalls: { documentId: string; query: Record<string, unknown> }[];
} = { read: null, doc: null, own: null, log: null, logCalls: [] };

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
vi.mock("@/server/evidence/work-document-read", () => ({
  readWorkDocument: async () => state.doc,
  readOwnWorkDocument: async () => state.own,
}));
vi.mock("@/server/privacy/my-access-log-pages", async (actual) => ({
  ...(await actual<object>()),
  readMyAccessLogPage: async (_token: unknown, _withActor: unknown, documentId: string, query: Record<string, unknown>) => {
    state.logCalls.push({ documentId, query });
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

async function render(raw: string, query: Record<string, string | string[]> = {}) {
  const element = await Page({ params: Promise.resolve({ assignmentId: raw }), searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  state.token = "T".repeat(43);
  state.read = ready;
  state.doc = { kind: "document", documentId: "dokument-1" };
  state.own = { kind: "document", documentId: "dokument-1" };
  state.log = { kind: "ok", days, next: null, continued: false };
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

  it("an unacknowledged notice and no own work: the assignment first", async () => {
    state.read = { kind: "noticeFirst" };
    state.own = { kind: "none" };
    await expect(render(WORK)).rejects.toThrow(`REDIRECT /zadatak/${WORK}`);
  });

  it("a work not started says so and reads no log", async () => {
    state.doc = { kind: "notOpened" };
    state.own = { kind: "none" };
    const out = await render(WORK);
    expect(out).toContain(a.notStarted);
    expect(out).not.toContain(a.note);
    expect(state.logCalls).toEqual([]);
  });

  it.each([
    ["another student's or an unknown work", { kind: "none" }, ready],
    ["a work not accepting", { kind: "notAccepting" }, ready],
    ["no work context", { kind: "none" }, { kind: "none" }],
  ])("%s, no own work: not available, no row, no note, no log read", async (_name, doc, read) => {
    state.doc = doc;
    state.read = read;
    state.own = { kind: "none" };
    const out = await render(WORK);
    expect(out).toContain(a.notFound);
    expect(out).not.toContain(a.note);
    expect(out).not.toContain("<li");
    expect(state.logCalls).toEqual([]);
  });

  const AT = "2026-11-09T10:40:00.000Z";
  const ID = "00000000-0000-4000-8000-000000000001";
  const CURSOR = `prije=${encodeURIComponent(AT)}&amp;zapis=${ID}`;

  it("filled: the note, the rows, and an older link carrying the cursor of the oldest row shown", async () => {
    state.log = { kind: "ok", days, next: { beforeAt: AT, beforeId: ID }, continued: false };
    const out = await render(WORK);
    expect(state.logCalls).toEqual([{ documentId: "dokument-1", query: {} }]);
    expect(out).toContain(a.note);
    expect(out.match(/<li /g)).toHaveLength(2);
    expect(out).toContain(`href="${HERE}?${CURSOR}">${a.older}`);
    expect(out).not.toContain(a.newest);
  });

  it("a continuation: the query goes to the reader as given, and a link back to the newest days", async () => {
    state.log = { kind: "ok", days, next: null, continued: true };
    const out = await render(WORK, { prije: AT, zapis: ID, stranica: "21" });
    expect(state.logCalls).toEqual([{ documentId: "dokument-1", query: { prije: AT, zapis: ID, stranica: "21" } }]);
    expect(out).toContain(`href="${HERE}">${a.newest}`);
    expect(out).not.toContain(a.older);
  });

  it("empty: the note and the empty text, no older link", async () => {
    state.log = { kind: "ok", days: [], next: null, continued: false };
    const out = await render(WORK);
    expect(out).toContain(a.note);
    expect(out).toContain(a.empty);
    expect(out).not.toContain(a.older);
  });

  it("an empty continuation says no older openings exist, never that the log is empty", async () => {
    state.log = { kind: "ok", days: [], next: null, continued: true };
    const out = await render(WORK, { prije: AT, zapis: ID });
    expect(out).toContain(a.noOlder);
    expect(out).not.toContain(a.empty);
    expect(out).toContain(`href="${HERE}">${a.newest}`);
  });

  it("a failed continuation: an alert and a retry at the same cursor, no row and no note", async () => {
    state.log = { kind: "unavailable" };
    const out = await render(WORK, { prije: AT, zapis: ID });
    expect(out).toContain(`role="alert">${a.unavailable}`);
    expect(out).toContain(`href="${HERE}?${CURSOR}">${a.retry}`);
    expect(out).not.toContain("<li");
    expect(out).not.toContain(a.note);
  });

  it("a failed first page retries the first page; a cursor half or a repeated parameter is not carried", async () => {
    state.log = { kind: "unavailable" };
    expect(await render(WORK)).toContain(`href="${HERE}">${a.retry}`);
    expect(await render(WORK, { prije: [AT, AT], zapis: ID })).toContain(`href="${HERE}">${a.retry}`);
    expect(await render(WORK, { zapis: ID })).toContain(`href="${HERE}">${a.retry}`);
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
});

// Review FAIL c.6820050088, contract on #1836 c.6820374064 (PRODUCT §5 rule
// 17): reading one's own log depends only on owning the work, never on an
// active membership, an acknowledged current notice or the right to write.
const OWN = { kind: "document", documentId: "dokument-1" };
const NO_OWN = { kind: "none" };
describe("DAN-294 S-42 the owner reads the log without the right to write", () => {
  it.each([
    ["the owner with an active membership", ready, OWN, OWN, true],
    ["the owner before acknowledging a new notice", { kind: "noticeFirst" }, { kind: "notAccepting" }, OWN, true],
    ["the owner after the membership ended", { kind: "none" }, { kind: "none" }, OWN, true],
    ["another student's work", ready, { kind: "notOpened" }, NO_OWN, false],
    ["an unknown assignment", { kind: "none" }, { kind: "none" }, NO_OWN, false],
  ] as [string, unknown, unknown, unknown, boolean][])("%s", async (_name, read, doc, own, shown) => {
    state.read = read;
    state.doc = doc;
    state.own = own;
    const out = await render(WORK);
    if (shown) {
      expect(state.logCalls).toEqual([{ documentId: "dokument-1", query: {} }]);
      expect(out).toContain(a.note);
      expect(out.match(/<li /g)).toHaveLength(2);
    } else {
      expect(state.logCalls).toEqual([]);
      expect(out).not.toContain(a.note);
      expect(out).not.toContain("<li");
    }
  });

  it("concurrency: the membership ends between the first page and its continuation, the owner still continues", async () => {
    const AT = "2026-11-09T10:40:00.000Z";
    const ID = "00000000-0000-4000-8000-000000000001";
    state.log = { kind: "ok", days, next: { beforeAt: AT, beforeId: ID }, continued: false };
    await render(WORK);
    state.read = { kind: "none" };
    state.doc = { kind: "none" };
    state.log = { kind: "ok", days, next: null, continued: true };
    const out = await render(WORK, { prije: AT, zapis: ID });
    expect(state.logCalls).toEqual([
      { documentId: "dokument-1", query: {} },
      { documentId: "dokument-1", query: { prije: AT, zapis: ID } },
    ]);
    expect(out.match(/<li /g)).toHaveLength(2);
  });

  it("negative: the same ended membership does not make another student's work readable", async () => {
    state.read = { kind: "none" };
    state.doc = { kind: "none" };
    state.own = NO_OWN;
    const out = await render(WORK, { prije: "2026-11-09T10:40:00.000Z", zapis: "00000000-0000-4000-8000-000000000001" });
    expect(out).toContain(a.notFound);
    expect(state.logCalls).toEqual([]);
  });
});
