# Ductus: ljuska sučelja, tekstovi i zabranjeni izrazi

Ako se ovaj vodič i dokument ili kod razilaze, vrijedi dokument odnosno kod; nesklad prijavi u IZVJEŠTAJU.

Vodič je karta, ne izvor pravila. Pravila su u `docs/PRODUCT.md` §3, §5 (s "Rječnikom sučelja") i §6, `docs/UX-EVAL.md`, `docs/TESTING.md` §2, `CLAUDE.md` ("Jezik", "Tvrda pravila"), `docs/DECISIONS.md` (D-70, D-84, D-89, D-90 t. 3, D-62, D-105) i `.claude/rules/sucelje.md`. Prije rada pročitaj `STATE.md`.

## 1. Kada koristiti

PR dira `app/**` (osim `app/api/**`, to je prijava), `src/components/**`, `src/lib/i18n/**`, `scripts/forbidden-terms/**`, `app/globals.css`, `app/fonts/**`, bilo koji tekst koji korisnik vidi ili oznake stanja spremanja (`src/domain/sync/labels.ts`). `config/` danas sadrži samo `config/faculties/fpzg/citation.json` (citatni stil, nije konfiguracija sučelja; vidi vodič `docs/vodici/editor-i-dokument.md`).

Uz ovaj vodič primjenjuju se (`.claude/skills/`):
- `ductus-ui-copy`: popis provjera prije predaje svakog PR-a s tekstom sučelja;
- `ductus-sync-states` kad se dira oznaka spremanja ili uvjet za "spremljeno na poslužitelju";
- `ductus-synthetic-data` za primjere u UI-ju (demo označava izmišljene podatke);
- `ductus-browser-cli` za pregled u pravom pregledniku, `ductus-product-ux` za procjenu tokova.
- `docs/vodici/prijava.md` za `app/api/auth/**` i tekstove `messages.auth` povezane s prijavom (prijava je isključivo AAI@EduHr, D-09; `app/api/auth/**` je `critical` po putanji).

Pravilo `.claude/rules/sucelje.md` učitava se samo za putanje: `app/**/*.tsx`, `app/**/*.css`, `src/components/**`, `src/lib/i18n/**`, `**/labels.ts`, `**/messages.ts`, `src/editor/schema.ts`.

## 2. Karta

Implementirano na `main` (ARCHITECTURE §0.1: stanje dokazuje kod, ne dokument). Aplikacija ima dvije stranice i tri API rute prijave; nema ekrana zadatka, obavijesti o praćenju, nastavničkog popisa ni sažetka procesa. Ti su ekrani planirani (PRODUCT §6, PLAN-DEMO), ne postoje.

### Rute (`app/`, Next.js 15 App Router, React 19)
- `app/layout.tsx`: korijenski layout, `<html lang="hr">`, klase varijabli fontova, `skip-link` prema `#sadrzaj`, uvozi `fonts/fonts.css` i `globals.css`. `metadata.title` iz kataloga.
- `app/page.tsx` (`/`): početna s `AppHeader`, naslov, `tagline`, `home.lead` i `Link` na `/rad`.
- `app/rad/page.tsx` (`/rad`): prazan radni prostor u `WorkspaceShell`. Slotovi: `rail` (RailSection Struktura, Popis tablica, Fusnote), `panel`, `status` (`wordsHr(0)`). List je `role="textbox"` s `aria-disabled="true"`, tekst kaže da pisanje još nije moguće. Editor se montira u zadatku F-8; nastavnički pogled (`teacherViewHref`) nema adresu, pa je gumb vidljivo onemogućen s oznakom "uskoro".
- `app/api/auth/{login,callback,logout}/route.ts`: tanke rute oko `@/server/auth/*`. Nisu dio ovog vodiča (vodič `docs/vodici/prijava.md`).
- `app/globals.css` (620 redaka): tokeni dizajna v6 (D-89) kao CSS varijable u `:root`, tamna tema preko `prefers-color-scheme` (i `data-theme`), raspored ljuske, `:focus-visible`, `.skip-link`, prelom na 1100 px, 640 px, `prefers-reduced-motion`.
- `app/fonts/`: `index.ts` (šest `next/font/local` poziva: Instrument Sans za sučelje, Newsreader za naslove, JetBrains Mono; po obitelji `latin` i `latin-ext` s `unicode-range`; izvozi `fontVariables`), `fonts.css` (spaja varijable i fallback lica s metričkim prilagodbama), `*.woff2`, `OFL-*.txt`, `SOURCE.md` (porijeklo, SHA-256, licence). Fontovi su datoteke u repou, build ne koristi mrežu (DAN-121).

