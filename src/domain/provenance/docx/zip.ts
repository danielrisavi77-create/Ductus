/**
 * Bounded ZIP reader for DOCX uploads (DAN-242). Everything is checked from
 * the central directory before a single part is inflated: one unambiguous end
 * record, no ZIP64 or split archives, safe and unique names, no encryption,
 * only stored or deflate, declared sizes and ratio within the limits, and
 * local headers that agree with the directory and do not overlap. Reading a
 * part then stops as soon as the output passes its declared size, and checks
 * the exact size and CRC-32. No network, no files, no dependencies.
 */
import { type DocxLimits, DocxRejected, resolveDocxLimits } from "./limits";

export interface DocxZip {
  /** File parts in central directory order; directory entries are left out. */
  readonly names: readonly string[];
  /** Reads one part by name, matched as OPC does: case-insensitive, NFC. */
  read(name: string): Promise<Uint8Array>;
}

interface Entry {
  name: string;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  start: number;
  end: number;
  descriptor: boolean;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;
const ENCRYPTED = 0x0001 | 0x0040 | 0x2000;
const PATCHED = 0x0020;
const DESCRIBED = 0x0008;
const UTF8 = 0x0800;
const MAX_VERSION = 63;
const UNICODE_PATH = 0x7075;
const UNICODE_COMMENT = 0x6375;
const reject = (code: ConstructorParameters<typeof DocxRejected>[0]): never => {
  throw new DocxRejected(code);
};
const keyOf = (name: string) => name.normalize("NFC").toLowerCase();
// Keep a leading U+FEFF: by default the decoder drops it, and the name would
// then differ from the one other ZIP readers see.
const names = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function openDocxZip(bytes: Uint8Array, limits?: Partial<DocxLimits>): DocxZip {
  const lim = resolveDocxLimits(limits);
  if (!(bytes instanceof Uint8Array)) reject("INPUT_INVALID");
  if (bytes.length > lim.maxInputBytes) reject("INPUT_TOO_LARGE");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);

  // The end record is the one whose comment ends exactly at the end of the file;
  // a second such record (for example inside the comment) makes the file ambiguous.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= 0 && at >= bytes.length - 22 - 0xffff; at--) {
    if (u32(at) === EOCD && at + 22 + u16(at + 20) === bytes.length) {
      if (eocd !== -1) reject("ZIP_INVALID");
      eocd = at;
    }
  }
  if (eocd === -1) reject("ZIP_INVALID");
  const [disk, cdDisk, onDisk, total] = [u16(eocd + 4), u16(eocd + 6), u16(eocd + 8), u16(eocd + 10)];
  const [cdSize, cdOffset] = [u32(eocd + 12), u32(eocd + 16)];
  if (disk !== 0 || cdDisk !== 0 || total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) reject("ZIP_UNSUPPORTED");
  if (onDisk !== total) reject("ZIP_INVALID");
  if (total > lim.maxEntries) reject("ZIP_TOO_MANY_ENTRIES");
  if (cdOffset + cdSize !== eocd) reject("ZIP_INVALID");

  const entries: Entry[] = [];
  const byKey = new Map<string, Entry>();
  let declared = 0;
  let at = cdOffset;
  for (let i = 0; i < total; i++) {
    if (at + 46 > eocd || u32(at) !== CENTRAL) reject("ZIP_INVALID");
    const [flags, method, crc, csize, usize] = [u16(at + 8), u16(at + 10), u32(at + 16), u32(at + 20), u32(at + 24)];
    const [nameLength, next, offset] = [u16(at + 28), at + 46 + u16(at + 28) + u16(at + 30) + u16(at + 32), u32(at + 42)];
    if (next > eocd) reject("ZIP_INVALID");
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = safeName(nameBytes, (flags & UTF8) !== 0);
    checkExtra(bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + u16(at + 30)));
    if (flags & ENCRYPTED || method === 99) reject("ZIP_ENCRYPTED");
    if (method !== 0 && method !== 8) reject("ZIP_METHOD");
    // A start disk other than 0 is a split archive, and 0xffff points to ZIP64.
    if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff || u16(at + 34) !== 0) reject("ZIP_UNSUPPORTED");
    // Patched data and versions past 6.3 are features other readers refuse; the
    // low byte of "version needed" is the version, the high byte names the host.
    if (flags & PATCHED || (u16(at + 6) & 0xff) > MAX_VERSION) reject("ZIP_UNSUPPORTED");
    if (usize > lim.maxPartBytes) reject("ZIP_PART_TOO_LARGE");
    declared += usize;
    if (declared > lim.maxTotalBytes) reject("ZIP_TOTAL_TOO_LARGE");
    if (usize > lim.maxRatio * Math.max(csize, 1)) reject("ZIP_RATIO");
    if (method === 0 && csize !== usize) reject("ZIP_SIZE_MISMATCH");
    if (name.endsWith("/") && usize !== 0) reject("ZIP_INVALID");

    // The local header must say what the directory says, so that no other ZIP
    // reader can see a different file in the same bytes.
    if (offset + 30 > cdOffset || u32(offset) !== LOCAL) reject("ZIP_INVALID");
    const localFlags = u16(offset + 6);
    if (localFlags & ENCRYPTED) reject("ZIP_ENCRYPTED");
    if (localFlags & PATCHED || (u16(offset + 4) & 0xff) > MAX_VERSION) reject("ZIP_UNSUPPORTED");
    const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
    const localName = bytes.subarray(offset + 30, offset + 30 + u16(offset + 26));
    if (start > cdOffset) reject("ZIP_INVALID");
    checkExtra(bytes.subarray(offset + 30 + u16(offset + 26), start));
    const sameSizes = (localFlags & DESCRIBED) !== 0 || (u32(offset + 14) === crc && u32(offset + 18) === csize && u32(offset + 22) === usize);
    // The name encoding and the data descriptor flags change how a reader reads the
    // name and finds the end of the data, so both headers must carry the same ones.
    const sameFlags = ((localFlags ^ flags) & (DESCRIBED | UTF8)) === 0;
    if (!equal(localName, nameBytes) || u16(offset + 8) !== method || !sameSizes || !sameFlags) reject("ZIP_INVALID");
    if (start + csize > cdOffset) reject("ZIP_INVALID");

    const entry = { name, method, crc, csize, usize, start: offset, end: start + csize, descriptor: (localFlags & DESCRIBED) !== 0 };
    const key = keyOf(name);
    if (byKey.has(key)) reject("ZIP_DUPLICATE");
    byKey.set(key, entry);
    entries.push(entry);
    at = next;
  }
  if (at !== eocd) reject("ZIP_INVALID");

  // Entries tile the file from offset 0 up to the central directory: each is
  // followed by the next, or by its own data descriptor and then the next, so
  // no bytes hide between them for a reader that walks local headers.
  let edge = 0;
  for (const e of [...entries].sort((a, b) => a.start - b.start)) {
    if (e.start !== edge) reject("ZIP_INVALID");
    edge = e.end;
    if (!e.descriptor) continue;
    const signed = edge + 16 <= cdOffset && u32(edge) === DESCRIPTOR ? 4 : 0;
    if (edge + signed + 12 > cdOffset) reject("ZIP_INVALID");
    if (u32(edge + signed) !== e.crc || u32(edge + signed + 4) !== e.csize || u32(edge + signed + 8) !== e.usize) reject("ZIP_INVALID");
    edge += signed + 12;
  }
  if (edge !== cdOffset) reject("ZIP_INVALID");

  const files = entries.filter((e) => !e.name.endsWith("/"));
  return {
    names: Object.freeze(files.map((e) => e.name)),
    async read(name: string) {
      const entry = byKey.get(keyOf(name));
      if (entry === undefined || entry.name.endsWith("/")) return reject("ZIP_NO_PART");
      const data = bytes.subarray(entry.end - entry.csize, entry.end);
      // Uint8Array.from copies; Buffer#slice would share the archive's memory.
      const out = entry.method === 0 ? Uint8Array.from(data) : await inflate(data, entry.usize);
      if (crc32(out) !== entry.crc) reject("ZIP_CRC");
      return out;
    },
  };
}

