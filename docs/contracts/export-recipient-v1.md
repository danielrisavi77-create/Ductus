# Izvoz po primatelju: klase, pokretači, poveznica i artefakt v1

DAN-316, plan rb 146, val 2, `critical`. Ugovor nema koda. Određuje komu se izvozi, tko pokreće izvoz i koje klase podataka iz DATA-CLASS (`docs/privacy/06-klase-podataka.md`) smiju ući u paket. Određuje i trajanje poveznice, odvojeno od roka izvoznog artefakta. Prije prvog retka koda u M8.6, M10.5, M10.6 i M10.11 popisuje testove koje kodni PR-ovi moraju imati. Ne donosi nove odluke, nego provodi zapisane. Sve što odluke ne zatvaraju ostaje otvoreno.

Izvori:
- D-173 (paket, poveznica 24 h, bivši student preko referade);
- D-271 MQ02 (referada i admin s referencom, jednokratna poveznica, revizijski trag);
- D-273 MQ08 i dopuna D-285 (artefakt 24 h, ponovna isporuka, predani DOCX i PDF se ne brišu);
- D-274 MQ09 (klasa 12 rezervirana) i MQ12 (izlaz iz usluge);
- D-284 (PDF/A), D-286 (CSV redak), D-287 (A-03), D-130;
- D-262 Q04 i Q06 (obrazac reference, konzola operatera), D-264 Q11 (hash je osobni podatak), D-09;
- `docs/PRODUCT.md` §5 pravilo 5, F-04, R-07, S-10.

Plan napada je #1882: klase ulaza A1 do A13, pokretač i ovlast B1 do B10, poveznica i artefakt C1 do C14, sadržaj D1 do D6, istodobnost N1 do N5, otvorena pitanja O-1 do O-6. Ugovor se poziva na te oznake i ne ponavlja ih.

Linear nije bio dostupan iz sesije koja je pisala ugovor. Opseg je preuzet iz dodjele orkestratora na #1836, a `DAN-316` u Linearu treba usporediti s njim (O-1).

## Što ugovor ne odlučuje

- **Oznaka koraka.** Dodjela zove ovaj korak M10.0-S2. U `docs/PROGRAM-RAZRADA.md` je M10.0-S2 raspored pg-boss. Izvoz je u M8.6 (DAN-316, DAN-341), M10.5, M10.6 (DAN-416) i M10.11. Ugovor ne preimenuje nijedan korak (O-1).
- **Format paketa, manifest i `ExportSnapshot`.** To su M8.0-S2 (DAN-636) i manifest DAN-341. Ovaj ugovor određuje samo što smije ući, a ne kako je zapisano.
- **Rokovi čuvanja po klasama.** Određuje ih D-30 (PRIJEDLOG, Q-16). Ugovor ne briše ništa novo.
- **Postupak provjere identiteta u referadi.** Potvrđuje ga FPZG (D-271 MQ02, radnja vlasnika).
- **Tekst i ekrani.** Pripadaju UX koraku M8 i M10. Ugovor samo zabranjuje sadržaj, a riječi ne propisuje.

## 1. Primatelji i pokretači

| Primatelj | Tko pokreće | Uvjet | Kako stiže | Izvor | Plan |
| --- | --- | --- | --- | --- | --- |
| Student | Student sam, pod svojom AAI@EduHr prijavom | Rad je predan i pripada mu | Poveznica na 24 h | D-173, D-09 | B1, B2, B3 |
| Bivši student | Admin ustanove, s referencom na zahtjev koji je primila referada | Referada je provjerila identitet; rad je predan | Jednokratna poveznica na 24 h koju predaje referada | D-271 MQ02, D-262 Q04 | B4, B5, B6 |
| Portfelj | Student sam | Kao za studenta | Kao za studenta | S-10, M10.11 | A9 |
| Izlaz ustanove | Operater, preko konzole | Pisani zahtjev ustanove i imenovani primatelj | Isporuka imenovanom primatelju, s manifestom DAN-341 | D-274 MQ12, D-262 Q06, F-04 | B7, B8 |

Pravila za sve primatelje:
- Nema nove uloge ni novog načina prijave. Bivši student nema račun u Ductusu, a poveznica mu ne otvara sesiju ni bilo koji drugi put u aplikaciju (D-09; B9).
- Pokretač nikad ne određuje opseg paketa. Opseg je ovaj ugovor; zahtjev s popisom klasa, ID-om tuđeg rada ili drugim primateljem odbija se (B1, B2, B10).
- Admin ustanove pokreće posao, ali ne vidi ni ne preuzima sadržaj paketa za bivšeg studenta (B6).
- Izlaz ustanove ne pokreće brisanje i ne mijenja nijedan zapis (D-274 MQ12; C12).

## 2. Ishodi

