# Paket istraživanja tehnologija od 19. 10. 2026.: sažetak i preslika na program

Status: istraživanje, ne odluka o gradnji ni instalaciji. Unosi se po D-251; odgovori na otvorena pitanja paketa su D-251 do D-259 (#87 [c.6587383297](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6587383297)). Paket ne mijenja `docs/PROGRAM.md`, `docs/PROGRAM-RAZRADA.md` ni Linear. Status zadataka vodi Linear, a redoslijed i opseg vode `docs/PROGRAM.md` i `docs/PROGRAM-RAZRADA.md`.

## 1. Izvor

Paket je vlasnikov privitak i nije u repou (D-251). Sastoji se od glavnog plana i šest istraživanja, snimljenih na `main` između `09a86ce` i `e4370a0` (19. 10. 2026.). Ovaj sažetak uspoređen je s `main` `fa7d68e` (2. 11. 2026.), nakon oko 400 commitova i odluka D-191 do D-250.

| Datoteka | SHA-256 |
| --- | --- |
| `DUCTURA_Glavni_tehnoloski_i_razvojni_plan_2026-10-19.md` | `eca935fa311e1bb5dc7a9d2d765799c8fc89a7031acf38e76550a36ef18c14f0` |
| `DUCTURA_Istrazivanje_01_Fakultetske_integracije_2026-10-19.md` | `a90f16568b7f3d4f7302f4ba9809f6ac50639fea5ca2958bec50170c4317bf65` |
| `DUCTURA_Istrazivanje_02_Word_PDF_akademski_dokumenti_2026-10-19.md` | `b953d0f0e930f0abec4b12298d2bc3b4131642b1e2a790a901318571ad20eb6e` |
| `DUCTURA_Istrazivanje_03_Kriptografski_dokazi_reprodukcija_2026-10-19.md` | `6561c66c7df45f9765811e712dc942dcee410e10daf9110989167c8a00b6e726` |
| `DUCTURA_Istrazivanje_04_Akademski_izvori_i_alati_2026-10-19.md` | `5bb528d0541a3c9e8dfe6078695056f159ff877576cf0df69cddbb89ceab0f9e` |
| `DUCTURA_Istrazivanje_05_Nastavnici_mentori_2026-10-19.md` | `38d8fd6e35c488591580a268392db9a15390a3355231cc556c0017826914c6f1` |
| `DUCTURA_Istrazivanje_06_Sigurnost_GDPR_Multitenant_Skaliranje_2026-10-19.md` | `c380680bc0fc4b31d91a81a681939061935038e0506f1ac5cf0ca5f5523d8d59` |
| `INDEKS_DUCTURA_Istrazivanja_2026-10-19.md` | `63a4392d3020c74bbfe0815f0f897b26d133e582644164a4fdb991df2333d65e` |

Vanjske tvrdnje paketa (cijene, kvote i uvjeti pružatelja, rokovi Akta o UI) datirane su 19. 10. 2026. i pri gradnji se ponovno čitaju sa službenih stranica.

## 2. Načela paketa koja vrijede

- Integritet zapisa nije autorstvo; hash, potpis, račun i reprodukcija ne kažu tko je pisao (D-01).
- Uvoz je uvoz: nema sintetiziranja povijesti iz DOCX-a ili PDF-a (D-44, D-198).
- Identitet nije ovlast; pristup dolazi iz odnosa (C-23, `can()`).
- Neutralni ishodi: „nije pronađeno”, „nedostupno” i „ne podudara se” su različiti i nikad nisu presuda o studentu.
- Licenca korijena nije licenca cijelog stabla ovisnosti.
- Postojeći CI i skeneri imaju prednost; novi alat samo uz grešku koju postojeći ne hvata.
- Jedna kodna baza i konfiguracija po fakultetu, bez forka.

## 3. Što je zastarjelo, što je usvojeno, što je otvoreno

| Tema | Paket (19. 10.) | Stanje u repou | Ocjena |
| --- | --- | --- | --- |
| Redoslijed | P0 do demoa 2. 11., zatim P1 do P3 | Demo odgođen (D-191); redoslijed M0 do M11, ciljevi D-199 t. 6 i D-203 | Zastarjelo |
| AI pomoćnik | Izvan pilota (D-77) | U pilotu, val 1 (D-194, D-199); zabrana AI analize procesa ostaje (pravilo 13) | Zastarjelo |
| Izvoz DOCX, PDF, PDF/A | Kasniji val | Val 1, PDF/A-2u uz veraPDF (D-203 A3, D-206); renderer D-254 | Zastarjelo |
| Verzije iz oblaka | Nije obrađeno | U pilotu (D-198 t. 1, M8.11) | Paket ne pokriva |
| Shema prije uvoza | Proširiti kanonski model | Shema v2, DAN-453, plan #1258; D-225 do D-231 | Usvojeno |
| Navod i bibliografija | Čvorovi dokumenta | D-226 | Usvojeno |
| Uvoz DOCX-a | Jedan `import_event` i manifest gubitaka | D-198 t. 5 i t. 7 (strože) | Usvojeno |
| DOI i ISBN | Crossref, uvjetno Open Library | D-232; uvjeti D-252 | Usvojeno, uz uvjet |
| Zotero | Najprije datoteke | D-232, D-227 | Usvojeno |
| LTI | Kasnije | Nije u pilotu (D-198 t. 4) | Usvojeno |
| ISVU | Samo odobreni snimak | Zaseban tiket (D-205 O3); probni sustav je stvarni podatak (D-258) | Usvojeno |
| Merkle i vremenski žig | Val 2, neovisni svjedok | D-72 odlučen (D-209) | Usvojeno, izvedba u M3.9 |
| Komentori i povjerenstvo | Kasniji val | Grantovi po radu (DAN-379) | Provedeno |
| Rubrika i ocjena | Uvjetno | Ne grade se u M6 (D-249) | Usvojeno |
| Citatni pogon | Oprez s citeproc i CSL | Vlastiti formatter (D-255) | Usvojeno |
| Zajednička zaštita odlaznih poziva | Taksonomija ishoda, SSRF, kvote | Nema zajedničkog modula na `main` | Otvoreno |
| Restore baze, pohrane i ključeva | Jedna vježba s negativnim slučajevima | M11.2 (DAN-298) | Otvoreno |
| DPIA za AI i oblak | Nije obrađeno | Opseg D-257 | Otvoreno |

## 4. Testne matrice paketa i kamo idu

Scenariji su zahtjevi za testove, ne izvršeni testovi. Pri gradnji koraka pisac plana napada uzima ih iz paketa (vlasnik ga daje na zahtjev) i u opisu PR-a navodi koji je pokriven, a koji nije primjenjiv.

| Matrica u paketu | Opseg | Korak programa |
| --- | --- | --- |
| 01 §3.3 | Negativni OIDC slučajevi (PKCE, `state`, `nonce`, `iss`/`aud`/`azp`, `userinfo.sub`, lažni pružatelj u produkciji) | M1, DAN-307; bug #1327 |
| 01 §5.4 | ISVU: 401/403, 429/503, nedostupnost, tuđa ustanova | Tiket ISVU adaptera (D-205 O3) |
| 02 §8.1 D01 do D15 | Sintetički DOCX: struktura, Unicode, fusnote, liste, tablice, slike, polja, komentari, praćenje izmjena, opseg, zlonamjerni ulazi | M8.1 do M8.4 |
| 02 §8.2 P01 do P10 | Sintetički PDF: tekstni sloj, redoslijed čitanja, sken, fontovi, oznake, PDF/A, šifrirani i zlonamjerni PDF, isti `revisionId` | M8.3, M8.5, M8.14 |
| 02 §7 | Preflight i izolacija parsera | M8.1, M8.2, M5.6 |
| 03 E01 do E18 | JCS, odsječci, lanac, idempotencija | M3.1, M3.6, M3.7 |
| 03 E19 do E25 | Potpis: točni bajtovi, domena, svrha ključa, inventar v1 (D-215) | M3.8, DAN-295 |
| 03 E26 do E35 | Merkle (list, čvor, prazno stablo, inclusion, consistency, fork) i RFC 3161 | M3.9, DAN-391 |
| 03 E36 do E44 | Uvoz, offline, dva taba, reprodukcija, zabranjene izvedene mjere | M8.2, M3.11, M6.2 |
| 04 §11 testovi 1 do 14 | DOI i ISBN normalizacija, 404/429/503, sukob izvora | M5.7, DAN-406 |
| 04 §11 testovi 15 do 23 | Navod, bibliografija, uvoz BibTeX/RIS/CSL-JSON | M5.1, M5.9 |
| 04 §11 testovi 24 do 31 | PDF lokator (fizička stranica i tiskana oznaka), OCR, sidro | M8.7, M5.1 |
| 04 §11 testovi 32 do 48 | SSRF, XSS, tokeni, privatne bilješke, kvote, atribucija | Zaštita odlaznih poziva, M5.9 |
| 05 §14 N01 do N46 | Pristup, sidra, dorade, nacrti, objava, obavijesti, pošten prikaz, pristupačnost | M6.5, M6.6, M6.7, M6.12, M11.6 |
| 05 §10 | Protokol mjerenja koristi za nastavnike | Sastanak s FPZG-om (D-259) |
| 06 §3.3 T01 do T20 | Model prijetnji akademskog SaaS-a | M2, M11.9 |
| 06 §14 T01 do T60 | Tenancy, pohrana i ključevi, evidencija, privatnost, operacije, izlaz | M2, M10, M11.2, M11.4 |
| 06 §12 | Osam koraka restorea | M11.2 |
| 06 §4.4 | Deset koraka uvođenja ustanove | M11.4, druga ustanova |
| 06 §5.3 | Sadržaj DPIA-e | M11.8, D-257 |
| Glavni plan §5.3 | Taksonomija ishoda vanjskih portova | Zaštita odlaznih poziva |
| Glavni plan §17 T01 do T42 | Objedinjeni prioritetni skup | Kontrolni popis za GO uvjete |

## 5. Kandidati za biblioteke (bez odluke o instalaciji)

Inventar i status vode se u `docs/REPOZITORIJI.md` §11. Svaka ovisnost ulazi samo vlastitim PR-om s pinom, licencom s allow-liste, testom koji pada i mogućnošću uklanjanja.

## 6. Što se iz paketa ne primjenjuje

- Redoslijed P0 do P3 i datumi iz paketa (zamjenjuju ih D-191, D-199 i D-203).
- Snimka statusa Linear zadataka od 19. 10. 2026.
- Tvrdnja da AI pomoćnik nije u pilotu (D-194, D-199).
- Zamjena editora (SuperDoc, ONLYOFFICE, EigenPal Pro), blockchain, novi event store ili CRDT kao izvor istine, OpenFGA, Kubernetes i dodatni skeneri bez dokazane rupe.
