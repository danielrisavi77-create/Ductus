import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { unicodeRange, woff2CodePoints } from "./woff2-codepoints";

// DAN-121: the interface fonts are files in the repository. The build must
// never fetch them, and Croatian letters must come from the font itself.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FONT_DIR = join(ROOT, "app", "fonts");
const FAMILIES = ["InstrumentSans", "Newsreader", "JetBrainsMono"] as const;
const SUBSETS = ["latin", "latin-ext"] as const;
const FONT_FILES = FAMILIES.flatMap((family) =>
  SUBSETS.map((subset) => `${family}-${subset}.woff2`),
);

const CROATIAN = [..."čćđšžČĆĐŠŽ"];
const BASIC = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?()-„“”’–"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?[jt]sx?|css|mdx)$/.test(entry.name) ? [path] : [];
  });
}

/** `src` and `unicode-range` of every localFont() call in app/fonts/index.ts. */
function declaredFaces(): { file: string; inRange: (codePoint: number) => boolean }[] {
  const source = readFileSync(join(FONT_DIR, "index.ts"), "utf8");
  const calls = source.split("localFont(").slice(1);
  return calls.map((call) => {
    const src = /src:\s*"\.\/([^"]+)"/.exec(call)?.[1];
    const range = /prop:\s*"unicode-range",\s*value:\s*"([^"]+)"/.exec(call)?.[1];
    if (!src || !range) throw new Error("localFont() call without a literal src and unicode-range");
    return { file: src, inRange: unicodeRange(range) };
  });
}

describe("font sources", () => {
  // Assembled so that this file does not match its own check.
  const forbidden = ["next/font/" + "google", "fonts.google" + "apis.com", "fonts.g" + "static.com"];

  it("has files to scan", () => {
    expect(sourceFiles(join(ROOT, "app")).length).toBeGreaterThan(0);
    expect(sourceFiles(join(ROOT, "src")).length).toBeGreaterThan(0);
  });

  it.each(forbidden)("app/ and src/ never reference %s", (needle) => {
    const offenders = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "src"))]
      .filter((path) => readFileSync(path, "utf8").includes(needle))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});

describe("font files", () => {
  it("are exactly the files that app/fonts/index.ts loads", () => {
    const onDisk = readdirSync(FONT_DIR).filter((name) => /\.(?:woff2?|ttf|otf)$/.test(name));
    expect(onDisk.sort()).toEqual([...FONT_FILES].sort());
    expect(
      declaredFaces()
        .map((face) => face.file)
        .sort(),
    ).toEqual([...FONT_FILES].sort());
  });

  it.each(FONT_FILES)("%s matches the checksum recorded in SOURCE.md", (file) => {
    const recorded = readFileSync(join(FONT_DIR, "SOURCE.md"), "utf8");
    const sha256 = createHash("sha256").update(readFileSync(join(FONT_DIR, file))).digest("hex");
    expect(recorded).toContain(`| \`${file}\` |`);
    expect(recorded).toContain(sha256);
  });

  it.each(FAMILIES)("%s ships its licence text", (family) => {
    const licence = readFileSync(join(FONT_DIR, `OFL-${family}.txt`), "utf8");
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
});

describe.each(FAMILIES)("%s glyph coverage", (family) => {
  const faces = declaredFaces()
    .filter((face) => face.file.startsWith(`${family}-`))
    .map((face) => ({
      ...face,
      glyphs: woff2CodePoints(readFileSync(join(FONT_DIR, face.file))),
    }));

  // A browser uses a face for a character only when the declared range allows
  // it and the file has the glyph; otherwise it falls through to a system font.
  const rendered = (character: string): boolean => {
    const codePoint = character.codePointAt(0) ?? -1;
    return faces.some((face) => face.inRange(codePoint) && face.glyphs.has(codePoint));
  };

  it("has a latin and a latin-ext face", () => {
    expect(faces.map((face) => face.file).sort()).toEqual(
      SUBSETS.map((subset) => `${family}-${subset}.woff2`).sort(),
    );
  });

  it.each(CROATIAN)("renders %s from the font", (character) => {
    expect(rendered(character)).toBe(true);
  });

  it("renders basic Latin text and Croatian punctuation from the font", () => {
    expect(BASIC.filter((character) => !rendered(character))).toEqual([]);
  });

  it("does not claim a glyph it lacks (the check can fail)", () => {
    // Cyrillic is outside both subsets.
    expect(rendered("ж")).toBe(false);
  });
});
