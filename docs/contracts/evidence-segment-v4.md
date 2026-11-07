# Odsječak evidencije v4: uvoz, AI prijenos i poznato podrijetlo lijepljenja

DAN-583, plan rb52 M9.0-S1, zajedno s M8.0-S1. Ovo je ugovor bez koda: definira jednu novu verziju formata za tri stvari i popis testova koji implementacija mora imati prije prvog retka koda.
Izvori:
- D-269 O8: jedna verzija, jedan ugovor; nositelj M3; receipt-v2 i v2/v3 ostaju kakvi jesu.
- D-198: uvoz, t. 1, 5, 6 i 7.
- D-41, D-42 i D-268 O2 do O4: AI prijenos.
- D-43, D-58 i D-268 O6: poznato podrijetlo lijepljenja.
- B-8 i B-12 (`STATE.md`) te `docs/backend/evidencija.md` §4.1.

Plan napada je #1659 (A1 do G5, klase ulaza K1 do K16, pitanja O-1 do O-6). Ovaj ugovor ga ne ponavlja, nego se poziva na njegove oznake.
Ovaj dokument predlaže odgovor na O-4 (oblik nove verzije). Prijedlog vrijedi tek kad ga potvrdi nositelj M3 (vlasnik). Dok to ne učini, nijedan implementacijski korak ne počinje.

## Verzija

Nova verzija je točno jedna: `ductus-evidence-segment-v4`. To je v3 s tri dodatka u zatvorenom skupu događaja:

1. izvor `import` (M8);
2. izvor `ai-transfer` (M9);
3. neobvezno polje `pasteOrigin` na događaju `paste` (D-58).

Sva ostala pravila v3, pa time i v2, vrijede nepromijenjena: ključevi odsječka, `captureContext`, kanonski JCS, vrijeme samo na cijeloj minuti i bez vremena na događaju (D-24, D-56), rezervacije D-34 i D-132 te granice.

Manifest uvoza i zapis AI prijenosa nisu odsječci. Oni su zapisi koje stvara poslužitelj, a odsječak na njih upućuje id-jem i hashom. Manifest je zaseban zapis već prema D-198 t. 7. Nijedan od njih nema vlastitu verziju formata odsječka, pa A4 vrijedi: postoji jedan novi identifikator formata odsječka.

| Pravilo | Ugovor | Plan |
| --- | --- | --- |
| Odabir sheme | `evidenceSchemaForEvents` vraća v4 samo ako barem jedan događaj ima izvor `import` ili `ai-transfer` ili nosi `pasteOrigin`. Inače vraća v3 ili v2 kao danas, bajt po bajt. | A6 |
| Stara zaglavlja | Odsječak v2 ili v3 s bilo kojom novom vrijednošću ili ključem odbija se istim razlogom kao nepoznat izvor ili ključ. Nema tihog spuštanja na `unattributed`. | A3, K4 |
| Paket | Smije miješati v2, v3 i v4 bilo kojim redom. `predecessorSegmentHash` veže preko granice verzija. | A7, K15 |
| Rezervacije | `applied-suggestion`, `own-variant`, `suggestionId`, `variantId` i `ductus-evidence-variant-v1` ostaju odbijeni i u v4. | A5, K8 |
| `drop` | Ne nosi `pasteOrigin` dok vlasnik ne odluči O-6. | D6, O-6 |

## Polja događaja v4 i klase ulaza

Ključevi događaja v2 (`sequence`, `source`, `steps`, `touchedNodeIds?`, `beforeDocumentHash`, `afterDocumentHash`) ostaju. Dodatni ključevi su uvjetni: smiju se pojaviti samo uz navedeni izvor i obvezni su uz njega. Bilo koji drugi ključ, ili dopušteni ključ uz drugi izvor, odbija se (K5, K11).

| Izvor | Ključ | Oblik | Klase |
| --- | --- | --- | --- |
| `import` | `importId` | Kanonski UUID v4, mala slova, 36 znakova; nil UUID se odbija. | K6, K7, K9, K14 |
| `import` | `importManifestSha256` | `^[0-9a-f]{64}$`, jednak `manifestSha256` zapisa uvoza. | K12 |
| `ai-transfer` | `aiTransferId` | Kanonski UUID v4 kao gore. | K6, K7, K9, K14 |
| `ai-transfer` | `aiTransferSha256` | `^[0-9a-f]{64}$`, jednak SHA-256(JCS(zapis prijenosa)). | K12 |
| `paste` | `pasteOrigin` (neobvezno) | Objekt s točno tri ključa iz tablice ispod. | K5, K6, K7, K11 |

