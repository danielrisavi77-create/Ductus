# Predaja orkestratoru: lijevi panel editora (dio 1a)

Datum: 17. 11. 2026. · Izvor: prototip Ductura Editor v0.7 (Claude artefakt, razrađen s vlasnikom u chat sesiji) · Autor dokumenta: Claude (chat sesija), po nalogu vlasnika.

Ovo je dizajnerska i funkcionalna referenca, kao `docs/design/ductura/*.dc.html`. Nije kod za preuzimanje. Prototip je običan JavaScript nad Tiptapom koji HTML slaže iz teksta; u repou se gradi u Reactu, CSS modulima i katalogu tekstova.

Repo je pročitan samo za čitanje, na lokalnom checkoutu `D:\Ductus`, HEAD `c7f469ec` (7. 11. 2026.). Ako je `main` otišao dalje, tvrdnje o kodu treba provjeriti.

## 1. Najvažnije prije početka

> **Dopuna od 17. 11. 2026., 19:00.** Pri izradi predaje za desni panel pokazalo se da `docs/design/EKRANI.md` vodi ekran S-14 Struktura kao ODOBREN (`m5-reference/struktura-s14.html`). Ovaj dokument nije s njim uspoređen, jer referencu tada nisam vidio. Prije koraka iz §6 treba usporediti tri rasporeda iz prototipa s odobrenom referencom S-14; gdje se razlikuju, vrijedi referenca dok vlasnik ne odluči drukčije.

1. **Dio 1a ne traži promjenu sheme dokumenta.** Sve iz §3 radi nad naslovima koje shema F1 već ima. To je razlog zašto ide prvi.
2. **Prototip koristi StarterKit i pet novih čvorova i oznaka. To se NE prenosi u ovom dijelu.** Shema u repou (`src/editor/schema.ts`) namjerno nema StarterKit jer je editor projekcija kanonskog dokumenta. Novi čvorovi su dio 1b (§7) i svaki dira kanonski model, interop, edit-step i evidenciju.
3. **Tri današnje vlasnikove odluke proturječe zapisanima** (§8). Dok nisu zapisane, vrijede stare.
4. **Jedan sudar traži tehničko rješenje prije gradnje:** premještanje poglavlja i identitet blokova (§5.1). Pohrana podataka o poglavlju je odlučena: nova tablica na poslužitelju (§4).

## 2. Što je u paketu

| Datoteka | Sadržaj |
| --- | --- |
| `site/index.html`, `editor.css` | Ljuska i stilovi (tokeni prepisani iz `app/globals.css`, D-188) |
| `site/app.js` | Jezgra: editor, navod kao atom, dekoracije, desni panel, predaja |
| `site/features.js` | Opseg Editora v11: fusnota, prikaz, unakrsna referenca, lijepljenje, pojmovnik, izvoz |
| `site/rail.js` | **Lijevi panel: tri rasporeda, Prilagodi panel, opcije poglavlja** |
| `site/rules.js` | Zahtjevi rada iz profila pravila (dio 2) |
| `site/advice.js` | Uloge poglavlja i zapažanja iz teksta (dio 3) |
| `site/plus.js` | Sljedeći korak, plan, zadaci, ravnoteža, rokovi, brzi skok, početak u tri koraka |
| `site/vendor/tiptap.js` | Tiptap 3.34 spakiran esbuildom iz `src/vendor.js` |

Namjerno izostavljeno iz paketa:

- `samples/diplomski.json`: stvaran studentski diplomski rad (ime zamijenjeno). Ne smije u repo (CLAUDE.md, tvrda pravila).
- `rules/unizg.json`: vrijednosti iz Lektina paketa za 35 sastavnica Sveučilišta u Zagrebu. Dozvola od 2. 11. pokriva samo FPZG, a uvoz izvodi Lekta sesija (D-217, D-224).

Bez te dvije datoteke prototip radi s početnim primjerom; kartica Zahtjevi rada javlja da se pravila nisu učitala. Pokretanje: bilo koji statički poslužitelj nad `site/`.

## 3. Dio 1a: što lijevi panel radi

### 3.1 Tri rasporeda (izbor korisnika)

| Raspored | Ponašanje |
| --- | --- |
| **Popis** | Sva poglavlja i potpoglavlja u jednom popisu. Naslov se lomi (poglavlje do 4 retka, potpoglavlje do 2). Opcije poglavlja otvaraju se na ⋯ kao plutajući list; redak se ne širi. Donji dijelovi su sklopive cjeline, a zbroj riječi i dani do roka stoje u ljepljivom podnožju. |
| **Kartice** | Kartice na vrhu panela: Struktura i donji dijelovi. Opcije se otvaraju ispod aktivnog poglavlja, u okviru. |
| **Dvije razine** | Prva razina: samo poglavlja, s punim naslovom i sažetkom stanja. Klik otvara poglavlje: opcije, napomene, potpoglavlja, gumb natrag. Ako je kursor u drugom poglavlju, panel to javi i nudi skok. |

Zadano: Popis na računalu, Dvije razine na širini do 640 px.

### 3.2 Prilagodi panel

