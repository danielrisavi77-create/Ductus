// @vitest-environment node
/**
 * The local demo scope (plan #197 attack 12): on only behind the explicit
 * flag, refused in production, never derived from anyone's identity.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { AtomicDexieJournal } from "./atomic-dexie-journal";
import {
  LOCAL_DEMO_DOCUMENT_ID, LOCAL_DEMO_SCOPE_HASH, LOCAL_DEMO_SCOPE_LABEL,
  LocalScopeConfigError, localScopeConfigFromEnv, resolveLocalScope,
} from "./local-scope";

const ENV_KEYS = ["DUCTUS_LOCAL_DEMO_JOURNAL", "DUCTUS_DEPLOYMENT"] as const;
const saved = ENV_KEYS.map((key) => process.env[key]);

afterEach(() => {
  ENV_KEYS.forEach((key, i) => {
    if (saved[i] === undefined) delete process.env[key];
    else process.env[key] = saved[i];
  });
});

describe("local demo journal scope (#197 attack 12)", () => {
  it("is the SHA-256 of its versioned label", () => {
    const digest = createHash("sha256").update(LOCAL_DEMO_SCOPE_LABEL, "utf8").digest("hex");
    expect(LOCAL_DEMO_SCOPE_HASH).toBe(digest);
  });

  it("is off unless the flag is set, so the editor has nowhere to save", () => {
    expect(resolveLocalScope({})).toBeNull();
    expect(resolveLocalScope({ localDemoJournal: "" })).toBeNull();
    expect(resolveLocalScope({ localDemoJournal: "", deployment: "production" })).toBeNull();
  });

  it("turns on only for the exact flag outside production", () => {
    expect(resolveLocalScope({ localDemoJournal: "1" })).toBe(LOCAL_DEMO_SCOPE_HASH);
    expect(resolveLocalScope({ localDemoJournal: "1", deployment: "preview" })).toBe(LOCAL_DEMO_SCOPE_HASH);
  });

  it("refuses a malformed flag instead of guessing", () => {
    for (const flag of ["0", "true", " 1", "1 ", "yes"]) {
      expect(() => resolveLocalScope({ localDemoJournal: flag })).toThrow(LocalScopeConfigError);
    }
  });

  it("refuses the demo scope in a production deployment", () => {
    expect(() => resolveLocalScope({ localDemoJournal: "1", deployment: "production" }))
      .toThrow(/prohibited in production/);
  });

  it("reads the runtime server variables", () => {
    process.env.DUCTUS_LOCAL_DEMO_JOURNAL = "1";
    process.env.DUCTUS_DEPLOYMENT = "production";
    expect(localScopeConfigFromEnv()).toEqual({ localDemoJournal: "1", deployment: "production" });
    expect(() => resolveLocalScope(localScopeConfigFromEnv())).toThrow(LocalScopeConfigError);
    delete process.env.DUCTUS_DEPLOYMENT;
    expect(resolveLocalScope(localScopeConfigFromEnv())).toBe(LOCAL_DEMO_SCOPE_HASH);
  });

  it("is a valid journal scope with its own database, and the document id is accepted", async () => {
    const journal = new AtomicDexieJournal(LOCAL_DEMO_SCOPE_HASH, { indexedDB, IDBKeyRange });
    try {
      expect(await journal.read(LOCAL_DEMO_DOCUMENT_ID))
        .toEqual({ snapshot: null, pending: [], meta: null });
    } finally {
      journal.close();
      await indexedDB.deleteDatabase(`ductus-journal-v1-${LOCAL_DEMO_SCOPE_HASH}`);
    }
  });
});
