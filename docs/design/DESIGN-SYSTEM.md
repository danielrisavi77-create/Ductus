# Ductus: dizajn sustav (mjerodavno)

Verzija 1.1 · 28. 10. 2026. · issue #960

Ovo je **jedini pisani izvor** za izgled aplikacije: boje, tipografiju, oblike, razmake i pravila. Vrijednosti tokena žive u `app/globals.css`; test `src/components/shell/design-doc.test.ts` pada čim se tablica u §3 i `globals.css` raziđu. Sve druge tablice boja u repou (`docs/design/ductura/README.md` §8, slajdovi #323, stari PR-ovi) su povijest.

## 1. Redoslijed mjerodavnosti

1. Vlasničke odluke u `docs/DECISIONS.md`: **D-184** (paleta javne naslovnice je paleta cijele aplikacije; mijenja D-179 u vrijednostima), **D-185** (CSS moduli nad tokenima, mijenja D-116), **D-186** (ime Ductura), **D-187** (svijetla tema), **D-179** (struktura palete), **D-178** (Archivum paket, 21 ekran; kad se slika i prototip razlikuju, vrijedi slika), vlasnička odluka od 27. 10. 2026. o svijetloj temi (opcija (a), #923 c.6430103437, #87 c.6430104038), D-180 (S01 kao početna), D-181 (oslovljavanje s „Vi”).
2. Ovaj dokument i `app/globals.css` (moraju biti isti; to provjerava test).
3. Odobrene slike (PNG) iz Archivum paketa za raspored pojedinog ekrana.
4. Ostalo (`docs/design/ductura/*.dc.html`, slajdovi #323) samo za ponašanje i tekst gdje 1. do 3. šute; njihove boje se ne koriste.

Nepromjenjiva pravila koja paleta ne dira: WCAG 2.1 AA (D-115), boje podrijetla pokazuju odakle je tekst, nikad ocjenu (D-57), nema boje za „prekršaj” (D-62), Rječnik iz `docs/PRODUCT.md` §5.

## 2. Načela

| # | Načelo | Značenje |
|---|---|---|
| 01 | Akademski, ne „AI-tech” | Sadržaj i institucionalna ozbiljnost; suzdržan UI. |
| 02 | Evidencija, ne sumnja | Stanja opisuju proces, nikad ne ocjenjuju studenta. |
| 03 | Tamno prvo, ali pristupačno | Šljiva ljuska naslovnice je zadana; svijetla ljuska i papirnati list (papir, tinta, bakar) su izbor korisnika. |
| 04 | Isti jezik za sve uloge | Student, nastavnik i administrator dijele tokene, kartice i stanja. |
| 05 | Bakar = akcija | Primarna boja (`--accent`) samo za glavnu radnju, poveznicu i fokus. |
| 06 | Institucionalno spremno | Izgleda kao proizvod kojem fakultet povjerava podatke. |

## 3. Boje

Četiri opsega u `app/globals.css`:

- **Tamna ljuska** (`:root`, zadano; ne prati postavku sustava): paleta javne naslovnice (D-184): `--plum` `#2b1f38` tlo, `--night` `#21172c` trake, `--plum2` `#3c2a4a` odabrano i hover, `--copper` `#f0b573` primarna, tekst i crte iz imenovanih boja naslovnice.
- **Svijetla ljuska** (`[data-theme="light"]` na elementu ljuske): `--paper` `#f3ede2`, `--page` `#fffcf5`, `--ink` `#2c2130`, `--soft` `#6b5b66`, `--line` `#d1c3b7` s naslovnice (D-184, D-187).
- **Tamni list** (`.sheet`, zadano za pisanje): drži tamnu tintu i u svijetloj ljusci.
- **Papirnati list** (`.sheet[data-sheet-theme="light"]`): papir naslovnice (`#fffcf5`, tinta `#2c2130`); prekidač u editoru, izbor se čuva samo u pregledniku.

Gdje naslovnica nema boju za ulogu (upozorenje, greška, spremanje, podrijetlo, komentari, polja, kartica, dijalog), ostaje vrijednost iz D-179. Svijetli bakar naslovnice `#8f5d49` pada ispod 4,5:1 na svijetlim hover površinama (4,23 do 4,39), pa svijetla primarna ostaje `#8f4f33` (AA ima prednost, D-115). Prigušeni tekst `#ab94aa` s naslovnice je 6,2:1, pa bi bio jednak običnom tekstu; `--ink-muted` je zato `#86738c` (crta naslovnice, 3,05:1 i više).

„·” znači da opseg vrijednost nasljeđuje iz ljuske oko sebe.

<!-- tokens:start -->
| Token | Tamna ljuska | Svijetla ljuska | Tamni list | Bijeli list | Namjena |
|---|---|---|---|---|---|
| `--ground` | `#2b1f38` | `#f3ede2` | · | · | tlo aplikacije |
| `--sheet` | `#392a44` | `#ffffff` | `#392a44` | `#fffcf5` | list za pisanje |
| `--chrome` | `#21172c` | `#fffcf5` | · | · | trake, bočni paneli |
| `--ink` | `#f8f1f4` | `#2c2130` | `#f8f1f4` | `#2c2130` | glavni tekst |
| `--ink-2` | `#e1d5e2` | `#6b5b66` | `#e1d5e2` | `#6b5b66` | sekundarni tekst |
| `--ink-3` | `#d2bfcf` | `#68575e` | `#d2bfcf` | `#68575e` | tihi mali tekst (najtiši dopušteni za tekst ispod 24 px) |
| `--rule` | `#86738c` | `#d1c3b7` | `#86738c` | `#d1c3b7` | crta, obrub |
| `--rule-2` | `#75667c` | `#e8dcc8` | `#75667c` | `#f6f1e7` | tiša crta (samo linija, nikad pozadina) |
| `--hover` | `#3c2a4a` | `#efe5d2` | · | · | hover sekundarnog gumba i stavke |
| `--raised` | `#291e33` | `#f9f3e6` | · | · | dijalog, podignuta površina |
| `--raised-rule` | `#c5afc8` | `#857363` | · | · | obrub dijaloga |
| `--card` | `#33253d` | `#fffcf5` | `#33253d` | `#fffcf5` | kartica |
| `--selected` | `#3c2a4a` | `#efe3cf` | · | · | odabrana stavka, segment |
| `--well` | `#3c2a4a` | `#e8dcc8` | `#3c2a4a` | `#f1eadd` | tiha površina ispod teksta (čip, staza, hover) |
| `--ink-muted` | `#86738c` | `#68575e` | `#86738c` | `#68575e` | samo veliki tekst (24 px+) i netekstne oznake |
| `--warn` | `#e9c58b` | `#7a5420` | `#e9c58b` | `#a87420` | oznaka upozorenja |
| `--error` | `#f0a08f` | `#9c3f33` | · | · | oznaka greške |
| `--accent` | `#f0b573` | `#8f4f33` | `#f0b573` | `#8f4f33` | primarna boja: gumb, poveznica, fokus |
| `--accent-hover` | `#ffd19c` | `#7a4129` | `#ffd19c` | `#7a4129` | hover primarne |
| `--accent-ink` | `#21172c` | `#fffcf5` | `#21172c` | `#fffcf5` | tekst na primarnoj |
| `--accent-soft` | `#3c2a4a` | `#efe0cb` | `#3c2a4a` | `#8f4f331a` | meka pozadina primarne (pritisnuto) |
| `--link-rule` | `#c5afc8` | `#946446` | `#c5afc8` | `#946446` | podcrta poveznice |
| `--field` | `#2b2035` | `#fffaf2` | `#2b2035` | `#fffaf2` | pozadina polja |
| `--field-rule` | `#b09ab6` | `#857363` | `#b09ab6` | `#857363` | obrub polja |
| `--field-placeholder` | `#bca4cb` | `#6b5f56` | `#bca4cb` | `#6b5f56` | placeholder polja |
| `--error-soft` | `#402b46` | `#f7e4dd` | `#402b46` | `#f7e4dd` | pozadina greške obrasca |
| `--synced` | `#a2c6e5` | `#355b81` | · | · | stanje „spremljeno na poslužitelju” (nikad primarna) |
| `--p-internal` | `#8fb0e0` | `#4a6fa5` | · | `#4a6fa5` | podrijetlo: napisano u aplikaciji |
| `--p-unknown` | `#9e9a90` | `#6e6a62` | · | `#6e6a62` | podrijetlo: izvor nije opažen |
| `--p-template` | `#7e7a70` | `#9a9488` | · | `#9a9488` | podrijetlo: predložak |
| `--p-ai` | `#d3ac63` | `#8a6a2f` | · | `#8a6a2f` | podrijetlo: AI pomoćnik |
| `--cmt` | `#e9c58b` | `#7a5420` | `#e9c58b` | `#b8862a` | oznaka komentara |
| `--cmt-ink` | `#e9c58b` | `#7a5420` | `#e9c58b` | `#8a6420` | tekst oznake komentara |
| `--cmt-bg` | `#e9c58b26` | `#e9c58b40` | `#e9c58b26` | `#b8862a26` | pozadina komentara i obavijesti |
| `--warn-soft` | `#3a2f22` | `#f3e6cf` | · | · | meka pozadina upozorenja |
| `--synced-soft` | `#24303a` | `#e3edf6` | · | · | meka pozadina stanja spremanja |

| `--scrim` | `#0008` | · | · | · | zavjesa iza dijaloga i ladice |
<!-- tokens:end -->

**Pravila boja**

- Boja se uzima **samo preko tokena** (`var(--…)`); tvrdo upisana boja u `*.module.css` nije dopuštena, ni na javnoj naslovnici (D-184). Zavjesa iza dijaloga je `--scrim`.
- Tekst na primarnoj je uvijek `--accent-ink` (tamno: 9,7:1), nikad bijeli.
- `--ink-muted` je ispod 4,5:1: samo veliki tekst i netekstne oznake; mali tihi tekst je `--ink-3`.
- `--rule` i `--rule-2` su linije; tiha površina ispod teksta je `--well`.
- `--raised` i `--selected` su površine ljuske; ne koriste se unutar lista.
- `--synced` se nikad ne izjednačava s `--accent`; „sprema se” pulsira u primarnoj, „spremljeno na poslužitelju” je puna točka u `--synced`.
- Boje stanja na mentorskom popisu (D-128): samo stanje tijeka, uvijek uz tekst, nijedna crvena.
- Boja nikad nije jedini nositelj značenja.

## 4. Tipografija

Fontovi aplikacije su u `app/fonts` (DAN-121), s licencama OFL. Javna naslovnica smije nositi vlastite kopije istih datoteka (D-184); one moraju biti bajt-za-bajt iste kao u `app/fonts` (provjereno za #952: SHA-256 jednak), tako da je slovo svugdje isto.

| Uloga | Font | Težine | Token |
|---|---|---|---|
| Sučelje | Instrument Sans | 400 do 600 | `--ff-ui` |
| Naslovi ekrana, tekst rada | Newsreader | 400 do 500 u aplikaciji; naslovi naslovnice težina 400 | `--ff-display`, `--ff-manuscript` |
| Kod, putovnica | JetBrains Mono | 400 do 500 | `--ff-mono` |

- Tekst sučelja: osnova 13,5 px, prored 1,5; najmanje 12 px, na mobitelu (≤ 640 px) najmanje 13 px.
- Tekst rada: Newsreader 16,5 px, prored 1,7, poravnato obostrano s rastavljanjem.
- Naslovi iz paketa: `--fs-h1` 64 px, `--fs-h2` 42 px, `--fs-h3` 29 px, `--fs-h4` 25 px; prored `--heading-leading` 1,08, razmak `--heading-tracking` −0,025em. Zasad ih koriste samo novi Archivum ekrani; postojeći `.page h1` (40 px) prelazi na ljestvicu s ekranom koji ga mijenja.

## 5. Oblici, razmaci, sjene

| Token | Vrijednost | Za |
|---|---|---|
| `--radius-sm` | 4 px | odabrana stavka, gusti gumbi u trakama |
| `--radius-control` | 5 px | gumbi i polja |
| `--radius` | 6 px | paneli i kartice |
| `--radius-lg` | 10 px | dijalozi |
| `--lift` | dvostruka sjena | plutajući izbornik, list |
| `--shadow` | `0 22px 80px #0003` | velike podignute površine |
| `--focus-width` / `--focus-offset` | 3 px / 4 px | prsten fokusa |

- Tvrdo upisan radijus nije dopušten osim pilule (`999px`, `50%`).
- Ciljevi dodira: najmanje 32 px u gustim trakama, 44 px drugdje i na mobitelu.
- Fokus (s naslovnice): `var(--focus-width) solid var(--accent)` = 3 px, odmak `--focus-offset` 4 px; nijedan modul ne upisuje debljinu ni odmak izravno (test).
- Mreža stranice: najveća širina 1200 px, bočni razmak 24 px; list do 720 px.
- Prijelomne točke: 1250 px (struktura ispod lista), 1050 px (jedan stupac), 800 px (bočna traka postaje ladica), 640 px (mobitel).

## 6. Komponente

Izvedba je **CSS moduli nad tokenima iz `globals.css`**, bez Tailwinda i shadcn/ui (D-185, mijenja D-116). Tekst dolazi samo iz i18n kataloga (D-70) i oslovljava korisnika s „Vi” (D-181). Pristupačnost dijaloga i izbornika provjerava se axe testovima u e2e.

## 7. Ime i ikona

Ime proizvoda je **Ductura** (D-186; `APP_NAME` u `src/lib/i18n/messages.hr.ts`). Repozitorij, paket i identifikatori u kodu ostaju `ductus`. Znak: „Ductura” u Newsreaderu, završetak u bakru (naslovnica). Ikona (`app/favicon.ico`) još je bordo iz #898; zamjena je otvorena stavka u §8.

## 8. Stanje usklađivanja

Vlasnik je 28. 10. 2026. odlučio sva proturječja iz v1.0 (#960 c.6469934229):

| # | Bilo | Sada |
|---|---|---|
| P-1 | D-116 (Tailwind, shadcn) nije proveden | D-185: CSS moduli nad tokenima |
| P-2 | naslovnica s vlastitom paletom | D-184: paleta naslovnice je paleta aplikacije (ovaj dokument); naslovnica (#952) boje uzima preko tokena |
| P-3 | #945 radijusi 10 → 6 px | #945 zatvoren |
| P-4 | ime nije odabrano | D-186: Ductura (README) |
| P-5 | zavjesa `#0008` u modulima | token `--scrim` |
| P-6 | fokus 2 px | fokus naslovnice 3 px / 4 px |
| P-7 | bordo favicon | **otvoreno**: nova ikona (šljiva, bakreno „D”, kao na stranici lažne prijave) je binarna datoteka; ide zasebnim PR-om iz sesije s git pristupom |
| P-8 | svijetla tema samo u komentarima | D-187 |

## 9. Veza s drugim dokumentima

- Ekrani i rute: `docs/design/ductura/INTEGRACIJA.md`; Archivum ekrani: #923.
- Funkcionalni tokovi i Rječnik: `docs/PRODUCT.md`.
- Vizualna provjera PR-ova: D-183 (#949) i `docs/SESSIONS.md` §6 (#959).

## Povijest

Ništa iz ovog odjeljka se ne koristi za novi rad.

- **v0.3, 13. 10. 2026. (D-115, slajdovi #323):** teal `#14B8A6` na `#0A0F0E`, semantičke boje iz Tailwinda. Zamijenjeno D-123.
- **D-123, 17. 10. 2026. (paket Ductura):** mint `#6FBFA5` na `#0F110E` (`ductura/README.md` §8). Zamijenjeno dizajnom v3 (21. 10., #476), pa #867.
- **D-179, 26. 10. 2026. (Archivum paket, #915):** ljubičasta `#2b1f38`, trake `#21192a`, tekst `#f7f0fa`, bakar `#f0b573`. Vrijednosti koje naslovnica ima za istu ulogu zamijenjene D-184; ostale vrijede.
- **#867, 26. 10. 2026. (Archivum V3):** bordo, tlo `#19161a`, bakar `#cf9d72`. Zamijenjeno D-179 (#915); svijetla ljuska i bijeli list iz V3 zadržani.
- Mapiranje ekrana v0.3 (landing, editor, replay, predaja, pravila fakulteta, nadzorne ploče, admin, prenosivi zapis) i prioriteti premješteni su u `ductura/INTEGRACIJA.md` i issuee #325 do #342; sadržajna pravila iz toga mapiranja (npr. zabrana teksta „Nema indikacija neautentičnog autorstva”, sortiranje samo po prezimenu) i dalje vrijede preko `PRODUCT.md` i odluka.