`pasteOrigin`:

| Ključ | Oblik |
| --- | --- |
| `kind` | Zatvoren skup: `ai-response` ili `source-notebook`. |
| `refId` | Kanonski UUID v4 odgovora AI pomoćnika odnosno stavke bilježnice izvora. |
| `textSha256` | `^[0-9a-f]{64}$`, hash teksta zalijepljenog ovim događajem (definicija ispod). |

Podrijetlo ne nosi tekst, naslov, autora ni bilo što drugo o izvoru (D9). Prikaz „iz izvora X” čita naziv iz zapisa izvora pod RLS-om.

**Tekst događaja.** Hash teksta (`textSha256` u `pasteOrigin` i u zapisu prijenosa) je SHA-256 UTF-8 bajtova teksta koji događaj umeće. Tekst čine svi umetnuti rasponi koraka, redom koraka; unutar raspona tekst se uzima kao `textBetween(0, size, "\n")`. Tekst se ne normalizira: NFC i NFD daju različit hash (K14). Implementacijski PR drži definiciju testom s poznatim odgovorom, izvedenim izvan koda pod testom (A8). Ako se pokaže da definicija ne može biti jednoznačna za blokove i oznake, mijenja se ovaj ugovor prije koda, ne kod.

## Zapisi na koje odsječak upućuje

Oba zapisa imaju zatvoren skup ključeva, kanonski JCS i bez vremena finijeg od minute. Stvara ih samo poslužitelj kroz RPC; klijent ne piše izravno ni u jednu tablicu. Svaka nova tablica dobiva RLS i retke u pgTAP matrici (C12).

### `ductus-import-manifest-v1` (D-198 t. 5 i 7)

| Ključ | Oblik |
| --- | --- |
| `manifestSchema` | Točno `ductus-import-manifest-v1`. |
| `importId` | Kanonski UUID v4. |
| `documentId` | Kao u odsječku. |
| `importKind` | Način dolaska, zatvoren skup `file-upload`, `cloud-version`; nova vrsta traži izmjenu ovog ugovora. |
| `fileFormat` | Format datoteke, zatvoren skup `docx`, `pdf` (PDF: M8.3, DAN-397). `cloud-version` dopušta samo `docx`; drugi spoj se odbija. Novi format traži izmjenu ovog ugovora. |
| `rawSha256` | SHA-256 točnih bajtova datoteke. |
| `rawByteLength` | Cijeli broj ≥ 1; gornja granica je O-7. |
| `contentSha256` | SHA-256(JCS(sadržaj kao dokument Ductusa)). |
| `traces` | Samo uz `fileFormat` `docx`: niz od najviše tri objekta `{traceKind, count}`. `traceKind` je iz zatvorenog skupa `insertion`, `deletion`, `comment`, svaki najviše jednom; `count` je cijeli broj ≥ 1. Uz `pdf` ključa nema; prazan niz ili ključ uz `pdf` odbija se. |
| `savedAt` (neobvezno) | Samo uz `cloud-version`: cijela UTC minuta u obliku iz D-24, ili ključa nema. |

`manifestSha256` = SHA-256(JCS(manifest)). Sprema se uz manifest, nikad u njemu. Poslužitelj sva tri hasha ponovno izračuna iz bajtova datoteke, a nepodudaranje bilo kojeg odbija cijeli uvoz (B3).
Manifest ne nosi autora, `lastModifiedBy`, `lastModifyingUser`, `w:date`, `w:author`, `rsid*`, e-adresu ni ime. Sve to je nepoznat ključ (B5). Siguran strukturni lokator traga (D-198 t. 5) namjerno nije u ovom skupu; to je O-7.

### `ductus-ai-transfer-v1` (D-41, D-42, D-268 O2)

| Ključ | Oblik |
| --- | --- |
| `transferSchema` | Točno `ductus-ai-transfer-v1`. |
| `transferId` | Kanonski UUID v4; jednak `aiTransferId` u događaju. |
| `documentId` | Kao u odsječku. |
| `conversationId`, `responseId` | Kanonski UUID v4. |
| `providerId` | `^[a-z0-9][a-z0-9-]{0,63}$`. |
| `modelId` | `^[a-z0-9][a-z0-9._-]{0,127}$`. |
| `purposeCatalogVersion` | Cijeli broj od 1 do 2^31 − 1. |
| `purposeId`, `phaseId` | `^[a-z0-9][a-z0-9-]{0,63}$`. |
| `textSha256` | Hash prenesenog teksta po definiciji „tekst događaja”. |
| `transferredAt` | Cijela UTC minuta iz DB sata poslužitelja, nikad s klijenta. |