- `da`: klasa ulazi u paket tog primatelja, samo za njegov rad ili njegovu ustanovu.
- `ne`: klasa ne ulazi.
- `otvoreno`: odluka ne postoji. **Do odluke vrijedi kao `ne`.** Kod ne smije imati granu koja klasu `otvoreno` stavlja u paket, ni iza zastavice.

Bivši student uvijek ima jednake ishode kao student (D-271 MQ02 mijenja put, ne opseg; A8). Portfelj nikad nema više od studentskog paketa (A9).

## 3. Klase po primatelju

Nazivi i redoslijed odgovaraju DATA-CLASS. Test `src/domain/privacy/export-recipient-contract.test.ts` to provjerava.

| Klasa | Naziv | Student | Bivši student | Portfelj | Izlaz ustanove | Izvor |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Identitet računa | ne | ne | ne | da | F-04; studentu D-173 ne navodi identifikator, a D-264 Q11 ga čini osobnim podatkom |
| 2 | Ime i prezime | da | da | otvoreno | da | D-286 (student dobiva svoj redak s prezimenom i imenom); portfelj O-3 |
| 3 | Sesije prijave i odjave | ne | ne | ne | ne | Tajne sesije; čuvanje 30 dana (D-273 MQ08) |
| 4 | Nastava i članstvo | ne | ne | ne | da | F-04 |
| 5 | Uloge i dodijeljeni pristup | ne | ne | ne | da | F-04 |
| 6 | Obavijesti u aplikaciji | ne | ne | ne | otvoreno | Prolazni podatak; F-04 ga ne imenuje (O-5) |
| 7 | Potvrda obavijesti uz zadatak | ne | ne | ne | da | F-04 |
| 8 | Evaluacija pilota | ne | ne | ne | otvoreno | Odvojeno od evidencije; tko je voditelj obrade evaluacije je Q-3 (O-5) |
| 9 | Zadatak i verzije zadatka | ne | ne | ne | da | F-04 |
| 10 | Pravila fakulteta i jezik rada | ne | ne | ne | da | F-04 |
| 11 | Projekt i dokument | ne | ne | ne | da | F-04 |
| 12 | Privatna povijest rada | ne | ne | ne | ne | D-274 MQ09, klasa rezervirana |
| 13 | Revizije dokumenta | ne | ne | ne | da | F-04; studentu D-173 daje samo predani tekst |
| 14 | Kontrolne točke s punim tekstom | ne | ne | ne | da | F-04 |
| 15 | Stanje prikaza uživo | ne | ne | ne | otvoreno | Izvedeno stanje; F-04 ne kaže ulazi li (O-5) |
| 16 | Predani rad | da | da | da | da | D-173, D-271 MQ02, S-10, D-274 MQ12, D-285 |
| 17 | Izjava o pomoći AI-ja i ispisi razgovora | otvoreno | otvoreno | ne | da | D-173 je ne navodi (O-6); izlaz F-04 |
| 18 | Komentari | otvoreno | otvoreno | ne | da | D-173 ih ne navodi (O-6); izlaz F-04 |
| 19 | Zahtjevi za doradu | otvoreno | otvoreno | ne | da | D-173 ih ne navodi (O-6); izlaz F-04 |
| 20 | Izvozni paket | ne | ne | ne | ne | Paket je izlaz, ne ulaz (D-273 MQ08) |
| 21 | Odsječci i paketi evidencije | ne | ne | ne | da | F-04; studentu ide potvrda, ne evidencija (D-173) |
| 22 | Vrijeme po promjeni | ne | ne | ne | da | F-04, D-143 |
| 23 | Odbačeni privremeni objekti | ne | ne | ne | ne | Brišu se (D-273 MQ08) |
| 24 | Zapis AI pomoćnika | ne | ne | ne | otvoreno | Q-10 i D-194 nisu zatvoreni (O-5) |
| 25 | Zapis pristupa radu | ne | ne | ne | da | F-04; studentov prikaz je D-274 MQ10, ne izvoz |
| 26 | Događaji promjena ovlasti | ne | ne | ne | da | F-04 |
| 27 | Hashevi i potvrde | da | da | otvoreno | da | D-173 (potpisana potvrda, manifest s otiscima), DAN-341; portfelj O-3 |
| 28 | Evidencija brisanja | ne | ne | ne | da | F-04 |
| 29 | Kopije baze i bucketa | ne | ne | ne | ne | Kopije se ne izvoze; izlaz čita izvorne tablice |
| 30 | Lokalni dnevnik na uređaju | ne | ne | ne | ne | Nije na poslužitelju |
| 31 | Prijave problema | otvoreno | otvoreno | ne | otvoreno | DAN-431; D-173 i F-04 je ne navode; portfelj nikad (A9) |

