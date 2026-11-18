# Predaja orkestratoru: desni panel editora

Datum: 17. 11. 2026. · Izvor: prototip Ductura Editor v0.16 (Claude artefakt, razrađen s vlasnikom u chat sesiji) · Autor dokumenta: Claude (chat sesija), po nalogu vlasnika.

Ovo je prijedlog funkcija, ne referentna slika i ne kod za preuzimanje. Izgled prototipa vlasnik nije odobravao („izgled sada nećemo dirati”). Prototip je običan JavaScript nad Tiptapom koji HTML slaže iz teksta.

Repo je čitan samo za čitanje, na lokalnom checkoutu `D:\Ductus`, HEAD `c7f469ec` (7. 11. 2026., odvojen HEAD). Ako je `main` otišao dalje, tvrdnje o repou treba provjeriti.

## 1. Najvažnije prije početka

1. **Za desni panel u repou već postoje odluke, kod i referentne slike.** Prototip je nastajao bez uvida u njih i tek je na kraju uspoređen. Zato ga treba čitati kao popis prijedloga za dopunu postojećih referenci, a ne kao zamjenu. Prvi korak je usporedba po ekranu (§3), ne gradnja.
2. **Tri mjesta prototipa sudaraju se sa zapisanim odlukama** (§5). Dva sam u prototipu uskladio sa zapisanim; treće je nova vlasnikova odluka koja mijenja prijedlog iz repoa i mora se zapisati.
3. **Gotovo ništa iz prototipa ne može u repo bez poslužitelja ili promjene sheme.** Iznimka su tekstne provjere u kartici Pregled (§6.1), a i one ovise o odluci o sadržajnim preporukama s #2012.
4. **Ništa nije isprobano sa stvarnim modelom, studentom ni mentorom.** Asistent je testiran s lažnim odgovorima.

## 2. Što je u paketu

`ductura-prototip-v016.zip`: mapa `site/` (22 datoteke) i `src/` (ulazi za esbuild). Moduli desnog panela:

| Datoteka | Sadržaj |
| --- | --- |
| `right.js` | Tri rasporeda (Kartice, Uz tekst, Ikone uz rub), Prilagodi desni panel, opseg „ovo poglavlje / cijeli rad”, kuke `X.rp.HK` |
| `tools.js` | Prvi krug: mjesta navoda, stanje izvora, Riješi redom, Šavovi, Ponavljanja, Dosljednost, Proba predaje, Kostur za obranu, sesija pisanja |
| `proofs.js` | Potvrde iz izvora: slika, zalijepljena slika, izrez iz PDF-a (`vendor/pdf.js`, pdfjs-dist 3.11.174) |
| `sources2.js` | Izvori, drugi krug |
| `comments2.js` | Komentari, drugi krug |
| `review2.js` | Pregled, drugi krug |
| `mentor2.js` | Mentor i predaja, drugi krug; Sažetak u dokumentu |
| `assist.js`, `assist2.js` | Asistent |
| `prune.js` | Obavijesti u rasporedu Uz tekst |

Namjerno izostavljeno, kao i prije: `samples/diplomski.json` (stvaran studentski rad) i `rules/unizg.json` (Lektina pravila izvan FPZG-a). Bez njih prototip radi s početnim primjerom.

Testovi `test9.py` do `test21.py` (Playwright, 1440×900 i 390×800) prolaze bez grešaka u konzoli; nisu u paketu jer ovise o izostavljenim datotekama.

## 3. Što već postoji u repou