### Komponente (`src/components/`)
- `shell/WorkspaceShell.tsx`: radni prostor v6: traka 46 px, lijeva tračnica 236 px, list do 756 px, desna tračnica 322 px, statusna traka 34 px (komentar u datoteci). Propovi: `context`, `mode` (`"writing" | "teacher-view"`), `writingHref`, `teacherViewHref`, `barExtra`, `banner`, `rail`, `panel`, `status`, `children`. Izvoz `RailSection`. `ModeLink` bez adrese je `button` s `aria-disabled="true"` koji ostaje u Tab redoslijedu.
- `shell/ShellRail.tsx` (`"use client"`): tračnica; ispod 1100 px je odjeljak ispod lista koji se otvara pravim gumbom (`aria-expanded`, `aria-controls`); na širokom ekranu gumb se ne prikazuje (CSS). Redoslijed DOM-a je isti na svim širinama: list (`main`), upute, struktura.
- `shell/AppHeader.tsx`: gornja traka jednostavnih ekrana (brand, `context`, `end`, oznaka demoa).
- `fonts/woff2-codepoints.ts` i `fonts/local-fonts.test.ts`: test čita `unicode-range` iz `app/fonts/index.ts` i provjerava ga prema glifovima u datotekama (hrvatska slova moraju doći iz samog fonta).

### Tekstovi (`src/lib/i18n/`)
- `messages.hr.ts`: jedini katalog teksta sučelja. Objekt `hr` (`app`, `shell`, `home`, `workspace`, `auth`), tip `Messages` (proširuje literale na `string`), izvoz `messagesHr`. Komponente ga uvoze kao `t`. Za engleski (D-70) se predviđa druga tablica istog oblika (`messages.en.ts`; ne postoji).
- `hr.ts`: pravila hrvatskog bez `Intl`: `formatDateHr`, `formatDateTimeHr` (genitiv mjeseca, 24 h, lokalno vrijeme izvođenja), `pluralHr`, `countHr`, `wordsHr`, `blocksHr`, `projectsHr`, `checkpointsHr`, `partsHr`, `problemsHr`. Razlog: ICU se razlikuje između okruženja, a brojevi imaju tri oblika.
- `messages.test.ts`: katalog nema prazan tekst, nijednu riječ iz rječnika (korijeni, npr. `sumnj`, `rizik`, `postot`), ne ponavlja tekstove stanja spremanja iz `@/domain/sync/labels` i nikad ne kaže samo "spremljeno". `hr.test.ts`: oblici datuma i množine.
- Oznake osam stanja spremanja i poruka o više kartica stoje uz automat stanja u `src/domain/sync/labels.ts` (`SYNC_STATE_LABELS`, `MULTI_TAB_BLOCKED_MESSAGE`), ne u katalogu.

### Skener zabranjenih izraza (`scripts/forbidden-terms/`)
- `terms.ts`: `FORBIDDEN_TERMS` (po jedan unos za svaki redak "Ne koristiti nikad" iz PRODUCT §5, hrvatski i engleski ekvivalenti, `lang: "hr" | "en"`), `findForbiddenTerms`, `findForbiddenTermsInMarkup`. Poklapanje ide na složenom tekstu (NFKC, mala slova, bez dijakritika, bez nevidljivih znakova, interpunkcija kao razmak). Unos "spremljeno" je kontekstualan: dopušteno samo uz "na uređaju" ili "na poslužitelju".
- `entities.ts`: dekodiranje HTML entiteta kako ga JSX dekodira (253 imena XHTML 1.0).
- `scan.ts`: `scanUiText(root)`, `findUnreadSourceFiles`, `findUnreadableText`, `findMisplacedUiText`, `UI_TEXT_MODULES`, `isUiTextModule`.
- Pokreće ga test `tests/unit/forbidden-terms.test.ts` (projekt `unit`), ne zasebna naredba; "finds no forbidden term in the interface text of this repository" skenira stvarni repo.

