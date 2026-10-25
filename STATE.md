# Stanje rada

Ažurira se skupno nakon spojenih PR-ova i kontrolnih točaka. Ovaj presjek čuva gateove, ciljeve i vlasničke obveze; za živi prioritet, nositelja i status zadatka mjerodavan je Linear. Cilj: najviše 80 redaka.

## Trenutna faza

M0 Temelj. Prvi cilj ostaje radni demo za FPZG 2. 11. 2026. (`docs/PLAN-DEMO.md`). Ductus Engineering System v1 uvodi risk-based review, QA/Bug Hunter/Product uloge, GitHub za izvršenje i dokaze te Linear za zadatke, prioritete, nositelje i statuse.

Session adresa orkestratora: ranije upisana adresa `session_01JCvXpAX1i9hax8K5FFRcTy` je arhivirana i više ne vrijedi za `send_message` (`docs/ORKESTRATOR.md` §5). Nova adresa se ne upisuje u javni repo; vidi Owner queue.

## Owner queue (samo Daniel)

Agent nikad ne uzima ove stavke i nikad ne čeka na njima ako drugi posao može naprijed.

- [x] 10. 10. 2026.: `main` zaštićen (PR obvezan; obvezni statusi CI, Local stack, Security scanners, Dependency review, Engineering review gate; neriješeni razgovori blokiraju; force push i delete zabranjeni; squash only; auto-merge i brisanje grane nakon spajanja uključeni). Administrator smije zaobići zaštitu; obvezni Code Owner review nije uključen (ENGINEERING_SYSTEM §10).
- [ ] Proba demoa 31. 10. 2026. i snimka prolaza (PLAN-DEMO D-3, D-4).
- [x] 10. 10. 2026.: vlasnik je potvrdio D-37, D-39, D-71 i D-74 (trag: komentar na issueu #87, `issuecomment-6101424008`; zapisano u `docs/DECISIONS.md`).
- [x] 18. 10. 2026.: odnos D-06 i D-39 riješen; obje zamjenjuje D-142 (prikaz uživo), uz D-143 (reprodukcija znak po znak) i D-144 (kratki zadaci). Ustav v1.4 izmijenjen (trag: #87 `issuecomment-6254642740`, `6254721033`).
- [x] 11. 10. 2026.: vlasnik je odlučio (trag: komentari na issueu #87, `issuecomment-6105246182`, `6105084144`, `6105021669`, `6105034219`, `6105201573`; zapisano u `docs/DECISIONS.md`): D-08 razdvojen (dio o aplikaciji ODLUČEN, dobavljači i trošak PRIJEDLOG do B0.1, rok 16. 11. 2026.), D-34 potvrđen uz dopunu o autoru, domena evidencije (D-102), ključ ustanove (D-103), model računa za drugog izdavatelja uz nepromijenjen D-09 (D-104), nastavnički prikaz samo opisni i bez novih rezova demoa (D-105), jezik tek uz engleski (D-70). Potvrđeno i tumačenje točke 3 (komentar `6105263690`): migracije na kritičnom putu demoa (#240 i sljedeći korak B-8) se ne zaustavljaju, B0.1 kreće čim postoje računi dobavljača, rizik prepisa migracija do tada ostaje zapisan.
- [ ] Potvrditi ili promijeniti D-16, D-20, D-38 te pragove P-01 do P-04 (D-08, dio o dobavljačima: B0.1).
- [ ] Odnos D-08 (dio o dobavljačima, B0.1) prema B0.2: D-08 u `docs/DECISIONS.md` i `docs/PLAN-DEMO.md` traže i B0.2, nova odluka 11. 10. spominje samo B0.1. Odluka nije donesena.
- [ ] Odnos D-105 ("zasad se ništa ne reže") prema već primijenjenom rezu iz D-98 dopune (a): D-105 ga ne poništava; vraćanje reza bila bi nova odluka.
- [ ] Izvršitelj obrade i ugovorna strana prema ustanovi (kontroler/procesor): vlasnik rješava s ustanovom; blokira pilot, ne demo.
- [ ] D-142/D-143 (prikaz uživo, reprodukcija znak po znak; Ustav v1.4 izmijenjen): pravno mišljenje (D-55; biometrija po čl. 4. t. 14. GDPR-a, razmjernost, Prilog III. Akta o UI, uključujući t. 3(d) prema D-151) i DPIA prije pilota sa stvarnim studentima; ne blokira demo. Od ostalih uloga reprodukciju vidi samo mentor, odnosno nastavnik zadatka, jer je to ista uloga (D-154); student vidi istu reprodukciju svog rada (pravilo 5).
- [ ] FPZG: koordinator pilota, kolegiji/mentori, akademski kalendar, AAI administrator, DPO, D-04, D-29, D-30, D-31, D-35, zamjenski postupak i zahtjev za ispis razgovora.
- [ ] FPZG AAI: ovlast za AAI@EduHr Lab i kasnije registracija Ductusa kao usluge. Blokira M1, ne demo.
- [ ] Lekta: licenca/pravo redistribucije prije punog M4 paketa.
- [ ] Dobavljači: UpCloud, Scaleway i AWS KMS računi + 2FA i uski ključevi. B0.1 je pomaknut naprijed (rok 16. 11. 2026., tri dodatne provjere) i čeka ove račune.
- [ ] Računovođa: PDV; FINA tek uz obrt ili FPZG kao ugovornu stranu.
- [ ] Vidljivost repoa: prije stvarnih podataka ponovno odlučiti ostaje li javni.
- [ ] Session adresa orkestratora: adresa upisana u `STATE.md` je arhivirana (stanje 25. 10. 2026.), a nova nije upisana u javni repo. Odluka gdje se adresa vodi izvan repoa ostaje vlasniku.
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

Stanje 25. 10. 2026. prema `gh pr list --state open` (nositelj statusa je Linear; review i QA stanje je na PR-u). STATE.md i dalje prati PR-ove i redovito se osvježava (vlasnik, 25. 10. 2026., #271 `issuecomment-6398435565`).

Otvoreno:

- DAN-289 predaja i živi prikaz: #782 (A3), #777 (O2), #773 (A2).
- DAN-308 brzi put nastavnika: #769 (B-11a), #774 (B-11b), #780 (B-11c), sve nacrti; #772 točka stanja (#732 t. 17).
- DAN-89 i odjava: #731 (F1a), #726 (K-4c-2, nacrt); #751 dijalog odjave (D-118, DAN-288); #768 zaštita privilegija `ductus_app` (DAN-300).
- Orkestrator i CI: #684 `orch:shadow` (DAN-269); #661, #668, #669 probni PR-ovi (DAN-263); #643 (nacrt), #642, #641 Mergify i akcije; #628 Playwright ponavljanja (DAN-262, nacrt).
- Stariji nacrti: #629, #571, #553, #552, #551, #550, #438, #372, #370, #354, #347, #344; #346 PRODUCT pravilo 12 (D-117); #94 drugi pružatelj reviewa (DAN-41, nakon demoa).

Spojeno od 12. do 25. 10. 2026.: 275 PR-ova (#287 do #776, s preskocima). Potpun popis: `gh pr list --state merged`.

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
