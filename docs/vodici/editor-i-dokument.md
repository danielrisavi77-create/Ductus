# Ductus: editor i model dokumenta

Ako se ovaj vodič i dokument ili kod razilaze, vrijedi dokument odnosno kod; nesklad prijavi u IZVJEŠTAJU.

Vodič je detaljna karta područja, ne izvor pravila. Pravila su u `docs/PRODUCT.md` §5 i §10, `docs/ARCHITECTURE.md` §0.1, §2, §5, §5a, §12, `docs/DECISIONS.md` i `STATE.md` ("Ne smije se izgubiti"). Prije rada pročitaj `STATE.md` (`CLAUDE.md`).

## 1. Kada koristiti

Koristi kad PR dira `src/editor/**`, `src/domain/document/**`, `src/domain/diff/**`, `src/domain/citation/**`, `src/domain/collaboration/**`, `config/faculties/**/citation.json` ili njihove testove. Pravilo `.claude/rules/sinkronizacija.md` obuhvaća `src/editor/**` i upućuje na `ductus-sync-states`, `ductus-offline-recovery` i `ductus-local-storage-logout`; pisac u tom području radi na Opusu bez obzira na `Risk` (`docs/ORKESTRATOR.md` §7, prema tom pravilu).

Uz ovaj vodič primjenjuju se kratki skillovi iz `.claude/skills/`:
- `ductus-sync-states` kad se mijenja nešto što utječe na stanje spremanja ili `SYNCED`;
- `ductus-offline-recovery` kad se dira oporavak, rebase ili salvage;
- `ductus-local-storage-logout` kad se dira lokalna pohrana (Dexie journal) ili odjava;
- `ductus-ui-copy` kad se mijenja tekst koji korisnik vidi (npr. `DEFAULT_PLACEHOLDER` u `src/editor/schema.ts`; ta datoteka je u `UI_TEXT_MODULES` skenera zabranjenih izraza);
- `ductus-synthetic-data` za fixtureove (nikad stvarni studentski tekst);
- `ductus-attack-plan` kad je zadatak `critical`.

Za tok oko editora (journal, sinkronizacija, `src/lib/journal`) pogledaj i vodič `docs/vodici/karta-aplikacije.md`, a za slojeve testova `docs/vodici/testovi.md`.

## 2. Karta

Što je implementirano, a što planirano (`docs/ARCHITECTURE.md` §0.1: kod, testovi i `main` dokazuju stanje, ne plan). Na `main` postoji model, validacija, editor schema i identitet, ali **Tiptap editor još nije montiran u aplikaciju**: `app/rad/page.tsx` je prazan radni prostor s ne-uređivim `role="textbox"` (komentar u datoteci: "F-8 mounts the editor"). Editor se koristi u testovima i u e2e harnessu (`e2e/support/identity-harness.ts`, `e2e/block-identity.spec.ts`). Montiranje je zadatak F-8 / PR-ovi #206 i #214 (STATE.md, "Otvoreni razvojni stog"; #214 je draft).

Biblioteka: Tiptap 3 (`@tiptap/core`, `extension-bold/document/heading/history/italic/paragraph/placeholder/text`, `@tiptap/pm`, `@tiptap/react`; `package.json`). Status odluke: Editor Tiptap / ProseMirror je [PRIJEDLOG D-08] u `docs/ARCHITECTURE.md` §1 (vidi Otvoreno).

### src/domain/document/ (čista domena, bez Reacta i editora)
- `schema.ts`: tipovi `CanonicalDocument` (`schemaVersion: 1`, `nodes`), `ParagraphNode`, `HeadingNode` (razina 1 do 3), `InlineNode` (tekst s oznakama `bold`, `italic`), brendirani `NodeId`, `isNodeId` (UUID verzije 1 do 8), `newNodeId(uuidFn?)`, `canonicalMarks`, `MARK_ORDER`, graditelji `textNode`, `paragraphNode`, `headingNode`.
- `validate.ts`: `validateDocument(doc: unknown)` skuplja sve greške (`VALIDATION_ERROR_CODES`), odbija nepoznata polja, dupli id (neovisno o veličini slova), prazan tekst, neuređene oznake, susjedne tekstove s istim oznakama; vraća novu kopiju.
- `normalize.ts`: `normalizeDocument` (idempotentno; spaja susjedne iste oznake, briše prazan tekst, sortira oznake, vraća jedan prazan odlomak ako nema blokova).
- `transaction.ts`: `applyTransaction` (compare-and-set nad `baseRevision`, jedina vrsta `REPLACE_DOCUMENT`), `emptyDocument`, `initialDocumentState`.
- `equality.ts`: `documentsEqual` (s id-evima) i `contentEqual` (bez id-eva).
- `edit-step.ts`: `parseEditStep`, `parseEditSteps`, `EDIT_STEP_FORMAT_V1 = "ductus-edit-steps-v1"`, `MAX_EDIT_STEP_BYTES = 2_097_152`, `EDIT_STEP_REJECTIONS`. Zajednički čitač koraka za klijent i poslužitelj; vektori u `edit-step.vectors.json`. Koristi ga evidencijska domena (`src/domain/forensics/*`, `src/application/evidence/*` testovi).
- `index.ts`: ponovo izvozi sve gore navedeno.

