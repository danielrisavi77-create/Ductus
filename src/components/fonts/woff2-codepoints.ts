import { brotliDecompressSync } from "node:zlib";

/**
 * Reads the code points a WOFF2 file maps to a real glyph (its `cmap` table).
 * Test helper only: it knows just enough of WOFF2 to find that one table, and
 * rejects anything it does not understand instead of guessing.
 */
export function woff2CodePoints(file: Buffer): Set<number> {
  if (file.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a WOFF2 file");
  if (file.toString("latin1", 4, 8) === "ttcf") throw new Error("font collections unsupported");
  const numTables = file.readUInt16BE(12);
  const compressedSize = file.readUInt32BE(20);

  // Table directory: starts after the 48-byte header.
  let pos = 48;
  const readBase128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = file.readUInt8(pos);
      pos += 1;
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("malformed UIntBase128");
  };
  const CMAP = 0;
  const GLYF = 10;
  const LOCA = 11;
  let offset = 0;
  let cmapAt = -1;
  let cmapLength = 0;
  for (let i = 0; i < numTables; i += 1) {
    const flags = file.readUInt8(pos);
    pos += 1;
    const tag = flags & 0x3f;
    if (tag === 0x3f) pos += 4; // explicit four-byte tag
    const transform = flags >> 6;
    const origLength = readBase128();
    // glyf and loca are transformed at version 0, every other table at != 0.
    const transformed = tag === GLYF || tag === LOCA ? transform === 0 : transform !== 0;
    const length = transformed ? readBase128() : origLength;
    if (tag === CMAP) {
      if (transformed) throw new Error("transformed cmap unsupported");
      cmapAt = offset;
      cmapLength = length;
    }
    offset += length;
  }
  if (cmapAt < 0) throw new Error("no cmap table");

  const data = brotliDecompressSync(file.subarray(pos, pos + compressedSize));
  const cmap = data.subarray(cmapAt, cmapAt + cmapLength);
  const points = new Set<number>();
  const subtables = new Set<number>();
  for (let i = 0; i < cmap.readUInt16BE(2); i += 1) subtables.add(cmap.readUInt32BE(4 + i * 8 + 4));
  for (const start of subtables) {
    const table = cmap.subarray(start);
    const format = table.readUInt16BE(0);
    if (format === 4) readFormat4(table, points);
    else if (format === 12) readFormat12(table, points);
  }
  if (points.size === 0) throw new Error("no supported cmap subtable");
  return points;
}

function readFormat4(table: Buffer, points: Set<number>): void {
  const segCount = table.readUInt16BE(6) / 2;
  const ends = 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  for (let s = 0; s < segCount; s += 1) {
    const end = table.readUInt16BE(ends + s * 2);
    const start = table.readUInt16BE(starts + s * 2);
    const delta = table.readUInt16BE(deltas + s * 2);
    const rangeOffset = table.readUInt16BE(rangeOffsets + s * 2);
    for (let code = start; code <= end && code < 0xffff; code += 1) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const raw = table.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (code - start) * 2);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) points.add(code);
    }
  }
}

function readFormat12(table: Buffer, points: Set<number>): void {
  const groups = table.readUInt32BE(12);
  for (let g = 0; g < groups; g += 1) {
    const at = 16 + g * 12;
    const start = table.readUInt32BE(at);
    const end = table.readUInt32BE(at + 4);
    const firstGlyph = table.readUInt32BE(at + 8);
    for (let code = start; code <= end; code += 1) {
      if (firstGlyph + (code - start) !== 0) points.add(code);
    }
  }
}

/** Parses a CSS `unicode-range` value into a membership test. */
export function unicodeRange(value: string): (codePoint: number) => boolean {
  const ranges = value.split(",").map((part) => {
    const match = /^U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?$/i.exec(part.trim());
    if (!match?.[1]) throw new Error(`unsupported unicode-range part: ${part}`);
    const start = Number.parseInt(match[1], 16);
    return [start, match[2] ? Number.parseInt(match[2], 16) : start] as const;
  });
  return (codePoint) => ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}
