/**
 * D-122 spike (DAN-99): a sealed local record next to, not inside, the Dexie
 * journal. AES-GCM-256 through WebCrypto, a write time for the deadline, and
 * two key sources: a device key kept in IndexedDB and a key wrapped by a
 * (fake) server per signed-in principal. Not product code: nothing in `src/`
 * imports it. Method and results: `docs/spikes/M3.11-S.md`.
 */
import Dexie, { type DexieOptions, type Table } from "dexie";

export const SEAL_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEVICE_KEY_ID = "device";

export type Sealed = { v: 1; iv: Uint8Array; ct: Uint8Array; at: number };
export type OpenFailure = "malformed" | "version" | "auth" | "no_key" | "missing";
export type OpenResult = { ok: true; text: string } | { ok: false; reason: OpenFailure };
export type Policy = { syncedTtlMs: number; unsyncedTtlMs: number; maxSkewMs: number };
export type Freshness = "live" | "expired" | "future" | "malformed";
export type SpikeRecord = { documentId: string; synced: boolean; body: Sealed };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Binds a record to its scope and document: a moved record does not open. */
export function contextFor(scopeHash: string, documentId: string): Uint8Array {
  return encoder.encode(`ductus-d122-v${SEAL_VERSION}\u0000${scopeHash}\u0000${documentId}`);
}

function validAt(at: unknown): at is number {
  return typeof at === "number" && Number.isSafeInteger(at) && at >= 0;
}

/** The write time is authenticated too: a backdated or postdated record fails. */
function additionalData(context: Uint8Array, at: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(context.length + 8);
  out.set(context);
  new DataView(out.buffer).setBigUint64(context.length, BigInt(at));
  return out;
}

export async function newRecordKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function seal(key: CryptoKey, text: string, context: Uint8Array, at: number): Promise<Sealed> {
  if (!validAt(at)) throw new Error("invalid write time");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(context, at) }, key, encoder.encode(text),
  );
  return { v: SEAL_VERSION, iv, ct: new Uint8Array(ct), at };
}

function own(raw: object, name: string): unknown {
  return Object.hasOwn(raw, name) ? (raw as Record<string, unknown>)[name] : undefined;
}

/** Shape check before any decryption; inherited fields do not count. */
export function parseSealed(raw: unknown): Sealed | "malformed" | "version" {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "malformed";
  if (!Object.hasOwn(raw, "v")) return "malformed";
  if (own(raw, "v") !== SEAL_VERSION) return "version";
  const iv = own(raw, "iv");
  const ct = own(raw, "ct");
  const at = own(raw, "at");
  if (!(iv instanceof Uint8Array) || iv.length !== IV_BYTES) return "malformed";
  if (!(ct instanceof Uint8Array) || ct.length < TAG_BYTES) return "malformed";
  if (!validAt(at)) return "malformed";
  return { v: SEAL_VERSION, iv, ct, at };
}

export async function openSealed(key: CryptoKey | null, raw: unknown, context: Uint8Array): Promise<OpenResult> {
  const sealed = parseSealed(raw);
  if (typeof sealed === "string") return { ok: false, reason: sealed };
  if (key === null) return { ok: false, reason: "no_key" };
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.iv.slice(), additionalData: additionalData(context, sealed.at) },
      key, sealed.ct.slice(),
    );
    return { ok: true, text: decoder.decode(plain) };
  } catch {
    return { ok: false, reason: "auth" };
  }
}

/**
 * Deadline of one record. A synced record is a copy of what the server holds
 * and may go soon; an unsynced one is the only copy, so it gets longer. A write
 * time in the future (clock moved back) or an invalid one is never deleted.
 */
export function freshness(at: unknown, synced: boolean, now: number, policy: Policy): Freshness {
  if (!validAt(at)) return "malformed";
  if (at > now + policy.maxSkewMs) return "future";
  return now - at >= (synced ? policy.syncedTtlMs : policy.unsyncedTtlMs) ? "expired" : "live";
}

type KeyRow = { id: string; key: CryptoKey };

/** One tab's connection to the spike database (a stand-in for the journal). */
export class SpikeStore {
  private readonly db: Dexie & { keys: Table<KeyRow, string>; records: Table<SpikeRecord, string> };

  constructor(readonly name: string, options?: DexieOptions) {
    this.db = new Dexie(name, options) as SpikeStore["db"];
    this.db.version(1).stores({ keys: "id", records: "documentId" });
  }