### src/editor/ (ovisi o domeni i Tiptapu, ne obrnuto)
- `schema.ts`: `createEditorExtensions(placeholder?)` registrira točno `F1_EXTENSION_NAMES` (doc, paragraph, heading 1 do 3, text, bold, italic, undoRedo, placeholder, nodeIdentity). StarterKit se namjerno ne koristi. `NodeIdentity` ekstenzija nosi atribut `nodeId` (`keepOnSplit: false`, HTML atribut `data-node-id`), `DEFAULT_PLACEHOLDER`.
- `identity.ts`: plugin identiteta blokova (`createNodeIdentityPlugin`), `mintMissingIds`, `repeatedNodeIds`, `withoutNodeIds`, `replaceWithStoredDocument`, `REMOVAL_MEMORY = 1000`.
- `interop.ts`: `canonicalToTiptap` (totalna), `tiptapToCanonical(json, idFor?, uuidFn?)` (vraća `CanonicalCandidate`), `INTEROP_ERROR_CODES`, `NODE_ID_ATTRIBUTE = "nodeId"`, `countNodes`, `countWords`. Namjerno bez importa Tiptapa u izvođenju.
- `storable-text.ts`: `storableText`, `storableDocument` (usamljeni surrogat u U+FFFD, U+0000 se briše).
- `storable-input.ts`: `StorableInput` ekstenzija i `createStorableInputPlugin` koji isto radi unutar editora.

### src/domain/diff/
`diff.ts`: `diffText(before, after)` (LCS po riječima, `DeterministicTextDiff`) i `advisoryClassifications` (`numeric-change`, `negation-change`, `modal-strength-change`). `index.ts` ponovo izvozi `./diff`. Nijedan modul izvan svojih testova i `tests/unit/forbidden-terms.test.ts` ga još ne uvozi.

### src/domain/citation/
`style.ts` (`parseCitationStyle`, `CitationStyleError`; podržan samo stil `author-date`, zatvoreno pada na nepotpun config), `types.ts` (`Source`: book, article, chapter, web; `Author`: person ili organization; `CitationInputError`), `format.ts` (`formatInText`, `formatBibliographyEntry`, `sortBibliography` s `Intl.Collator("hr")`, `assignYearSuffixes`, `normalizePages`), `index.ts` (izvozi i `fpzgCitationStyle` iz `config/faculties/fpzg/citation.json`). Config je kopija iz Lekte (D-83), provenance je u samoj JSON datoteci; zamjenjuje se Lekta paketom u M4.

### src/domain/collaboration/
- `anchor.ts`: `createTextAnchor`, `resolveTextAnchor` (statusi `exact`, `moved`, `ambiguous`, `missing`).
- `revision-request.ts`: automat `OPEN` do `REREVIEW_REQUIRED` (`createRevisionRequest`, `submitStudentResponse`, `shareResponseForReview`, `acceptForRevision`, `requestClarification`, `markRereviewRequired`).
- `share.ts`: `createSharePackage`, `revokeSharePackage`, `canRecipientReadRevision`.
Sve su čiste funkcije; nema poslužiteljskih tablica ni RPC-a u ovom području (komentari, prijedlozi i obavijesti iz ARCHITECTURE §5a su cilj, ne postojeći kod osim ovih tipova).

Smjer ovisnosti (ARCHITECTURE §0.1: prema unutra): `src/editor` -> `src/domain/document`; `collaboration/anchor` -> `document` (samo tip `NodeId`); `src/lib/journal/local-document-saver.ts` -> `document` i `editor/storable-text`; `src/domain/sync/{conflict,recovery}.ts` -> `document`. Domena ne smije uvoziti React, SQL ni vendor SDK; `interop.ts` ne smije uvoziti Tiptap.

