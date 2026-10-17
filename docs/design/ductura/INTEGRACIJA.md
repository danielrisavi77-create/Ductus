# Ductura: integracija u aplikaciju

Uz README.md (ekrani, tokeni, ponašanje) i PROVJERE.md (pravila i zapisi). Ovaj dokument kaže **što graditi, kojim redom, što nije riješeno i kako spojiti**.

## 1. Što je u paketu

> **Napomena u repou:** imena u tablici su imena iz izvornog paketa; u repou su kebab-case (`prijava-v5.dc.html`, `demo-tok-v2.dc.html`, `pocetna.dc.html`, `editor-v11.dc.html`, `komentari-mobitel.dc.html`, `pregled-radova-v2.dc.html`, `istraga.dc.html`, `povjerenstvo.dc.html`, `koordinator.dc.html`, `kako-radi.dc.html`). Veze između ekrana unutar HTML-a još pokazuju na izvorna imena i `support.js` nije u repou (odluka vlasnika 17. 10. 2026.); prototip se otvara iz izvornog zipa ili Claude Designa. `Ductura Vodič` nije u repou.

| Datoteka | Uloga | U aplikaciji |
|---|---|---|
| Ductura Prijava v5 | prijava, putovnica, kod zadatka | `/prijava`, `/provjera/[kod]` |
| Ductura Demo tok v2 | novi zadatak, upis + obavijest S3, predaja, brz put | `/nastavnik/zadatak/novi`, `/upis`, `/rad/[id]/predaja`, `/nastavnik/brz-put` |
| Ductura Početna | početna studenta, obavijesti, paket rada | `/` (student) |
| Ductura Editor v11 | editor + "Kako vidi nastavnik" | `/rad/[id]` |
| Ductura Komentari mobitel | komentari na uskom zaslonu | `/rad/[id]/komentari` (responzivno) |
| Ductura Pregled radova v2 | mentor | `/nastavnik/radovi` |
| Ductura Istraga | zahtjev → odobrenje → prikaz → lanac → ishod | `/istraga/[id]` |
| Ductura Povjerenstvo | ocjena povjerenstva | `/povjerenstvo/[rad]` |
| Ductura Koordinator | zbrojevi po kolegiju | `/koordinator` |
| Ductura Kako radi | javna stranica | `/kako-radi` (bez prijave) |
| Ductura Vodič | obilazak za prezentaciju | **ne gradi** |

Prototipi su referenca izgleda i ponašanja, ne kod. Sva logika je u klasi `Component` na dnu svake datoteke; tekstove preuzmi doslovno u `messages.hr.ts`.

## 2. Redoslijed gradnje

**Faza A: demo 2. 11. 2026.** (PLAN-DEMO)
1. Ljuska editora, traka alata, struktura, list, traka stanja (F-4, F-8).
2. Osam stanja spremanja, rad bez mreže, druga kartica (F-8).
3. Naslovi, navod kao atom, bibliografija FPZG (F-8, K-2).
4. Komentar uz odlomak, pogled nastavnika (F-9, B-10, B-11).
5. Prijava v5 bez e-pošte i putovnice; upis + obavijest S3 (F-5, F-7). **Tekst obavijesti tek nakon odluke iz §4.1.**
6. Predaja, sažetak procesa isti za oba (F-10, B-12, B-13).
7. Brz put (F-11).

**Faza B: nakon demoa, M2–M4**
8. Literatura (uvoz BibTeX/RIS/Zotero, 2019a/b, navodi bez izvora, bilješke iz čitanja).
9. Dorada u rundama, prijedlozi izmjene, usporedba rundi, "novo od zadnjeg pregleda".
10. Mentorstvo: etape, konzultacije, rubrika, izvješće, ocjena.
11. Početna, obavijesti (aplikacija + e-pošta), komentari na mobitelu.
12. Pomoć u pisanju: @navod, /naredbe, rupe, fraze, kostur odlomka, riječ u kontekstu, prijelazi, oblik rečenica.
13. Uvoz teksta, izvoz .docx/PDF po FPZG-u, predajni paket, putovnica + javna provjera.
14. Povjerenstvo, koordinator, "Kako Ductura radi", prijava e-poštom.

**Faza C: tek nakon pravnog mišljenja**
15. Zapis unosa s lancem hasheva i istraga (§4.1).