Zapis ne nosi sadržaj razgovora, upute ni preneseni tekst (C11). Tekst ostaje u zapisu razgovora pod RLS-om.
Format provjerava samo oblik `providerId` i `modelId`. Pripadnost dopuštenom skupu provjerava poslužitelj pri stvaranju zapisa, iz verzionirane konfiguracije u `config/faculties` (D-270 O11). Isto vrijedi za svrhu iz kataloške verzije zadatka (D-268 O2, C4) i za isključene pružatelje (C3). Popis stvarnih pružatelja ne ulazi u format ni u testove dok su D-194 t. 6 i 7 te D-267 O1 PRIJEDLOG (O-1); testovi koriste `provider-test-a` i `model-test-1`.
`transferredAt` je predloženi odgovor na O-5. Nastavnik vidi vrijeme iz zapisa prijenosa na minutu, a odsječak i dalje nema vrijeme po događaju.

## Prihvat i rekonstrukcija

Pravilo iz `docs/backend/evidencija.md` §4.1 (odluka vlasnika 17. 10. 2026.) ostaje: prihvat ne pokreće replay. Pregled po vrsti provjere:

| Provjera | Gdje | Ishod neuspjeha |
| --- | --- | --- |
| Oblik svih novih polja | Zajednički `isEvidenceSegment` na klijentu i poslužitelju | `invalid` |
| Zapis `import` ili `ai-transfer` postoji za istog principala i isti dokument, i njegov hash je jednak veznom hashu | RPC koji radi commit i `reserve`, u istoj transakciji | `invalid`. Tuđi i nepostojeći id daju isti odgovor (C7). |
| Jedan zapis uvoza ili prijenosa veže najviše jedan događaj u lancu dokumenta | Isti RPC, jedinstveno ograničenje | `invalid`. Ponovno slanje istog odsječka nakon prekida je idempotentno i nije drugi događaj. |
| Umetnuti sadržaj `import` odgovara `contentSha256`; tekst `ai-transfer` odgovara `textSha256` zapisa | Replay pri rekonstrukciji | `mismatch`, kao `removedSha256` (B-12) |
| `pasteOrigin`: hash zalijepljenog teksta iz replaya jednak je `textSha256`; odgovor ili stavka `refId` postoji za istog principala i isti dokument; zalijepljeni tekst je neprekinut, točan podniz teksta tog odgovora ili stavke (bez normalizacije, K14) | Projekcija nakon uspješnog replaya, na poslužitelju, dok sadržaj izvora postoji | Lijepljenje se prikazuje kao `origin: "not_observed"`, kao danas. Nikad se ne prikazuje kao poznato podrijetlo, a cijela rekonstrukcija ne pada. |

Dva tumačenja traže potvrdu reviewa i vlasnika:
- C6 u #1659 kaže da se nepodudaranje teksta „odbija”. Ovdje se otkriva rekonstrukcijom (`mismatch`), jer prihvat prema odluci od 17. 10. ne radi replay.
- D2 i D3 u #1659 dopuštaju odbijanje ili prikaz bez podrijetla. Ugovor bira prikaz bez podrijetla. Razlog: brisanje odgovora ili stavke u drugoj kartici (E5) inače bi zaustavilo sinkronizaciju.

Djelomično lijepljenje (D-58: kopiran dio odgovora ili stavke) je poznato podrijetlo jednako kao cijelo, jer se provjerava podniz, a ne jednakost hasha cijelog izvora. Hash izvora zato nije dovoljan i poslužitelj ga ne čuva kao zamjenu za sadržaj. Poznate granice:
- nakon brisanja sadržaja odgovora ili stavke podrijetlo se više ne može provjeriti i prikazuje se kao `not_observed`;
- razlika koju unese međuspremnik (razmaci, prijelomi redaka, NFC/NFD) daje `not_observed`. Ugovor bira lažno negativan ishod, nikad lažno pozitivan.

Ishod projekcije nosi samo vrstu i oznaku poznatog podrijetla, nikad tekst izvora ni položaj podniza (D9).

