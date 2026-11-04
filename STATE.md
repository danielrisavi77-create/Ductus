# Stanje rada

Ažurira se skupno nakon spojenih PR-ova i kontrolnih točaka; čuva gateove, ciljeve i vlasničke obveze. Prioritet, nositelja i status zadatka vodi Linear. Cilj: najviše 80 redaka i 9 000 znakova (`STATE_LIMIT`), inače ga SessionStart hook ne učitava.

## Konačni vizualni smjer

**Konačni vizualni smjer Ducture je „papir i grafit”** (D-188; potvrda vlasnika 29. 10. 2026.): tamna grafitna ljuska, gotovo bijeli list, prigušeno zlato (`docs/design/DESIGN-SYSTEM.md`, `docs/SESSIONS.md` §6). Drugi smjer traži novu izričitu Danielovu odluku. Izvor: [potvrda vlasnika](https://github.com/danielrisavi77-create/Ductus/issues/960#issuecomment-6497819007).

## Trenutna faza

M0 Temelj. Gradi se stvarna aplikacija, program je M0 do M11 (D-191). Engineering System v1: risk-based review, QA/Bug Hunter/Product uloge, GitHub za izvršenje i dokaze, Linear za zadatke, prioritete, nositelje i statuse.

## Owner queue (samo Daniel)

Agent ne uzima ove stavke i ne čeka na njima ako drugi posao može naprijed.

- [x] 10. 10. 2026.: `main` zaštićen (obvezni statusi, squash only, neriješeni razgovori blokiraju, force push zabranjen; popis u ENGINEERING_SYSTEM §10). Administrator smije zaobići; Code Owner review nije obvezan.
- [x] 1. 11. 2026.: novi raspored rada (D-191 t. 2) je D-199 t. 6, ODLUČENO (#87 `issuecomment-6551869348`). Pilot 1. 3. 2027., kod vala 1 spreman 22. 2. 2027.; datumi po fazi u Linear milestoneovima; kontrolne točke 30. 11. 2026. i 15. 1. 2027. AI pomoćnik M9 i AI dio izjave D-40 ulaze u val 1 (D-199 t. 1), koji traži oko 93 do 126 nominalnih jedinica naspram oko 100 (NEPROVJERENO, brzina se mjeri na kontrolnim točkama).
- [x] 10. 10. 2026.: potvrđeni D-37, D-39, D-71 i D-74 (#87 `issuecomment-6101424008`). 18. 10.: D-06 i D-39 zamijenjeni D-142 (prikaz uživo), D-143 (reprodukcija znak po znak) i D-144 (kratki zadaci); Ustav v1.4 (`6254642740`, `6254721033`).
- [x] 11. 10. 2026. (#87 `6105246182`, `6105084144`, `6105021669`, `6105034219`, `6105201573`, `6105263690`): D-08 razdvojen (aplikacija ODLUČENO; dobavljači i trošak PRIJEDLOG do B0.1, rok 16. 11. 2026.), D-34 uz dopunu o autoru, D-102, D-103, D-104 (uz nepromijenjen D-09), D-105 (nastavnički prikaz samo opisni, bez novih rezova), D-70. Migracije na kritičnom putu (#240, B-8) se ne zaustavljaju; B0.1 kreće kad postoje računi dobavljača, rizik prepisa migracija ostaje zapisan.
- [x] 25. 10. 2026.: D-16, svi se prijavljuju isključivo preko AAI@EduHr (#87 `issuecomment-6399982880`). Zapisi su u `docs/DECISIONS.md`.
- [ ] Potvrditi ili promijeniti D-38 te pragove P-01 do P-04 (D-08, dio o dobavljačima: B0.1). D-20 je pod preispitivanjem D-194 t. 6 (model računa za AI).
- [ ] Odnos D-08 (dio o dobavljačima, B0.1) prema B0.2: D-08 u `docs/DECISIONS.md` i `docs/PLAN-DEMO.md` traže i B0.2, nova odluka 11. 10. spominje samo B0.1. Odluka nije donesena.
- [ ] Odnos D-105 ("zasad se ništa ne reže") prema već primijenjenom rezu iz D-98 dopune (a): D-105 ga ne poništava; vraćanje reza bila bi nova odluka.
- [ ] Izvršitelj obrade i ugovorna strana prema ustanovi (kontroler/procesor): vlasnik rješava s ustanovom; blokira pilot, ne demo. Odlučeno 31. 10. 2026. (D-194 t. 3, #87 `issuecomment-6544045938`): vlasnik osniva pravnu osobu operatera kad prvi fakultet odobri pilot; ugovor o usluzi i obradi prije stvarnih podataka; raspodjela uloga ide u isti pravni angažman kao mišljenje i DPIA. PRIJEDLOG modela (fakultet voditelj, operater izvršitelj, pružatelji podizvršitelji, student ne plaća): `docs/privacy/05` A.1. Rok: ugovor prije tehničke probe (D-264). Otvoreno: oblik pravne osobe.
- [ ] AI pomoćnik u pilotu (D-194): model računa (tko drži račune i plaća; obuhvaća li cijelo visoko obrazovanje i D-15), izbor pružatelja nakon testa hrvatskog i pisanih odgovora (PRIJEDLOG t. 6 i 7), proračun 10.000 EUR bez PDV-a (D-199 t. 2, zamjenjuje D-66; raspodjela PRIJEDLOG s neprovjerenim procjenama do B0.1 i ponuda), razina 2 i „objašnjenje pojma” (D-64 prema D-80), pitanja pravniku u `docs/privacy/05` točke 23 do 28.
- [ ] D-142/D-143 (prikaz uživo, reprodukcija znak po znak; Ustav v1.4): pravno mišljenje (D-55; biometrija po čl. 4. t. 14. GDPR-a, razmjernost, Prilog III. Akta o UI, uključujući t. 3(d) prema D-151) i DPIA prije pilota sa stvarnim studentima; ne blokira demo. Reprodukciju vidi samo mentor, odnosno nastavnik zadatka (ista uloga, D-154), i student svog rada (pravilo 5).
- [ ] FPZG: koordinator pilota, kolegiji/mentori, akademski kalendar, AAI administrator, DPO, D-04, D-29, D-30, D-31, D-35, zamjenski postupak i zahtjev za ispis razgovora. Za prvi sastanak (D-199 t. 4): vodi li FPZG DPIA uz DPO-a, može li pokriti dio troška, prihvaća li ugovor s pravnom osobom operatera, potvrda D-29 i D-30.
- [ ] Pristup podrške sadržaju rada (D-199 t. 3, dopunjuje D-172): ADR (tko na fakultetu daje pristanak, potvrda, najdulji istek, obavijest studentu) prije bilo kakve izgradnje.
- [ ] FPZG AAI: ovlast za AAI@EduHr Lab i kasnije registracija Ductusa kao usluge. Blokira M1, ne demo.
- [ ] M8 Document Provenance (D-198): Word i Google Docs dodaci u sljedeći val (t. 2, ODLUČENO 1. 11. 2026.); FPZG DPO i pravno mišljenje za rok čuvanja uvezenih verzija (t. 3) i čitanje verzija iz clouda (t. 1); FPZG IT: admin consent za Microsoft Graph u tenantu fakulteta (DAN-438).
- [ ] Lekta: pisana dozvola vlasnika zapisana 2. 11. 2026. (#87 `issuecomment-6588746985`, doslovno: „Oodobravam sve, pogotovo ovo za letku, pa to je moj projekt tako da mož. Zadaj posao dodatni, pogotovo za m0”; `docs/lekta/RIGHTSSCOPE.md` §6a, DAN-513). Otvoreno: vidljivost/licenca Lekte, potvrda za Lektin kod, kanal isporuke (privatni kanal prema zadatku DAN-513 naspram D-217, nesklad otvoren) i FPZG potvrda (D-219) prije punog M4 paketa.
- [ ] Dobavljači: UpCloud, Scaleway i AWS KMS računi + 2FA i uski ključevi. B0.1 je pomaknut naprijed (rok 16. 11. 2026., tri dodatne provjere) i čeka ove račune.
- [ ] Računovođa: PDV; FINA tek uz obrt ili FPZG kao ugovornu stranu.
- [ ] Vidljivost repoa: prije stvarnih podataka ponovno odlučiti ostaje li javni.
- [ ] Session adresa orkestratora: ranije upisana `session_01JCvXpAX1i9hax8K5FFRcTy` je arhivirana (stanje 25. 10. 2026.) i ne vrijedi za `send_message` (`docs/ORKESTRATOR.md` §5); nova nije upisana. Vlasnik odlučuje hoće li se nova upisati u javni `STATE.md` ili voditi izvan repoa.
- [x] 28. 10. 2026.: konačno ime proizvoda je **Ductura**; repozitorij, paket i identifikatori u kodu ostaju `ductus` (D-186; trag: #960 `issuecomment-6469934229`, t. 4).

## Engineering System v1

Kanonski dokument: `docs/ENGINEERING_SYSTEM.md`, sažetak `docs/ENGINEERING_SYSTEM-SAZETAK.md`.

- Normalno 3 writera (Backend, Frontend, Platforma); kontrolne uloge: Orkestrator, Product/UX, QA, Reviewer, Bug Hunter. Autor ne reviewa svoj PR.
- `low` i `standard`: neovisni review na aktualnom headu; `critical`: review + zaseban QA PASS. Novi push poništava review/QA (D-101: osim čistog spajanja `main`). Owner Override je iznimka s razlogom i head SHA-om.

## Otvoreni razvojni stog

Stanje 2. 11. 2026. (oko 23:00 UTC), 32 otvorena PR-a bez probnih PR-ova Mergify reda; (n) je nacrt. Status je u Linearu, review i QA na PR-u.

- Platforma, CI i orkestrator: #1458 skener oznaka skip/todo/only i #1453 pravila projekta iz ovog repoa (DAN-168); #1456 (n) login E2E preko https, WebKit (DAN-232); #1446 postupak dijeljenog pisca; #1443 (n) F-046 (DAN-178); #1396 nečitljiv negativan verdikt blokira (DAN-163); #1051 (n) advisory lock za dbmate (DAN-71); #641 Mergify; Dependabot #1441, #1416, #1415, #1414, #1413, #1411.
- Baza i backend: #1455 (n) `/api/ready` (DAN-299); #1447 lanac ključa ustanove (DAN-442); #1439 `signPendingReceipt` v2 (DAN-512); #1372 opseg seminarske grupe (DAN-351).
- Sučelje i editor: #1444 odjava bez mreže (DAN-511); #1437 traži i zamijeni (DAN-507); #1407 Literatura (DAN-484).
- Testovi: #550 (n) parovi falsifikacije (DAN-233).
- Dokumenti: #1461 sažetak istraživanja (D-251); referentne slike #1454, #1450, #1435, #1434 (DAN-313, DAN-510); #1452 spike M3.11-S (DAN-99); #1451 dozvola za paket Lekte (DAN-513); #1449 M0.5c (DAN-344); #1445 logo potvrda (DAN-55); #1440 spike pravopisa (DAN-508).

## Ne smije se izgubiti

- B-8: canonical JCS + SHA-256, unknown fields reject, commit+reserve atomically, client/server size limit.
- F-3/F-8: SYNCED tek uz potpisanu potvrdu; stale/local-save ishodi nakon novog EDIT-a; recovery/rebase/salvage redoslijed testirati.
- B-12: replay za delete/cut/replace provjerava hash uklonjenog raspona.
- Prije velikog `diffText`: input granica ili diff po odlomcima + postojeći hardening nalazi.
- B0.2 ponoviti na stvarno kupljenom stroju; M1 čeka Lab; M4 čeka Lekta licencu.

## Gotovo

- Plan proizvoda, odluke i demo-plan; arhitektura v0.4; CI/skeneri, lokalni stog, prva jezgra, citatni stil, evidence/forensics osnova.
- PR #51: provider-neutral agent runtime i skills; globalni alati i pluginovi za sesije (`docs/REPOZITORIJI.md` §8); PR #17 spojen 3. 10.
