# Referenca editora Ductura, prototip v0.27

Ovo je dizajnerska i funkcionalna **referenca** za editor (student i nastavnik), ne kod koji se preuzima. Prototip je običan JavaScript nad Tiptapom 3.34; u repou se editor gradi u Reactu, CSS modulima i katalogu tekstova (`src/lib/i18n/messages.hr.ts`).

## Za što je referenca

- **Funkcije i ponašanje:** što editor nudi i kako se ponaša, po odlukama vlasnika na #2012 (komentar 6962604654, točke 1 do 8).
- **Izgled editora:** po odluci vlasnika od 17. 11. 2026. (#2012, komentar 6962890596) prototip v0.26 zamjenjuje v0.22 kao odobrenu vizualnu referencu editora. Paleta ostaje „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`).
- Iznimke iz iste odluke vrijede i ovdje: rječnik zabranjenih izraza (`docs/PRODUCT.md` §5), WCAG 2.2 AA (D-248) i redoslijed valova. Gdje se prototip i ta pravila razilaze, vrijede pravila.

Mapa nosi ime `editor-v027` po odluci vlasnika od 18. 11. 2026. jer su snimke, `index.html` i `editor.css` iz v0.27. Odluka odobrava v0.26; v0.27 dodaje samo modul `mentor3.js` (zapis nastanka i povijest), a za taj dio vidi „Što nije odlučeno”.

## Što je u mapi

| Datoteka | Sadržaj |
|---|---|
| `index.html`, `editor.css` | ljuska i stilovi prototipa v0.27 (tokeni prepisani iz `app/globals.css`, D-188) |
| `snimke/` | `editor-<student\|nastavnik>-<svijetla\|tamna>-<1440\|400>.png` |
| `SHA256SUMS` | kontrolni zbrojevi svih datoteka u mapi osim njega samog (`sha256sum -c SHA256SUMS`) |

Snimke: Playwright Chromium, lokalni statički poslužitelj nad cijelim prototipom, prozor 1440 × 900 i 400 × 860, DPR 1, nakon `document.fonts.ready`; „Prvi koraci” su zatvoreni. Svijetla i tamna ljuska su `data-theme="light"` i `data-theme="dark"` na `<html>`; list je u obje svijetao. Prototip pomiče sadržaj unutar svojih okvira, pa snimka pokazuje prvi zaslon, ne cijeli rad. Sadržaj je izmišljen početni primjer prototipa (Student A, Autor A, Kolegij A).

## Što nije u repou

- **JavaScript moduli prototipa** (25 datoteka, od `app.js` do `mentor3.js`) i `vendor/` (Tiptap, pdf.js, KaTeX, hrvatski rječnik za provjeru pravopisa). Izostavljeni su iz opreza, po presedanu odluke #2012 c.6959360865 za #2026: CI skenira cijeli repo Semgrepom, a ovi moduli njime nisu skenirani. Vendor datoteke su tuđi kod s licencama koje ovdje nisu provjerene. Zato se `index.html` iz repoa ne može sam pokrenuti; pregled daju snimke, a cijeli paket je kod vlasnika.
- `rules/unizg.json` (vrijednosti iz Lektina paketa): uvoz ide samo kroz Lekta sesiju (D-217, D-224). Snimke su napravljene s tom datotekom, pa kartica „Zahtjevi rada” pokazuje naziv „FPZG · opći akademski rad” i broj stavki; pojedinačne vrijednosti pravila na snimkama se ne vide.
- `samples/`: dugi primjer rada nije u paketu ni u repou (`CLAUDE.md`, tvrda pravila).
- `index.html` učitava fontove s Google Fontsa; u izvedbi se koriste fontovi iz repoa.

## Što nije odlučeno

- **Zapis nastanka i ritam tipkanja (`mentor3.js`, v0.27):** prijedlog, nije odluka. Ritam tipkanja proturječi `docs/PRODUCT.md` §5 pravilu 4 (iz vremena se nikad ne računa brzina, pauze ni ritam) i ne smije se graditi bez nove odluke vlasnika.
- **Mentorski dio:** prijedlog; nije isproban ni s jednim mentorom. Granice su `docs/PRODUCT.md` §5 pravila 5 i 7 (D-130, D-142, D-143).
- **Prijevod sažetka:** bilješke prototipa kažu da prijevod radi tek kad fakultet uključi AI; odluka c.6962890596 (t. 7) kaže da aplikacija prevodi sama. Vrijedi odluka.
- Odluke 9 do 14 iz predaje „Stranice, struka, fakultet” još nisu zapisane na #2012 i ova ih mapa ne uvodi.
- Pragovi, omjeri i tekstovi savjeta u prototipu napisani su bez provjere sa studentima i nastavnicima.

## Rječnik

U `index.html` i `editor.css` nema zabranjenih izraza u tekstu sučelja. `editor.css` u komentaru ima riječ „prepisani” (o tokenima) i CSS svojstvo `hidden`; to nije tekst koji korisnik čita. Na snimkama stoji „Spremljeno na ovom uređaju”, što rječnik dopušta.