Za `da` kod studenta, bivšeg studenta i portfelja vrijedi samo onaj redak klase koji pripada tom radu i toj osobi (A2). Za `da` kod izlaza vrijede samo retci te ustanove (A10). Brojevi klasa osim sidara 1, 4, 12, 16 i 27 slijede DATA-CLASS. Ako se DATA-CLASS promijeni, ugovor se mijenja u istom PR-u, a test pada dok se to ne učini.

## 4. Podaci izvan klasa

Ovi podaci nisu zaseban redak DATA-CLASS, ali ne smiju stići do primatelja ni kroz klasu u koju bi inače upali.

| Podatak | Student | Bivši student | Portfelj | Izlaz ustanove | Izvor |
| --- | --- | --- | --- | --- | --- |
| Mentorovi radni zapisi | ne | ne | ne | otvoreno | D-130 (ne ulaze u izvoz), `docs/PRODUCT.md` §5 pravilo 5; izlaz O-2 |
| Rezultat A-03 | ne | ne | ne | ne | D-287 |
| Ocjena i obrazloženje prije objave | ne | ne | ne | otvoreno | D-130, D-135 (uvjetno, ne gradi se prije D-55); izlaz O-2 |
| Ključevi, tokeni i tajne | ne | ne | ne | ne | `docs/SECURITY.md`; ni potpisni ključ ustanove, ni token poveznice, ni tajna sesije |

## 5. Poveznica

| Pravilo | Ugovor | Izvor | Plan |
| --- | --- | --- | --- |
| Trajanje | Poveznica vrijedi 24 sata od izdavanja. Granica je isključiva: u trenutku izdavanja + 24 h više ne vrijedi. | D-173, D-271 MQ02 | C1 |
| Sat | Istek se računa po satu poslužitelja (baze), nikad po satu klijenta ni po zaglavlju zahtjeva. | D-273 MQ08 | C2 |
| Jednokratnost | Poveznica bivšeg studenta vrijedi za jedno uspješno preuzimanje. Drugi pokušaj odbija se jednako kao istekla poveznica. Za studenta je jednokratnost otvorena (O-4) i zasad vrijedi kao jednokratna. | D-271 MQ02 | C3, C4 |
| Trag | Izdavanje, preuzimanje i odbijeni pokušaj bilježe se u revizijskom tragu, bez tokena i bez otiska sadržaja. | D-271 MQ02, D-264 Q11 | C5, D3 |
| Bez ovlasti | Token poveznice ne daje sesiju, ne produžuje se i ne otvara drugi paket ni drugi rad. | D-09 | B9 |
| Isti odgovor | Nepostojeća, istekla, iskorištena i tuđa poveznica daju isti odgovor bez pojedinosti. | #1882 | C6 |

## 6. Izvozni artefakt

Rok artefakta je zasebno pravilo od roka poveznice (MQ08), iako oba danas traju 24 sata.

| Pravilo | Ugovor | Izvor | Plan |
| --- | --- | --- | --- |
| Rok | Novi izvozni artefakt (klasa 20) briše se 24 sata nakon nastanka. Brisanje ide kroz raspored pg-boss, bez obzira na to je li poveznica iskorištena. | D-273 MQ08, MQ14 | C7 |
| Odvojeni rokovi | Istek poveznice ne briše artefakt, a brisanje artefakta ne produžuje poveznicu. Svaki ima svoj stupac i svoju provjeru. | D-273 MQ08 | C8 |
| Predana datoteka | Bajtovi DOCX-a i PDF-a iz trenutka predaje dio su zapisa predaje (klasa 16) i nikad se ne brišu po pravilu 24 h. Izvoz ih kopira nepromijenjene, a ne premješta. | D-285 | C9 |
| Ponovna isporuka | Novi posao nad istim snimkom daje novi artefakt i novu poveznicu. Izvorni posao i njegov trag ostaju. Otisci sadržaja u manifestu jednaki su prvoj isporuci. | D-273 MQ08 | C10, C11 |
| Bez novog vremena | Ponovna isporuka ne mijenja vrijeme predaje, potvrdu ni manifest predaje. | D-173, `submission-receipt-v2.md` | C11 |
| Zadržavanje | Izvoz ne skida zadržavanje (D-274 MQ11) i ne briše ništa što zadržavanje drži. Smije li se izvoziti rad pod zadržavanjem, ugovor ne odlučuje. | D-274 MQ11 | C13 |
| Izlaz | Izlaz iz usluge ne mijenja rokove ni zapise. Nakon isporuke ne pokreće brisanje. | D-274 MQ12 | C12, C14 |

## 7. Sadržaj paketa