### Što skener čita (`scan.ts`)
Skenira samo `app/` i `src/` (preskače `node_modules`, `.next`, `*.test.*`, `*.spec.*`, `*.d.ts`).
- Moduli s tekstom (`UI_TEXT_MODULES`): `src/lib/i18n/**`, `**/labels.ts`, `**/messages.ts`, `**/copy.ts`, `src/editor/schema.ts`, `app/**/manifest.ts`: svaki string se provjerava protiv cijelog rječnika. JSON katalozi pod `src/lib/i18n/**`, statički manifesti pod `app/**` i `.json` koji skeniran kod uvozi čitaju se isto.
- `.tsx` pod `app/` i `src/`: JSX tekst, stringovi koji se iscrtavaju, svaki JSX atribut koji nije na `TECHNICAL_ATTRIBUTES`, Next.js metapodaci (`metadata`, `generateMetadata`), te sadržaj elementa kao jedan tekst (fraza razdvojena inline oznakama se i dalje nalazi; `PHRASE_BREAK` je kraj fraze).
- Ostali `.ts`/`.tsx`: samo hrvatski unosi (kod je engleski, pa `hidden`, `saved`, `risk` ne smetaju u SQL-u i logovima). Ostali `.ts` pod `app/`: samo metapodaci.
- `findMisplacedUiText` prijavljuje hrvatski tekst (slovo č ć đ š ž i razmak ili veliko početno slovo) u `.ts` modulu koji nije na popisu; `findUnreadSourceFiles` pada na `.js/.jsx/.mjs/.cjs/.mdx` pod `app/` i `src/`. Popravak je uvijek premjestiti tekst u popisani modul ili proširiti popis, nikad izuzeće po datoteci ("This is the only list: there are no exemptions per file or per finding").
- Skener ne čita `docs/`, `e2e/`, `tests/`, `scripts/` ni `config/`.
- Rječnik je čitan usko: ne pokriva druge oblike participa, drugi red riječi ni sinonime; proširenje rječnika je odluka vlasnika (komentar u `terms.ts`, DAN-134).

## 3. Tok teksta i stranice

1. Ruta ili komponenta uvozi `messagesHr as t` iz `@/lib/i18n/messages.hr` i piše `{t.workspace.title}`; nikad doslovni hrvatski u JSX-u (D-84: tekstovi u ključevima od prvog dana).
2. Brojevi i datumi idu kroz `hr.ts` (`wordsHr(n)`, `formatDateTimeHr(iso)`), nikad `Intl.DateTimeFormat`.
3. Stanje spremanja dolazi iz `SYNC_STATE_LABELS` uz automat; "spremljeno na poslužitelju" smije se prikazati tek uz potpisanu potvrdu (ARCHITECTURE §5 t. 5; PRODUCT §5 pravilo 10 za offline oznaku).
4. Test `messages.test.ts` i skener u CI-ju dokazuju da tekst ne sadrži zabranjene izraze; `local-fonts.test.ts` da fontovi pokrivaju hrvatska slova.
5. Strukturu i pristupačnost dokazuju e2e specovi: `e2e/shell.spec.ts` (raspored, redoslijed DOM-a i Tab-a, skip link, ciljevi, minimalna veličina teksta), `e2e/accessibility.spec.ts` (axe WCAG 2.1 AA, svijetla i tamna shema, `/` i `/rad`, i `/rad` pri 390 px s otvorenim tračnicama), `e2e/home.spec.ts`, `e2e/screenshots.spec.ts` (snimke za PR).

## 4. Invarijante

