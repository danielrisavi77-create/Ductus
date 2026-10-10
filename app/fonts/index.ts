import localFont from "next/font/local";

// The interface fonts are files in this directory, so `pnpm build` needs no
// network and the student's browser gets them from our own origin (DAN-121).
// Provenance, checksums and licences: SOURCE.md.
//
// Each family is the two subset files Google Fonts serves (latin, latin-ext),
// kept apart by `unicode-range` exactly as before. `next/font/local` takes one
// range per call, hence two calls per family; fonts.css joins each pair back
// into the single variable that globals.css reads and adds the fallback face.
//
// next/font needs literal arguments, so the two ranges are repeated. The test
// in src/components/fonts reads them from this file and checks them against
// the glyphs the files really contain.

export const uiLatin = localFont({
  src: "./InstrumentSans-latin.woff2",
  weight: "400 600",
  style: "normal",
  display: "swap",
  variable: "--font-ui-latin",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

export const uiLatinExt = localFont({
  src: "./InstrumentSans-latin-ext.woff2",
  weight: "400 600",
  style: "normal",
  display: "swap",
  variable: "--font-ui-latin-ext",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

export const displayLatin = localFont({
  src: "./Newsreader-latin.woff2",
  weight: "400 500",
  style: "normal",
  display: "swap",
  variable: "--font-display-latin",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

export const displayLatinExt = localFont({
  src: "./Newsreader-latin-ext.woff2",
  weight: "400 500",
  style: "normal",
  display: "swap",
  variable: "--font-display-latin-ext",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

export const monoLatin = localFont({
  src: "./JetBrainsMono-latin.woff2",
  weight: "400 500",
  style: "normal",
  display: "swap",
  variable: "--font-mono-latin",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

export const monoLatinExt = localFont({
  src: "./JetBrainsMono-latin-ext.woff2",
  weight: "400 500",
  style: "normal",
  display: "swap",
  variable: "--font-mono-latin-ext",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

/** Classes that define every font variable; they go on `<html>`. */
export const fontVariables = [
  uiLatin,
  uiLatinExt,
  displayLatin,
  displayLatinExt,
  monoLatin,
  monoLatinExt,
]
  .map((font) => font.variable)
  .join(" ");
