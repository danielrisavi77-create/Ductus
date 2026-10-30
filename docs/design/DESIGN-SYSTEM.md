# Ductus: dizajn sustav (mjerodavno)

Verzija 1.2 · 28. 10. 2026. · konačni smjer potvrđen 29. 10. 2026. · issue #960

Ovo je **jedini pisani izvor odobrenog cilja dizajna**: boje, tipografija, oblici, razmaci i pravila. Preuzima punu specifikaciju pripremljenu u postojećem #973, bez nove paralelne palete. Sve druge tablice boja u repou (`docs/design/ductura/README.md` §8, slajdovi #323, stari PR-ovi) su povijest.

**Konačni smjer za sve agente, sesije i orkestratora je „papir i grafit”**, prema [Danielovoj potvrdi od 29. 10. 2026.](https://github.com/danielrisavi77-create/Ductus/issues/960#issuecomment-6497819007) i D-188. Zadano: tamna grafitna ljuska, gotovo bijeli list i prigušeno zlato; svijetla ljuska i tamni list ostaju korisnički izbori. Drugi smjer traži novu izričitu vlasnikovu odluku s datumom, izvorom i navodom zamijenjenog dijela. Odobrene kompozicije i funkcionalni ugovori ostaju. Postupak je `docs/SESSIONS.md` §6.

**Stanje provedbe:** `app/globals.css` pokazuje stvarno ugrađene vrijednosti, a tablica §3 odobreni cilj. Postojeći #972 zapisuje D-188; #973 provodi tokene i test `src/components/shell/design-doc.test.ts` koji uspoređuje tablicu i CSS, a #974 zadani gotovo bijeli list. Ovaj dokumentacijski PR ne tvrdi da su ti PR-ovi spojeni, da je taj test na ovoj grani izvršen ili da je nova paleta u produkciji. Razlika cilja i CSS-a je zaostatak provedbe, ne novi dizajnerski smjer. Lokalni demo DAN-360 zadano ima svijetlu ljusku; to ne mijenja zadani izgled aplikacije.

## 1. Redoslijed mjerodavnosti

1. Vlasničke odluke u `docs/DECISIONS.md`: **D-188** (paleta „papir i grafit”; zamjenjuje D-184 u vrijednostima), **D-184** (jedna paleta za naslovnicu i aplikaciju), **D-185** (CSS moduli nad tokenima, mijenja D-116), **D-186** (ime Ductura), **D-187** (svijetla tema), **D-179** (struktura palete), **D-178** (Archivum paket, 21 ekran; kad se slika i prototip razlikuju, vrijedi slika), vlasnička odluka od 27. 10. 2026. o svijetloj temi (opcija (a), #923 c.6430103437, #87 c.6430104038), D-180 (S01 kao početna), D-181 (oslovljavanje s „Vi”).
2. Ovaj dokument i `app/globals.css` (moraju biti isti; to provjerava test).
3. Odobrene slike (PNG) iz Archivum paketa za raspored pojedinog ekrana.
4. Ostalo (`docs/design/ductura/*.dc.html`, slajdovi #323) samo za ponašanje i tekst gdje 1. do 3. šute; njihove boje se ne koriste.

Nepromjenjiva pravila koja paleta ne dira: WCAG 2.1 AA (D-115), boje podrijetla pokazuju odakle je tekst, nikad ocjenu (D-57), nema boje za „prekršaj” (D-62), Rječnik iz `docs/PRODUCT.md` §5.

## 2. Načela

| # | Načelo | Značenje |
|---|---|---|
| 01 | Akademski, ne „AI-tech” | Sadržaj i institucionalna ozbiljnost; suzdržan UI. |
| 02 | Evidencija, ne sumnja | Stanja opisuju proces, nikad ne ocjenjuju studenta. |
| 03 | Tamna ljuska, tekst na papiru | Zadana ljuska je tamni grafit; list je papir (D-188). Svijetla ljuska je izbor korisnika. |
| 04 | Isti jezik za sve uloge | Student, nastavnik i administrator dijele tokene, kartice i stanja. |
| 05 | Zlato = akcija | Primarna boja (`--accent`) samo za glavni gumb, aktivnu karticu, oznaku odabira, poveznicu i fokus; obrubi, ikone, pomoćni tekst i brojke ostaju sivi. |
| 06 | Institucionalno spremno | Izgleda kao proizvod kojem fakultet povjerava podatke. |

## 3. Boje

Četiri opsega u `app/globals.css`:

- **Tamna ljuska** (`:root`, zadano; ne prati postavku sustava): topli grafit (D-188): `#242422` tlo, `#292a28` trake i bočna navigacija, `#2e2e2b` paneli i dijalozi, tekst `#faf9f5`, zlato `#c8aa6e` s grafitnim tekstom na njemu.
- **Svijetla ljuska** (`[data-theme="light"]` na elementu ljuske, izbor korisnika, D-187): `#f3f2ee` podloga, `#faf9f6` trake i paneli, tekst `#242422`, tamno zlato `#806529`.
- **Tamni list** (`.sheet`): grafitni panel `#2e2e2b` sa svijetlom tintom; drži je i u svijetloj ljusci.
- **Bijeli list** (`.sheet[data-sheet-theme="light"]`): gotovo bijeli papir `#fcfbf8`, tinta `#242422`, tamno zlato `#806529`; prekidač u editoru, izbor se čuva samo u pregledniku.

Vlasnik je zadao osnovne boje (#960, 28. 10. 2026.). Ostale stupnjeve iste sive skale (prigušeni tekst, crte, polja, hover, odabrano, kartica) izveo je agent i provjerio testom kontrasta; vlasnik je to prihvatio. Upozorenje, greška, stanje spremanja i boje podrijetla ostaju nepromijenjeni (D-57). Vlasnikovo svijetlo zlato `#b49a63` na papiru je 2,4 do 2,6:1, pa ne smije nositi tekst, oznaku ni fokus; na svijetlim površinama to radi `#806529` (4,6:1 i više). `--ink-muted` `#8c887f` je ispod 4,5:1 na tamnim površinama: samo veliki tekst i oznake.

„·” znači da opseg vrijednost nasljeđuje iz ljuske oko sebe.

<!-- tokens:start -->
| Token | Tamna ljuska | Svijetla ljuska | Tamni list | Bijeli list | Namjena |
|---|---|---|---|---|---|
| `--ground` | `#242422` | `#f3f2ee` | · | · | tlo aplikacije |
| `--sheet` | `#2e2e2b` | `#fcfbf8` | `#2e2e2b` | `#fcfbf8` | list za pisanje |
| `--chrome` | `#292a28` | `#faf9f6` | · | · | trake, bočni paneli |
| `--ink` | `#faf9f5` | `#242422` | `#faf9f5` | `#242422` | glavni tekst |
| `--ink-2` | `#dedbd3` | `#55534d` | `#dedbd3` | `#55534d` | sekundarni tekst |
| `--ink-3` | `#c9c5bb` | `#5c5a54` | `#c9c5bb` | `#5c5a54` | tihi mali tekst (najtiši dopušteni za tekst ispod 24 px) |
| `--rule` | `#8c887f` | `#cfccc4` | `#8c887f` | `#cfccc4` | crta, obrub |
| `--rule-2` | `#5a5853` | `#e2e0d9` | `#5a5853` | `#f1efea` | tiša crta (samo linija, nikad pozadina) |
| `--hover` | `#3a3a36` | `#ecebe5` | · | · | hover sekundarnog gumba i stavke |
| `--raised` | `#2e2e2b` | `#faf9f6` | · | · | dijalog, podignuta površina |
| `--raised-rule` | `#b3aea3` | `#85827a` | · | · | obrub dijaloga |
| `--card` | `#33332f` | `#fcfbf8` | `#33332f` | `#fcfbf8` | kartica |
| `--selected` | `#3a3a36` | `#ecebe5` | · | · | odabrana stavka, segment |
| `--well` | `#3a3a36` | `#ecebe5` | `#3a3a36` | `#efede7` | tiha površina ispod teksta (čip, staza, hover) |
| `--ink-muted` | `#8c887f` | `#5c5a54` | `#8c887f` | `#5c5a54` | samo veliki tekst (24 px+) i netekstne oznake |
| `--warn` | `#e9c58b` | `#7a5420` | `#e9c58b` | `#a87420` | oznaka upozorenja |
| `--error` | `#f0a08f` | `#9c3f33` | · | · | oznaka greške |
| `--accent` | `#c8aa6e` | `#806529` | `#c8aa6e` | `#806529` | primarna boja: gumb, poveznica, fokus |
| `--accent-hover` | `#dcc28a` | `#6b5420` | `#dcc28a` | `#6b5420` | hover primarne |
| `--accent-ink` | `#242422` | `#fcfbf8` | `#242422` | `#fcfbf8` | tekst na primarnoj |
| `--accent-soft` | `#3a3a36` | `#efe9dc` | `#3a3a36` | `#8065291a` | meka pozadina primarne (pritisnuto) |
| `--link-rule` | `#b3aea3` | `#8a7550` | `#b3aea3` | `#8a7550` | podcrta poveznice |
| `--field` | `#2a2a27` | `#fcfbf8` | `#2a2a27` | `#fcfbf8` | pozadina polja |
| `--field-rule` | `#a6a196` | `#85827a` | `#a6a196` | `#85827a` | obrub polja |
| `--field-placeholder` | `#bcb7ac` | `#5c5a54` | `#bcb7ac` | `#5c5a54` | placeholder polja |
| `--error-soft` | `#3e302b` | `#f7e4dd` | `#3e302b` | `#f7e4dd` | pozadina greške obrasca |
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
- Tekst na primarnoj je uvijek `--accent-ink` (tamno: grafit na zlatu 7,0:1).
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
- Fokus: `var(--focus-width) solid var(--accent)` = 3 px, odmak `--focus-offset` 4 px; nijedan modul ne upisuje debljinu ni odmak izravno (test).
- Mreža stranice: najveća širina 1200 px, bočni razmak 24 px; list do 720 px.
- Prijelomne točke: 1250 px (struktura ispod lista), 1050 px (jedan stupac), 800 px (bočna traka postaje ladica), 640 px (mobitel).

## 6. Komponente

Izvedba je **CSS moduli nad tokenima iz `globals.css`**, bez Tailwinda i shadcn/ui (D-185, mijenja D-116). Tekst dolazi samo iz i18n kataloga (D-70) i oslovljava korisnika s „Vi” (D-181). Pristupačnost dijaloga i izbornika provjerava se axe testovima u e2e.

## 7. Ime i ikona

Ime proizvoda je **Ductura** (D-186; `APP_NAME` u `src/lib/i18n/messages.hr.ts`). Repozitorij, paket i identifikatori u kodu ostaju `ductus`. Znak: „Ductura” u Newsreaderu, završetak u zlatu. Ikona (`app/favicon.ico`) prelazi na grafit i zlato zasebnim PR-om (§8, P-7).

## 8. Stanje usklađivanja

Vlasnik je 28. 10. 2026. odlučio sva proturječja iz v1.0 (#960 c.6469934229):

| # | Bilo | Sada |
|---|---|---|
| P-1 | D-116 (Tailwind, shadcn) nije proveden | D-185: CSS moduli nad tokenima |
| P-2 | naslovnica s vlastitom paletom | D-184: jedna paleta za naslovnicu i aplikaciju; vrijednosti od D-188 (papir i grafit); naslovnica (#952) boje uzima preko tokena |
| P-3 | #945 radijusi 10 → 6 px | #945 zatvoren |
| P-4 | ime nije odabrano | D-186: Ductura (README) |
| P-5 | zavjesa `#0008` u modulima | token `--scrim` |
| P-6 | fokus 2 px | fokus naslovnice 3 px / 4 px |
| P-7 | bordo favicon | **otvoreno**: ikona u grafitu i zlatu (D-188), zasebni PR (#967) |
| P-8 | svijetla tema samo u komentarima | D-187 |

## 9. Veza s drugim dokumentima

- Ekrani i rute: `docs/design/ductura/INTEGRACIJA.md`; Archivum ekrani: #923.
- Funkcionalni tokovi i Rječnik: `docs/PRODUCT.md`.
- Vizualna provjera PR-ova: D-183 (#949) i `docs/SESSIONS.md` §6 (#959).

## Povijest

Ništa iz ovog odjeljka se ne koristi za novi rad.

- **v0.3, 13. 10. 2026. (D-115, slajdovi #323):** teal `#14B8A6` na `#0A0F0E`, semantičke boje iz Tailwinda. Zamijenjeno D-123.
- **D-123, 17. 10. 2026. (paket Ductura):** mint `#6FBFA5` na `#0F110E` (`ductura/README.md` §8). Zamijenjeno dizajnom v3 (21. 10., #476), pa #867.
- **D-179, 26. 10. 2026. (Archivum paket, #915):** ljubičasta `#2b1f38`, trake `#21192a`, tekst `#f7f0fa`, bakar `#f0b573`. Vrijednosti su zatim usklađene D-184, a konačnu paletu određuje D-188.
- **D-184, 28. 10. 2026. (paleta naslovnice, #964):** šljiva `#2b1f38`, trake `#21172c`, bakar `#f0b573`, papir `#fffcf5`, svijetli bakar `#8f4f33`. Vrijednosti zamijenjene D-188 (papir i grafit); pravilo jedne palete za naslovnicu i aplikaciju vrijedi.
- **#867, 26. 10. 2026. (Archivum V3):** bordo, tlo `#19161a`, bakar `#cf9d72`. Zamijenjeno D-179 (#915); svijetla ljuska i bijeli list iz V3 zadržani.
- Mapiranje ekrana v0.3 (landing, editor, replay, predaja, pravila fakulteta, nadzorne ploče, admin, prenosivi zapis) i prioriteti premješteni su u `ductura/INTEGRACIJA.md` i issuee #325 do #342; sadržajna pravila iz toga mapiranja (npr. zabrana teksta „Nema indikacija neautentičnog autorstva”, sortiranje samo po prezimenu) i dalje vrijede preko `PRODUCT.md` i odluka.
