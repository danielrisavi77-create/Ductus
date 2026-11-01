# Stanje rada

Ažurira se skupno nakon spojenih PR-ova i kontrolnih točaka. Ovaj presjek čuva gateove, ciljeve i vlasničke obveze; za živi prioritet, nositelja i status zadatka mjerodavan je Linear. Cilj: najviše 80 redaka.

## Trenutna faza

M0 Temelj. Gradi se stvarna aplikacija, program je M0 do M11 (D-191). Ductus Engineering System v1 uvodi risk-based review, QA/Bug Hunter/Product uloge, GitHub za izvršenje i dokaze te Linear za zadatke, prioritete, nositelje i statuse.

Session adresa orkestratora: ranije upisana adresa `session_01JCvXpAX1i9hax8K5FFRcTy` je arhivirana i više ne vrijedi za `send_message` (`docs/ORKESTRATOR.md` §5). Nova adresa zasad nije upisana; vidi Owner queue.

## Owner queue (samo Daniel)

Agent nikad ne uzima ove stavke i nikad ne čeka na njima ako drugi posao može naprijed.

- [x] 10. 10. 2026.: `main` zaštićen (PR obvezan; obvezni statusi CI, Local stack, Security scanners, Dependency review, Engineering review gate; neriješeni razgovori blokiraju; force push i delete zabranjeni; squash only; auto-merge i brisanje grane nakon spajanja uključeni). Administrator smije zaobići zaštitu; obvezni Code Owner review nije uključen (ENGINEERING_SYSTEM §10).
- [ ] Novi raspored rada (D-191). Datum pilota je 1. 3. 2027. (vlasnik, #87 `issuecomment-6543799262`); prijedlog rasporeda je D-199 t. 6 (PRIJEDLOG: ciljni datumi po fazi, kontrolne točke 30. 11. 2026. i 15. 1. 2027.); vlasnikova potvrda upisuje datume u Linear milestoneove. AI pomoćnik M9 i AI dio izjave D-40 ulaze u val 1 (D-199 t. 1); uz njih val 1 traži oko 93 do 126 nominalnih jedinica naspram oko 100 po starom modelu (NEPROVJERENO, stvarna brzina se mjeri na kontrolnim točkama).
- [x] 10. 10. 2026.: vlasnik je potvrdio D-37, D-39, D-71 i D-74 (trag: komentar na issueu #87, `issuecomment-6101424008`; zapisano u `docs/DECISIONS.md`).
- [x] 18. 10. 2026.: odnos D-06 i D-39 riješen; obje zamjenjuje D-142 (prikaz uživo), uz D-143 (reprodukcija znak po znak) i D-144 (kratki zadaci). Ustav v1.4 izmijenjen (trag: #87 `issuecomment-6254642740`, `6254721033`).
- [x] 11. 10. 2026.: vlasnik je odlučio (trag: komentari na issueu #87, `issuecomment-6105246182`, `6105084144`, `6105021669`, `6105034219`, `6105201573`; zapisano u `docs/DECISIONS.md`): D-08 razdvojen (dio o aplikaciji ODLUČEN, dobavljači i trošak PRIJEDLOG do B0.1, rok 16. 11. 2026.), D-34 potvrđen uz dopunu o autoru, domena evidencije (D-102), ključ ustanove (D-103), model računa za drugog izdavatelja uz nepromijenjen D-09 (D-104), nastavnički prikaz samo opisni i bez novih rezova demoa (D-105), jezik tek uz engleski (D-70). Potvrđeno i tumačenje točke 3 (komentar `6105263690`): migracije na kritičnom putu demoa (#240 i sljedeći korak B-8) se ne zaustavljaju, B0.1 kreće čim postoje računi dobavljača, rizik prepisa migracija do tada ostaje zapisan.
- [x] 25. 10. 2026.: vlasnik je potvrdio D-16, svi se prijavljuju isključivo preko AAI@EduHr (trag: #87, `issuecomment-6399982880`; zapisano u `docs/DECISIONS.md`).
- [ ] Potvrditi ili promijeniti D-38 te pragove P-01 do P-04 (D-08, dio o dobavljačima: B0.1). D-20 je pod preispitivanjem D-194 t. 6 (model računa za AI).
- [ ] Odnos D-08 (dio o dobavljačima, B0.1) prema B0.2: D-08 u `docs/DECISIONS.md` i `docs/PLAN-DEMO.md` traže i B0.2, nova odluka 11. 10. spominje samo B0.1. Odluka nije donesena.
- [ ] Odnos D-105 ("zasad se ništa ne reže") prema već primijenjenom rezu iz D-98 dopune (a): D-105 ga ne poništava; vraćanje reza bila bi nova odluka.
- [ ] Izvršitelj obrade i ugovorna strana prema ustanovi (kontroler/procesor): vlasnik rješava s ustanovom; blokira pilot, ne demo. Odlučeno 31. 10. 2026. (D-194 t. 3, #87 `issuecomment-6544045938`): vlasnik osniva pravnu osobu operatera kad prvi fakultet odobri pilot; ugovor o usluzi i obradi nakon toga, prije stvarnih podataka; raspodjela uloga ide u isti pravni angažman kao mišljenje i DPIA. PRIJEDLOG ugovornog modela (fakultet voditelj, operater izvršitelj, pružatelji podizvršitelji, okvirni ugovor, student ne plaća): `docs/privacy/05` A.1. Otvoreno: oblik pravne osobe i rok.
- [ ] AI pomoćnik u pilotu (D-194): model računa (tko drži račune i plaća; obuhvaća li to cijelo visoko obrazovanje i D-15), izbor pružatelja nakon testa hrvatskog i pisanih odgovora pružatelja (PRIJEDLOG t. 6 i 7), proračun je 10.000 EUR bez PDV-a (D-199 t. 2, zamjenjuje D-66; raspodjela je PRIJEDLOG s neprovjerenim procjenama do B0.1 i ponuda), razina 2 i „objašnjenje pojma” (D-64 prema D-80), pitanja pravniku u `docs/privacy/05` točke 23 do 28.
- [ ] D-142/D-143 (prikaz uživo, reprodukcija znak po znak; Ustav v1.4 izmijenjen): pravno mišljenje (D-55; biometrija po čl. 4. t. 14. GDPR-a, razmjernost, Prilog III. Akta o UI, uključujući t. 3(d) prema D-151) i DPIA prije pilota sa stvarnim studentima; ne blokira demo. Od ostalih uloga reprodukciju vidi samo mentor, odnosno nastavnik zadatka, jer je to ista uloga (D-154); student vidi istu reprodukciju svog rada (pravilo 5).
- [ ] FPZG: koordinator pilota, kolegiji/mentori, akademski kalendar, AAI administrator, DPO, D-04, D-29, D-30, D-31, D-35, zamjenski postupak i zahtjev za ispis razgovora. Za prvi sastanak (D-199 t. 4): vodi li FPZG DPIA uz DPO-a, može li pokriti dio troška, prihvaća li ugovor s pravnom osobom operatera, potvrda D-29 i D-30.
- [ ] Pristup podrške sadržaju rada (D-199 t. 3, dopunjuje D-172): ADR (tko na fakultetu daje pristanak, potvrda, najdulji istek, obavijest studentu) prije bilo kakve izgradnje.
- [ ] FPZG AAI: ovlast za AAI@EduHr Lab i kasnije registracija Ductusa kao usluge. Blokira M1, ne demo.
- [ ] M8 Document Provenance (D-198): Word i Google Docs dodaci idu u sljedeći val (t. 2, ODLUČENO 1. 11. 2026.); FPZG DPO i pravno mišljenje za rok čuvanja uvezenih verzija (t. 3) i za čitanje verzija iz clouda (t. 1); FPZG IT: admin consent za Microsoft Graph u tenantu fakulteta (DAN-438).
- [ ] Lekta: licenca/pravo redistribucije prije punog M4 paketa.
- [ ] Dobavljači: UpCloud, Scaleway i AWS KMS računi + 2FA i uski ključevi. B0.1 je pomaknut naprijed (rok 16. 11. 2026., tri dodatne provjere) i čeka ove račune.
- [ ] Računovođa: PDV; FINA tek uz obrt ili FPZG kao ugovornu stranu.
- [ ] Vidljivost repoa: prije stvarnih podataka ponovno odlučiti ostaje li javni.
- [ ] Session adresa orkestratora: adresa upisana u `STATE.md` je arhivirana (stanje 25. 10. 2026.), a nova zasad nije upisana. Vlasnik odlučuje hoće li se nova adresa upisati u javni `STATE.md` ili voditi izvan repoa.
- [x] 28. 10. 2026.: konačno ime proizvoda je **Ductura**; repozitorij, paket i identifikatori u kodu ostaju `ductus` (D-186; trag: #960 `issuecomment-6469934229`, t. 4).

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

Stanje 31. 10. 2026. prema popisu otvorenih PR-ova (34); (n) označava nacrt. Nositelj statusa je Linear, review i QA stanje je na PR-u. Presjek se osvježava skupno.

- Platforma, CI i orkestrator: #1083 pravila pisaca u definicijama agenata (D8); #1082 kritični pod za toolchain, lint i skenere (DAN-166); #1081 ci-once; #1079 kritični PR bez D-97 putanja (D-196); #1078 (n) pravilo testova prijenosa (D-195); #1076 agentske datoteke kritične (DAN-171); #1073 usporedba sheme s `db/schema.sql` (DAN-71); #1059 (n) `scripts/local` (DAN-434); #1057 i #641 Mergify; #1041 WebKit na macOS-u (DAN-114); #1038 brži hookovi (DAN-432); #994 D-161 (g) (DAN-361); #684 (n) `orch:shadow`; #643 (n) Mergify nositelj; #628 (n) Playwright ponavljanja (DAN-262).
- Baza: #1077 migrator i grupne uloge (DAN-71); #1051 (n) advisory lock za dbmate (DAN-71); #947 (n) put evidencije mentorstva (DAN-349).
- Sučelje i editor: #1075 (n) tema na cijelom dokumentu (Z-13a); #1024 `/prijava` u paleti papir i grafit (DAN-344); #980 (n) i #976 (n) editor prema V3 (DAN-214, DAN-211); #866 (n) citati i literatura (DAN-343); #831 (n) korak na poslužitelju (DAN-331); #1048 (n) napomena S3 (D-63); #553 (n) obavijest o radnim zapisima mentora.
- Testovi: #1084 (n) auth tok i OIDC klijent (DAN-307); #970 (n) postavljanje labela (DAN-83); #550 (n) parovi falsifikacije (DAN-233).
- Dokumenti: #1030 D-63 i pravilo 4; #959 (n) papir i grafit u uputama (DAN-357); #551 (n) UX evaluacija (DAN-234); #344 (n) elementi prototipa u M5.

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
