// @vitest-environment node
/**
 * The local demo scope (plan #197 attack 12): on only behind the explicit
 * flag in an allow-listed deployment, never derived from anyone's identity.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { AtomicDexieJournal } from "./atomic-dexie-journal";
import {
  LOCAL_DEMO_DOCUMENT_ID, LOCAL_DEMO_SCOPE_HASH, LOCAL_DEMO_SCOPE_LABEL,
  LOCAL_DEMO_DEPLOYMENTS, LocalScopeConfigError, localScopeConfigFromEnv, resolveLocalScope,
  type LocalScopeConfig,
} from "./local-scope";

const ENV_KEYS = [
  "DUCTUS_LOCAL_DEMO_JOURNAL", "DUCTUS_DEPLOYMENT", "NEXT_PUBLIC_DUCTUS_LOCAL_DEMO_JOURNAL",
] as const;
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

  it("turns on only for the exact flag in an allow-listed deployment", () => {
    for (const deployment of LOCAL_DEMO_DEPLOYMENTS) {
      expect(resolveLocalScope({ localDemoJournal: "1", deployment })).toBe(LOCAL_DEMO_SCOPE_HASH);
    }
  });

  it("refuses a malformed flag instead of guessing", () => {
    for (const flag of ["0", "true", " 1", "1 ", "yes"]) {
      expect(() => resolveLocalScope({ localDemoJournal: flag, deployment: "local" }))
        .toThrow(LocalScopeConfigError);
    }
  });

  it("fails closed for an unset, production or unknown deployment, whatever its case or spacing", () => {
    const refused = [
      undefined, "", "production", "Production", "PRODUCTION", "production ", " production",
      "prod", "preview", "staging", "Local", "local ", " ci", "CI", "Demo", "demo\n",
    ];
    for (const deployment of refused) {
      expect(() => resolveLocalScope({ localDemoJournal: "1", deployment }))
        .toThrow(LocalScopeConfigError);
    }
  });

  it("reads the runtime server variables", () => {
    process.env.DUCTUS_LOCAL_DEMO_JOURNAL = "1";
    process.env.DUCTUS_DEPLOYMENT = "production";
    expect(localScopeConfigFromEnv()).toEqual({ localDemoJournal: "1", deployment: "production" });
    expect(() => resolveLocalScope(localScopeConfigFromEnv())).toThrow(LocalScopeConfigError);
    delete process.env.DUCTUS_DEPLOYMENT;
    expect(() => resolveLocalScope(localScopeConfigFromEnv())).toThrow(LocalScopeConfigError);
    process.env.DUCTUS_DEPLOYMENT = "ci";
    expect(resolveLocalScope(localScopeConfigFromEnv())).toBe(LOCAL_DEMO_SCOPE_HASH);
  });

  it("ignores a public twin of the flag and inherited configuration", () => {
    delete process.env.DUCTUS_LOCAL_DEMO_JOURNAL;
    process.env.NEXT_PUBLIC_DUCTUS_LOCAL_DEMO_JOURNAL = "1";
    process.env.DUCTUS_DEPLOYMENT = "ci";
    expect(localScopeConfigFromEnv().localDemoJournal).toBeUndefined();
    expect(resolveLocalScope(localScopeConfigFromEnv())).toBeNull();
    const inherited = Object.create({ localDemoJournal: "1", deployment: "local" }) as LocalScopeConfig;
    expect(resolveLocalScope(inherited)).toBeNull();
    expect(Object.isFrozen(LOCAL_DEMO_DEPLOYMENTS)).toBe(true);
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