| Ekran (EKRANI.md) | Stanje u repou | Kod | Što prototip dodaje |
| --- | --- | --- | --- |
| S-13 Literatura i bilježnica izvora | DJELOMIČNO, `m5-reference` | `SourcesPanel.tsx`, `sources.ts`: obrazac za knjigu i članak; navod se upisuje kao običan tekst (D-98), popis izvora živi dok je list otvoren | §4.1 |
| S-14 Struktura (kartica Nacrt) | ODOBRENO | `HeadingOutline.tsx` | Nacrt po odlomcima s brojem riječi i navoda; ostalo je lijevi panel |
| Komentari | `komentari-mobitel.dc.html`, F-9 | `CommentPanel.tsx`, `comment-anchor.ts`: student samo odgovara; komentar otvara nastavnik; sidro je zapis izvan dokumenta | §4.2 |
| S-15 Panel Rad | NEMA reference | `SidePanels.tsx`: etape samo za čitanje, radnje „uskoro” | §4.4 može biti ulaz za referencu |
| Upute | u `SidePanels.tsx` | zadatak, rok, dopuštena pomoć | u prototipu su pravila u lijevom panelu (Zahtjevi rada) |
| S-16 Panel Asistent | PRIJEDLOG, `m9-reference-a` (12 stanja, S16-BUD) | nema koda | §4.5; sudari u §5 |
| S31-AI, N-AI-ATT | NEMA reference | nema | „Izjava iz dnevnika” i „Korištenje u ovom radu” mogu biti ulaz |
| A-AI-POL | `m9-reference-b` | nema | prototip ima samo zamjenu u pogledu nastavnika |

Reference sam čitao samo kroz njihove README datoteke. Same stranice (`s13-literatura.html`, `s16-asistent.html` i druge) nisam otvarao, pa usporedba po stanju ekrana ostaje za orkestratora ili Product/UX sesiju.

## 4. Što prototip predlaže

Oznake: **P** traži poslužitelj (tablica s RLS-om i pgTAP retkom), **S** traži promjenu sheme ili formata evidencije, **K** radi samo u pregledniku.

### 4.1 Izvori

| Funkcija | Ovisi o | Napomena |
| --- | --- | --- |
| Popis izvora kao redci, opseg po poglavlju, „Gdje je citirano” | S (navod kao atom, D-134, D-226) | Dok je navod običan tekst (D-98), mjesta navoda se ne mogu pouzdano naći |
| Stanje izvora, plan po poglavlju, konzultirana literatura | P | Studentovi podaci |
| Oslonac na jedan izvor, slika literature, za dopuniti, dvostruki unosi | K nad popisom izvora | „Za pogledati”, bez ocjene |
| Dohvat iz DOI-ja, ISBN-a, naslova; provjera poveznica | P | Upiti su već u opsegu DPIA-e (D-257). `m5-reference` propisuje tri ishoda provjere i da se izvor nikad ne ocjenjuje |
| Crtični kod | K | Samo preglednici s BarcodeDetectorom |
| Sekundarni navod („cit. prema”) | S | Novi podatak na navodu |
| **Potvrde iz izvora** (slika, PDF izrez) | P + pohrana datoteka | Nova funkcija bez odluke. Otvoreno: autorska prava i pohrana isječaka (pravno mišljenje), naziv „priložena potvrda”, cijeli PDF ostaje na uređaju |
| Zatraži potvrdu (mentor), pregled literature, obvezna literatura, preporuka izvora | P | Zahtjev je u prototipu vezan atributom na navod; u repou treba zapis sa sidrom |

### 4.2 Komentari

| Funkcija | Ovisi o | Napomena |
| --- | --- | --- |
| Vrsta komentara, čiji je red, brzi odgovori | P (polja na komentaru) | |
| Zatvaranje u dva koraka | P | Vlasnik 17. 11.: potvrdu mentora traži samo vrsta „mora se popraviti” |
| Opći komentar (poglavlje ili rad) | P | Novi oblik sidra: bez teksta |
| Jedan komentar, više mjesta | P | Više sidara na jednom zapisu |
| Novo od zadnjeg otvaranja, ponavlja se, povijest rundi, ispis | P / K nad popisom | |
| Riješi redom, „što je promijenjeno”, prije i poslije | P | „Prije” je citat iz sidra |
| Spremljeni komentari, diktiranje | P / K | |
| Privatna bilješka mentora | P | Student je ne smije dobiti ni u odgovoru poslužitelja (pravilo 5 ima iznimku za mentorove radne zapise, D-130) |

### 4.3 Pregled

