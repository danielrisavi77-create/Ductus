import { expect, test, type Page } from "@playwright/test";

import { DOC, EvidenceServer, openEvidenceHarness, prepareEvidenceHarness, R0 } from "./support/evidence-harness";
import type { Failure, HarnessConfig, HarnessState, Saved, ServerVersion } from "./support/evidence-harness.entry";

/**
 * F-8 3d-2b, QA points 12-20 (#476): the evidence journal, the recorder and
 * the drain in real engines (assignment: orchestrator, 24. 10.). The oracle is
 * real segments from `EvidenceRecorder`, the real `commitEvidence` and Ed25519
 * receipts checked by the engine's own Web Crypto; the commit route is a fake
 * in Node (`support/evidence-harness.ts`). PR CI runs `desktop` and `mobile`;
 * Firefox and WebKit run on `main`, nightly and in the cloud run before QA.
 */

const JOURNAL = (config: HarnessConfig) => `ductus-journal-v1-${config.scope}`;

function ok<T extends object>(value: T | Failure): T {
  if ("error" in value) throw new Error(`harness failure: ${value.error}`);
  return value;
}

async function type(page: Page, text: string) {
  await page.locator("#editor .ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

async function save(page: Page): Promise<Saved> {
  const saved = await page.evaluate(() => window.__evidence!.save());
  if (saved === null) throw new Error("nothing was typed since the last save");
  return ok(saved);
}

const state = async (page: Page): Promise<HarnessState> => ok(await page.evaluate(() => window.__evidence!.state()));
const drain = (page: Page) => page.evaluate(() => window.__evidence!.drain());
const step = (page: Page) => page.evaluate(() => window.__evidence!.step());
const text = (page: Page) => page.evaluate(() => window.__evidence!.text());
const databases = (page: Page) => page.evaluate(() => window.__evidence!.databases());

/** Tests that end in SYNCED need receipts this engine can verify; t. 20 covers an engine that cannot. */
async function expectEd25519(page: Page) {
  const supported = await page.evaluate(() => window.__evidence!.ed25519());
  expect(supported, "this engine's Web Crypto has no Ed25519: no receipt verifies, so SYNCED is out of reach (t. 20)").toBe(true);
}

async function reload(page: Page) {
  await page.reload();
  await page.waitForFunction(() => window.__evidence?.ready === true);
}

test.describe("evidence journal in the browser", () => {
  let server: EvidenceServer;
  let config: HarnessConfig;

  // Playwright requires the first argument to be a destructuring pattern.
  test.beforeAll(async ({}, testInfo) => {
    // Bundling the harness is not part of any test's time.
    testInfo.setTimeout(180_000);
    await prepareEvidenceHarness(testInfo.project.outputDir);
  });

  test.beforeEach(async ({ context, page }) => {
    server = new EvidenceServer();
    config = server.config();
    await server.install(context, config);
    await openEvidenceHarness(page);
  });

  test("12: typing reaches SYNCED; each body is the stored bytes, one segment, one request at a time", async ({ page }) => {
    await expectEd25519(page);
    await type(page, " prvi");
    const first = await save(page);
    await type(page, " drugi");
    const second = await save(page);
    expect(first.sequenceFrom).toBe(1);
    expect(second.sequenceFrom).toBe(first.sequenceTo + 1);
    const before = await state(page);
    expect(before.meta?.state).toBe("LOCAL_DURABLE");
    expect(before.rows.map((row) => row.segmentHash)).toEqual([first.sha256, second.sha256]);

    expect((await drain(page)).map((result) => ok(result).kind)).toEqual(["sent", "sent", "idle"]);

    const after = await state(page);
    expect(after.meta?.state).toBe("SYNCED");
    expect(after.rows).toEqual([]);
    expect(after.meta?.evidenceHead).toEqual({ segmentHash: second.sha256, lastSequenceTo: second.sequenceTo });
    expect(server.calls.map((call) => call.body)).toEqual(before.rows.map((row, index) => ({
      documentId: DOC, clientTransactionId: row.key, baseRevision: R0 + index, segments: [row.segment], document: row.document,
    })));
    for (const call of server.calls) expect(call.text).not.toContain("stepOffsetsMs");
    expect(server.maxInFlight).toBe(1);
    expect(await text(page)).toBe("Uvod prvi drugi");
    expect(after.snapshotText).toBe("Uvod prvi drugi");
  });

  test("13: after a reload the row, the snapshot and the timing record are there, bytes as Uint8Array", async ({ page }) => {
    await type(page, " spremljeno");
    const saved = await save(page);
    const before = await state(page);
    expect(before.rows).toHaveLength(1);
    expect(before.timings.map((timing) => timing.segmentHash)).toEqual([saved.sha256]);

    await reload(page);

    const after = await state(page);
    expect(after.rows).toEqual(before.rows);
    expect(after.rows[0]).toMatchObject({ segmentIsBytes: true, documentIsBytes: true });
    expect(after.timings).toEqual(before.timings);
    expect(after.snapshotText).toBe("Uvod spremljeno");
    expect(await text(page)).toBe("Uvod spremljeno");
    expect(server.calls).toEqual([]);
  });

  test("14: a reload mid-send replays the same key with the same body before anything newer goes", async ({ page }) => {
    await expectEd25519(page);
    await type(page, " jedan");
    await save(page);
    await type(page, " dva");
    await save(page);
    const rows = (await state(page)).rows;
    server.answers.push("hang");
    await page.evaluate(() => {
      void window.__evidence!.step();
    });
    await server.arrived(1);

    await reload(page);
    expect((await drain(page)).map((result) => ok(result).kind)).toEqual(["sent", "sent", "idle"]);

    expect(server.calls.map((call) => call.key)).toEqual([rows[0]!.key, rows[0]!.key, rows[1]!.key]);
    expect(server.calls[1]!.text).toBe(server.calls[0]!.text);
    expect((await state(page)).meta?.state).toBe("SYNCED");
  });

  test("15: a lost connection is ERROR with the row kept; once back, rows go in order", async ({ page }) => {
    await expectEd25519(page);
    await type(page, " bez");
    await save(page);
    await type(page, " mreže");
    await save(page);
    const rows = (await state(page)).rows;
    server.answers.push("abort");

    ok(await step(page));
    const offline = await state(page);
    expect(offline.meta?.state).toBe("ERROR");
    expect(offline.rows).toEqual(rows);

    await drain(page);
    expect(server.calls.map((call) => call.key)).toEqual([rows[0]!.key, rows[0]!.key, rows[1]!.key]);
    const back = await state(page);
    expect(back.meta?.state).toBe("SYNCED");
    expect(back.meta?.evidenceHead?.segmentHash).toBe(rows[1]!.segmentHash);
  });

  test("16: segments saved one after another are stored with their timing in this engine", async ({ page, browserName }) => {
    const saved: Saved[] = [];
    for (const word of [" a", " b", " c"]) {
      await type(page, word);
      saved.push(await save(page));
    }
    const stored = await state(page);
    expect(stored.rows.map((row) => [row.localSeq, row.segmentHash])).toEqual(saved.map((segment, index) => [index + 1, segment.sha256]));
    expect(stored.timings.map((timing) => timing.segmentHash).sort()).toEqual(saved.map((segment) => segment.sha256).sort());
    test.info().annotations.push({ type: "engine", description: `${browserName}: saveSegment hashes before its transaction` });
  });

  test("17: a version 2 database written with raw IndexedDB opens as the current version without loss", async ({ page }) => {
    const upgraded = await page.evaluate(() => window.__evidence!.upgradeFromV2("b".repeat(64)));
    expect(upgraded).toEqual({
      verno: 4, tables: ["control", "meta", "pending", "salvage", "snapshots", "timings"], same: true, fence: true,
    });
  });

  test("18: chain_conflict, then the server's version with a confirmation; the copy outlives a reload and holds logout", async ({ page }) => {
    await expectEd25519(page);
    await type(page, " lokalno");
    await save(page);
    await type(page, " još");
    await save(page);
    server.answers.push("chain_conflict");
    ok(await step(page));
    expect((await state(page)).meta?.state).toBe("CONFLICT");

    const other: ServerVersion = { text: "Tekst s drugog uređaja", currentRevision: R0 + 1, headSegmentHash: "c".repeat(64), lastSequenceTo: 7 };
    expect(await page.evaluate((version) => window.__evidence!.adopt(version, false), other)).toEqual({ error: "confirmation_required" });
    expect((await state(page)).meta?.state).toBe("CONFLICT");
    ok(await page.evaluate((version) => window.__evidence!.adopt(version, true), other));

    const adopted = await state(page);
    expect(adopted.meta?.state).toBe("SYNCED");
    expect(adopted.rows).toEqual([]);
    expect(adopted.meta?.evidenceHead).toEqual({ segmentHash: other.headSegmentHash, lastSequenceTo: 7 });
    expect(await text(page)).toBe(other.text);

    // The chain goes on from the server's head.
    server.revision = R0 + 1;
    await type(page, " nastavak");
    const next = await save(page);
    expect(next.sequenceFrom).toBe(8);
    await drain(page);
    expect((await state(page)).meta?.state).toBe("SYNCED");

    await reload(page);
    const copies = ok(await page.evaluate(() => window.__evidence!.salvage()));
    expect(copies).toEqual([expect.objectContaining({ cause: "CONFLICT", text: "Uvod lokalno još" })]);
    expect(await text(page)).toBe("Tekst s drugog uređaja nastavak");
    expect(await page.evaluate(() => window.__evidence!.logout())).toEqual({ error: "unsynced_work" });
    expect(await page.evaluate((id) => window.__evidence!.release(id), copies[0]!.id)).toBeNull();
    expect(await page.evaluate(() => window.__evidence!.logout())).toBeNull();
    expect(await databases(page)).not.toContain(JOURNAL(config));
  });

  test("19: logout in one tab; the other gets logout_in_progress and never re-creates the database", async ({ context, page }) => {
    const other = await context.newPage();
    await openEvidenceHarness(other);
    await type(other, " druga kartica");

    expect(await page.evaluate(() => window.__evidence!.logout())).toBeNull();

    const name = JOURNAL(config);
    expect(await other.evaluate(() => window.__evidence!.save())).toEqual({ error: "logout_in_progress" });
    expect(await databases(other)).not.toContain(name);
    for (const event of ["pagehide", "pageshow"]) {
      await other.evaluate((kind) => window.dispatchEvent(new PageTransitionEvent(kind, { persisted: true })), event);
      await type(other, ` ${event}`);
      expect(await other.evaluate(() => window.__evidence!.save())).toEqual({ error: "logout_in_progress" });
      expect(await other.evaluate(() => window.__evidence!.state())).toEqual({ error: "logout_in_progress" });
      expect(await databases(other)).not.toContain(name);
    }
    expect(await databases(page)).not.toContain(name);
  });

  test("20: this engine's Ed25519 decides SYNCED; a receipt with a changed signature byte never does", async ({ page, browserName }) => {
    const native = await page.evaluate(() => window.__evidence!.ed25519());
    test.info().annotations.push({ type: "ed25519", description: `${browserName}: ${native ? "supported" : "missing"}` });
    await type(page, " potpis");
    await save(page);
    await drain(page);
    const verified = await state(page);
    if (native) expect(verified.meta?.state).toBe("SYNCED");
    else expect(verified.meta?.state).not.toBe("SYNCED");

    await type(page, " krivotvoren");
    await save(page);
    server.answers.push("tamper");
    ok(await step(page));
    const tampered = await state(page);
    expect(tampered.meta?.state).not.toBe("SYNCED");
    expect(tampered.rows).toHaveLength(native ? 1 : 2);
  });

  // D-118 sign-out dialog (#476 c.6396619831 §6 U1, U2; criterion 4): the read
  // of a page without the editor, in this engine and not in fake-indexeddb.
  test("21: the sign-out read creates no journal, counts owed rows and agrees with the deletion", async ({ page }) => {
    await expectEd25519(page);
    const peek = (scope: string) => page.evaluate((s) => window.__evidence!.peek(s), scope);
    const missing = "c".repeat(64);
    expect(await peek(missing)).toEqual({ pending: 0, copies: 0, kept: false });
    expect(await databases(page)).not.toContain(`ductus-journal-v1-${missing}`);

    await type(page, " neposlano");
    await save(page);
    expect(await peek(config.scope)).toEqual({ pending: 1, copies: 0, kept: true });
    expect(await page.evaluate(() => window.__evidence!.logout())).toEqual({ error: "unsynced_work" });

    await drain(page);
    expect((await state(page)).meta?.state).toBe("SYNCED");
    expect(await peek(config.scope)).toEqual({ pending: 0, copies: 0, kept: false });
    expect(await page.evaluate(() => window.__evidence!.logout())).toBeNull();
    expect(await peek(config.scope)).toEqual({ pending: 0, copies: 0, kept: false });
    expect(await databases(page)).not.toContain(JOURNAL(config));
  });
});

test.describe("evidence journal without Ed25519 in Web Crypto", () => {
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(180_000);
    await prepareEvidenceHarness(testInfo.project.outputDir);
  });

  test("20: an engine that cannot verify Ed25519 never reaches SYNCED", async ({ context, page }) => {
    await context.addInitScript(() => {
      const subtle = globalThis.crypto.subtle;
      const importKey = subtle.importKey.bind(subtle);
      Object.defineProperty(subtle, "importKey", {
        value: (...args: Parameters<SubtleCrypto["importKey"]>) => {
          const algorithm = args[2];
          const name = typeof algorithm === "string" ? algorithm : algorithm.name;
          return name === "Ed25519"
            ? Promise.reject(new DOMException("Ed25519 is not supported", "NotSupportedError"))
            : (importKey as (...rest: unknown[]) => Promise<CryptoKey>)(...args);
        },
      });
    });
    const server = new EvidenceServer();
    await server.install(context, server.config());
    await openEvidenceHarness(page);
    expect(await page.evaluate(() => window.__evidence!.ed25519())).toBe(false);

    await type(page, " bez potpisa");
    await save(page);
    await drain(page);
    const stored = await state(page);
    expect(stored.meta?.state).not.toBe("SYNCED");
    expect(stored.rows).toHaveLength(1);
    expect(server.calls.length).toBeGreaterThan(0);
  });
});
