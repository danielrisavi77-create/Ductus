import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { ACCESS_LOG_PAGE, readMyAccessLog } from "./my-access-log";

// DAN-294 (M10.4, contract on #1836, c.6814737263). Invented ids and names only.
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-dnevnik-3f9c";
const DOC = "rad-izmisljeni-1";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

type Row = Record<string, unknown>;
const row = (n: number, iso: string, over: Row = {}): Row => ({
  entry_id: id(n), opened_at: new Date(iso), surface: "live_view", reader_role: "mentor",
  reader_given_name: "Nastavnik", reader_family_name: "B", ...over,
});

function database(answer: { rows?: Row[]; code?: string }) {
  const calls: { text: string; values: readonly unknown[] | undefined; token: string | null | undefined }[] = [];
  const withActor = vi.fn(async (token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string, values?: readonly unknown[]) {
        calls.push({ text, values, token });
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction),
  ) as unknown as WithActor;
  return { withActor, calls };
}

function logged(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

afterEach(() => vi.restoreAllMocks());

describe("DAN-294 my access log: the read", () => {
  it("asks the RPC once, with the session token and the document, and nothing else", async () => {
    const { withActor, calls } = database({ rows: [row(1, "2026-11-10T13:10:00Z")] });
    const read = await readMyAccessLog(TOKEN, withActor, DOC);
    expect(calls).toEqual([{ text: "SELECT * FROM app.read_my_access_log($1, $2, $3, $4)", values: [DOC, ACCESS_LOG_PAGE, null, null], token: TOKEN }]);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(read.days.map((d) => d.key)).toEqual(["2026-11-10"]);
    expect(read.next).toBeNull();
    expect(JSON.stringify(read)).not.toMatch(/"(count|total|duration|visits)"/);
  });

  it("an empty log is ok with no day", async () => {
    const { withActor } = database({ rows: [] });
    expect(await readMyAccessLog(TOKEN, withActor, DOC)).toEqual({ kind: "ok", rows: [], days: [], next: null });
  });

  it("a full page names the oldest row as the cursor of the next; the cursor goes to the RPC as given", async () => {
    const rows = Array.from({ length: ACCESS_LOG_PAGE }, (_, i) => row(i + 1, new Date(Date.UTC(2026, 10, 10, 12) - i * 300_000).toISOString()));
    const { withActor, calls } = database({ rows });
    const read = await readMyAccessLog(TOKEN, withActor, DOC);
    const oldest = rows.at(-1)!;
    expect(read.kind === "ok" && read.next).toEqual({ beforeAt: (oldest.opened_at as Date).toISOString(), beforeId: oldest.entry_id });
    await readMyAccessLog(TOKEN, withActor, DOC, { beforeAt: "2026-11-10T08:00:00.000Z", beforeId: id(7) });
    expect(calls[1]?.values).toEqual([DOC, ACCESS_LOG_PAGE, "2026-11-10T08:00:00.000Z", id(7)]);
  });

  it("contract b: a continuation that brings a newer or an already shown row is the RPC's answer, and the page shows each id once", async () => {
    const { withActor } = database({ rows: [row(1, "2026-11-10T13:10:00Z"), row(1, "2026-11-10T13:10:00Z")] });
    const read = await readMyAccessLog(TOKEN, withActor, DOC);
    expect(read.kind === "ok" && read.days.flatMap((d) => d.entries)).toHaveLength(1);
  });
});

describe("DAN-294 my access log: refusals", () => {
  it("negative: another person's work (ZD403) reads exactly as an unknown work, with no row and no error text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { withActor } = database({ code: "ZD403" });
    const foreign = await readMyAccessLog(TOKEN, withActor, "rad-tudji-9");
    const unknown = await readMyAccessLog(TOKEN, withActor, "rad-nepostojeci");
    expect(foreign).toEqual({ kind: "not_found" });
    expect(unknown).toEqual(foreign);
    expect(JSON.stringify(foreign)).not.toContain(CANARY);
    expect(logged(error)).not.toContain(CANARY);
  });

  it("no session (ZD401) is unauthorized; a malformed token never reaches the database", async () => {
    const { withActor, calls } = database({ code: "ZD401" });
    expect(await readMyAccessLog(TOKEN, withActor, DOC)).toEqual({ kind: "unauthorized" });
    expect(await readMyAccessLog(undefined, withActor, DOC)).toEqual({ kind: "unauthorized" });
    expect(await readMyAccessLog("kratak", withActor, DOC)).toEqual({ kind: "unauthorized" });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["an empty id", ""],
    ["a padded id", " doc"],
    ["a control character", "doc\u0000"],
    ["an over-long id", "d".repeat(257)],
  ])("a malformed document id (%s) is not_found without a query", async (_, documentId) => {
    const { withActor, calls } = database({ rows: [] });
    expect(await readMyAccessLog(TOKEN, withActor, documentId)).toEqual({ kind: "not_found" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a time that is no instant", { beforeAt: "jučer", beforeId: id(1) }],
    ["a time off the five-minute grid", { beforeAt: "2026-11-10T08:01:00.000Z", beforeId: id(1) }],
    ["an id that is no uuid", { beforeAt: "2026-11-10T08:00:00.000Z", beforeId: "x" }],
  ])("a malformed cursor (%s) is unavailable without a query", async (_, cursor) => {
    const { withActor, calls } = database({ rows: [] });
    expect(await readMyAccessLog(TOKEN, withActor, DOC, cursor)).toEqual({ kind: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  it("any other failure and a malformed row are unavailable, logging only the SQLSTATE or a fixed word", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readMyAccessLog(TOKEN, database({ code: "ZD422" }).withActor, DOC)).toEqual({ kind: "unavailable" });
    expect(await readMyAccessLog(TOKEN, database({ code: `bad ${CANARY}` }).withActor, DOC)).toEqual({ kind: "unavailable" });
    const off = database({ rows: [row(1, "2026-11-10T13:07:00Z")] });
    expect(await readMyAccessLog(TOKEN, off.withActor, DOC)).toEqual({ kind: "unavailable" });
    expect(error.mock.calls).toEqual([
      ["my access log read failed", "ZD422"],
      ["my access log read failed", "unknown"],
      ["my access log read failed", "row_malformed"],
    ]);
    expect(logged(error)).not.toContain(CANARY);
  });
});