1. Prijava studenata isključivo AAI@EduHr (D-09; `CLAUDE.md`). U sučelju ne dodaj drugi način prijave, ni privremeno. Test: `e2e/auth.spec.ts` (odbijanje lažnog pružatelja u produkcijskom buildu).
2. Tekst sučelja na hrvatskom, kod i identifikatori na engleskom (`CLAUDE.md` "Jezik"; D-84). Izravni hrvatski tekst izvan kataloga: uređivanje odgođeno do engleskog (D-70 dopuna 11. 10. 2026.) i nije poseban zadatak, ali hrvatski i rječnik ostaju obvezni.
3. Izrazi iz lijevog stupca Rječnika ne smiju se pojaviti u sučelju, ni engleski ekvivalenti (PRODUCT §5; D-90 t. 3). Test: `tests/unit/forbidden-terms.test.ts`, `src/lib/i18n/messages.test.ts`.
4. Nema postotka AI-ja, postotka ljudskosti, ocjene rizika, sumnje ni integriteta (PRODUCT §5 pravilo 2) ni tvrdnje tko je napisao rad (pravilo 1; D-01). Nema oznaka ni boja upozorenja za studenta (PRODUCT §6 Nastavnik, t. 4: "Bez oznaka, boja upozorenja ili sortiranja po 'sumnjivosti'"); nema `--breach` boje (D-62; komentar u `globals.css`). Boje podrijetla pokazuju odakle je tekst, ne presudu.
5. Nastavnički prikaz ostaje samo opisni: bez postotaka i bez zaključka o autorstvu (D-105 t. 1; PRODUCT §5 pravilo 2 i D-01 se ne mijenjaju). Nepoznato nije krivnja: praznina u zapisu je "praznina u zapisu" (pravilo 3). Praznina i "lijepljenje bez poznatog izvora" ne smiju se ni naslućivati kao rang ili bodovi (UX-EVAL §3 i §5: broj događaja nije risk score; ako nastavnici počnu mentalno rangirati studente po broju, prikaz se mora promijeniti).
6. Student vidi točno ono što nastavnik vidi, istom funkcijom (pravilo 5); obavijest o praćenju je prvi ekran svakog zadatka (pravilo 6; PRODUCT §6 Student t. 3). Obavijest nije privola i ne smije se tako prikazivati. Nastavnički pogled i obavijest još nisu implementirani; na `/rad` je pogled "Kako vidi nastavnik" onemogućen.
7. Oznake spremanja doslovno: "spremljeno na uređaju" / "spremljeno na poslužitelju" / "predano"; nikad goli "spremljeno" (Rječnik; `messages.test.ts` "never says a bare spremljeno"). Jedan dom teksta stanja: `src/domain/sync/labels.ts`; katalog ga ne ponavlja. Offline oznaka ostaje i nakon sinkronizacije (pravilo 10).
8. Nastavnik vidi trenutno spremljeno stanje, ne tipkanje uživo; student o tome zna (pravilo 7). Sučelje ne smije sugerirati živi nadzor (UX-EVAL §3: "trenutno spremljeno stanje = live nadzor" je UX bug).
9. Sučelje je bez izvršavanja sadržaja radova na poslužitelju (D-74: bez server-side renderiranja sadržaja; ARCHITECTURE §1). Sadržaj rada se ne renderira u Server Component-u.
10. Pristupačnost: cilj WCAG 2.1 AA (FEATURES F-03); ciljevi dodira najmanje 32 px u gustim trakama i 44 px drugdje (`globals.css` komentar, D-89 odstupanja); drugi tekst `#5A605A` zbog kontrasta; vidljiv fokus (`:focus-visible`); skip link kao prvi Tab stop; DOM, Tab i redoslijed čitanja jedno te isto; tamna tema ima vlastite tokene i ispituje se zasebno. Test: `e2e/accessibility.spec.ts`, `e2e/shell.spec.ts`.
11. Onemogućena kontrola ostaje u Tab redoslijedu i kaže da nije dostupna (`aria-disabled`), nikad poveznica koja vodi nikamo (komentar `WorkspaceShell`).
12. Svako pravilo iz PRODUCT §5 ima test ili provjeru u PR-u (PRODUCT §5 uvod; `ductus-ui-copy` t. 5).
13. Fontovi se učitavaju iz repoa, ne s mreže; `next/font/local` zahtijeva doslovne argumente pa se `unicode-range` ponavlja u `index.ts` i provjerava testom (`local-fonts.test.ts`).
14. Demo označava izmišljene podatke: oznaka "Demo · izmišljeni podaci" u zaglavlju (`shell.demoBadge`). Ne ubacuj stvarne studentske radove ni osobne podatke (`CLAUDE.md`).

## 5. Kako napraviti promjenu

Razine rizika (`docs/ENGINEERING_SYSTEM.md` §5): copy bez promjene značenja je `low`; frontend ponašanje je `standard`; tekst koji dira pravilo iz PRODUCT §5 ili sam `scripts/forbidden-terms` je `critical` (automatski floor: "forbidden-terms gate", `PRODUCT.md`; `.claude/rules/sucelje.md`). Promjene u `tests/` (uključujući `tests/unit/forbidden-terms.test.ts`) su `critical`. `app/api/**` s auth segmentima je `critical`. Putanje D-97 (`.claude/`, `.github/`, `CLAUDE.md` ...) ne mijenjaš iz ovog područja.