Sažetak procesa (`process-summary.ts`) prikazuje stavke ovako:
- `import` je vrsta `imported` („uvezeno, tvrdnja iz datoteke”), nikad `observed` (B1, B8).
- `ai-transfer` je zaseban izvor koji nije ni `imported` ni `declared`.
- Izjavljena oznaka iz D-43 ostaje zasebna od `pasteOrigin` i nikad se ne spaja s njim (D5).

Prikaz i tekst sučelja su zaseban korak koji čeka odobrene slike (D-269 O7). Projekcija ne zbraja preneseni ni zalijepljeni tekst i ne računa udjele (G1). Student i nastavnik dobiju iste bajtove (G3).

## JCS i granice

Kanonizacija je RFC 8785 (JCS), hash SHA-256 kao 64 mala heksadekadska znaka. Prihvaćaju se samo kanonski bajtovi (`verifyCanonicalEvidencePayloadV2`) i strogi UTF-8. Duplikat ključa uvijek se odbija (K13, K14).

Granice v4 jednake su granicama v2 i v3. Mijenjaju se samo novom verzijom, na klijentu i poslužitelju zajedno:

| Granica | Vrijednost |
| --- | --- |
| Događaja po odsječku | 5000 (`MAX_EVENTS`, `MAX_SEGMENT_EVENTS`) |
| Duljina id-a | 256 (`MAX_ID_LENGTH`) |
| Dubina JCS-a | 256 (`MAX_JCS_DEPTH`) |
| Duljina `evidenceProfileId` | 120 |
| Veličina odsječka | 2 097 152 bajta (`maxSegmentBytes`) |
| Trajanje odsječka | 30 000 ms (`MAX_SEGMENT_SPAN_MS`, klijent) |

Nova polja imaju fiksnu ili gornju duljinu iz gornjih tablica. Test drži svaku granicu na vrijednosti i za jedan preko nje (K9).

## Spoj sa starim zapisima

- Zlatni vektori `evidence-v2.json` i `evidence-v3.json` te `pinnedFiles` u `format-reservation.json` ostaju bajtno isti. Diff na njima mora biti prazan (A1). Vektori v4 idu u novu datoteku `evidence-v4.json`, izvedenu izvan koda pod testom (A8).
- `evidence-receipt-v2` se ne mijenja: ni ključevi, ni prefiks potpisa, ni bajtovi postojećih potvrda (A2). Njegov `evidenceSchema` nosi shemu prihvaćenog odsječka, pa skup dopuštenih vrijednosti u `isEvidenceSegmentSchema` dobiva v4. Potvrda za v4 odsječak koristi isti format.
- Baza: `validate_segment_descriptor_v2` i provjera u rezervaciji danas primaju samo v2 i v3 (`20261028000000_evidence_segment_v3.sql`). Primanje v4 traži novu migraciju u implementacijskom koraku, nikad izmjenu postojeće.
- Stari klijent ne piše v4 i nikad ne prepisuje v4 odsječak iz dnevnika kao v3. Ako stari klijent pri oporavku naiđe na v4 odsječak, ne tvrdi SYNCED i traži osvježavanje; to nije nalaz o krivotvorenju.
- Postojeći v2 i v3 zapisi ne dobivaju podrijetlo naknadno, a nema ni dopisivanja manifesta starim uvozima.

## Istodobnost

Istodobnost: commit i `reserve` su jedna transakcija. Provjera postojanja i hasha zapisa uvoza ili prijenosa, jedinstvenost veze i rezervacija `sequence` odvijaju se u njoj, pod istim zaključavanjem dokumenta kao danas.

Za pojedine scenarije:
- E3: `import_event` i manifest nastaju u istoj transakciji ili nikako.
- E2: tijekom postupnog uvođenja poslužitelj koji još ne zna v4 odbije odsječak; odsječak ostaje u dnevniku i šalje se ponovno, a nijedan poslužitelj ga ne prihvati djelomično.
- E1: dvije kartice, stara (v2/v3) i nova (v4), idu postojećim putem spajanja ili sukoba (F-3/F-8), bez SYNCED-a bez potpisane potvrde.
- E4: oporavak već zapisanog prijenosa iz dnevnika prolazi i uz opoziv; nova primjena traži živu provjeru na poslužitelju (D-268 O4).
- E5: brisanje odgovora ili razgovora ne poništava vezu već primljenog odsječka.
- E6: odjava usred uvoza ne zapisuje ništa pod isteklim identitetom.

