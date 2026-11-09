# Referentne slike M7, paket 6: S-15, S-30, S-31, S-32, S-33 (DAN-600)

Ovo je paket 6 iz `docs/design/EKRANI.md` §4 (Predaja, student). Sadrži ekrane S-30 Pregled prije predaje, S-31 Izjava i S-32 Potvrda predaje (prvi PR) te S-15 Panel Rad i S-33 Sažetak procesa (drugi PR).

Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači da su slike odobrene kao referenca (D-183). Dotad su prijedlog.

Ulaz je M7 UX prolaz, issuei #1779 do #1790. Stari prototipovi `../demo-tok-v2.dc.html` (koraci predaje) i `../editor-v11.dc.html` (bočni panel) nisu odobrena referenca (DESIGN-SYSTEM §1 t. 4). Iz njih nisu preuzeti ni raspored ni boje.

Stranice su složene iz dijelova `../m5-reference` i `../m7-reference-c`: koraci, kartica, oznaka, dijalog, kartice panela i kostur učitavanja.

## Stranice

| Stranica | Prototip | Stanja | Izvori |
|---|---|---|---|
| `s30-pregled-prije-predaje.html` | `../demo-tok-v2.dc.html` (stari, nije preslikan) | korak 3 prije predaje (popis), korak 4 prije roka, nakon roka, produljen rok, bez mreže, prazno (rad nije započet), odbijeno (zapis nije potvrđen), predaja nije dovršena, već zatraženo i ishod nepoznat, učitavanje, greška | #1779, #1780, #1782, #1784, #1787, D-128, D-129, D-137, Q07, Q-3, PRODUCT §5 pravila 3 i 5 |
| `s31-izjava.html` | `../demo-tok-v2.dc.html` (stari, nije preslikan) | popunjeno, izjava i zapis se ne slažu, pregled priloženog razgovora, prazno (ništa zabilježeno), učitavanje, greška | #1783, D-40, D-44, D-62, D-263 Q22, PRODUCT §5 pravilo 5 |
| `s15-panel-rad.html` | `../editor-v11.dc.html` (stari, nije preslikan) | popunjeno (u pisanju), poslano na pregled uz produljen rok, predano, predaja nije dovršena, prazno (nije započeto), učitavanje, greška | #1782, D-47, D-62, D-128, D-136, D-249, Q-3 |
| `s32-potvrda-predaje.html` | `../demo-tok-v2.dc.html` (stari, nije preslikan) | popunjeno i potpisano, potvrda čeka potpis, nakon roka, zapis ima praznine, prazno (rad nije predan), učitavanje, greška | #1781, #1782, D-49, D-128, Q07, `docs/contracts/submission-receipt-v2.md` |
| `s33-sazetak-procesa.html` | nema | popunjeno (rad predan), prije predaje uz praznine u zapisu, prazno, učitavanje, greška | PRODUCT §6 nastavnik t. 8, §7, pravilo 5, #1789, C-12, D-41, D-44, D-57, D-129, P-01, P-02 |

Mobitel je snimka širine 400 px. Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`. Izrađene su Playwrightovim Chromiumom:

- cijela stranica, DPR 1, nakon `document.fonts.ready`;
- bez vodoravnog pomicanja na obje širine.

Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m7-reference-c/reference.css` (a time i `../m5-reference/reference.css`) i dodaje samo:

- niz koraka;
- blok stanja;
- mono redak otiska;
- okvir izjave;
- širinu padajućeg izbornika;
- široku varijantu (dva stupca), redak događaja s oznakom, citat, bočni panel s karticama i popis poveznica (drugi PR).

## Odluke u slici

### Pregled prije predaje (S-30)

- Tok ima pet koraka (tekst, izjava, prije predaje, predaja, potvrda), a pregled je korak 3. Popis kaže je li sve priloženo i ne ocjenjuje rad. Retci popisa:
  - izjava;
  - razgovori;
  - mjesta za izvor;
  - zalijepljeni odlomci;
  - pravila oblika.
