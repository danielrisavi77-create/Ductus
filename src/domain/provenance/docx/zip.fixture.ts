/**
 * Test-only ZIP builder for the DAN-242 reader tests. It writes any field the
 * tests need to falsify (sizes, CRC, flags, offsets, EOCD counts), so every
 * negative input is built here from invented text instead of being committed
 * as a binary file. Written independently of the reader under test.
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface FixtureEntry {
  name: string | Uint8Array;
  /** Uncompressed content; compressed with raw deflate when method is 8. */
  data?: string | Uint8Array;
  /** Bytes written as the entry's stored data instead of compressing `data`. */
  raw?: Uint8Array;
  method?: number;
  flags?: number;
  /** Version needed to extract, central and local; default 20 (2.0). */
  version?: number;
  localVersion?: number;
  crc?: number;
  csize?: number;
  usize?: number;
  /** Local header overrides; default to the central values. */
  localName?: string | Uint8Array;
  localFlags?: number;
  localMethod?: number;
  localCrc?: number;
  /** Central directory offset of the local header; defaults to the real one. */
  offset?: number;
  /** Bytes written right after the entry data: a data descriptor, or anything to hide. */
  after?: Uint8Array;
}

export interface FixtureZip {
  before?: Uint8Array;
  comment?: Uint8Array;
  trailing?: Uint8Array;
  diskNumber?: number;
  cdDisk?: number;
  countOnDisk?: number;
  countTotal?: number;
  cdSize?: number;
  cdOffset?: number;
}

const utf8 = (v: string | Uint8Array): Uint8Array => (typeof v === "string" ? new TextEncoder().encode(v) : v);

export function fixtureZip(entries: FixtureEntry[], z: FixtureZip = {}): Uint8Array {
  const before = z.before ?? new Uint8Array();
  const locals: Uint8Array[] = [before];
  const centrals: Uint8Array[] = [];
  let at = before.length;
  for (const e of entries) {
    const name = utf8(e.name);
    const plain = utf8(e.data ?? "");
    const method = e.method ?? 0;
    const body = e.raw ?? (method === 8 ? new Uint8Array(deflateRawSync(plain)) : plain);
    const crc = e.crc ?? crc32(plain);
    const csize = e.csize ?? body.length;
    const usize = e.usize ?? plain.length;
    const localName = utf8(e.localName ?? name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, e.localVersion ?? e.version ?? 20, true);
    local.setUint16(6, e.localFlags ?? e.flags ?? 0, true);
    local.setUint16(8, e.localMethod ?? method, true);
    local.setUint32(14, e.localCrc ?? crc, true);
    local.setUint32(18, csize, true);
    local.setUint32(22, usize, true);
    local.setUint16(26, localName.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, e.version ?? 20, true);
    central.setUint16(8, e.flags ?? 0, true);
    central.setUint16(10, method, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, csize, true);
    central.setUint32(24, usize, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, e.offset ?? at, true);
    const after = e.after ?? new Uint8Array();
    locals.push(new Uint8Array(local.buffer), localName, body, after);
    centrals.push(new Uint8Array(central.buffer), name);
    at += 30 + localName.length + body.length + after.length;
  }
  const cd = concat(centrals);
  const comment = z.comment ?? new Uint8Array();
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, z.diskNumber ?? 0, true);
  end.setUint16(6, z.cdDisk ?? 0, true);
  end.setUint16(8, z.countOnDisk ?? entries.length, true);
  end.setUint16(10, z.countTotal ?? entries.length, true);
  end.setUint32(12, z.cdSize ?? cd.length, true);
  end.setUint32(16, z.cdOffset ?? at, true);
  end.setUint16(20, comment.length, true);
  return concat([...locals, cd, new Uint8Array(end.buffer), comment, z.trailing ?? new Uint8Array()]);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A data descriptor for `data` stored as is, with or without its signature. */
export function descriptorFor(data: string, signed: boolean, crc = crc32(utf8(data))): Uint8Array {
  const size = utf8(data).length;
  const view = new DataView(new ArrayBuffer(16));
  view.setUint32(0, 0x08074b50, true);
  view.setUint32(4, crc, true);
  view.setUint32(8, size, true);
  view.setUint32(12, size, true);
  return new Uint8Array(view.buffer).subarray(signed ? 0 : 4);
}
