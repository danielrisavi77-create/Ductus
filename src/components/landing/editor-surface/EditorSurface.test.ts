import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import EditorSurface from "./EditorSurface";

describe("the isolated writing surface", () => {
  it("starts with a blank document and accessible, initially unavailable controls", () => {
    const html = renderToStaticMarkup(createElement(EditorSurface));

    expect(html).toContain('aria-label="Tekst rada"');
    expect(html).toContain('aria-label="Oblikovanje teksta"');
    expect(html).toContain('aria-label="Naslov 1"');
    expect(html).toContain("Naslovi će se pojaviti ovdje.");
    expect(html).toContain("0 riječi");
    expect(html).not.toContain("Spremljeno");
    expect(html).not.toContain("Poslano");
  });
});