- PDF teksta nosi oznaku PDF/A samo nakon uspješne veraPDF provjere. Bez nje se oznaka ne piše (D-284; D1).
- Paket za studenta, bivšeg studenta i portfelj ima odjeljak „Što ovaj paket ne dokazuje”, jednak onome uz potvrdu (D2).
- Hashevi, tokeni i potpisi ne pišu se u log aplikacije ni workera (D-264 Q11; D3).
- Isti podatak ima istu vrijednost u sučelju, API-ju i izvozu (R-07; D4).
- Studentov CSV redak ima iste stupce kao CSV za Merlin i ništa iz sažetka procesa (D-286; D5).
- Tekst koji Ductus sam piše u paket (oznake, naslovi, objašnjenja i tekst sučelja izvoza) ne sadrži riječ iz rječnika zabranjenih izraza (`docs/PRODUCT.md` §5; D6). Predani rad i drugi tekst koji je napisao korisnik prenose se nepromijenjeni, pa se na njih rječnik ne primjenjuje.

## 8. Veza s drugim ugovorima

- **M8.0-S2 (DAN-636):** `ExportSnapshot`, format paketa i rok trajanja artefakta. Ako M8.0-S2 odredi drugačiji rok artefakta od odjeljka 6, vrijedi D-273 MQ08, a nesklad ide orkestratoru.
- **Manifest DAN-341:** jedan verzioniran potpisani manifest s jednim nositeljem, zajedno s M7.10-P01 (D-263 Q23). Izlaz ustanove nosi taj manifest (D-274 MQ12).
- **`docs/contracts/submission-receipt-v2.md`:** potvrda u paketu je ta potvrda, nepromijenjena.

## 9. Obvezni testovi kodnih PR-ova

Prvi kodni PR za pojedinog primatelja mora imati testove iz #1882 za tog primatelja, napisane prije koda. Svaki test pada bez provjere koju štiti.

- **Klase:** paket svakog primatelja sadrži točno klase s `da` iz odjeljka 3 i ništa iz odjeljka 4. Klasa `otvoreno` u paketu je pad (A1 do A13).
- **Ovlast:** tuđi rad, rad bez predaje, posao bez reference, admin koji čita sadržaj i operater bez pisanog zahtjeva ili imenovanog primatelja odbijaju se (B1 do B10).
- **Poveznica i artefakt:** granica 24 h u točnoj sekundi, sat klijenta naprijed i natrag, drugo preuzimanje, brisanje artefakta neovisno o poveznici, D-285 i ponovna isporuka s jednakim otiscima (C1 do C14).
- **Sadržaj:** PDF/A samo uz veraPDF, log bez hasheva i tokena, R-07 i CSV redak (D1 do D5). Rječnik zabranjenih izraza provjerava se samo nad tekstom koji Ductus piše u paket, a predana datoteka u paketu bajtno je jednaka predanoj, i kad sadrži riječ iz rječnika (D6).
- **Istodobnost:** dva istodobna preuzimanja iste jednokratne poveznice daju točno jedno preuzimanje. Brisanje artefakta za vrijeme preuzimanja ne daje nepotpun paket. Dvije ponovne isporuke daju dva posla bez prepisivanja. Opoziv za vrijeme posla i istek u trenutku preuzimanja ponašaju se kao u #1882 (N1 do N5).

Svi podaci u testovima su izmišljeni (`CLAUDE.md`).

## 10. Otvorena pitanja

Do odluke svako otvoreno pitanje vrijedi kao zabrana.

- **O-1, oznaka i Linear.** Ovaj korak se u dodjeli zove M10.0-S2, a u `docs/PROGRAM-RAZRADA.md` je M10.0-S2 nešto drugo. Treba ga i usporediti s `DAN-316` u Linearu. Odlučuje orkestrator.
- **O-2, izlaz ustanove i mentorovi zapisi.** D-130 kaže da mentorovi radni zapisi ne ulaze u izvoz, a F-04 traži sve podatke fakulteta. Je li izlaz iz usluge „izvoz” u smislu D-130? Isto vrijedi za neobjavljenu ocjenu. Do odluke ništa od toga ne ulazi. Odlučuje vlasnik.
- **O-3, portfelj.** Ulaze li u portfelj potvrda, otisci i ime (klase 2 i 27)? S-10 navodi samo predani rad. Odlučuje vlasnik.
- **O-4, studentska poveznica.** D-271 MQ02 traži jednokratnost samo za bivšeg studenta. Je li studentova poveznica također jednokratna? Odlučuje vlasnik.
- **O-5, izlaz i klase 6, 8, 15 i 24.** F-04 kaže „svi podaci fakulteta”, a za ove klase nije jasno jesu li podaci fakulteta, dobavljača ili prolazno stanje. Odlučuje vlasnik uz paket Q-3.
- **O-6, klase 17, 18 i 19 za studenta.** D-173 nabraja PDF, potvrdu i manifest. Izjava o AI-ju, komentari i zahtjevi za doradu nisu ni uključeni ni isključeni. Odlučuje vlasnik.