## Popis testova (prije koda)

Testovi se pišu prije implementacije i padaju dok implementacija ne postoji. Svi podaci su izmišljeni (G5): tekst „Lorem odlomak 1”, UUID-ovi tipa `00000000-0000-4000-8000-0000000000a1`, `provider-test-a`, sintetički DOCX s autorom „Lorem Autor”.

| Test | Vrsta | Pokriva |
| --- | --- | --- |
| Parser odsječka v4 | Tablični test, po jedan red za svaku klasu K1 do K16 i za svaku razinu u K5 (odsječak, događaj, `captureContext`, `pasteOrigin`, manifest, zapis prijenosa) | F1 do F15 |
| Svojstvo zatvorenog skupa | fast-check: svaka mutacija valjanog vektora izvan zatvorenog skupa je odbijena; svaki valjan vektor ima isti JCS i hash nakon parse → serialize | K3 do K16 |
| Stari formati | Postojeći vektori v2/v3 i potvrde daju iste bajtove; test nad izvezenim konstantama drži točno jedan novi identifikator formata odsječka | A1, A2, A4 |
| Odabir sheme | `evidenceSchemaForEvents` za svaku kombinaciju izvora | A6 |
| Lanac | Miješani lanac v2+v3+v4 prolazi provjeru, a sažetak je isti kao bez v4 za isti sadržaj | A7, K15 |
| Manifest | Tablični test: tri hasha, zabranjeni ključevi B5, `savedAt` sa sekundama, pretraga bajtova za „Lorem Autor”; valjan PDF manifest bez `traces`, odbijen PDF s `traces` (i praznim) i odbijen spoj `cloud-version` + `pdf` | B3 do B7, B10 |
| Zapis prijenosa | Tablični test: obvezna polja, oblik, katalog svrha, isključeni pružatelj | C1 do C5, C11 |
| Tekst događaja | Test s poznatim odgovorom za definiciju hasha teksta, uključujući NFC i NFD | C6, D1, K14 |
| Rekonstrukcija | Kriv `contentSha256` ili `textSha256` daje `mismatch`; neprovjerljiv `pasteOrigin` daje `not_observed` bez pada | B4, C6, D3 |
| Djelomično lijepljenje | Dio odgovora i dio stavke bilježnice daju poznato podrijetlo; tekst koji nije neprekinut podniz, podniz tuđeg odgovora, izmijenjen razmak i NFD umjesto NFC daju `not_observed`; izbrisan sadržaj izvora daje `not_observed`; ishod ne sadrži bajtove teksta izvora | D1 do D3, D9, K14 |
| Projekcija | `import` je `imported`; isti bajtovi za studenta i nastavnika; nema zbrojeva | B1, B8, G1, G3, G4 |
| pgTAP | Tuđi i nepostojeći id daju isti ishod; RLS i matrica pristupa za nove tablice; jedinstvenost veze | C7, C10, C12, D2 |
| Istodobnost | Dvije transakcije uvoza istog dokumenta; opoziv prije i poslije primjene; stari i novi klijent nad istim radom | E1 do E6 |
| Tekst sučelja | Skener zabranjenih izraza nad novim oznakama, kad UI postoji | G2 |

## Obvezni zasebni implementacijski koraci

Svaki je zaseban PR s rizikom `critical`, reviewom i QA-om:

1. vektori v4 i parser u `src/domain/forensics/`;
2. migracija descriptora i rezervacije s pgTAP-om;
3. tablice i RPC za manifest i zapis prijenosa;
4. replay i projekcija;
5. bilježenje na klijentu.

Ovaj dokument sam ne daje SYNCED, prihvat ni prikaz.

## Otvoreno za vlasnika

- **O-1 do O-6** iz #1659 ostaju otvoreni. Ugovor ne gradi na D-194 t. 6 i 7, D-267 O1, D-198 t. 3 ni D-30.
- **O-4.** Ugovor predlaže v4 s manifestom i zapisom prijenosa kao zasebnim zapisima. Potvrđuje nositelj M3.
- **O-5.** Ugovor predlaže `transferredAt` na cijeloj minuti u zapisu prijenosa.
- **O-7 (novo).** Prije prvog koda M8.0-S1 treba odrediti dvije stvari:
  - siguran strukturni lokator traga (D-198 t. 5): koja razina strukture i bez kojeg sadržaja;
  - gornju granicu `rawByteLength`.
