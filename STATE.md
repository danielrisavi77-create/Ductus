# Stanje rada

Ažurira se skupno nakon spojenih PR-ova i kontrolnih točaka. Ovaj presjek čuva gateove, ciljeve i vlasničke obveze; za živi prioritet, nositelja i status zadatka mjerodavan je Linear. Cilj: najviše 80 redaka.

## Trenutna faza

M0 Temelj. Prvi cilj ostaje radni demo za FPZG 2. 11. 2026. (`docs/PLAN-DEMO.md`). Ductus Engineering System v1 uvodi risk-based review, QA/Bug Hunter/Product uloge, GitHub za izvršenje i dokaze te Linear za zadatke, prioritete, nositelje i statuse.

Session adresa orkestratora: `session_012PKnBC3YXckp6L2abHe7VX` (pomoćni podatak za `send_message`, `docs/ORKESTRATOR.md` §5; nije izvor istine).

## Owner queue (samo Daniel)

Agent nikad ne uzima ove stavke i nikad ne čeka na njima ako drugi posao može naprijed.

- [x] 10. 10. 2026.: `main` zaštićen (PR obvezan; obvezni statusi CI, Local stack, Security scanners, Dependency review, Engineering review gate; neriješeni razgovori blokiraju; force push i delete zabranjeni; squash only; auto-merge i brisanje grane nakon spajanja uključeni). Administrator smije zaobići zaštitu; obvezni Code Owner review nije uključen (ENGINEERING_SYSTEM §10).
- [ ] Proba demoa 31. 10. 2026. i snimka prolaza (PLAN-DEMO D-3, D-4).
- [x] 10. 10. 2026.: vlasnik je potvrdio D-37, D-39, D-71 i D-74 (trag: komentar na issueu #87, `issuecomment-6101424008`; zapisano u `docs/DECISIONS.md`).
- [ ] Razjasniti odnos D-06 i potvrđene D-39: zamjenjuje li D-39 odluku D-06 (potvrda to ne kaže; D-06 ostaje na snazi). UX test u `docs/UX-EVAL.md` §4.
- [x] 11. 10. 2026.: vlasnik je odlučio (trag: komentari na issueu #87, `issuecomment-6105246182`, `6105084144`, `6105021669`, `6105034219`, `6105201573`; zapisano u `docs/DECISIONS.md`): D-08 razdvojen (dio o aplikaciji ODLUČEN, dobavljači i trošak PRIJEDLOG do B0.1, rok 16. 11. 2026.), D-34 potvrđen uz dopunu o autoru, domena evidencije (D-102), ključ ustanove (D-103), model računa za drugog izdavatelja uz nepromijenjen D-09 (D-104), nastavnički prikaz samo opisni i bez novih rezova demoa (D-105), jezik tek uz engleski (D-70). Potvrđeno i tumačenje točke 3 (komentar `6105263690`): migracije na kritičnom putu demoa (#240 i sljedeći korak B-8) se ne zaustavljaju, B0.1 kreće čim postoje računi dobavljača, rizik prepisa migracija do tada ostaje zapisan.
- [ ] Potvrditi ili promijeniti D-16, D-20, D-38 te pragove P-01 do P-04 (D-08, dio o dobavljačima: B0.1).
- [ ] Odnos D-08 (dio o dobavljačima, B0.1) prema B0.2: D-08 u `docs/DECISIONS.md` i `docs/PLAN-DEMO.md` traže i B0.2, nova odluka 11. 10. spominje samo B0.1. Odluka nije donesena.
- [ ] Odnos D-105 ("zasad se ništa ne reže") prema već primijenjenom rezu iz D-98 dopune (a): D-105 ga ne poništava; vraćanje reza bila bi nova odluka.
- [ ] Izvršitelj obrade i ugovorna strana prema ustanovi (kontroler/procesor): vlasnik rješava s ustanovom; blokira pilot, ne demo.
- [ ] D-56: pravno mišljenje + Constitution Gate C-14/C-19 prije ikakvog bilježenja ritma; nije na kritičnom putu demoa.
- [ ] FPZG: koordinator pilota, kolegiji/mentori, akademski kalendar, AAI administrator, DPO, D-04, D-29, D-30, D-31, D-35, zamjenski postupak i zahtjev za ispis razgovora.
- [ ] FPZG AAI: ovlast za AAI@EduHr Lab i kasnije registracija Ductusa kao usluge. Blokira M1, ne demo.
- [ ] Lekta: licenca/pravo redistribucije prije punog M4 paketa.
- [ ] Dobavljači: UpCloud, Scaleway i AWS KMS računi + 2FA i uski ključevi. B0.1 je pomaknut naprijed (rok 16. 11. 2026., tri dodatne provjere) i čeka ove račune.
- [ ] Računovođa: PDV; FINA tek uz obrt ili FPZG kao ugovornu stranu.
- [ ] Vidljivost repoa: prije stvarnih podataka ponovno odlučiti ostaje li javni. Uz to: session adresa orkestratora stoji u javnom `STATE.md`; prihvatiti ili premjestiti izvan repoa.
- [ ] Konačno ime proizvoda.

## Engineering System v1

Kanonski dokument: `docs/ENGINEERING_SYSTEM.md`.

- Normalno 3 writera: Backend, Frontend, Platforma; četvrti samo za potpuno neovisan posao.
- Kontrolne uloge: Orkestrator, Product/UX, QA, Independent Reviewer, Bug Hunter.
- Autor ne reviewa vlastiti PR; Bug Hunter/Product ne implementiraju vlastite nalaze.
- `low` i `standard`: neovisni review na aktualnom headu.
- `critical`: neovisni review + zaseban QA PASS na aktualnom headu.
- Novi push invalidira review/QA preko `Review-Head` / `QA-Head`, osim čistog spajanja `main` bez promjene diffa (D-101).
- Owner Override je eksplicitna iznimka s razlogom i head SHA-om.

## Otvoreni razvojni stog

Provjereni presjek 11. 10. 2026. oko 17:25 CEST: između 8. i 11. 10. spojena su 102 PR-a (GitHub UTC: 3, 3, 64, 32); na presjeku je bilo 10 otvorenih razvojnih PR-ova. Nakon presjeka otvoren je informativni [PR #259](https://github.com/danielrisavi77-create/Ductus/pull/259) s detaljnom evidencijom i punim popisom spojenih PR-ova. **To nije potvrda dovršenosti FPZG demoa niti status živih zadataka.**

Otvoreno na razvojnom presjeku (za aktualni review, QA i CI uvijek provjeriti pojedini PR):

- **F-3:** #214 lokalni Tiptap editor na `/rad` (otvoren, nije u `main`). #206 atomsko lokalno spremanje te #250/#251/#256 zaštite i testovi već su spojeni; za editor ostaju 1b-2b (poruke/izvoz), 1b-3 (status spremanja) i stvarni browser QA.
- **B-8 / dokazna evidencija:** #245 integracija S3 domena po ustanovi (draft), #257 testni zlatni vektori na formatu koraka v1 (draft); #232/#233/#247/#253/#254 spojeni su kao zasebni temelji, ne kao dovršen integrirani ingest i potpis.
- **Orkestracija:** #219 REST cloud skripte, #220 ispis Owner-Override, #221 ispis review/QA verdikta (draft), #258 upozorenja na razvojno okruženje (draft).
- **Ostalo:** #234 usklađenje S3 dokumentacije (draft), #180 test sinkronosti skillova (draft), #94 drugi review provider (draft, nakon demoa).

Spojeno kao ključni napredak 8.–11. 10.: #39 migracije/pgTAP, #44 E2E infrastruktura, #45 provjera teksta UI-ja, #46/#148/#151 uloge/sesije, #191/#212/#215/#224 demo prijava, #163/#175/#240 model ustanove i zadatka, #112/#206 journal/saver, #97/#159/#170/#189/#194/#216 oporavak sinkronizacije, #133/#174/#207/#213/#218 evidencijski ugovori, #232/#233/#247/#253/#254 pohrana i potvrde, #150 tanki dokazni prolaz, #238 prvi korak demo E2E, #230 D-101 kontrola verdikta, #243 i #244 odluke i nacrti privatnosti.

**Sljedeći GO dokaz za demo:** cjelovit tok nastavnik stvara zadatak → student se upisuje i piše uz lokalno/poslužiteljsko spremanje → nastavnik komentira → student predaje uz server-side rekonstrukciju → jednak sažetak i potvrda. Potreban je zelen E2E u CI-ju, ponovljiv lokalni demo i snimka prolaza 31. 10.; cilj prikaza ostaje 2. 11. 2026. Prioritet je povezivanje, ne širenje opsega.

## Ne smije se izgubiti

- B-8: canonical JCS + SHA-256, unknown fields reject, commit+reserve atomically, client/server size limit.
- F-3/F-8: SYNCED tek uz potpisanu potvrdu; stale/local-save ishodi nakon novog EDIT-a; recovery/rebase/salvage redoslijed testirati.
- B-12: replay za delete/cut/replace provjerava hash uklonjenog raspona.
- Prije velikog `diffText`: input granica ili diff po odlomcima + postojeći hardening nalazi.
- B0.2 ponoviti na stvarno kupljenom stroju; M1 čeka Lab; M4 čeka Lekta licencu.

## Gotovo

- Plan proizvoda, odluke i demo-plan; arhitektura v0.4.
- CI/skeneri, lokalni stog, prijenos prve jezgre, citatni stil, evidence/forensics osnova.
- PR #51: multi-account/provider-neutral agent runtime i repo-local skills.
- 10. 10. 2026.: globalni alati naredbenog retka i pluginovi za sesije (`docs/REPOZITORIJI.md` §8); PR #17 (Dependabot, provjera ovisnosti) spojen 3. 10.