| Funkcija | Ovisi o | Napomena |
| --- | --- | --- |
| Početni zaslon s nalazima, Provjere po vrsti, „nije greška” | K (+ P za pamćenje) | |
| Nacrt, Šavovi, Ponavljanja, Dosljednost, Doslovni navodi, Upućivanja, Struktura naslova, Sitnice | K | Sitnice mijenjaju tekst: promjena mora imati izvor u evidenciji (pravilo 8). Predlažem da se bilježi kao radnja alata, kao traži i zamijeni |
| Brojke bez izvora, tvrdnje bez izvora | K + S | Traže navod kao atom |
| Promjene od zadnjeg slanja, sažetak rada | P | |
| Iz napomene u komentar | P | |

Sve provjere su „za pogledati” i ništa ne blokira predaju. Jesu li to „sadržajne provjere” u smislu D-221 i D-222, ovisi o odluci B s #2012 (c.6949416900).

### 4.4 Mentor i predaja

Stanje rada, etape s rokom, poruke, zahtjev za konzultacije, zajednički zapisnik, obrasci fakulteta, suglasnost mentora, stanja nakon predaje, vremenska crta, Vrati na doradu sa složenim sažetkom, Moji studenti, Kako mentor radi, Proba predaje, Kostur za obranu. Sve traži poslužitelj.

- **Sažetak, Summary i ključne riječi** u prototipu su premješteni u dokument. U repou to znači nove dijelove kanonskog dokumenta (S).
- **Suglasnost mentora** u prototipu ne blokira predaju, jer D-129 dopušta blokadu samo za mjesta za izvor i izjavu fakulteta.
- **Moji studenti** je zaseban ekran mentora, ne dio editora.

### 4.5 Asistent

| Funkcija | Odnos prema `m9-reference-a` |
| --- | --- |
| Svrhe u dvije razine, unos uz svrhu, prijenos u rad, dnevnik prijenosa, razgovori uz izjavu | Pokriveno referencom (stanja 1 do 8) |
| Poziv s označenog teksta | Novo |
| Lektura izmjenu po izmjenu; izmjena koja dira navod se ne unosi | Blisko stanju 5 (D-46: usporedba brojki, citata i oznaka izvora prije primjene); prototip ne uspoređuje brojke |
| Upozorenje na osobne podatke prije slanja | Novo |
| Svrha „Pravila fakulteta” (odgovor samo iz paketa pravila) | Novo; jedanaesta svrha, izvan kataloga D-268 |
| Poveznice na pretragu, Dodaj u Izvore, Prevedi sažetak, gotovi počeci upita | Novo |
| Izjava iz dnevnika, Korištenje u ovom radu | Ulaz za S31-AI i N-AI-ATT (reference ne postoje) |
| Svrhe po zadatku s obrazloženjem | Blisko A-AI-POL i D-52; u repou to radi nastavnik unutar pravila kolegija |
| Četiri izvora AI-ja i kvota u upitima | Sudar, §5.3 |

## 5. Sudari sa zapisanim odlukama

### 5.1 „Objašnjenje pojma” (usklađeno u prototipu)

D-268 O2: to je svrha razine 2, po zadanom isključena. U prototipu je bila razina 1; sada je razina 2.

### 5.2 Oznaka podudaranja (usklađeno u prototipu)

D-268 O6: oznaka podudaranja s odgovorom pomoćnika ostaje isključena do rješenja U-4, nakon pilota. Prototip je ima izgrađenu (osam riječi zaredom, izuzeti navodnici), ali je sada po zadanom isključena; uključuje se u pogledu nastavnika radi pokazivanja. Vlasniku je ranije danas rečeno da D-58 traži tu oznaku; to je bilo netočno jer nisam bio pročitao D-268.

### 5.3 Tko plaća AI (nova vlasnikova odluka, nije zapisana)

Stanje u repou: D-194 t. 6 i D-267 O1 su PRIJEDLOG „operater drži račune, student ne plaća”; D-267 O5 veže granice uz trošak, a `m9-reference-a` izričito ne prikazuje iznose ni broj zahtjeva; pravilo 15 kaže da student nikad ne mora platiti da izvrši obvezu.

