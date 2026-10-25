import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { validateDocument, type CanonicalDocument } from "@/domain/document";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { EarlierDraftView, earlierDraftText, type CopyState } from "./earlier-draft";

// #711 F1b (contract 6391402093 §4, §8). Every text is invented.
const t = messagesHr.workspace;
const noop = () => {};

const KEYS = [
  "earlierDraftSummary", "earlierDraftExplain", "earlierDraftCopy", "earlierDraftCopied",
  "earlierDraftCopyFailed", "earlierDraftOpen",
] as const;

function doc(...blocks: ({ heading: string } | string)[]): CanonicalDocument {
  const result = validateDocument({
    schemaVersion: 1,
    nodes: blocks.map((block, i) => {
      const id = `${String(i + 1).repeat(8)}-1111-4111-8111-111111111111`;
      const text = typeof block === "string" ? block : block.heading;
      const children = text === "" ? [] : [{ type: "text", text, marks: [] }];
      return typeof block === "string"
        ? { id, type: "paragraph", children }
        : { id, type: "heading", level: 1, children };
    }),
  });
  if (!result.ok) throw new Error("invalid synthetic document");
  return result.doc;
}

const view = (text: string, copy: CopyState) =>
  renderToStaticMarkup(h(EarlierDraftView, { text, copy, onCopy: noop, onExport: noop }));

describe("earlierDraftText", () => {
  it("is null without a document, for an empty one and for white space only", () => {
    expect(earlierDraftText(null)).toBeNull();
    expect(earlierDraftText(undefined)).toBeNull();
    expect(earlierDraftText(doc(""))).toBeNull();
    expect(earlierDraftText(doc("   ", "", " "))).toBeNull();
  });

  it("separates blocks by an empty line, headings included, and keeps the text exactly", () => {
    expect(earlierDraftText(doc({ heading: "Uvod" }, "Prvi izmišljeni odlomak.", "Drugi  odlomak."))).toBe(
      "Uvod\n\nPrvi izmišljeni odlomak.\n\nDrugi  odlomak.");
    expect(earlierDraftText(doc("Jedan odlomak."))).toBe("Jedan odlomak.");
  });

  it("joins the runs of one block", () => {
    const result = validateDocument({
      schemaVersion: 1,
      nodes: [{
        id: "11111111-1111-4111-8111-111111111111", type: "paragraph",
        children: [{ type: "text", text: "Gradske ", marks: [] }, { type: "text", text: "knjižnice", marks: ["bold"] }],
      }],
    });
    if (!result.ok) throw new Error("invalid synthetic document");
    expect(earlierDraftText(result.doc)).toBe("Gradske knjižnice");
  });
});

describe("F1b interface text", () => {
  it("every new key is a non-empty string without a forbidden term", () => {
    for (const key of KEYS) {
      expect(t[key].trim()).not.toBe("");
      expect({ key, found: findForbiddenTerms(t[key]) }).toEqual({ key, found: [] });
    }
  });

  it("names no server and no save as the place of the text", () => {
    for (const key of KEYS) expect(t[key]).not.toMatch(/poslužitelj|spremljen|sinkron/i);
  });

  it("is the accepted text of the contract", () => {
    expect(t.earlierDraftSummary).toBe("Na ovom uređaju čuva se tvoj raniji tekst koji nije u ovom radu.");
    // Until 3d-2c2 a paste is not recorded, so the explanation must not claim it is (owner, #711 amendment c).
    expect(t.earlierDraftExplain).toBe("Tekst ostaje gdje je i ne briše se. Ako ga želiš u ovom radu, kopiraj ga i zalijepi.");
    expect(t.earlierDraftExplain).not.toMatch(/zapis|bilje/);
    expect(t.earlierDraftCopy).toBe("Kopiraj tekst");
    // The contract wrote "Kopirano u međuspremnik." here; messages.test.ts refuses the stem "kopiran", so this text awaits confirmation.
    expect(t.earlierDraftCopied).toBe("Tekst je u međuspremniku.");
    // The contract wrote "kopirati" here, a forbidden term; this text awaits confirmation.
    expect(t.earlierDraftCopyFailed).toBe("Tekst nije moguće staviti u međuspremnik. Izvezi ga kao datoteku.");
    expect(t.earlierDraftOpen).toBe("Otvori raniji tekst");
  });
});

describe("EarlierDraftView", () => {
  const TEXT = "Uvod\n\nIzmišljeni raniji odlomak.";

  it("is closed, shows the text to read and offers only copy, never an insert", () => {
    const html = view(TEXT, "idle");
    expect(html).toMatch(/^<details class="earlier-draft">/);
    expect(html).not.toContain("open");
    expect(html).toContain(`<summary>${t.earlierDraftSummary}</summary>`);
    expect(html).toContain("<p>Izmišljeni raniji odlomak.</p>");
    expect(html).toContain(`>${t.earlierDraftCopy}</button>`);
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<input");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(`href="/rad">${t.earlierDraftOpen}</a>`);
    expect(html).toContain('role="status" class="earlier-draft__status"></p>');
  });

  it("says a copy happened only after it did", () => {
    expect(view(TEXT, "copied")).toContain(`role="status" class="earlier-draft__status">${t.earlierDraftCopied}</p>`);
    expect(view(TEXT, "idle")).not.toContain(t.earlierDraftCopied);
  });

  it("offers the export when the clipboard refused", () => {
    const html = view(TEXT, "failed");
    expect(html).toContain(t.earlierDraftCopyFailed);
    expect(html).toContain(`>${messagesHr.editor.exportText}</button>`);
    expect(html).not.toContain(`>${t.earlierDraftCopy}</button>`);
  });
});