### a) Novi ili izmijenjen tekst sučelja
1. Dodaj ključ u `hr` u `src/lib/i18n/messages.hr.ts`, u skupinu po ekranu; tip `Messages` se izvodi sam. Ne piši hrvatski u JSX.
2. Provjeri da riječ nije u Rječniku (PRODUCT §5), uključujući engleski ekvivalent.
3. Ako je to stanje spremanja, mijenja se `src/domain/sync/labels.ts` uz `ductus-sync-states`, ne katalog.
4. Prođi `ductus-ui-copy` (stavke 1 do 9).
5. Dokaži pokrivenost: privremeno, bez commita, upiši riječ iz Rječnika u novu datoteku i potvrdi da `pnpm exec vitest run --project unit tests/unit/forbidden-terms.test.ts` pada. Ako datoteka nije na popisu skenera, to upiši u "Otvoreno ili blokira" i ne tvrdi pokrivenost.
6. Dodaj ili proširi test koji veže formulaciju uz datoteku u kojoj tekst stoji.

### b) Nova stranica ili ruta
1. Datoteka `app/<ruta>/page.tsx`; tekstovi u katalogu; `metadata.title` iz kataloga.
2. Koristi `AppHeader` (jednostavni ekrani) ili `WorkspaceShell` (radni prostor). Landmark `main` ima `id="sadrzaj"` i `tabIndex={-1}` jer na njega vodi skip link.
3. Dodaj red u `PAGES` u `e2e/accessibility.spec.ts` ("Every page added later gets a row here") i u `e2e/screenshots.spec.ts`; po potrebi `e2e/shell.spec.ts`.
4. Putanja mora biti unutar `app/` ili `src/` da je skener čita. Server Component ne smije renderirati sadržaj rada (D-74).
5. PR prilaže Playwright snimke (široko i mobilno, hr; `docs/SESSIONS.md` §6 t. 2). Frontend se gradi samo po odobrenom dizajnu (D-89).

### c) Nova komponenta ljuske
1. Pod `src/components/shell/`; stil u `app/globals.css` s postojećim tokenima (nema novih boja izvan tokena; tamna tema dobiva vlastite vrijednosti).
2. Klijentska komponenta samo kad treba stanje (`"use client"`, kao `ShellRail`).
3. Ne mijenjaj redoslijed DOM-a: list, upute, struktura. Provjeri `e2e/shell.spec.ts` na 1440, 1000 i 390 px.
4. Cilj dodira 32 ili 44 px, vidljiv fokus, `aria-*` kao u postojećim komponentama.

### d) Nova datoteka s tekstom izvan kataloga
1. Preferiraj katalog. Ako nužno novi `.ts` modul s tekstom, imenuj ga `labels.ts`, `messages.ts` ili `copy.ts`, ili dodaj obrazac u `UI_TEXT_MODULES` u `scan.ts` (to je `critical`: forbidden-terms gate).
2. Test u `tests/unit/forbidden-terms.test.ts` koji dokazuje da je novi modul skeniran.

### e) Promjena rječnika ili skenera
1. Proširenje rječnika je odluka vlasnika (komentar `terms.ts`, DAN-134) i `critical` je; stani i dodaj pitanje u Owner queue ako rječnik u PRODUCT §5 nije ažuriran.
2. Svaki unos u `FORBIDDEN_TERMS` ima `entry` točno kao u PRODUCT §5, `instead`, `lang` i obrazac literal (nema `RegExp` iz stringova).
3. Dodaj pozitivne i negativne slučajeve u `tests/unit/forbidden-terms.test.ts`, uz test koji pada kad se zaštita makne (TESTING §5).

### f) Font
1. Nova datoteka mora imati zapis u `app/fonts/SOURCE.md` (izvor, SHA-256, licenca, OFL tekst) i poziv u `index.ts`; `local-fonts.test.ts` mora proći. Build ne smije trebati mrežu.

## 6. Provjera

Naredbe iz `package.json`:
- `pnpm test:unit` (cijelo područje); samo ovo područje: `pnpm exec vitest run --project unit tests/unit/forbidden-terms.test.ts src/lib/i18n src/components`.
- `pnpm typecheck`, `pnpm lint` (`eslint .`), `pnpm build`.
- `pnpm test:e2e` (Playwright, `playwright.config.ts`): `shell`, `accessibility`, `home`, `screenshots`. Politika preglednika (TESTING §2): Chromium za svaki frontend/E2E PR; Firefox i WebKit za editor, sync, journal, clipboard, auth, predaju; za demo K-4 do 1. 11. obvezan je samo Chromium (D-98 dopuna), Firefox i WebKit su informativni. Mobilni viewport je dodatak, ne zamjena za WebKit.
- `pnpm test:e2e:login` samo za puni tok prijave (nad `next dev`, Chromium).
CI: posao "Lint, typecheck, test and build" (`.github/workflows/ci.yml`) vrti lint, typecheck, `test:unit` (uključuje skener), `test:property`, `build`. E2E, axe i snimke su u poslu "Local stack (compose.yaml)".