## 3. Tok podataka

1. Autor tipka u Tiptapu. Svaki blok (paragraph, heading) nosi atribut `nodeId`.
2. Nakon svake transakcije `NodeIdentity` plugin (`appendTransaction`) prati korake (`trace`, `plan`) i rješava tko drži koji id: blok koji postoji prije i poslije zadržava id po tekstu, svi ostali dobivaju novi (`newNodeId`); iznimke su premještaj unutar jedne transakcije i vraćanje (undo/redo) istog bloka. Zalijepljen ili ispušten sadržaj gubi id-eve (`transformPasted: withoutNodeIds`).
3. Ekstenzija `StorableInput` (kad je registrirana) u istom ažuriranju čini tekst pohranjivim (`storableText`).
4. Editor stanje se projicira u kanonski kandidat: `tiptapToCanonical(editor.getJSON())`. Nepoznat čvor ili oznaka je greška (`TIPTAP_UNKNOWN_*`), nikad tiho brisanje. Zatim `normalizeDocument`, pa `validateDocument` kao završna vrata.
5. Saver (`src/lib/journal/local-document-saver.ts`) sprema `storableDocument(doc)` u journal; to je stanje "spremljeno na uređaju" (ARCHITECTURE §5 t. 1).
6. Učitavanje pohranjenog dokumenta: `replaceWithStoredDocument(view, doc)` validira (`validateDocument`), odbija dupli id, ne ide u povijest poništavanja i ne generira nove id-eve.
7. Prema poslužitelju ide `REPLACE_DOCUMENT` transakcija (`applyTransaction`: STALE_BASE ako `baseRevision` nije jednak trenutnoj reviziji, nema last-write-wins), a koraci uređivanja u evidenciji idu kroz `parseEditSteps` (format v1, zatvoreni skupovi ključeva, bez vremena).
8. Usporedba i sidra: `diffText` radi nad običnim nizovima; `createTextAnchor`/`resolveTextAnchor` nad tekstom jednog bloka, vezano uz `nodeId`.
9. Citiranje: `Source` + `fpzgCitationStyle` -> `formatInText` / `formatBibliographyEntry`. Nema veze s editor shemom: u demou je citat običan tekst, bez novog čvora u shemi (PLAN-DEMO F-8, D-98 dopuna).

## 4. Invarijante