Postavke (vrijede za korisnika, primjenjuju se odmah):

- raspored; raspored na mobitelu (isti, Dvije razine, Popis);
- u retku poglavlja: broj riječi, traka napretka, točka stanja, napomene (svako zasebno);
- gustoća: prozračno ili zbijeno;
- potpoglavlja: rasklopljena, sklopljena, samo u aktivnom poglavlju;
- donji dijelovi: koji se prikazuju i kojim redom;
- širina na računalu: 248, 288 ili 340 px;
- Vrati zadano.

### 3.3 Zajedničko svim rasporedima

- Panel prati aktivno poglavlje (pomakne popis ako je aktivni redak izvan vidljivog dijela) i čuva položaj pri ponovnom crtanju.
- Sklopi sve, Rasklopi sve; sklapanje pojedinog poglavlja.
- Polje „Traži naslov” filtrira popis; pogodak u potpoglavlju prikazuje i njegovo poglavlje.
- Teza ili pitanje rada na vrhu (dva retka, klik za uređivanje).
- Prikaz samo naslova (pisanje isključeno dok traje), kopiranje sadržaja rada.
- Prikaz samo jednog poglavlja (ostalo skriveno dekoracijom, ne mijenja dokument).

### 3.4 Opcije poglavlja

- stanje: skica, u radu, gotovo;
- cilj riječi, vlastiti rok, bilješka, svrha poglavlja;
- premjesti gore ili dolje (i Alt+Shift+↑/↓);
- dodaj podnaslov, preimenuj, podigni ili spusti razinu, obriši (uz potvrdu).

### 3.5 Što nije u dijelu 1a

Popis prikaza i fusnota, navodi po poglavlju, „Popravi” i „Još nedostaje” koji ovise o navodima, Zahtjevi rada, zapažanja, sljedeći korak, mentor, rokovi fakulteta. Vidi §7.

## 4. Podaci koje panel čuva

Ništa od ovoga nije dio kanonskog dokumenta niti ulazi u journal (`outline.ts`: prikaz strukture ne dodaje ništa u zapis).

| Podatak | Ključ | Tko vidi | Napomena |
| --- | --- | --- | --- |
| Postavke panela (§3.2) | korisnik | samo korisnik | Može ostati u pregledniku, kao tema lista |
| Sklopljena poglavlja | nodeId naslova | samo korisnik | Preglednik |
| Stanje, cilj riječi, vlastiti rok | nodeId naslova | samo student | PRODUCT §5 pravilo 4, iznimka D-63: studentov napredak vidi samo student |
| Bilješka, svrha poglavlja | nodeId naslova | samo student, osim ako se drukčije odluči | Otvoreno: vidi li svrhu mentor (u Editoru v11 je dio „Niti argumenta”) |
| Pitanje rada (teza) | rad | student; mentor? | Otvoreno |

**Odluka vlasnika (17. 11. 2026., doslovno: „Nova tablica na poslužitelju treba”):** podaci po poglavlju čuvaju se na poslužitelju, u novoj tablici s RLS-om i retkom u pgTAP matrici (tvrdo pravilo). Prototip ih drži u `localStorage`; to se ne prenosi. Postavke panela i sklopljena poglavlja mogu ostati u pregledniku.

Ključ mora biti `nodeId` naslova, ne položaj. Prototip ima vlastiti atribut `hid`; u repou ga zamjenjuje postojeći `nodeId` iz `identity.ts`.

## 5. Sudari s postojećim kodom

### 5.1 Premještanje poglavlja i identitet blokova (blokira §3.4)

`identity.ts` čuva id pri premještanju samo kad transakcija ukloni točno jedan blok i umetne točno jedan istovjetan. Premještanje poglavlja miče naslov i sve blokove ispod njega u jednoj transakciji. Po sadašnjem pravilu svi bi dobili nove id-eve, pa bi pukla sidra komentara, zahtjevi za doradu i podaci iz §4. Prototip to rješava ručnim pomakom položaja komentara, što u repou nije prihvatljivo.

Treba odlučiti: proširiti pravilo premještanja na niz blokova (dira jezgru identiteta, razina `critical`) ili premještanje izvesti kao niz pojedinačnih premještanja. Isto vrijedi za podizanje i spuštanje razine ako mijenja tip čvora (ne mijenja, samo atribut `level`).

### 5.2 Razine naslova

| Prototip | Repo |
| --- | --- |
| h1 = naslov rada (u dokumentu), h2 = poglavlje, h3 = potpoglavlje | razine 1 do 3 su poglavlja; naslov rada nije blok u dokumentu |

U repou panel treba tri razine, ne dvije. Rasporedi su građeni za dvije; treća razina treba dodatno uvlačenje u Popisu i Karticama, a u Dvije razine treći stupanj unutar pogleda poglavlja. Numeracija dolazi iz `deriveChapters` (`chapter-numbers.ts`), ne računa se ponovno.

### 5.3 Postojeće datoteke na koje se dio 1a naslanja

