# Ductus: dizajn sustav (mjerodavno)

Verzija 1.0 · 28. 10. 2026. · issue #960

Ovo je **jedini pisani izvor** za izgled aplikacije: boje, tipografiju, oblike, razmake i pravila. Vrijednosti tokena žive u `app/globals.css`; test `src/components/shell/design-doc.test.ts` pada čim se tablica u §3 i `globals.css` raziđu. Sve druge tablice boja u repou (`docs/design/ductura/README.md` §8, slajdovi #323, stari PR-ovi) su povijest.

## 1. Redoslijed mjerodavnosti

1. Vlasničke odluke u `docs/DECISIONS.md`: **D-179** (paleta), **D-178** (Archivum paket, 21 ekran; kad se slika i prototip razlikuju, vrijedi slika), vlasnička odluka od 27. 10. 2026. o svijetloj temi (opcija (a), #923 c.6430103437, #87 c.6430104038), D-180 (S01 kao početna), D-181 (oslovljavanje s „Vi”).
2. Ovaj dokument i `app/globals.css` (moraju biti isti; to provjerava test).
3. Odobrene slike (PNG) iz Archivum paketa za raspored pojedinog ekrana.
4. Ostalo (`docs/design/ductura/*.dc.html`, slajdovi #323) samo za ponašanje i tekst gdje 1. do 3. šute; njihove boje se ne koriste.

Nepromjenjiva pravila koja paleta ne dira: WCAG 2.1 AA (D-115), boje podrijetla pokazuju odakle je tekst, nikad ocjenu (D-57), nema boje za „prekršaj” (D-62), Rječnik iz `docs/PRODUCT.md` §5.

## 2. Načela

| # | Načelo | Značenje |
|---|---|---|
| 01 | Akademski, ne „AI-tech” | Sadržaj i institucionalna ozbiljnost; suzdržan UI. |
| 02 | Evidencija, ne sumnja | Stanja opisuju proces, nikad ne ocjenjuju studenta. |
| 03 | Tamno prvo, ali pristupačno | Ljubičasta tamna ljuska je zadana; svijetla ljuska (papir i bakar) i bijeli list su izbor korisnika. |
| 04 | Isti jezik za sve uloge | Student, nastavnik i administrator dijele tokene, kartice i stanja. |
| 05 | Bakar = akcija | Primarna boja (`--accent`) samo za glavnu radnju, poveznicu i fokus. |
| 06 | Institucionalno spremno | Izgleda kao proizvod kojem fakultet povjerava podatke. |

## 3. Boje

Četiri opsega u `app/globals.css`:

- **Tamna ljuska** (`:root`, zadano; ne prati postavku sustava): ljubičasta iz Archivum paketa (D-179).
- **Svijetla ljuska** (`[data-theme="light"]` na elementu ljuske): papir i bakar (odluka 27. 10., opcija (a)).
- **Tamni list** (`.sheet`, zadano za pisanje): drži tamnu tintu i u svijetloj ljusci.
- **Bijeli list** (`.sheet[data-sheet-theme="light"]`): prekidač u editoru, izbor se čuva samo u pregledniku.

„·” znači da opseg vrijednost nasljeđuje iz ljuske oko sebe.

<!-- tokens:start -->
| Token | Tamna ljuska | Svijetla ljuska | Tamni list | Bijeli list | Namjena |
|---|---|---|---|---|---|
| `--ground` | `#2b1f38` | `#f6efdf` | · | · | tlo aplikacije |
| `--sheet` | `#392a44` | `#ffffff` | `#392a44` | `#ffffff` | list za pisanje |
| `--chrome` | `#21192a` | `#fcf7ec` | · | · | trake, bočni paneli |
| `--ink` | `#f7f0fa` | `#332a27` | `#f7f0fa` | `#2a2321` | glavni tekst |
| `--ink-2` | `#cdb3df` | `#5f544d` | `#cdb3df` | `#5f544d` | sekundarni tekst |
| `--ink-3` | `#bca4cb` | `#6b5f56` | `#bca4cb` | `#6b5f56` | tihi mali tekst (najtiši dopušteni za tekst ispod 24 px) |
| `--rule` | `#765588` | `#d9cbb5` | `#765588` | `#e3dccf` | crta, obrub |
| `--rule-2` | `#664774` | `#e8dcc8` | `#664774` | `#f6f1e7` | tiša crta (samo linija, nikad pozadina) |
| `--hover` | `#483250` | `#efe5d2` | · | · | hover sekundarnog gumba i stavke |
| `--raised` | `#291e33` | `#f9f3e6` | · | · | dijalog, podignuta površina |
| `--raised-rule` | `#bc92d0` | `#857363` | · | · | obrub dijaloga |
| `--card` | `#33253d` | `#fffaf1` | `#33253d` | `#fffaf1` | kartica |
| `--selected` | `#3e294a` | `#efe3cf` | · | · | odabrana stavka, segment |
| `--well` | `#3e294a` | `#e8dcc8` | `#3e294a` | `#f1eadd` | tiha površina ispod teksta (čip, staza, hover) |
| `--ink-muted` | `#94729f` | `#6b5f56` | `#94729f` | `#6b5f56` | samo veliki tekst (24 px+) i netekstne oznake |
| `--warn` | `#e9c58b` | `#7a5420` | `#e9c58b` | `#a87420` | oznaka upozorenja |
| `--error` | `#f0a08f` | `#9c3f33` | · | · | oznaka greške |
| `--accent` | `#f0b573` | `#8f4f33` | `#f0b573` | `#8f4f33` | primarna boja: gumb, poveznica, fokus |
| `--accent-hover` | `#ffd09a` | `#7a4129` | `#ffd09a` | `#7a4129` | hover primarne |
| `--accent-ink` | `#201526` | `#fcf7ec` | `#201526` | `#ffffff` | tekst na primarnoj |
| `--accent-soft` | `#3e294a` | `#efe0cb` | `#3e294a` | `#8f4f331a` | meka pozadina primarne (pritisnuto) |
| `--link-rule` | `#a681b9` | `#946446` | `#a681b9` | `#946446` | podcrta poveznice |
| `--field` | `#2b2035` | `#fffdf8` | `#2b2035` | `#fffdf8` | pozadina polja |
| `--field-rule` | `#9c76b0` | `#857363` | `#9c76b0` | `#857363` | obrub polja |
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
<!-- tokens:end -->

**Pravila boja**

- Boja se uzima **samo preko tokena** (`var(--…)`); nova tvrdo upisana boja u `*.module.css` nije dopuštena. Iznimka su zavjese dijaloga (`#0008`) dok ne dobiju token (§8, P-5).
- Tekst na primarnoj je uvijek `--accent-ink` (tamno: 9,7:1), nikad bijeli.
- `--ink-muted` je ispod 4,5:1: samo veliki tekst i netekstne oznake; mali tihi tekst je `--ink-3`.
- `--rule` i `--rule-2` su linije; tiha površina ispod teksta je `--well`.
- `--raised` i `--selected` su površine ljuske; ne koriste se unutar lista.
- `--synced` se nikad ne izjednačava s `--accent`; „sprema se” pulsira u primarnoj, „spremljeno na poslužitelju” je puna točka u `--synced`.
- Boje stanja na mentorskom popisu (D-128): samo stanje tijeka, uvijek uz tekst, nijedna crvena.
- Boja nikad nije jedini nositelj značenja.

## 4. Tipografija

Fontovi se poslužuju samo iz `app/fonts` (DAN-121), s licencama OFL.

| Uloga | Font | Težine | Token |
|---|---|---|---|
| Sučelje | Instrument Sans | 400 do 600 | `--ff-ui` |
| Naslovi ekrana, tekst rada | Newsreader | 400 do 500 (sintetski bold se ne koristi) | `--ff-display`, `--ff-manuscript` |
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

- Tvrdo upisan radijus nije dopušten osim pilule (`999px`, `50%`).
- Ciljevi dodira: najmanje 32 px u gustim trakama, 44 px drugdje i na mobitelu.
- Fokus: `2px solid var(--accent)`, odmak 2 px (paket ima 4 px, vidi §8, P-6).
- Mreža stranice: najveća širina 1200 px, bočni razmak 24 px; list do 720 px.
- Prijelomne točke: 1250 px (struktura ispod lista), 1050 px (jedan stupac), 800 px (bočna traka postaje ladica), 640 px (mobitel).

## 6. Komponente

Izvedba je **CSS moduli nad tokenima iz `globals.css`**, bez Tailwinda i shadcn/ui (vidi §8, P-1). Tekst dolazi samo iz i18n kataloga (D-70) i oslovljava korisnika s „Vi” (D-181). Pristupačnost dijaloga i izbornika provjerava se axe testovima u e2e.

## 7. Ime i ikona

U sučelju je ime **Ductura** (`APP_NAME` u `src/lib/i18n/messages.hr.ts`); repozitorij i kod se zovu Ductus. Konačno ime je i dalje vlasnikova stavka (`STATE.md`, Owner queue), vidi §8, P-4.

## 8. Otvorena proturječja (PRIJEDLOG, čeka vlasnika)

Ovaj dokument ih ne rješava sam; za svako je navedena preporuka koja najmanje mijenja postojeći kod.

| # | Proturječje | Opcije | Preporuka |
|---|---|---|---|
| P-1 | D-116 traži Tailwind v4 i shadcn/ui; kod je cijeli na CSS modulima, #334 nije izveden | (a) izmijeniti D-116: CSS moduli + tokeni ostaju; (b) uvesti Tailwind/shadcn i prepisati ekrane | **(a)**: nula promjena koda, 21 Archivum ekran se već gradi na modulima |
| P-2 | Javna naslovnica u #952 ima vlastite tokene (`--copper`, `--plum`), oko 60 tvrdo upisanih boja i vlastite kopije fontova (Newsreader do 600) | (a) #952 prije spajanja prelazi na tokene iz §3 i `app/fonts`; (b) naslovnica je izuzeta kao marketinška stranica s vlastitom paletom, zapisano kao odluka | **(a)**: boje su već iste obitelji (`#2b1f38`, `#f0b573`), pa je to mehanička zamjena |
| P-3 | #945 mapira radijuse naslovnice 10 px → 6 px; paket ima `--radius-lg` 10 px; i #952 mijenja iste datoteke | (a) zatvoriti #945 jer ga #952 zamjenjuje; (b) prerada #945 na `--radius-lg` | **(a)** ako se #952 spaja; inače (b) |
| P-4 | Ime: sučelje „Ductura”, README „ime nije odabrano”, repo Ductus | (a) potvrditi Ducturu kao ime proizvoda; (b) ostaviti otvoreno i `APP_NAME` kao radno ime | odluka vlasnika; do tada vrijedi (b) |
| P-5 | Zavjesa dijaloga `#0008` tvrdo upisana u `AppShell` i `LogoutDialog` | token `--scrim` | dodati token u zasebnom malom PR-u |
| P-6 | Fokus: Ductus 2 px odmak, paket 4 px | (a) ostaviti 2 px; (b) 4 px | (a) dok vlasnik ne kaže drukčije (otvoreno pitanje iz #915) |
| P-7 | `app/favicon.ico` je još bordo (#898) | nova ikona iz paketa | zaseban mali PR nakon #915 |
| P-8 | Svijetla ljuska nije ljubičasta, nego papir i bakar | potvrđeno 27. 10. (opcija (a)) | nije proturječje; upisati u `DECISIONS.md` kao dopunu D-179 jer je zasad samo u komentarima |

## 9. Veza s drugim dokumentima

- Ekrani i rute: `docs/design/ductura/INTEGRACIJA.md`; Archivum ekrani: #923.
- Funkcionalni tokovi i Rječnik: `docs/PRODUCT.md`.
- Vizualna provjera PR-ova: D-183 (#949) i `docs/SESSIONS.md` §6 (#959).

## Povijest

Ništa iz ovog odjeljka se ne koristi za novi rad.

- **v0.3, 13. 10. 2026. (D-115, slajdovi #323):** teal `#14B8A6` na `#0A0F0E`, semantičke boje iz Tailwinda. Zamijenjeno D-123.
- **D-123, 17. 10. 2026. (paket Ductura):** mint `#6FBFA5` na `#0F110E` (`ductura/README.md` §8). Zamijenjeno dizajnom v3 (21. 10., #476), pa #867.
- **#867, 26. 10. 2026. (Archivum V3):** bordo, tlo `#19161a`, bakar `#cf9d72`. Zamijenjeno D-179 (#915); svijetla ljuska i bijeli list iz V3 zadržani.
- Mapiranje ekrana v0.3 (landing, editor, replay, predaja, pravila fakulteta, nadzorne ploče, admin, prenosivi zapis) i prioriteti premješteni su u `ductura/INTEGRACIJA.md` i issuee #325 do #342; sadržajna pravila iz toga mapiranja (npr. zabrana teksta „Nema indikacija neautentičnog autorstva”, sortiranje samo po prezimenu) i dalje vrijede preko `PRODUCT.md` i odluka.