1. Kanonski dokument je izvor istine, editor je projekcija; shema editora ne smije moći izraziti što kanonski model ne može držati (komentar u `src/editor/schema.ts`; `docs/ARCHITECTURE.md` §12 prenosi `src/editor` s testovima). Test: `src/editor/schema.test.ts`, `interop.test.ts`.
2. Okrugli put: za svaki valjan dokument `tiptapToCanonical(canonicalToTiptap(d))` daje `d` (do na normalizaciju); nema tihog gubitka. Test: `src/editor/interop.test.ts`.
3. Identitet bloka: blok koji ostaje u dokumentu zadržava id; novi blok dobiva novi; split ne kopira id (`keepOnSplit: false`); paste, drop i skriptom umetnut sadržaj nikad ne donosi id; vraćanje i premještaj samo za isti blok. Plugin ne čita meta transakcije. Testovi: `src/editor/identity.test.ts`, `identity.property.test.ts`, `identity.stored.test.ts`, `e2e/block-identity.spec.ts` (Chromium, Firefox, WebKit). Izvor: komentar `identity.ts`; razlog je da komentari, zahtjevi za doradu i evidencija pokazuju na `nodeId` (PRODUCT §5 pravilo 8, ARCHITECTURE §5a). Dokument-izvor za sam algoritam: u kodu, nije u dokumentima.
4. Id-evi su jedinstveni neovisno o velikim i malim slovima; id je UUID verzije 1 do 8; nil UUID odbijen. Test: `validate.test.ts`, `validate.hardening.test.ts`.
5. Dokument ima barem jedan blok; "prazan dokument" je jedan prazan odlomak (`emptyDocument`, `normalizeDocument`). Test: `transaction.test.ts`, `normalize.test.ts`.
6. Validacija nikad ne popravlja; normalizacija je izričit, idempotentan korak koji mijenja samo kodiranje teksta, nikad tekst ni identitet. Test: `normalize.test.ts`.
7. Nema last-write-wins: `applyTransaction` odbija `STALE_BASE`, a provjera baze ide prije validacije. Izvor: komentar u `transaction.ts` ("by constitution"); ARCHITECTURE §5 t. 3.3 (CAS revizija). Test: `transaction.test.ts`.
8. Pohranjiv tekst: lone surrogate postaje U+FFFD, U+0000 se briše, jer JCS (B-8) odbija prvo, a `jsonb` drugo, pa bi red zauvijek stajao kao LOCAL_DURABLE. Test: `storable-text.test.ts`, `storable-input.test.ts`. Izvor: `STATE.md` B-8 i komentar u `storable-text.ts` (#131). U `storable-text.ts` NUL se gradi s `String.fromCodePoint(0)`: skener zabranjenih izraza čita svaki string u datoteci (#223).
9. Format koraka v1: zatvoren skup ključeva, bez vremenskih polja, pozicije su sigurni nenegativni cijeli brojevi, tekst bez NUL i bez normalizacije jer hash pokriva točno zabilježeno; blok iz isječka nema id (id dolazi iz `attr` koraka); limit 2 MiB (D-96) računa se nad UTF-8 bajtovima kanonskog (RFC 8785) oblika. Test: `edit-step.test.ts`, `edit-step.property.test.ts`, `edit-step.vectors.json`. Povezano: B-12, replay za delete/cut/replace provjerava hash uklonjenog raspona (`STATE.md`).
10. Sidro komentara nikad ne pada na krivo mjesto: ako se tekst ne može pouzdano naći, status je `ambiguous` ili `missing` ("sidro nije pouzdano", ARCHITECTURE §5a). Test: `anchor.test.ts`.
11. Zahtjev za doradu: odgovor studenta traži neprazno obrazloženje i reviziju koja nije manja od tražene; dijeljenje i prihvaćanje samo iz propisanih stanja (D-45; ARCHITECTURE §5a). Test: `revision-request.test.ts`, `revision-request.hardening.test.ts`.
12. Paket dijeljenja: primatelj čita samo točno dijeljenu reviziju, ne vlasnik sam sebi, opoziv odmah vrijedi. Test: `share.test.ts`. Izvor: pristup nastaje iz odnosa (PRODUCT §3 i ARCHITECTURE §7); izvršno provođenje je kasniji RPC/RLS, ne ova funkcija.
13. Citatni stil je konfiguracija, ne kod (PRODUCT §5 pravilo 12; D-25, D-83). Nepotpun config baca `CitationStyleError`, nema djelomičnog formatiranja. Test: `format.test.ts`, `format.property.test.ts`.
14. Brojač riječi i usporedbe su pomoć pri čitanju, nikad dokaz o autorstvu (komentar `countWords`; PRODUCT §5 pravila 1 i 9). `advisoryClassifications` ne sudi o značenju (test "without judging meaning"). Riječi iz rječnika zabranjenih izraza (PRODUCT §5) ne smiju se pojaviti u tekstu sučelja; popis riječi `diff.ts` (negacije, modali) je kod, ne sučelje, i skener ga čita samo prema hrvatskim unosima.
15. Student i nastavnik vide isto generirano istom funkcijom (PRODUCT §5 pravilo 5); zato usporedba mora biti deterministička i bez AI-ja (`DeterministicTextDiff`, D-45). Pinning test: `diff.test.ts` (tri slučaja za diff).

## 5. Kako napraviti promjenu

Razine rizika (`docs/ENGINEERING_SYSTEM.md` §5): editor je `standard`; runtime kod je najmanje `standard`. Automatski `critical` su putanje sa segmentima evidence, forensics, JCS, replay, signing i sl. (§5 "Automatski risk floor"). `src/domain/document/edit-step.ts` po putanji nije na tom popisu, ali njegov čitač služi evidenciji (B-8, B-12): ako PR dira hash ili replay, o razini odlučuje orkestrator i računaj `critical`. Svaki novi testni fajl pod `tests/` je `critical`. Putanje D-97 (`.claude/`, `.github/`, `CLAUDE.md` ...) ovaj vodič ne smije mijenjati.

### a) Novi čvor ili nova oznaka u modelu
1. Prvo odluka: shema je zamrznuta na F1 (paragraph, heading 1 do 3, bold, italic); citat/bibliografija u demou bez novog čvora (PLAN-DEMO F-8). Novi čvor traži zapis u `docs/DECISIONS.md` i verziju sheme (`DOCUMENT_SCHEMA_VERSION`); inače stani i dodaj pitanje u Owner queue.
2. `schema.ts` tipovi, `validate.ts` (novi kodovi greške, nikad preimenovanje starih bez verzije), `normalize.ts`, `equality.ts`.
3. `interop.ts` (oba smjera i `INTEROP_ERROR_CODES`), `src/editor/schema.ts` (`ID_CARRYING_TYPES`, `F1_EXTENSION_NAMES`), `identity.ts` ako blok nosi id.
4. `edit-step.ts` (format v1 je zatvoren: promjena traži novu verziju formata ili izričitu odluku, vektori i test), `storable-*`.
5. Testovi: validate, normalize idempotentnost, okrugli put, property test identiteta, `edit-step` vektori. Broj prenesenih testova ne smije pasti (ARCHITECTURE §12).

### b) Promjena pravila identiteta bloka
1. Pročitaj komentar na vrhu `identity.ts` i `identity.test.ts`; promjena pravila 1 do 3 iz komentara mijenja što evidencija i komentari smatraju istim blokom.
2. Dodaj slučaj u `identity.test.ts` i, ako je ulazni put preglednika, u `e2e/block-identity.spec.ts` (sva tri enginea, `docs/TESTING.md` §2).
3. Provjeri `identity.property.test.ts` (`pnpm test:property`) i `identity.stored.test.ts`.

### c) Novi ulaz teksta u editor (paste, drop, ekstenzija)
1. Tekst mora proći `storableText` (invarijanta 8) i izgubiti id-eve (`withoutNodeIds`).
2. Testiraj kroz `Editor` s `[...createEditorExtensions(), StorableInput]` kao u `storable-input.test.ts`.
3. TESTING §3 popisuje scenarije: zlonamjeran HTML pri pasteu (18), paste 100.000+ znakova (19), zero-width/bidi (20), programski umetnut tekst (21). Test koji ih pokriva dodaj uz promjenu.

### d) Diff
1. Prije bilo kakvog velikog `diffText` dodaj granicu ulaza ili diff po odlomcima (`STATE.md`, "Ne smije se izgubiti"), uz postojeće "hardening" nalaze.
2. `lcs` je O(n*m) memorije i vremena nad brojem tokena; tablica je `number[][]`.
3. Test u `diff.test.ts` za granicu (veličina, rezultat pri prekoračenju); odluči prekoračenje kao odbijanje, ne tiho skraćivanje.
4. Ako novi tekst u diffu ulazi u sučelje, prođi `ductus-ui-copy`.

### e) Citatni stil
1. Novi fakultet ili izmjena: samo JSON pod `config/faculties/<fakultet>/` + `parseCitationStyle` (nova polja u `style.ts` i `CitationStyle`).
2. Testovi u `format.test.ts`, svojstva u `format.property.test.ts`. Hrvatski redoslijed: `Intl.Collator("hr")`.
3. Ne dodavaj logiku koja je na izvoru u Lekti; D-25 i D-83: zamjena Lekta paketom je M4.

### f) Suradnja (sidra, zahtjevi za doradu, dijeljenje)
1. Promjena prijelaza u `revision-request.ts` mora imati test u oba datoteke testova i test koji pada kad se zaštita makne (TESTING §5).
2. Sve što ide na poslužitelj (RPC, tablice) pripada `docs/vodici/baza.md` i `ductus-new-table`, ne ovdje.

## 6. Provjera

Naredbe iz `package.json`:
- `pnpm test:unit` (Vitest projekt `unit`: `src/**/*.test.ts` i `tests/unit/**`, bez `*.property.test.ts`; uključuje `src/editor/interop.bench.test.ts` kao tripwire kašnjenja) ili samo područje: `pnpm exec vitest run --project unit src/editor src/domain/document src/domain/diff src/domain/citation src/domain/collaboration`.
- `pnpm test:property` (projekt `property`; `FC_NUM_RUNS` skalira broj pokretanja, zadano 100, `tests/property/setup.ts`): identity, edit-step, citation format.
- `pnpm typecheck`, `pnpm lint`.
- `pnpm test:e2e` (Playwright): `e2e/block-identity.spec.ts` na Chromiumu, Firefoxu i WebKitu.
CI: posao "Lint, typecheck, test and build" (`.github/workflows/ci.yml`) vrti lint, typecheck, `test:unit`, `test:property`, `build`; e2e je u poslu "Local stack (compose.yaml)".

## 7. Zamke

- `StorableInput` je izvezen, ali na `main` ga `createEditorExtensions` **ne registrira** (`F1_EXTENSION_NAMES` ga ne sadrži; test ga dodaje ručno). Komentar u `storable-input.ts` tvrdi "closed in #214", a #214 je draft. Ne pretpostavljaj da je editor stvarno pohranjiv dok se to ne spoji i testira.
- `tiptapToCanonical` mint-a novi id za duplikat i za nedostajući id; to je zadnja linija obrane. Pravi vlasnik identiteta je plugin; ne oslanjaj se na interop za odluku tko je prvi.
- Početni sadržaj (`content` u editoru) nitko ne validira; duplikat se popravlja pozicijski i upisuje upozorenje u konzolu. Pohranjeni dokumenti moraju ići kroz `replaceWithStoredDocument`.
- `SetNodeIds.toJSON()` namjerno baca: koraci editora se ne serijaliziraju; šalje se dokument.
- Plugin ne vidi zamjenu cijelog stanja ni uređivanje dok je editor nemontiran. Preglednik nije granica povjerenja za identitet; onaj tko prihvaća dokument ne smije se oslanjati samo na plugin.
- `contentEqual` (bez id-eva) nikad ne odlučuje treba li pisati: promjena id-eva je prava promjena (komentar `equality.ts`).
- Oznake su sortirane (`bold` prije `italic`); polja moraju biti u kanonskom redoslijedu, inače `MARKS_UNSORTED`.
- Nedefinirani prazni `Array` u `nodes` ("holes") se odbijaju; `Array.from` je tu namjerno.
- `diffText` nema granicu ulaza (nema `MAX` konstante ni provjere u `diff.ts`); `lcs` gradi tablicu (n+1) x (m+1), pa velik ulaz znači kvadratnu memoriju. `diff.ts` je u kodu bez razmaka i bez komentara; održavaj ga čitljivim pri izmjeni, ali ne mijenjaj ponašanje bez testa.
- `fpzgCitationStyle` se učitava pri importu (`parseCitationStyle` na JSON); neispravan config ruši uvoz, ne formatiranje.
- Format koraka: ne dodavaj polje "radi praktičnosti"; svaki objekt ima zatvoren skup ključeva (`__proto__` i `constructor` su zabranjeni).
- Tekst u `schema.ts` (placeholder "Počni pisati…") podliježe skeneru zabranjenih izraza (`UI_TEXT_MODULES`); ne stavljaj tekst koji korisnik vidi u druge `.ts` datoteke editora (`findMisplacedUiText`).
- Pravilo "jedan korak iz STATE.md po PR-u, oko 400 redaka" (`CLAUDE.md`) vrijedi; `identity.ts` ima 522 retka, pa promjena ide u malim koracima.

## 8. Otvoreno

- Editor Tiptap / ProseMirror, Lokalna pohrana Dexie i stack redak nisu potvrđeni: [PRIJEDLOG D-08] u ARCHITECTURE §1 (potvrđen je samo dio D-08 o aplikaciji). Promjena biblioteke bila bi skupa; ne gradi nove ovisnosti o Tiptap internalima izvan `src/editor`.
- Granulacija koraka u commitu (korak po tipki ili spojeni) nije utvrđena prije M3 (ARCHITECTURE §5, B0.2); mijenja brojke o 6 puta. Ne optimiziraj format koraka oko pretpostavke.
- Razmak kontrolnih točaka (oko 2.000 koraka) je [PRIJEDLOG] do B0.3.
- Tehnička izvedba izravnih izmjena (D-34) potvrđena je 11. 10. 2026.; mjesto u formatu zapisa za "primijenjeni prijedlog" rezervira se jednom prije prve stvarne evidencije (BACKEND §4.1). Ne dodaj izvor "prijedlog" u `edit-step` format dok to nije zasebno odlučeno.
- Odnos D-06 i D-39 (koliko često nastavnik vidi stanje) otvoren je u Owner queue (`STATE.md`); do odluke vrijedi D-06.
- Zahtjev za doradu i "promijenjeno nakon prihvaćanja" (D-45) je val 2; kod ima samo čiste prijelaze.
- Lekta paket zamjenjuje kopiju citatnog stila u M4 (D-83); Lekta licenca je u Owner queue.
- Veliki `diffText`: granica ulaza ili diff po odlomcima nije napravljena (`STATE.md`).