- „Mjesto za izvor” i „Zalijepljeno (izvor nije opažen)” su dva različita retka (D-137). Uz zalijepljeno stoji „Možete dodati oznaku podrijetla. Nije obavezno.”
- Do potvrde D-129 nijedan redak popisa ne zaustavlja predaju. Nema ocjene ni oznake „prolazi” (D-62).
- Napomena uz predaju nije obavezna i vodi na S-43.
- Nakon roka predaja izgleda jednako kao prije roka: isti tekst, rub i boja, bez crvene (D-128). „Nakon roka” ovisi samo o vremenu zahtjeva i o roku zamrznutom pri zahtjevu (Q07).
- Produljen rok se prikazuje kao oznaka uz rok.
- Bez mreže se predaja ne nudi. Tekst je spremljen na uređaju, a gumb „Predaj rad” je onemogućen s objašnjenjem. Vrijeme predaje je trenutak kad zahtjev stigne na poslužitelj (`requestedAt`), ne trenutak klika. To piše i u koracima 4 prije i nakon roka.
- Odbijanja poslužitelja imaju zaseban tekst:
  - nije započet (`notStarted`);
  - zapis nije potvrđen (`blocked`);
  - predaja nije dovršena (`recordMismatch`);
  - već zatraženo (`alreadyRequested`);
  - ishod nepoznat (`unavailable`).
