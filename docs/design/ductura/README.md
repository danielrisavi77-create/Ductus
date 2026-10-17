# Predaja dizajna: Ductura editor i Pregled radova

## Status u repou

- Ovo je dizajnerska referenca, ne produkcijski kod.
- Mjerodavne su vlasničke odluke (#87 `issuecomment-6235542273`, D-123 do D-126 u `docs/DECISIONS.md`); imaju prednost pred §9 „Otvorena pitanja”.
- Mjere (demo) se ne grade (D-56).
- Prototip povlači React i Babel s unpkg samo za pregled u pregledniku (`support.js`); aplikacija ih ne koristi.

---


Za repo `danielrisavi77-create/Ductus`, uloga Frontend (F-4, F-8 do F-11) i Backend (zapisi iz `PROVJERE.md`).

## 1. Pregled

Dva ekrana koji pokrivaju cijeli tok rada na završnom ili seminarskom radu na FPZG-u:

- **Editor** (student, i pogled "Kako vidi nastavnik"): pisanje, struktura rada, literatura i navodi, komentari i dorada, provjera prema Uputama FPZG-a, etape, konzultacije, predaja.
- **Pregled radova** (mentor): popis radova, zaključan rad s komentarima, dorada, konzultacije, etape, rubrika i izvješće, ocjena.

Ime u sučelju je **Ductura** (CLAUDE.md projekta). U repou i odlukama stoji Ductus; konačno ime je otvoreno u Owner queue (`STATE.md`). Ime drži u jednom ključu teksta.

## 2. O datotekama

Datoteke u ovoj mapi su **dizajnerske reference u HTML-u**: prototipi koji pokazuju izgled i ponašanje. Nisu produkcijski kod. Zadatak je ekrane **izgraditi u postojećem stogu repoa** (Next.js, React, TypeScript strict, Tiptap editor, Dexie journal, tekstovi u ključevima prema D-84), njegovim obrascima i bibliotekama.

- `*.dc.html` otvaraju se izravno u pregledniku (uz `support.js` u istoj mapi). Predložak je HTML s `{{ }}` rupama, a logika je klasa `Component` u `<script data-dc-script>` na dnu datoteke. Sva stanja, tekstovi, pravila i izračuni su u toj klasi.
- Editor u prototipu je `contenteditable`. U aplikaciji je to Tiptap (F-3): oznake (navod, komentar, rupa, fusnota, unakrsna referenca, uvezeno) postaju **marks/nodes** u shemi, ne `span`ovi s klasama.
- Svi podaci su izmišljeni (Student A–D, Nastavnik A, Autor A–C). Nijedan stvarni osobni podatak.

## 3. Vjernost

**Visoka (hi-fi).** Boje, tipografija, razmaci, tekstovi i interakcije su konačni za demo. Tekstove preuzmi doslovno u katalog `messages.hr.ts`. Gdje se boje prototipa i tokena iz PR-a #386 razlikuju, vidi §9.

## 4. Opseg prema PLAN-DEMO

Prototip je širi od demoa 2. 11. 2026. Za gradnju vrijedi:

| Dio | Status | Zadatak |
|---|---|---|
| Ljuska, traka alata, struktura, list, traka stanja | demo | F-4, F-8 |
| Stanja spremanja (8), rad bez mreže, druga kartica | demo | F-8 |
| Naslovi, navod, bibliografija u FPZG stilu | demo | F-8, K-2 |
| Komentar uz odlomak, pogled nastavnika | demo | F-9, B-10, B-11 |
| Predaja i potvrda, sažetak procesa isti za oba | demo | F-10, B-12, B-13 |
| Brz put za nastavnika, popis abecedno | demo | F-11 |
| Literatura (uvoz BibTeX/RIS/Zotero, 2019a/b, navodi bez izvora) | nakon demoa (M4) | |
| Dorada u rundama, prijedlozi izmjene | nakon demoa (D-34 za izravne izmjene) | |
| Etape, konzultacije, rubrika, izvješće, ocjena | nakon demoa (M2 mentorstvo) | |
| Uvoz teksta, izvoz .docx/PDF, predajni paket, putovnica | nakon demoa (izvan demoa po §2) | |
| Pomoć u pisanju (fraze, @navod, /naredbe, rupe, kostur odlomka, riječ u kontekstu, prijelazi, oblik rečenica) | nakon demoa | |
| Čitanje naglas, diktiranje, glasovni komentar, mirni način | nakon demoa | |
| Asistent | "uskoro", izvan demoa | |
| **Mjere (demo)**: ritam, postoci, reprodukcija | **ne gradi** dok D-56 nije riješen (pravno mišljenje, C-14/C-19). Reprodukcija je izvan demoa po PLAN-DEMO §2 | |

## 5. Ekrani

### 5.1 Editor (`editor-v11.dc.html`)

**Raspored** (puna visina prozora, `display:flex; flex-direction:column`):

1. **Gornja traka**, 48 px, pozadina `#141712`, donja crta `1px #2C312B`. Lijevo "Ductura" (Newsreader 19/600), put "Kolegij A / Zadatak 1", tekst "demo" (11.5 px `#767D75`). Desno prekidač prikaza **Pisanje / Kako vidi nastavnik** (segment, pozadina `#232722`, radius 7, aktivni dio `#1A1E19`).
2. **Traka alata**, jedan red. Ono što ne stane ide u izbornik **Više ▾** (redom: Odloži, Diktiraj, Čitaj, Fraze…). Desno izbornik **Prikaz ▾**: Pomoć u tekstu (razina), List (tamni/bijeli, s uzorkom boje), Stil citiranja (FPZG, APA, Chicago). Odlomak, Popis i Blok-citat su znakovi `¶ • „ ”` s punim nazivom u `title`.
3. **Tijelo**, tri stupca:
   - **Struktura** (lijevo, ~260 px, `#141712`, desna crta `#2C312B`): stablo poglavlja, oznaka trenutnog, sklapanje, povlačenje, `⋯` radnje, cilj riječi, stanje (skica / u radu / gotovo), rok, kontrolni popis, kartica pod mišem. Ispod 1240 px sklopiva.
   - **List** (sredina, max ~720 px teksta): Newsreader 16.5–17 px, prored 1.7. Tamni list `#161A15`, bijeli list `#FFFFFF` s tekstom `#1C160B`-tonovima (vidi CSS u `<helmet>` datoteke, selektori `.ed[data-sheet=light]`).
   - **Desni panel** (~330 px, `#141712`): kartice **Asistent · Literatura · Nacrt · Upute · Komentari · Rad** (+ Izvor kad je otvoren). Kartice su tekst 12 px s podcrtom aktivne `inset 0 -2px 0 #6FBFA5`, traka kartica je `flex:none; overflow-x:auto`, ljepljiva na vrhu. Ispod 1000 px panel se otvara gumbom ▥ preko teksta.
4. **Traka stanja** (dno): stanje spremanja, "210 / 2 000–2 500 riječi · ≈ 1 str.", broj rupa (klik otvara popis), broj riječi označenog teksta.

**Kartice desnog panela**
- **Literatura**: traženje, `+ Izvor`, `Uvezi` (BibTeX/RIS/Zotero), skupine Citirano / Nije citirano, upozorenja uz izvor, "citirano 2× ›" kruži kroz mjesta, bilješke iz čitanja sa stranicom (povlačenje u tekst umeće „citat” (Autor, godina: str.)), Izvori po poglavljima, jezik izvora, Navodi bez izvora (Pokaži / Poveži / Dodaj).
- **Nacrt**: Obrnuti nacrt, Nit argumenta (pitanje → svrhe poglavlja → zaključak), Pojmovnik ("Gdje se koristi ›").
- **Upute**: provjere prema profilu FPZG (`PROVJERE.md` §2–§5), klik vodi na mjesto.
- **Komentari**: redni brojevi koji se ne recikliraju, stanje otvoreno/riješeno, nit odgovora, prijedlog izmjene (prihvati/odbij), pravilo FPZG uz komentar, glasovna snimka, "izmijenjeno nakon komentara".
- **Rad**: Etape (5), Dogovoreno na konzultacijama (kvačice), Priprema za konzultacije (složi iz rada), Sažetak i Summary s ključnim riječima, Uz rad: Uvoz postojećeg teksta, Izjava o AI-ju, Predajni paket.

**Dijalozi** (fiksno, `top:64px`, centrirano, `#1A1E19`, rub `#2C312B`, radius 10, sjena `0 20px 44px -14px #000d`, zavjesa `#0008`): Prije predaje (kontrolni popis), Predajni paket (stavke s točkom stanja zelena `#6FBFA5` / jantarna `#D3AC63` / crvena `#E07A6A` + autorska putovnica s kodom), Uvoz teksta (traži izjavu), Izjava o AI-ju (alati + svrha → tekst za Prilog), Povijest rada (točke, usporedba), Brzi izvor, Uvoz literature.

### 5.2 Pregled radova (`pregled-radova-v2.dc.html`)

1. **Gornja traka** 48 px kao u editoru; desno prekidač "Mjere (demo)" (ne gradi, §4), "Nastavnik A", poveznica Editor.
2. **Lijevo** (230 px): popis radova **abecedno**, ime 13/600, stanje u boji (Čeka doradu `#D3AC63`, Dorada stigla na pregled `#8FB0E0`, Prihvaćeno `#6FBFA5`, Nije započeto `#8E958D`), vrijeme 11 px. Ispod: "Popis se ne može poredati po brojevima."
3. **Sredina** (max 720 px): ime (Newsreader 24/600), stanje · runda, radnje (Zatraži novu doradu / Prihvati rad / Ocjena). Redak "Novo od tvog pregleda … · Označi kao pregledano". Prikaz: Tekst / Promjene od runde N (diff po riječima: brisano precrtano `#D9AE5B`, dodano `#8FB0E0` na `#8FB0E022`) / Podrijetlo teksta (točka uz odlomak: napisano u Ducturi `#8FB0E0`, zalijepljeno `#9E9A90`). Rad je zaključan; označavanjem teksta otvara se novi komentar.
4. **Desno** (330 px): kartice **Komentari · Dorada · Konzultacije · Etape · Izvješće**. Predlošci komentara s pravilom FPZG, zahtjev za doradu s rokom i dnevnikom, konzultacije (bilješke, dogovoreno po retku, "Dnevni red iz rada", privatne bilješke), etape (Odobri / Vrati s napomenom, "izmijenjeno nakon odobrenja"), rubrika s kriterijima koje mentor uređuje, nacrt izvješća, ocjena (nacrt dok se ne objavi).

## 6. Ponašanje

- **Stanja spremanja** (F-8): osam stanja iz `src/domain/sync/labels.ts`; SYNCED tek uz potpisanu potvrdu. Rad bez mreže zadržava oznaku do povratka. Druga kartica = samo čitanje. Greške nude "Izvezi tekst".
- **Navodi**: navod je atom (jedan čvor), stil se mijenja globalno; dva susjedna navoda spajaju se u "(A, 2017: 7; B, 2023)" i razdvajaju kad se jedan obriše. Isti autor + ista godina → 2019a/2019b automatski.
- **Komentar**: označi tekst unutar jednog odlomka → desni klik ili gumb → polje iznad teksta; Ctrl+Enter objavi, Esc odustani. Broj se ne mijenja ni nakon brisanja.
- **Rupe** `[?] [izvor] [provjeri] [broj]`: crveno podcrtane, blokiraju predaju.
- **Struktura**: Ctrl+Alt+↑/↓ i Alt+Shift+↑/↓ premještaju poglavlje u fokusu; dok je fokus u strukturi, kursor u tekstu ne mijenja aktivno poglavlje.
- **Mirni način**: ◎ ili Ctrl+. ; Esc izlazi.
- **Etape**: student predaje sljedeću tek kad su sve prethodne odobrene; vraćena etapa nudi "Predaj ponovno".
- **Predaja**: blokirana dok ima rupa i dok izjava o autorstvu nije potvrđena; žute stavke ne blokiraju.
- **Prijelazi i animacije**: samo `background .15s`, `left .15s` (prekidači). Toast 2.6 s, dno sredina.
- **Studentski prikaz** poštuje PRODUCT.md §5: bez postotaka, bez mjera ritma i truda, rječnik iz §5. P-6 to provjerava u CI-ju.

## 7. Stanje i podaci

Popis zapisa uz rad, tko piše i tko vidi: **`PROVJERE.md` §6c i §6d** (u ovoj mapi). Ukratko:
- Oba ekrana čitaju **isti rad na poslužitelju**; nijedan ne drži svoju kopiju.
- Stanje rada (čeka doradu / na pregledu / prihvaćeno) računa se iz zahtjeva i rundi.
- Runda = jedna predaja na pregled, isto brojanje u oba ekrana.
- "Novo od zadnjeg pregleda" = razlika `reviewedRev` → trenutna runda; "izmijenjeno nakon odobrenja" = razlika od snimke pri odobrenju etape.
- Provjere su čiste funkcije `(chapter, doc, profile) → Finding[]` u pregledniku; poslužitelj ih ponavlja pri predaji (`PROVJERE.md` §4–§6).

Lokalna stanja sučelja (otvoreni dijalozi, kartica, sklopljena poglavlja, tema lista) vidi `state = { … }` u klasi editora.

## 8. Tokeni

**Boje (tamna tema)**

| Uloga | Hex |
|---|---|
| Pozadina aplikacije | `#0F110E` |
| Površina (trake, paneli) | `#141712` |
| List (tamni) | `#161A15` |
| Dijalog, podignuta površina | `#1A1E19` |
| Hover | `#1E221D` |
| Odabrano, segment | `#232722` |
| Rub | `#2C312B` |
| Tekst | `#E9EBE6` |
| Tekst sekundarni | `#A6ADA5` |
| Tekst tercijarni | `#8E958D` |
| Tekst tihi | `#767D75` |
| Naglasak / primarni gumb | `#6FBFA5` (tekst na njemu `#0E1C17`) |
| Info, poveznica, dodano | `#8FB0E0` (hover `#B3CAEC`) |
| Upozorenje | `#D3AC63`; komentar `#D9AE5B` |
| Greška, rupa | `#E07A6A` |

Bijeli list: tekst i oznake u `<helmet><style>` editora, selektori `.ed[data-sheet=light]` (`#3A6BB0`, `#2F7A63`, `#A87420` za navod, komentar, upozorenje).

**Tipografija**: Instrument Sans (sučelje), Newsreader (tekst rada, naslovi ekrana), JetBrains Mono / `ui-monospace` (kod putovnice). Fontovi su već u `app/fonts`. Veličine sučelja: 10.5, 11, 11.5, 12, 12.5, 13, 14 px; tekst rada 16.5–17 px, prored 1.7; naslov ekrana 24 px.

**Radius**: 4 (oznake), 6 (polja, mali gumbi), 7 (gumbi, polja za unos), 10 (dijalozi), 50 % (točke).
**Sjene**: dijalog `0 20px 44px -14px #000d`; plutajući izbornik `0 1px 1px #0008, 0 20px 44px -14px #000d`.
**Razmaci**: 4, 6, 8, 10, 12, 14, 16, 24 px; paneli `padding 14–16px`.

## 9. Otvorena pitanja prije gradnje

1. **Boje**: prototip koristi boje odobrenih demo ekrana; PR #386 (D-115) uvodi svoje tokene. F-4 traži podudaranje s odobrenim dizajnom: odluči koje vrijede i mapiraj tablicu iz §8.
2. **Ime**: Ductura ili Ductus u sučelju.
3. **Mjere (demo)**: ne graditi dok D-56 nije riješen.
4. **Profil FPZG**: granice (opseg, Sažetak 150–300 riječi, 3–5 ključnih riječi, kontrolni popisi) treba potvrditi prema službenim Uputama prije nego uđu u `fpzg.json`.

## 10. Datoteke

- `editor-v11.dc.html`: editor, zadnja verzija (v2–v10 su povijest u projektu).
- `pregled-radova-v2.dc.html`: mentorski ekran.
- `support.js`: runtime za otvaranje `.dc.html` u pregledniku.
- `PROVJERE.md`: provjere, profil pravila, zapisi uz rad (§6c), zajednički zapis mentora i studenta (§6d).
- `analiza.dc.html`: analiza frontenda (ekrani, 135 radnji iz showcasea, pravila, sukobi s repoom).