**Kasnije:** čitanje naglas, diktiranje, glasovni komentar, mirni način, asistent.

## 3. Kako spojiti

### 3.1 Editor (Tiptap)
> **Napomena u repou:** komentar kao mark i navod kao atom su PRIJEDLOG (D-133, D-134). Za demo vrijedi PLAN-DEMO F-8: navod kao običan tekst (dopuna D-98).

- Oznake iz prototipa postaju **marks/nodes**: `citation` (atom, attrs `sourceId, page`), `comment` (mark, `commentId`), `gap` (`[?] [izvor] [provjeri] [broj]`), `footnote`, `crossRef` (`targetId`), `imported` (mark), `figure`/`table` s `caption` i `source`.
- Spajanje susjednih navoda: plugin koji pri renderu grupira susjedne `citation` čvorove; u dokumentu ostaju zasebni.
- 2019a/2019b: izračun u selektoru nad literaturom, ne sprema se.
- Provjere: čiste funkcije `(chapter, doc, profile) → Finding[]` (PROVJERE.md §4–§6), pokreću se s debounceom 400 ms; poslužitelj ih ponavlja pri predaji.
- Prečaci: Ctrl+Alt+↑/↓ i Alt+Shift+↑/↓ (poglavlje), Ctrl+. (mirni način), @ i / kao suggestion pluginovi.

### 3.2 Spremanje i journal (Dexie)
- Postojeći journal ostaje izvor istine na uređaju; stanja iz `src/domain/sync/labels.ts`.
- **Ako se odobri §4.1** *(PRIJEDLOG dizajna, ne gradi. Sukobljava se s D-24 (vrijeme ne finije od minute), D-56 i D-125; čeka vlasnikovu D-odluku i pravno mišljenje (GDPR čl. 35). Tekst obavijesti S3 u demou slijedi važeće D-24 i D-56, ne opis iz prototipa.)*: journal dobiva zapis po unosu `{t, op, pos, s|n, paste?}` i `h = SHA-256(h_prev ‖ JSON)`; `h_0 = SHA-256("zadatak:" + taskId + "|student:" + userId)`. Šalje se u skupinama; poslužitelj provjerava lanac pri primitku i odbija skupinu s prekidom (→ stanje ERROR s "Izvezi tekst").

### 3.3 Poslužitelj (zapisi)
> **Napomena u repou:** dio o istrazi (§6e) je PRIJEDLOG dizajna, ne gradi. Sukobljava se s D-24 (vrijeme ne finije od minute), D-56 i D-125; čeka vlasnikovu D-odluku i pravno mišljenje (GDPR čl. 35). Tekst obavijesti S3 u demou slijedi važeće D-24 i D-56, ne opis iz prototipa.

Sve tablice i tko vidi što: PROVJERE.md §6c, §6d, §6e. Ključno:
- jedan rad, oba ekrana čitaju isto; stanje rada računa se iz zahtjeva i rundi;
- runda = jedna predaja na pregled;
- mentorove privatne bilješke i nacrt ocjene nikad u studentski API;
- koordinator dobiva samo agregate (bez `userId` u odgovoru);
- istraga: `investigation {id, workId, requestedBy, reason, approver, decision, decidedAt, openedAt, replyDue, reply, outcome, outcomeNote}` + `access_log {investigationId, userId, at}`; prikaz unosa dostupan **samo** kad `decision = approved`, i studentu i mentoru jednako.

### 3.4 Prava pristupa (RLS / middleware)
| Uloga | Vidi |
|---|---|
| Student | svoj rad, komentare, sažetak procesa, istragu o sebi kad je odobrena |
| Mentor | radove svojih kolegija; zapis unosa samo u odobrenoj istrazi |
| Član povjerenstva | zaključan predani rad, putovnicu, svoju ocjenu; tuđe ocjene kad svi predaju |
| Koordinator | agregate; odobrava istrage |
| Javno | provjera putovnice po kodu (bez teksta i komentara) |

### 3.5 Obavijesti
Događaji: `comment.created`, `revision.requested`, `revision.accepted`, `deadline.7d`, `deadline.1d`, `investigation.opened`, `investigation.closed`. Zadnja dva **ne mogu se isključiti**. Kanali: aplikacija, e-pošta (postavke po vrsti, Početna).

