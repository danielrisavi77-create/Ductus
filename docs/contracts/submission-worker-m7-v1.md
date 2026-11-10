# Predaja u workeru: zamrznuti kontekst, otprema i runde v1

DAN-381, plan rb 121, M7.0-S1. Ovo je ugovor bez koda: određuje što zahtjev za predaju zamrzava, kako se posao predaje šalje workeru bez korisničkog kolačića, kako se otvaraju runde i na što se veže registar poslanih verzija. Daje i popis testova koje M7.1 mora imati prije prvog retka koda. Ugovor ne donosi nove odluke, nego provodi zapisane.

Izvori:
- D-263 Q03, Q07, Q08, Q15 i Q26; D-237; D-28; D-74; D-261 Q02 i `STATE.md` Q-4 (worker DAN-517/518 prije DAN-381).
- `docs/PRODUCT.md` §5 pravilo 11; `docs/backend/poslovi-i-predaja.md` §4.5 i §4.6.
- Postojeći kod na `main`:
  - `db/migrations/20261018120000_submission_request.sql` (`evidence.submission_request`, `app.request_submission`);
  - `db/migrations/20261018140000_submission.sql` (`evidence.submission`, `app.record_submission`);
  - `src/server/evidence/submission.ts`;
  - `src/application/jobs/job-body.ts`, `src/server/attempt-fence.ts` i `src/server/db/job-queue.ts` (DAN-517, #1829);
  - uzorak uskih RPC-ova `app.worker_*` dodijeljenih samo ulozi `ductus_worker` (`db/migrations/20261031120000_evidence_worker_signature.sql`).

Plan napada je #1843 (klase J1 do J9 i F1 do F8; napadi A1 do A9, R1 do R5 i V1 do V5; istodobnost I1 do I6; otvorena pitanja OQ-1 do OQ-3). Plan napada workera je #1826 (W-1 do W-15). Ovaj ugovor se poziva na njihove oznake i ne ponavlja ih.

Oznake C01, C02 i C06 dolaze iz dodjele orkestratora za plan rb 121; u ostatku repoa ih nema.

## Što ugovor ne odlučuje

- **Model efektivnog roka.** D-263 Q07 kaže da zahtjev zamrzava efektivni rok, ali model efektivnog roka još nije zapisan u `docs/BACKEND.md` ni u `docs/DECISIONS.md`. Ugovor ga ne izmišlja. Do zapisa efektivni rok je rok verzije zadatka koju nosi zahtjev, kako ga danas računa `app.record_submission`. Testovi F1 do F4 dovršavaju se kad model bude zapisan (OQ-3).
- **Povijest produljenja** dobiva vlastitu tablicu u M7.3-P01 (D-263 Q07). Ugovor traži samo da produljenje ne mijenja već evidentiran ishod.
- **Popis „potvrđenog opoziva”.** D-263 Q03 ne nabraja što je potvrđeni opoziv prava (članstvo u kolegiju ili grupi, račun, `work_grant`). Ugovor ne određuje popis (OQ-1). Testovi zasad koriste uklonjeno članstvo, koje danas provjerava `app.lock_student_assignment`.
- **Protokol čekanja nepotpisanog odsječka.** Ostaje sadašnji blok s ponovnim pokušajem, a praznina se prikazuje kao praznina (D-263 Q26). Novi protokol traži novu odluku.
- **Tekst i ekrani za studenta i nastavnika.** To je M7.UX-R (D-263 Q16). Backend ne čeka slike.
- **Raspored koraka.** O rasporedu odlučuju `docs/PROGRAM.md` i `docs/PROGRAM-RAZRADA.md` (rb118, M7.0a); ovaj ugovor ih ne mijenja.

## Načela

| Pravilo | Ugovor | Izvor | Plan |
| --- | --- | --- | --- |
| Vrijeme predaje je klik | `requested_at` se piše iz sata baze u transakciji zahtjeva, prije reda. Worker ga ne mijenja i ne računa ponovno. | `poslovi-i-predaja.md` §4.6 | F6 |
| Zahtjev zamrzava kontekst | Worker čita verziju, reviziju, `content_hash` i rok iz retka zahtjeva, nikad iz trenutačnog stanja zadatka ili dokumenta. | D-263 Q07 | F1, F5 |
| Odjava ne zaustavlja | Prihvaćen posao predaje ne ovisi o sesiji. Odjava, istek ili brisanje sesije ne prekidaju ga. | D-263 Q03 | A1, I4 |
| Opoziv blokira novu finalizaciju | Ako je opoziv potvrđen prije zapisa ishoda, predaja se ne zapisuje, a zahtjev ostaje. Opoziv nakon zapisa ne briše predaju. | D-263 Q03, Q08 | A2, A3, I1 |
| Bez korisničkog kolačića | Worker nema korisnički token, kolačić ni `withActor`. Radi kao `ductus_worker`, kroz uske RPC-ove za jedan zahtjev. | D-263 Q03, D-74 | A4, A5 |
| Tijelo posla su samo ID-ovi | Tijelo je točno `{ submissionRequestId }` i prolazi `parseJobBody` pri stavljanju u red i pri izvođenju. | D-74, `job-body.ts` | J1 do J6 |
| Tehnička greška ne sprječava predaju | Pad workera vodi u ponovni pokušaj istog zahtjeva s istim `requested_at`. Nepodudarnost nakon roka ide u zamjenski postupak. | PRODUCT §5 pravilo 11, §4.6 | A8, F8 |
| Nepodudarnost blokira | Predaja se zapisuje kao uspjela samo ako rekonstrukcija odgovara `content_hash` zahtjeva. | PRODUCT §5 pravilo 11, izlaz M7 | A9 |
| Prethodna predaja je nepromjenjiva | Nijedan put ne mijenja ni ne briše redak zahtjeva ili predaje ranije runde. | D-263 Q08, D-28 | R2, R3 |
| Usporedba samo poslanih verzija | Usporedba vrijedi samo između poslanih verzija (poslanih na pregled ili predanih), u oba profila, bez oznake i bez ocjene. | D-237 | V1 do V5 |

## C01: zamrznuti kontekst zahtjeva

Danas redak `evidence.submission_request` nosi:

| Polje | Značenje | Tko ga piše |
| --- | --- | --- |
| `requested_at` | trenutak klika, sat baze | `app.request_submission` |
| `assignment_version` | verzija zadatka u trenutku klika | isto |
| `revision`, `content_hash` | revizija koja je bila trenutačna u trenutku klika i njen hash | isto |
| `document_id`, `project_id`, `principal_id`, `institution_id`, `assignment_id` | čiji je zahtjev i za što | isto |

Rok predaje danas dolazi iz verzije zadatka koju nosi zahtjev (`app.assignment_version_due`), a `after_deadline` je `requested_at > due_at`.

Ugovor za M7.1:
1. Worker sve navedeno čita samo iz retka zahtjeva. Nijedan podatak iz zahtjeva ne dolazi iz tijela posla (osim ID-a), iz okoline workera ni iz sata workera.
2. Rok koji odlučuje „poslije roka” je rok zamrznut zahtjevom. Kasnija nova verzija zadatka (F1) ili produljenje (F2, I3) ne mijenjaju ishod već evidentiranog zahtjeva. Produljenje je zasebna dopuna (D-263 Q07).
3. Ako se efektivni rok jednom bude razlikovao od roka verzije (nakon zapisa modela, OQ-3), zamrzava se u transakciji zahtjeva i zapisuje uz zahtjev. Worker ga ne računa. Kako i gdje se zapisuje, ugovor ne određuje.
4. Granica: rok jednak `requested_at` nije „poslije roka” (F3), a 1 µs kasnije jest (F4). To je postojeće ponašanje generiranog stupca i ne smije se promijeniti.
5. Revizija nakon klika ne ulazi u predaju (F5); vrijedi postojeća provjera revizije u `app.request_submission`.

## C02: otprema workera

Tijek koji M7.1 uvodi, bez propisivanja imena funkcija:
1. Web proces u sesiji studenta zove `app.request_submission` kao danas. Ishod `requested` ili `existing` vraća ID zahtjeva.
2. Posao predaje se stavlja u red s tijelom `{ submissionRequestId }`. Za red vrijedi pravilo jednog posla po subjektu (DAN-517); subjekt je ID zahtjeva.
3. Worker, kao `ductus_worker`, izvodi posao kroz uske `app.worker_*` RPC-ove:
   - čitanje zamrznutog konteksta i evidencije samo za taj zahtjev;
   - zapis ishoda samo za taj zahtjev.
   Nijedan RPC ne prima ID dokumenta, osobe ni ustanove kao zaseban argument (A5).
4. Zapis ishoda i provjera opoziva idu u istoj transakciji, pod istim redoslijedom zaključavanja kao `app.request_submission` (zadatak i članstvo `FOR SHARE`, zatim dokument), pa opoziv ne može proći između provjere i zapisa (I1).
5. Potpis potvrde ostaje kako je (potvrda v2, `docs/contracts/submission-receipt-v2.md`).

Granice uloga (pgTAP matrica):
- `ductus_app` nema `EXECUTE` na worker RPC-ovima predaje (A6);
- `ductus_worker` nema `INSERT`, `UPDATE`, `DELETE` ni `TRUNCATE` na `evidence.submission_request` i `evidence.submission`, nego piše samo kroz RPC (A7);
- RPC za zahtjev druge ustanove ili nepostojeći ID vraća isti ishod bez zapisa (J8, J9).

Idempotentnost:
- Ponovljen posao istog zahtjeva vraća postojeći ishod, a ne drugi zapis (I2). To osigurava postojeći `UNIQUE` na `evidence.submission`; ugovor traži test, ne novi ključ.
- Pokušaj kojem je istekao attempt fence ne smije zapisati ishod nakon što je novi pokušaj počeo (I6; #1826).

Odjava i opoziv:
- Odjava, istek ili brisanje sesije ne mijenjaju tijek (A1, I4).
- Potvrđeni opoziv prije zapisa: nema retka u `evidence.submission`, zahtjev ostaje, a ishod posla bilježi razlog bez sadržaja rada (A2).
- Opoziv nakon zapisa: predaja ostaje (A3).

## C06: runde predaje

D-263 Q08 provodi D-28: runde se otvaraju izričito, a prethodna predaja ostaje nepromjenjiva.
1. Dok runde nema, drugi klik na Predaj daje `existing` (R1). To je današnje ponašanje i ostaje.
2. Novu rundu otvara samo izričita radnja ovlaštene osobe. Student je ne može otvoriti sam (R4). Tko je ovlaštena osoba, ugovor ne određuje; to se piše u koraku M7.1-P07 iz zapisanih uloga.
3. Expand migracija M7.1-P07 zamjenjuje `UNIQUE (assignment_id, institution_id, principal_id)` na `submission_request` ključem koji uključuje rundu, bez `UPDATE` ili `DELETE` postojećih redaka (R3). Test uspoređuje stare retke prije i poslije migracije.
4. Okidači nepromjenjivosti na zahtjevu i predaji ostaju. Nijedan put ne mijenja redak ranije runde (R2).
5. Otvaranje runde istodobno s finalizacijom prethodne ne smije prepisati ni preuzeti njen zahtjev (I5).
6. M7.1-P07 ne ide prije M7.1-P01 do P06 (D-263 Q08 i Q15, R5); runde su u valu M7.Z2.

## Registar poslanih verzija (D-237)

Usporedba vrijedi samo između poslanih verzija, poslanih na pregled ili predanih, u oba profila (D-05), bez oznake i bez ocjene. Međustanja su samo u prikazu uživo i reprodukciji.
- Predana verzija je redak `evidence.submission` za zahtjev, odnosno za zahtjev runde (C06).
- „Poslano na pregled” danas postoji samo kao stanje rada u `docs/PRODUCT.md` §6 t. 4, bez zapisa u bazi. Nositelja tog zapisa ugovor ne određuje.
- Usporedba zahtjeva koja uključuje neposlanu reviziju se odbija (V1). Rezultat ne nosi oznaku, postotak ni ocjenu (V2) i dostupan je u oba profila (V3). Međustanje ne ulazi u usporedbu (V4). Osoba bez prava na rad dobiva isti ishod kao za nepostojeći rad (V5).
- **Nesklad (otvoren, OQ-2):** dodjela za ovaj korak registar veže uz oznaku M6.7-P03, a nje u repou nema. M6.7 postoji u `docs/PROGRAM-RAZRADA.md` (D-51, N-03, N-05), ali korak P03 nije zapisan. Registar se zato veže samo uz D-237 dok orkestrator ili vlasnik ne zapišu drukčije.

## Klase ulaza

Prvi kodni PR M7.1 piše tablični test nad svim klasama prije koda. Klase su u #1843:
- **J1 do J9**, tijelo posla predaje. Odbijanje vraća zatvoreni razlog (`JobBodyProblem`), nikad vrijednost ulaza. J7 do J9 su ID-ovi koji prolaze oblik, ali pripadaju drugom studentu, drugoj ustanovi ili ne postoje.
- **F1 do F8**, zamrznuti kontekst: nova verzija i produljenje nakon klika, granica roka, nova revizija, sat workera, praznina u zapisu i nepodudarnost nakon roka.

Svojstveni test (fast-check) za J klase: za proizvoljan objekt koji nije točno `{ submissionRequestId: <uuid malim slovima> }`, `parseJobBody` vraća `ok: false`, a posao se ne stavlja u red.

## Istodobnost

Za ovaj PR se ne primjenjuje, jer ne mijenja shemu, sesije ni kod. Za M7.1 su obvezni negativni testovi I1 do I6 iz #1843:

| ID | Utrka | Traženi ishod |
| --- | --- | --- |
| I1 | opoziv između čitanja ovlasti i zapisa | provjera i zapis u istoj transakciji; nikad djelomičan ishod |
| I2 | isti zahtjev dvaput u redu, dva izvođenja | jedan zapis; drugo izvođenje dobiva `existing` |
| I3 | produljenje između zahtjeva i finalizacije | ishod koristi zamrznuti rok |
| I4 | odjava tijekom posla | posao se dovrši |
| I5 | otvaranje runde uz finalizaciju prethodne | prethodna runda nepromijenjena |
| I6 | istekli pokušaj piše dok novi počinje | zapisuje samo jedan pokušaj |

## Testovi koje M7.1 mora imati

- Jedinični i svojstveni: J1 do J9 (tablica i fast-check), F3 i F4.
- Integracijski (worker i baza): A1 do A5, A8, A9, F1, F2, F5 do F8, I1 do I4 i I6.
- pgTAP: A6 i A7, a za M7.1-P07 R2, R3 i I5.
- Kontrole lažnog blokiranja iz #1843: ispravan zahtjev prije roka zapisuje se kao predan; odjava ne blokira; produljenje ne ruši zapisan ishod; usporedba dviju poslanih verzija radi u oba profila.

Test koji samo provjerava da nema greške ne dokazuje nijednu od ovih tvrdnji. Svaki test mora pasti kad se pravilo prekrši.

## Otvoreno

- OQ-1: popis „potvrđenog opoziva” (D-263 Q03).
- OQ-2: oznaka M6.7-P03 ne postoji u repou.
- OQ-3: model efektivnog roka nije zapisan (D-263 Q07).