- `src/components/editor/HeadingOutline.tsx`: sadašnji popis naslova; postaje jezgra Popisa.
- `src/editor/outline.ts`, `src/editor/chapter-numbers.ts`: izvor naslova i brojeva.
- `src/components/shell/ShellRail.tsx`, `WorkspaceShell.tsx`: ljuska u koju panel sjeda.
- `src/lib/i18n/messages.hr.ts`: svi tekstovi; prototip ih ima u kodu.

### 5.4 Pravila proizvoda i rječnik

- **Oslovljavanje:** prototip koristi „Vi” (D-181). Tekstovi iz Editora v11 koji su na „ti” prepisani su.
- **Rječnik (PRODUCT §5):** u desnom panelu prototip piše „N upozorenja”. Riječ je o tekstu, ne o studentu, ali predlažem „napomene” da se izbjegne provjera zabranjenih izraza. U lijevom panelu koriste se: „za popraviti”, „nedostaje”, „za pogledati”, „u redu”.
- **Trake napretka:** pokazuju omjer riječi prema cilju. Nisu postotak iz pravila 2, ali ih treba provjeriti prema testu P-6 (studentski prikaz bez postotaka).
- **Boja:** poglavlje iznad cilja nije označeno drugom bojom, samo tekstom (D-62).
- **Pristupačnost:** cilj je WCAG 2.2 AA (D-248). Prototip ima vidljiv fokus i mete od 44 px na mobitelu; nije prošao čitač zaslona ni axe.

### 5.5 Brzina

S radom od 15 000 riječi i 35 naslova unos slova traje oko 45 ms, jer prototip pri svakoj transakciji analizira cijeli dokument. Panel se zato crta s odgodom od 180 ms. U repou naslove treba čitati kroz `useEditorState` sa selektorom (kao sada), a sve što broji riječi računati po bloku i pamtiti.

## 6. Prijedlog koraka (jedan korak po PR-u)

1. Raspored Popis nad postojećim `HeadingOutline`: lomljenje naslova, sklapanje, praćenje aktivnog, čuvanje položaja.
2. Traženje naslova, Sklopi sve, prikaz samo naslova.
3. Postavke panela: gustoća, sadržaj retka, širina, potpoglavlja; pohrana u pregledniku.
4. Raspored Kartice.
5. Raspored Dvije razine i zadani raspored na mobitelu.
6. Podaci po poglavlju (stanje, cilj, rok, bilješka, svrha): nova tablica s RLS-om i pgTAP retkom (§4).
7. Opcije poglavlja koje mijenjaju dokument: podnaslov, preimenovanje, razina, brisanje.
8. Premještanje poglavlja, nakon rješenja iz §5.1.
9. Broj riječi po poglavlju, traka napretka, Napredak i Ravnoteža poglavlja (samo studentov prikaz, D-63).

Koraci 1 do 5 ne ovise ni o jednoj otvorenoj odluci.

## 7. Što čeka i zašto

| Dio | Sadržaj | Uvjet |
| --- | --- | --- |
| 1b | Navod kao atom; fusnota; prikaz (tablica, slika); unakrsna referenca; oznake zalijepljeno i uvezeno; inačice odlomka | Navod: D-134 je odlučen (atom u kanonskom modelu), pojedinosti D-226. Fusnota, prikaz i unakrsna referenca nemaju odluku: svaki mijenja kanonski oblik i hash. Zalijepljeno, uvezeno i inačice moraju ići kroz izvor u evidenciji (PRODUCT §5 pravilo 8, D-132), ne kao oznaka u shemi kako je u prototipu. |
| 2 | Zahtjevi rada iz profila pravila | Uvoz paketa iz Lekte (M4.2, Lekta sesija); nove odluke iz §8 |
| 3 | Uloge poglavlja, zapažanja iz teksta, sljedeći korak, plan poglavlja, vlastiti zadaci | Nova odluka iz §8 (preporuke). Zapažanja su obične provjere teksta u pregledniku, nisu AI analiza (pravilo 13), ali to treba izričito potvrditi. |
| 4 | Što je mentor vidio, rokovi fakulteta, etape | Poslužitelj i mentorski ekran. **Sudar:** prototip pokazuje „mentor pregledao” iz oznake pregleda. Po pravilu 5 i D-130 ta je oznaka mentorov radni zapis i student je ne vidi. Isti podatak student smije dobiti iz dnevnika pristupa (pravilo 17) i iz odobrenih etapa; gradi se na tome. |

## 9. Pretpostavke prototipa koje treba potvrditi

- Prag od 150 riječi prije nego što se uz poglavlje pojave zapažanja o sadržaju.
- Prag od 350 riječi po stranici za procjenu opsega u stranicama.
- Omjeri za prijedlog raspodjele opsega (uvod 9 %, teorijski okvir 20 %, metodologija 10 %, rasprava 14 %, zaključak 7 %, ostatak na empirijska poglavlja).
- Tekstovi „Što ovakvo poglavlje obično sadrži” po ulozi poglavlja (napisao Claude; za uvod i zaključak polazište je Editor v11).
- Popis uloga poglavlja i pogađanje uloge iz naslova.

Nijedna nije provjerena sa studentima ni s nastavnikom akademskog pisanja.