  /**
   * The device key, created on first use. `naive` reads, then writes in a
   * second transaction: two tabs can both find nothing and keep two keys.
   * `checked` adds only if no key exists, in the transaction that looks.
   */
  async deviceKey(mode: "naive" | "checked" = "checked", afterRead?: () => Promise<void>): Promise<CryptoKey> {
    if (mode === "naive") {
      const found = await this.db.keys.get(DEVICE_KEY_ID);
      if (found) return found.key;
      await afterRead?.();
      const key = await newRecordKey();
      await this.db.keys.put({ id: DEVICE_KEY_ID, key });
      return key;
    }
    const candidate = await newRecordKey();
    await afterRead?.();
    return this.db.transaction("rw", this.db.keys, async () => {
      const found = await this.db.keys.get(DEVICE_KEY_ID);
      if (found) return found.key;
      await this.db.keys.add({ id: DEVICE_KEY_ID, key: candidate });
      return candidate;
    });
  }

  async existingKey(): Promise<CryptoKey | null> {
    return (await this.db.keys.get(DEVICE_KEY_ID))?.key ?? null;
  }

  /** Crypto-shredding: a row delete, which another open tab cannot block. */
  async shredKey(): Promise<void> {
    await this.db.keys.delete(DEVICE_KEY_ID);
  }

  async put(record: SpikeRecord): Promise<void> {
    await this.db.records.put(record);
  }

  /** Writes only while the key row exists, in the same transaction. */
  async putGuarded(record: SpikeRecord): Promise<void> {
    await this.db.transaction("rw", this.db.keys, this.db.records, async () => {
      if (!(await this.db.keys.get(DEVICE_KEY_ID))) throw new Error("logout");
      await this.db.records.put(record);
    });
  }

  async read(documentId: string, context: Uint8Array, key: CryptoKey | null): Promise<OpenResult> {
    const record = await this.db.records.get(documentId);
    if (!record) return { ok: false, reason: "missing" };
    return openSealed(key, record.body, context);
  }

  /**
   * Deletes expired records. `naive` decides in one transaction and deletes in
   * another (`between` runs in the gap); `single` decides and deletes in one
   * read-write transaction while `between` runs at the same time.
   */
  async sweep(now: number, policy: Policy, mode: "naive" | "single", between?: () => Promise<void>): Promise<string[]> {
    const expired = (rows: SpikeRecord[]) =>
      rows.filter((row) => freshness(row.body?.at, row.synced, now, policy) === "expired").map((row) => row.documentId);
    if (mode === "naive") {
      const ids = expired(await this.db.records.toArray());
      await between?.();
      await this.db.records.bulkDelete(ids);
      return ids;
    }
    const run = this.db.transaction("rw", this.db.records, async () => {
      const ids = expired(await this.db.records.toArray());
      await this.db.records.bulkDelete(ids);
      return ids;
    });
    const [ids] = await Promise.all([run, between?.()]);
    return ids;
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Stand-in for a server that holds one key-encryption key per principal and
 * wraps the record key (AES-KW). The browser keeps only the wrapped bytes, so
 * after sign-out nobody on the device can open the record without the
 * student's own sign-in. No network and no KMS here.
 */
export class FakeKeyService {
  private readonly keks = new Map<string, CryptoKey>();

  private async kek(principal: string): Promise<CryptoKey> {
    let kek = this.keks.get(principal);
    if (!kek) {
      kek = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
      this.keks.set(principal, kek);
    }
    return kek;
  }

  async issue(principal: string): Promise<Uint8Array> {
    const dek = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    return new Uint8Array(await crypto.subtle.wrapKey("raw", dek, await this.kek(principal), "AES-KW"));
  }

  async unwrap(principal: string, wrapped: Uint8Array): Promise<CryptoKey | null> {
    const kek = this.keks.get(principal);
    if (!kek) return null;
    try {
      return await crypto.subtle.unwrapKey(
        "raw", wrapped.slice(), kek, "AES-KW", "AES-GCM", false, ["encrypt", "decrypt"],
      );
    } catch {
      return null;
    }
  }

  loseKek(principal: string): void {
    this.keks.delete(principal);
  }
}

export function serverKey(service: FakeKeyService, principal: string, wrapped: Uint8Array): Promise<CryptoKey | null> {
  return service.unwrap(principal, wrapped);
}
