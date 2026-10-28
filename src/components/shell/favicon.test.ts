import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

// #960 (D-184): app/favicon.ico is the app's "D" mark on --ground with the
// letter in --accent. The demo login icon is tied to the tokens by
// e2e/login/provider-favicon.spec.ts; this ties the app's own icon to them,
// so a palette change cannot leave the old colours in the browser tab.
const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const ROOT = /:root\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
const TOKENS = new Map(
  [...ROOT.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]!.toLowerCase()]),
);

type Rgba = [number, number, number, number];

/** The 8-bit RGBA, non-interlaced PNG images stored in an ICO file, by width. */
function icoImages(file: Buffer): Map<number, { width: number; pixel: (x: number, y: number) => Rgba }> {
  const images = new Map<number, { width: number; pixel: (x: number, y: number) => Rgba }>();
  const count = file.readUInt16LE(4);
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const size = file.readUInt32LE(entry + 8);
    const offset = file.readUInt32LE(entry + 12);
    const png = file.subarray(offset, offset + size);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) throw new Error("expected 8-bit RGBA, non-interlaced");
    const idat: Buffer[] = [];
    for (let p = 8; p < png.length; ) {
      const length = png.readUInt32BE(p);
      if (png.toString("latin1", p + 4, p + 8) === "IDAT") idat.push(png.subarray(p + 8, p + 8 + length));
      p += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * 4;
    const out = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)]!;
      for (let x = 0; x < stride; x++) {
        const cur = raw[y * (stride + 1) + 1 + x]!;
        const a = x >= 4 ? out[y * stride + x - 4]! : 0;
        const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
        const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
        const paeth = () => {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        };
        const add = [0, a, b, (a + b) >> 1, paeth()][filter];
        if (add === undefined) throw new Error(`unknown PNG filter ${filter}`);
        out[y * stride + x] = (cur + add) & 0xff;
      }
    }
    images.set(width, {
      width,
      pixel: (x, y) => [...out.subarray(y * stride + x * 4, y * stride + x * 4 + 4)] as Rgba,
    });
  }
  return images;
}

const hex = ([r, g, b]: Rgba) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

describe("app favicon (#960, D-184)", () => {
  const images = icoImages(readFileSync(join(process.cwd(), "app", "favicon.ico")));

  it("holds the 16, 32 and 48 px sizes", () => {
    expect([...images.keys()].sort((x, y) => x - y)).toEqual([16, 32, 48]);
  });

  it("draws the mark on --ground with the letter in --accent", () => {
    const image = images.get(48)!;
    const colours = new Set<string>();
    for (let y = 0; y < image.width; y++)
      for (let x = 0; x < image.width; x++) {
        const px = image.pixel(x, y);
        if (px[3] === 255) colours.add(hex(px));
      }
    expect(hex(image.pixel(4, 24))).toBe(TOKENS.get("ground"));
    expect(colours).toContain(TOKENS.get("accent"));
  });
});