Vlasnik je 17. 11. u chat sesiji rekao da ne želi sam plaćati AI i tražio da Asistent podrži: ugovor fakulteta s pružateljem, „Ductura AI” kao plaćeni dodatak s kvotom, studentov vlastiti API ključ i prijavu studentovom pretplatom gdje pružatelj to službeno dopušta. Prototip to prikazuje, s kvotom u broju upita.

Vlasnik je istog dana (18:59) pojasnio: „Student ne plaća osim svog privatno, ali službeno ne.” Dakle službeno AI osigurava fakultet (vlastitim ugovorom ili plaćenim dodatkom Ductura AI) i studenta ništa ne košta, što ostaje u skladu s pravilom 15. Vlastiti ključ i pretplata su studentov privatni izbor, nikad uvjet. Prototip to sada tako i prikazuje.

To mijenja prijedlog iz D-194 t. 6 i dira D-77 (osobni računi odbačeni zbog obrade u EU), D-23 (pružatelje određuje fakultet), D-194 t. 2 (bez kineskih pružatelja) i prikaz granica iz S16-BUD. Dok nije zapisano na #2012 i dok pravno mišljenje ne pokrije studentove račune, vrijedi stanje iz repoa.

### 5.4 Ostalo

- **Upute pomoćniku** u prototipu slaže preglednik. U repou ih slaže poslužitelj iz pravila zadatka, a tekst rada ide kao omeđeni nepouzdani podaci (C-37, pravilo 16).
- **Pružatelje** u prototipu „uključuje nastavnik”. U repou dolaze iz `config/faculties`, a administrator mijenja samo pravilo AI-ja i pragove (D-270 O11).
- **Transkripcija** je u prototipu samo najavljena; u repou je iza prekidača ustanove i nema gumba za snimanje (D-267 O10).
- **„Mentor pregledao”** i oznake pregleda: vrijedi napomena iz predaje za lijevi panel (pravilo 5, D-130).
- **Rječnik:** tekstove prototipa nisam provukao kroz `findForbiddenTerms`. Riječi „upozorenje” i „provjereno” treba provjeriti.

## 6. Prijedlog redoslijeda

1. **Usporedba po ekranu** (Product/UX): S-13, S-16, komentari, S-15. Za svaki: što referenca već ima, što prototip dodaje, što se odbacuje. Ishod su dopune referenci ili nove reference za S-15, S31-AI i N-AI-ATT.
2. **Odluke vlasnika** iz §7 zapisati ili odbaciti.
3. Tek tada tiketi, po postojećim fazama: Izvori u M5, Komentari uz F-9 i B-11, Mentor i predaja u M7, Asistent u M9.

### 6.1 Što bi moglo prvo

Tekstne provjere iz §4.3 koje ne traže navod kao atom ni poslužitelj: Nacrt, Šavovi, Ponavljanja, Dosljednost, Doslovni navodi, Upućivanja, Struktura naslova. Rade nad postojećom shemom F1 i ništa ne upisuju u dokument. Uvjet je odluka B s #2012.

## 8. Izmišljeno, pretpostavljeno i neprovjereno

- **Izmišljeni podaci:** obvezna literatura (dva unosa), Moji studenti (četiri retka), obrasci fakulteta (tri), početni spremljeni komentari, „Kako mentor radi”, opisi etapa, popis pružatelja.
- **Tekstovi koje je napisao Claude:** upute pomoćniku po svrsi, gotovi počeci upita, tekstovi komentara iz „U komentar”, sve poruke sučelja.
- **Pragovi:** oslonac na izvor (pola navoda, najmanje pet), ponavljanje (tri komentara), dug navod (40 riječi), podudaranje (osam riječi), kvota (50, 100, 200 upita), najveći upit (1500 riječi), isječak potvrde (do oko 150 kB).
- **Neprovjereno u artefaktu:** odgovori stvarnog modela, čitanje naglas, diktiranje, kamera, crtični kod, ispis, dohvat iz kataloga, provjera poveznica.
- **Poznati nedostaci:** „nije greška” skriva stavku u popisu, ali podcrtavanje u tekstu ostaje; „Popravi sve” radi u više transakcija; analiza cijelog dokumenta pri svakoj izmjeni (brzina) nije riješena.