/** A part name that cannot leave the archive root or mean two things. */
function safeName(raw: Uint8Array, utf8: boolean): string {
  // Without the UTF-8 flag other readers take non-ASCII bytes as CP437.
  if (!utf8 && raw.some((b) => b >= 0x80)) reject("ZIP_PATH");
  let name = "";
  try {
    name = names.decode(raw);
  } catch {
    reject("ZIP_PATH");
  }
  const segments = name.split("/");
  if (name.endsWith("/")) segments.pop();
  const bad = (s: string) => s === "" || s === "." || s === "..";
  if (segments.length === 0 || segments.some(bad) || /[\u0000-\u001f\u007f\ufeff\\:]/.test(name)) reject("ZIP_PATH");
  return name;
}

/**
 * An extra field must be whole records (16-bit ID, 16-bit length, data), so no
 * record can hide from this walk while another reader still finds it. Info-ZIP
 * Unicode Path renames the entry in readers that honour it, and Unicode Comment
 * is the same mechanism, so both are refused.
 */
function checkExtra(extra: Uint8Array): void {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let at = 0;
  while (at < extra.length) {
    if (at + 4 > extra.length) reject("ZIP_INVALID");
    const id = view.getUint16(at, true);
    at += 4 + view.getUint16(at + 2, true);
    if (at > extra.length) reject("ZIP_INVALID");
    if (id === UNICODE_PATH) reject("ZIP_PATH");
    if (id === UNICODE_COMMENT) reject("ZIP_UNSUPPORTED");
  }
}

async function inflate(data: Uint8Array, size: number): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const writing = writer
    .write(data.slice())
    .then(() => writer.close())
    .catch(() => undefined);
  const out = new Uint8Array(size);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > size) reject("ZIP_SIZE_MISMATCH");
      out.set(value, length);
      length += value.length;
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e instanceof DocxRejected ? e : new DocxRejected("ZIP_INVALID");
  } finally {
    await writing;
  }
  if (length !== size) reject("ZIP_SIZE_MISMATCH");
  return out;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
