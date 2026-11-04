# Stanje rada

Ažurira se skupno nakon spojenih PR-ova i kontrolnih točaka. Prioritet, nositelja i status zadatka vodi Linear. Cilj: najviše 80 redaka i 9 000 znakova (`STATE_LIMIT`), inače ga SessionStart hook ne učitava.

## Konačni vizualni smjer

**Konačni vizualni smjer Ducture je „papir i grafit”** (D-188; [potvrda vlasnika](https://github.com/danielrisavi77-create/Ductus/issues/960#issuecomment-6497819007) 29. 10. 2026.): tamna grafitna ljuska, gotovo bijeli list, prigušeno zlato (`docs/design/DESIGN-SYSTEM.md`, `docs/SESSIONS.md` §6). Drugi smjer traži novu izričitu Danielovu odluku.

## Trenutna faza

M0 Temelj. Gradi se stvarna aplikacija, program je M0 do M11 (D-191). GitHub drži izvršenje i dokaze, Linear zadatke.

## Owner queue (samo Daniel)

Agent ne uzima ove stavke i ne čeka na njima ako drugi posao može naprijed. Redom blokiranja; „Q-n” je oznaka iz karte plana 4. 11. 2026. §7 (nije broj iz D-265).

- [x] Odlučeno i zapisano u `docs/DECISIONS.md` (tragovi na #87): `main` zaštićen 10. 10. (administrator smije zaobići, Q-15); raspored D-199 t. 6 (#87 `6551869348`: pilot 1. 3. 2027., kod 22. 2., kontrolne točke 30. 11. i 15. 1.; val 1 oko 93 do 126 jedinica naspram oko 100, NEPROVJERENO); D-37, D-39, D-71, D-74, D-142 do D-144, Ustav v1.4; D-08 razdvojen (dobavljači do B0.1), D-34, D-70, D-102 do D-105; D-16 samo AAI@EduHr; ime Ductura (D-186).
- [ ] Q-1, ugovor i pravna osoba (kontroler/procesor; blokira pilot, ne demo). Odlučeno 31. 10. (D-194 t. 3 i 9, #87 `6544045938`): pravnu osobu osniva vlasnik kad FPZG odobri pilot; ugovor o obradi prije tehničke probe 22. 2. 2027. (D-264 Q13). Model je PRIJEDLOG: `docs/privacy/05` A.1. Pitanje: zadnji datum odobrenja i osnivanja koji još drži probu; smije li proba sa sintetikom bez ugovora (nova odluka); uskladiti `docs/PROGRAM.md:192`. Rok: 13. 11. 2026. Preporuka: od FPZG-a tražiti odgovor do tada.
- [ ] Q-2, dobavljači i B0.1: UpCloud, Scaleway i AWS KMS računi + 2FA i uski ključevi; B0.1 čeka račune. D-38 i pragovi P-01 do P-04 čekaju potvrdu (D-20 pod preispitivanjem D-194 t. 6). Odnos D-08 (dobavljači) prema B0.2 nije odlučen: D-08 i `docs/PLAN-DEMO.md` traže B0.2, odluka 11. 10. samo B0.1. Rok: 16. 11. 2026. (D-261 Q01). Preporuka: otvoriti račune do roka.
- [ ] Q-3, FPZG: koordinator pilota, kolegiji/mentori, akademski kalendar, AAI administrator, DPO, D-04, D-29, D-30, D-31, D-35, zamjenski postupak, zahtjev za ispis razgovora. Prvi sastanak (D-199 t. 4, D-264 Q09): vodi li FPZG DPIA uz DPO-a (D-257), dio troška, ugovor s operaterom, potvrda D-29 i D-30. Rok: zahtjev 13. 11., odgovori 30. 11. 2026. Preporuka: jedan paket.
- [ ] Q-4, worker: datumi i prioritet DAN-517/518 (worker) i DAN-381 (M7.1) prema D-261 Q02; blokira M3, M8, M9, M10 (D-203 C2). Rok: 30. 11. 2026. Preporuka: DAN-517/518 prije DAN-381.
- [ ] Q-5, pristup podrške sadržaju (D-199 t. 3, D-172): ADR prije izgradnje (tko daje pristanak, potvrda, najdulji istek, obavijest studentu), uz razlog produljenja i klasu podataka (P24) prije DAN-312. Rok: 30. 11. 2026. Preporuka: ADR prije DAN-312.
- [ ] Q-6, komentari: migracije postoje, a D-133 i D-134 su PRIJEDLOG (`docs/DECISIONS.md:181`, D-226). Do odluke se na komentarima dalje ne gradi (DAN-538 pokriva samo odlučeno). Rok: 30. 11. 2026. Preporuka: potvrditi ili zaustaviti prije M6 komentara.
- [ ] Q-7, pentest: narudžba sada (D-264 Q14), strop troška i GO redak (`docs/PROGRAM.md:180` do 202 ga nema). Rok: 30. 11. 2026. Preporuka: strop i redak odrediti do roka.
- [ ] Q-8, odobrenje referentnih slika: M6 (#1454, O9), M5 po ekranu (D-235), M7 (Q16). Rok: M6 i M5 odmah, M7 15. 1. 2027. Preporuka: po ekranu, čim prođu gate.
- [ ] Q-9, M0: sigurnosni tiketi F-035, F-045, F-046, F-180 diraju review gate (D-97 putanje). Naredba za #1443 i #1458 kad budu READY, ili M0 zatvoriti bez njih i tikete preseliti u M11. Rok: 15. 11. 2026. Preporuka: naredba za točan head kad gate bude zelen.
- [ ] Q-10, AI pomoćnik u pilotu (D-194): model računa (tko drži račune i plaća; D-15), pružatelj nakon testa hrvatskog (PRIJEDLOG t. 6 i 7), proračun 10.000 EUR bez PDV-a (D-199 t. 2; raspodjela PRIJEDLOG), razina 2 i „objašnjenje pojma” (D-64 prema D-80), `docs/privacy/05` t. 23 do 28. Rok: 15. 12. 2026. (prijedlog), Q25 15. 1. 2027. Preporuka: t. 6 i 7 odlučiti do 15. 12.; inače M9.2 do M9.7 nakon pilota (V-C mijenja D-199 t. 1, Q-17).
- [ ] Q-11, Lekta: dozvola vlasnika 2. 11. (#87 `6588746985`, `docs/lekta/RIGHTSSCOPE.md` §6a, DAN-513). Otvoreno: licenca i vidljivost Lekte, potvrda za Lektin kod, kanal isporuke (DAN-513 naspram D-217), FPZG potvrda (D-219). Rok: licenca 15. 12. 2026. Preporuka: licencu i kanal zajedno.
- [ ] Q-12, pilot: pragovi uspjeha (`docs/PRODUCT.md` §12) i milestone M12 (P20, P21). Rok: 20. 12. 2026. Preporuka: zapisati prije probe.
- [ ] Q-13, pilot: osoba koja smije zaustaviti pilot, tko prijavljuje AZOP-u u 72 h (P1), zamjenik vlasnika (P11); `docs/PROGRAM.md:197`, :202, `docs/privacy/05` A.12. Rok: 15. 1. 2027. Preporuka: imenovati prije pravnika.
- [ ] Q-14, WCAG za cijeli proizvod: 2.1 AA (F-03, DAN-428, axe) naspram 2.2 AA (D-248 za M6; `docs/FEATURES.md:33`); blokira DAN-428 i DAN-553. Rok: 15. 1. 2027. Preporuka: jedna razina.
- [ ] Q-15, zaštita `main`: administrator smije zaobići (`docs/SECURITY.md:44`, :74); isključenje radi samo vlasnik (DAN-552). Rok: 22. 2. 2027. Preporuka: isključiti prije GO; do tada samo uz Owner Override.
- [ ] Q-16, čuvanje: D-30 (rokovi po klasi podataka) je PRIJEDLOG, D-12 (brisanje u kopijama, P17) traži odgovor FPZG-a; tko odlučuje ako ga nema (DAN-297, M10 10. 2.). Kod čuvanja se ne gradi na D-30. Rok: 15. 1. 2027. Preporuka: odgovor tražiti u paketu Q-3.
- [ ] Q-17, varijanta plana V-A do V-E (D-203 t. 1) na 30. 11. i 20. 12. 2026.; V-B mijenja D-198 t. 1, V-C D-199 t. 1. Preporuka: birati po izmjerenoj brzini.
- [ ] Q-18, zapisi: D-195, D-197 (#87 `6548381010`, `6549030612`), D-260 (#1484), D-157 nemaju redak u `docs/DECISIONS.md`; `docs/PROGRAM.md:65` (15. 12. naspram 20. 12.) i :192 (rok ugovora) neusklađeni. Rok: 30. 11. 2026. Preporuka: docs PR koji samo bilježi donesene odluke.
- [ ] Q-19, nesklad: D-68 (obrana u pilotu) naspram N-09 val 3 i D-265 Q21; D-265 Q29 naspram RAZRADA Z-11; D-70 (EN) naspram `docs/PROGRAM.md:172`. Rok: 15. 1. 2027. Preporuka: do odluke vrijede zapisane odluke.
- [ ] Q-20, poslovno (ne blokira kod): P8 žig/domena, P12 strop troška agenata, P14 fondovi i osiguranje, P22 SLA, P3 plagijat, P6 etika, P29 kraj studija, raspored DAN-303 (P48). Rok: 30. 11. 2026. do 15. 1. 2027. Preporuka: jedan razgovor.
- [ ] Q-21, operacije: DAN-299 je Done, a `docs/OPERATIONS.md` ne postoji; je li kostur ispao iz opsega (tada DAN-540). Tko i kada šalje Srcu zahtjev za Registar resursa (`docs/PROGRAM.md:198`). Rok: 30. 11. 2026. Preporuka: vlasnik; kostur kroz DAN-540.
- [ ] D-105 ("zasad se ništa ne reže") ne poništava rez iz D-98 dopune (a); njegovo vraćanje bila bi nova odluka.
- [ ] D-142/D-143 (Ustav v1.4): pravno mišljenje (D-55, GDPR čl. 4. t. 14., Prilog III. Akta o UI, t. 3(d) prema D-151) i DPIA prije pilota sa stvarnim studentima; ne blokira demo.
- [ ] FPZG AAI: ovlast za AAI@EduHr Lab i registracija Ductusa kao usluge. Blokira M1, ne demo.
- [ ] M8 (D-198): DPO i pravno mišljenje za rok čuvanja uvezenih verzija (t. 3) i čitanje iz clouda (t. 1); FPZG IT: admin consent za Microsoft Graph (DAN-438).
- [ ] Računovođa: PDV; FINA tek uz obrt ili FPZG kao ugovornu stranu. Vidljivost repoa: prije stvarnih podataka ponovno odlučiti ostaje li javni.
- [ ] Session adresa orkestratora: ranije upisana je arhivirana i ne vrijedi za `send_message` (`docs/ORKESTRATOR.md` §5); nova nije upisana. Vlasnik odlučuje ide li u javni `STATE.md` ili izvan repoa.

## Engineering System v1

Kanonski dokument: `docs/ENGINEERING_SYSTEM.md`, sažetak `docs/ENGINEERING_SYSTEM-SAZETAK.md`. Normalno 3 writera (Backend, Frontend, Platforma); autor ne reviewa svoj PR. `low` i `standard`: neovisni review na headu; `critical`: review + zaseban QA PASS. Novi push poništava review/QA (D-101: osim čistog spajanja `main`). Owner Override samo s razlogom i head SHA-om.

## Otvoreni razvojni stog

Popis PR-ova nije ovdje: `pnpm orch:status`, status zadatka je u Linearu, review i QA na PR-u.

## Ne smije se izgubiti

- B-8: canonical JCS + SHA-256, unknown fields reject, commit+reserve atomically, client/server size limit.
- F-3/F-8: SYNCED tek uz potpisanu potvrdu; stale/local-save ishodi nakon novog EDIT-a; testirati redoslijed recovery/rebase/salvage.
- B-12: replay za delete/cut/replace provjerava hash uklonjenog raspona.
- Prije velikog `diffText`: input granica ili diff po odlomcima + postojeći hardening nalazi.
- B0.2 ponoviti na kupljenom stroju; M1 čeka Lab; M4 čeka Lekta licencu.

## Gotovo

- Plan proizvoda, odluke i demo-plan; arhitektura v0.4; CI/skeneri, lokalni stog, prva jezgra, citatni stil, evidence/forensics osnova; agent runtime i skills (PR #51, `docs/REPOZITORIJI.md` §8).
