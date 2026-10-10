/**
 * Interface text, Croatian (D-84: every string in keys from day one).
 *
 * Components read text only from here, never inline, so `messages.en.ts`
 * (D-70) is a second table of the same shape and nothing else. Words from the
 * forbidden vocabulary in docs/PRODUCT.md §5 never appear here;
 * `messages.test.ts` checks that.
 *
 * This is the one catalogue of screen text. Two neighbours hold text that is
 * not repeated here, and `messages.test.ts` checks that as well:
 *   - `./hr.ts`: Croatian dates and counted nouns ("2 riječi"), built by rule;
 *   - `@/domain/sync/labels`: the wording of the eight save states, kept next
 *     to the state machine it describes.
 */

export const hr = {
  app: {
    name: "Ductus",
    tagline: "Kako je rad nastao, bez presude o autorstvu.",
  },
  shell: {
    skipToContent: "Preskoči na sadržaj",
    demoBadge: "Demo · izmišljeni podaci",
  },
  home: {
    lead: "Ductus ne procjenjuje autorstvo ni korištenje AI-ja. Prije početka vidiš što nastavnik vidi i od kada.",
    openWorkspace: "Otvori radni prostor",
  },
  workspace: {
    title: "Radni prostor",
    viewModes: "Prikaz",
    modeWriting: "Pisanje",
    modeTeacherView: "Kako vidi nastavnik",
    soon: "uskoro",
    structure: "Struktura",
    structureLabel: "Struktura rada",
    structureEmpty: "Naslovi će se pojaviti ovdje.",
    tables: "Popis tablica",
    tablesEmpty: "Nema tablica.",
    footnotes: "Fusnote",
    footnotesEmpty: "Nema fusnota.",
    progress: "Napredak",
    sidePanel: "Upute, literatura i komentari",
    sidePanelEmpty: "Upute zadatka, literatura i komentari nastavnika prikazuju se ovdje.",
    documentUntitled: "Bez naslova",
    documentLabel: "Tekst rada",
    documentNotEditable: "Pisanje ovdje još nije moguće.",
    status: "Stanje rada",
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** The shape every language table has to fill. */
export type Messages = Widen<typeof hr>;

export const messagesHr: Messages = hr;