### 3.6 Testovi koje treba dodati
- P-6 (CI): studentski prikaz bez postotaka i mjera ritma; iznimka samo ruta `/istraga/*` uz odobrenu istragu.
- Jednakost sažetka procesa za studenta i mentora (B-13).
- Lanac hasheva: izmjena jednog zapisa → prekid točno na tom indeksu.
- Prava: mentor bez odobrene istrage dobiva 403 na zapis unosa.
- Koordinator: odgovor ne sadrži imena ni ID-eve studenata.

## 4. Što nije riješeno

### 4.1 Pravno i odluke (blokira fazu C i tekst obavijesti)
1. **Zapis svakog unosa i istraga** proturječe dosadašnjem D-56 i PRODUCT.md §5 koji je pisan bez iznimke. Treba: pravno mišljenje, procjena učinka (GDPR čl. 35), pravna osnova (javni interes / legitimni interes ustanove), odluka u `DECISIONS` koja zamjenjuje D-56, izmjena PRODUCT.md §5 ("osim u odobrenoj istrazi").
2. **Tko odobrava istragu** na FPZG-u (koordinator ili etičko povjerenstvo) i veza sa stegovnim pravilnikom.
3. **Rok čuvanja** zapisa ("kao rad") treba točan broj iz pravilnika FPZG-a.
4. **Ime**: Ductura ili Ductus.
5. **Boje**: prototip vs. tokeni iz PR #386 (README §9).
6. **Profil FPZG**: opseg, Sažetak 150–300 riječi, 3–5 ključnih riječi, kontrolni popisi — potvrditi prema službenim Uputama prije `fpzg.json`.
7. **Čl. 8 Pravilnika**: u prototipu je sažetak; u aplikaciji doslovni tekst.
8. **Logo i pilot** na prijavi (oznaka [potvrditi]).
9. **Adresa podrške i obavijest o privatnosti** su rezervirana mjesta.

### 4.2 Prototip ne pokazuje ili samo glumi
- Podaci se ne čuvaju između učitavanja (bilješke, glasovni komentari, odloženo, ciljevi poglavlja).
- Ekrani ne dijele podatke (mentor i student imaju svaki svoju kopiju).
- Zotero uvoz radi stvarno samo za javne zbirke; privatne trebaju poslužiteljski proxy (CORS, API ključ ne smije u preglednik).
- Prijava e-poštom, slanje e-pošte, preuzimanje paketa, izvoz .docx/PDF: samo izgled.
- Provjera putovnice: SHA-256 datoteke je stvaran, predana datoteka je izmišljena.
- Kod zadatka: demo prihvaća bilo koji; u aplikaciji generira ga poslužitelj pri objavi, format `FPZG-XX-XXX`, provjera na poslužitelju, ograničenje pokušaja.
- Istraga: zapis je izmišljen (jedan odlomak, 224 unosa); stvaran rad ima stotine tisuća unosa → reprodukcija mora raditi nad snimkama stanja svakih N unosa, ne od nule.
- Diktiranje i čitanje naglas ovise o glasovima preglednika; hrvatski nije zajamčen.
- Komentar može obuhvatiti samo jedan odlomak.

### 4.3 Nedovršeno u dizajnu
- Pristupačnost: puni prolaz tipkovnicom i čitačem zaslona, kontrast, povećanje teksta (napravljen samo vidljiv fokus i "Preskoči na sadržaj").
- Početna se ne prikazuje nakon prijave (student ide na upis); za studenta koji se vraća treba voditi na Početnu.
- Nastavnički ekrani Novi zadatak, Predaja i Brz put nisu vizualno usklađeni s Prijavom v5.
- Starije verzije (Editor v2–v10, Demo tok, Prijava v1–v4) imaju stari tekst o bilježenju; nisu u paketu.
- Asistent: samo "uskoro".
- Engleska inačica sučelja: nema.
- Mobilni editor: namjerno nema (samo komentari).

## 5. Provjera prije predaje programerima
- [ ] Odluka o §4.1 zapisana i PRODUCT.md §5 izmijenjen.
- [ ] Tekst obavijesti S3, "Što Ductura čuva" i "Kako Ductura radi" pregledan s pravnikom.
- [ ] Boje i ime odlučeni.
- [ ] Profil FPZG potvrđen.
- [ ] Svaki `.dc.html` otvoren u pregledniku iz ove mape (s `support.js`) bez grešaka.