## 7. Zamke

- Tekst u `.tsx` izvan kataloga skener čita, ali to ne čini taj tekst legalnim: D-84 traži ključeve. Uređivanje postojećeg izravnog teksta nije poseban zadatak do engleskog (D-70), ali novi tekst ide u katalog.
- Katalog ne smije ponoviti tekstove iz `labels.ts` (test "does not repeat the save-state wording"); ni u malim slovima.
- Skener čita svaki string u popisanom modulu, pa u `src/editor/schema.ts` i sličnim ne stavljaj tehničke stringove s rječničkim riječima. Obrnuto: NUL se u `storable-text.ts` gradi s `String.fromCodePoint(0)` jer skener čita svaki string (#223).
- Engleski unosi `hidden`, `saved`, `risk` ne pogađaju kod izvan popisanih modula, ali hrvatski unosi pogađaju svaki string u `.ts`/`.tsx` pod `app/` i `src/`.
- `sumnj` i `rizik` poklapaju se kao dio riječi; prezimena na "-rizić" ili "-rizik" (npr. izmišljeno "Brizić") su lažno pozitivni i rješavaju se jedan po jedan (komentar `terms.ts`).
- Datoteke `.js/.jsx/.mjs/.cjs/.mdx` pod `app/` i `src/` ruše test (`findUnreadSourceFiles`); piši `.ts`/`.tsx`.
- Testne datoteke i `.d.ts` se ne skeniraju, pa skenirani fajl ne smije uvoziti testni modul (`findUnreadableText`).
- `ModeLink` bez adrese mora ostati gumb s `aria-disabled`; ne pretvaraj ga u `<a href="#">`.
- `main:focus { outline: none }` namjerno je samo na `main` (skip link); svaka kontrola zadržava svoj fokus.
- Datumi se prikazuju u lokalnom vremenu izvođenja, ne u Europe/Zagreb (komentar `hr.ts`); za pravno relevantno vrijeme ARCHITECTURE §3 traži sat baze i zonu Europe/Zagreb pa to ne rješavaj `hr.ts` funkcijama bez odluke.
- Zaslonski prikaz sadržaja studentskog rada u testovima: samo izmišljen tekst (`ductus-synthetic-data`).
- Veličina PR-a: oko 400 redaka i jedan korak iz `STATE.md` (`CLAUDE.md`); `globals.css` je velik, pa mijenjaj ciljano.

## 8. Otvoreno

- Engleski (D-70/D-84): `messages.en.ts` ne postoji; `e2e/screenshots.spec.ts` ima `LOCALES = ["hr"]`. Do uvođenja engleskog nema posebnog zadatka za izravni hrvatski tekst.
- Nastavnički prikaz (PRODUCT §6) i obavijest o praćenju nisu izgrađeni; D-105 ograničava nastavnički prikaz na opisni. Odnos D-06 i D-39 (koliko često nastavnik vidi stanje) je u Owner queue (`STATE.md`); do odluke vrijedi D-06. Ne gradi sučelje na D-39.
- Odnos D-105 ("zasad se ništa ne reže") prema već primijenjenom rezu iz D-98 dopune (a) je u Owner queue; ne vraćaj taj rez bez nove odluke.
- Dizajn: D-89 (dizajn v6) je ODLUČEN; ekrani koji nisu u njemu (npr. nastavnička lista) traže odobrenje prije gradnje (`docs/SESSIONS.md` §6 t. 1).
- Rječnik zabranjenih izraza: proširenje i uža pokrivenost (DAN-134) su odluka vlasnika.
- Konačno ime proizvoda je u Owner queue (`STATE.md`); ne ugrađuj ga kao konačno u tekstove dok nije odlučeno (trenutno `app.name` je "Ductus").
- Stack redak "Sučelje: App Router, React, TypeScript" ima status PRIJEDLOG unutar D-08 (ARCHITECTURE §1); Next.js sam je ODLUČEN.
- Pilotni uvjeti pristupačnosti: puni acceptance path na Chromiumu, Firefoxu i WebKitu prije pilota (TESTING §2); izjava o pristupačnosti i vanjski pregled su F-03, nisu napravljeni.