- Svako odbijanje kaže što student sada radi (#1780) i ne govori o studentu (pravilo 3).
- `recordMismatch` vodi na zamjenski postupak. Kontakt je „Obratite se nastavniku kolegija”.
- Greška učitavanja ne tvrdi da predaja postoji ili ne postoji. Traži ponovni pokušaj prije nove predaje.

### Izjava (S-31)

- Naslov je „Izjava o korištenju generativne umjetne inteligencije”, uz uputu na čl. 9 i 15 pravilnika fakulteta (#1783).
- Zabilježeno i izjavljeno su odvojeni (D-40, D-44):
  - okvir „Zabilježeno u Ducturi” ima puni rub, a student ga ne može brisati, samo dodati objašnjenje;
  - okvir „Vaša izjava” ima isprekidani rub i oznaku „izjavljeno”.
- Uz svaki priloženi razgovor je „Pregledaj razgovor”. Dijalog prikazuje cijeli razgovor točno kako je zabilježen, prije potvrde (D-263 Q22).
- Razgovor iz kojeg je prenesen tekst nosi oznaku „Obvezno”.
- Potvrda izjave nije unaprijed označena.
- Kad se odabrani obrazac izjave i zapis ne slažu, slika to kaže činjenicom o zapisu („Zapis bilježi prijenos iz AI pomoćnika na …”) i traži provjeru odabira. Nema ocjene ni zaustavljanja. Nastavnik vidi isto (pravilo 5).
- Model u zapisu je izmišljena oznaka „M-2”.

### Potvrda predaje (S-32)

- Prikazana su polja potvrde v2:
  - vrijeme predaje iz `requestedAt`;
  - rok iz `dueAt`;
  - „nakon roka” iz `afterDeadline`;
  - „Potpisivanje potvrde započelo” iz `signedAt`. Prema ugovoru v2 to je početak izdavanja potpisa, ne trenutak dovršetka. Slika ga ne predstavlja kao vremenski žig treće strane.
- Vremena su po zagrebačkom vremenu s oznakom zone u istom retku, „(UTC+1)”, ljeti „(UTC+2)” (prijedlog iz #1788). Točne vrijednosti iz potvrde u UTC-u su u pojedinostima, neskraćene, sa šest decimala sekunde kako ih zapisuje ugovor v2.
- „Otisak predanog teksta” ima 64 heksadekadske znamenke u skupinama radi čitanja, uz objašnjenje.
  - „Kopiraj otisak” u međuspremnik stavlja 64 znaka bez razmaka.
  - Poveznica „Provjera potvrde” vodi na `/provjera` (J-03, D-49), bez prijave.
- Dok potvrda čeka potpis, stanje je „Predaja u obradi” (#1781, #1782). Preuzimanje zapisa i provjera nude se tek s potpisom.
- Predaja nakon roka je činjenica bez boje (D-128). Kasniji potpis ne mijenja „nakon roka” (Q07).
- Praznina u zapisu ne mijenja predaju ni vrijeme predaje. Vodi na sažetak procesa.
- Greška učitavanja ne tvrdi da predaja postoji ili ne postoji.

### Panel Rad (S-15)

- Kartica „Rad” stoji uz Upute, Literaturu i Komentare u bočnom panelu radnog prostora. Kartice su `tablist`; strelice lijevo i desno mijenjaju karticu.
- Naslov kartice je stanje rada, uz vrijeme kad ga ima: „U pisanju”, „Poslano na pregled {vrijeme}”, „Predano {vrijeme}”, „Predaja nije dovršena: zamjenski postupak”, „Nije započeto”. Ispod je rok.
- Produljen rok je oznaka uz rok, bez boje. Predaja nakon roka mijenja samo tekst naslova („Predano {vrijeme}, nakon roka”), ne boju (D-128).
- „Dogovoreno na konzultacijama” je tekst iz zapisa konzultacije. Nema kvačica ni oznake izvršenog (D-62). Student i mentor vide isti zapis (D-47).
- „Uz rad” vodi na uvoz postojećeg teksta, izjavu (S-31) i sažetak procesa (S-33); nakon predaje na potvrdu (S-32).
- „Pregled prije predaje” otvara korak 3 toka (S-30). Poslano na pregled ne zatvara pisanje: „Možete nastaviti pisati. Mentor vidi verziju koju ste poslali.”
- Etape se ne grade (D-249, D-136) i nisu nacrtane.
- Učitavanje i greška koriste postojeće ključeve `panelLoading` i `panelUnavailable`. Greška kaže da tekst rada u uređivaču ostaje kakav jest.

### Sažetak procesa (S-33)

- Stavke su redom iz tablice u `docs/PRODUCT.md` §7: razdoblje rada, sesije, aktivno vrijeme uređivanja, verzije, lijepljenja, uvozi, AI pomoćnik, zahtjevi za doradu, konzultacije, prilagodba, izmjene nastavnika, praznine u zapisu, izjava, napomene studenta, stanje zapisa. Karta podrijetla slijedi tablicu, kao u §7.
- Student vidi isti sažetak kao nastavnik (pravilo 5), u svakom trenutku, i prije predaje (§6 nastavnik t. 8). Prije predaje to piše na vrhu.
- Svaka brojka ima jedinicu, nazivnik i metodu (C-12). Prag stoji uz brojku na koju utječe: sesija je niz promjena bez prekida duljeg od 30 minuta (P-01), popisano je lijepljenje dulje od 200 znakova (P-02). Oba su postavke fakulteta.
- Aktivno vrijeme je zbroj trajanja navedenih sesija, uz rečenicu „Vrijeme uređivanja nije mjera truda ni vremena razmišljanja.”
- Uz lijepljenja, uvoze i AI nema zbroja, udjela u radu ni broja u naslovu stavke (§7 „Zabranjeno u sažetku”, #1789). Nema ocjene ni boje procjene.
- Svaka stavka nosi vrstu dokaza (D-44, §7) kao riječ u oznaci: „opaženo” s punim rubom, „izjavljeno” s isprekidanim, „uvezeno” uz uvoz. Oznaka stoji uz naslov stavke, a gdje se vrste miješaju, uz pojedini unos. Prilagodba je studentova oznaka, pa je „izjavljeno”; isto vrijedi za studentov navod da je zahtjev za doradu proveden i za oznaku studenta uz lijepljenje, uz zabilježeni „Izvor nije opažen”. Zapis mentora o konzultacijama i izmjene nastavnika nastali su u Ducturi i nose „opaženo”.
- Tekst prenesen iz AI pomoćnika prikazan je kao citat s pružateljem, modelom i svrhom. Razgovori se nastavniku prikazuju samo kao prilog izjavi (D-41).
- Izjava prikazuje tekst izjave i priloge (§7 „Tekst izjave i prilozi”, D-40, D-41), u istoj podjeli kao S-31: „Zabilježeno u Ducturi” (opaženo, puni rub) i „Izjava studenta” (izjavljeno, isprekidani rub). Ispod su prilozi; razgovor iz kojeg je prenesen tekst priložen je uvijek, a „Pregledaj razgovor” ga otvara kao u S-31 stanju 3.
- Vrijeme lijepljenja je zaokruženo na odsječak zapisa („odsječak oko 14:05”).
- „Prikaži mjesto u radu” i „Prikaži oznake u tekstu” vode na kartu podrijetla u tekstu (D-57, N-10 u `../m7-reference-b`).
- Praznina u zapisu je opisana verzijama na njezinim krajevima i ne zaustavlja predaju (D-129). Sesije se broje iz primljenih odsječaka; raspon praznine nije uračunat.
- Greška učitavanja kaže da se zapis rada ne mijenja i nudi ponovni pokušaj.

## Otvoreno za vlasnika

Slika ova pitanja označava kao otvorena i ne odlučuje ih:

- **Gdje popis živi (#1787).** Popis je ovdje nacrtan kao korak 3 toka predaje. Mjesto određuje orkestrator ili vlasnik.
- **Zaustavlja li išta predaju (D-129).** Dok FPZG to ne potvrdi, ništa ne zaustavlja.
- **Kontakt zamjenskog postupka (Q-3).** To je parametar fakulteta. Do odgovora FPZG-a tekst je „Obratite se nastavniku kolegija”.
- **Nazivi stanja (#1782).** „Predaja nije dovršena: zamjenski postupak” i „Predaja u obradi” preuzeti su iz prijedloga u #1782, koji još nije potvrđen.
- **Zona vremena (#1788).** S-32 prikazuje zagrebačko vrijeme s oznakom zone. J-03 u `../m7-reference-c` prikazuje UTC. Usklađivanje J-03 je otvoreno.
- **Kratka lijepljenja (S-33).** §7 kaže da se lijepljenja do praga „samo broje”. Slika taj broj ne prikazuje, jer #1789 traži da uz lijepljenje nema zbroja. Treba li broj kraćih lijepljenja, otvoreno je.
- **Sesije preko praznine (S-33).** Slika predlaže da se raspon praznine ne uračunava u sesije ni aktivno vrijeme.
- **Pragovi P-01 i P-02.** Vrijednosti 30 minuta i 200 znakova čekaju potvrdu (Q-2).
- **Konzultacije u sažetku (S-15, S-33).** S-33 prikazuje datum, temu, verziju rada i „Dogovoreno” (§7, D-47); S-15 prikazuje samo „Dogovoreno”. „Bilješka mentora” (privatni radni zapis, D-130) nije prikazana nigdje. Dvodijelni zapis iz D-135 čeka pravno mišljenje D-55, pa je oblik zapisa konzultacije otvoren.
- **Zahtjevi za doradu (S-33).** Oblik ovisi o arhitekturi komentara (Q-6, D-133).
- **„Napisano u Ducturi” i karta podrijetla (D-127, O-2).** Sažetak samo vodi na N-10; uključivanje prikaza nacrtano je ondje.
- **Prazno stanje panela (S-15).** Postojeći tekst `workEmpty` spominje etape, koje se ne grade (D-249). Slika koristi novi tekst; zamjena ključa je otvorena.
- **Naslov izjave.** #1783 predlaže „Izjava o korištenju generativne umjetne inteligencije”. `../m9-reference-b/s31-ai.html` koristi „Izjava o uporabi AI u predaji”. Usklađivanje je otvoreno.

## Nije nacrtano

- Ekrani paketa 7 (N-05, N-10, N-11, N-13) idu u `../m7-reference-b`.
- Panel napomena S-43 je u `../m7-reference-c`. Ovdje je samo poveznica na njega.
- Cijeli AI dio izjave (sastavljanje iz zapisa pomoćnika) je u `../m9-reference-b`.
- Sadržaj PDF zapisa i QR koda nije nacrtan, kao ni nastavnički prikaz predaje.
- Iz starog bočnog panela nisu nacrtane etape, „Priprema za konzultacije” ni sažetak s ključnim riječima.

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni: autor, rad, datumi, otisak i oznaka modela.
- Datumi 20. 11. i 27. 11. 2026. su primjer, ne stvarni rokovi.
- U S-33 su izmišljeni i naziv datoteke, pružatelj („Pružatelj A”), citat i napomena studenta.

## Provjera rječnika

Tekst i atributi svih pet stranica i tekst ovog README-a prošli su provjeru bez nalaza (`docs/PRODUCT.md` §5). Korištene su `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts`. Kontrolni prolaz s umetnutim zabranjenim izrazom javio je nalaz.
