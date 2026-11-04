# Stanje rada

Ažurira se skupno nakon spojenih PR-ova i kontrolnih točaka. Prioritet, nositelja i status zadatka vodi Linear. Cilj: najviše 80 redaka i 9 000 znakova (`STATE_LIMIT`), inače ga SessionStart hook ne učitava.

## Konačni vizualni smjer

**Konačni vizualni smjer Ducture je „papir i grafit”** (D-188; [potvrda vlasnika](https://github.com/danielrisavi77-create/Ductus/issues/960#issuecomment-6497819007) 29. 10. 2026.): tamna grafitna ljuska, gotovo bijeli list, prigušeno zlato (`docs/design/DESIGN-SYSTEM.md`, `docs/SESSIONS.md` §6). Drugi smjer traži novu izričitu Danielovu odluku.

## Trenutna faza

M0 Temelj. Gradi se stvarna aplikacija, program je M0 do M11 (D-191). GitHub drži izvršenje i dokaze, Linear zadatke.

## Owner queue (samo Daniel)

Agent ne uzima ove stavke i ne čeka na njima ako drugi posao može naprijed. „Q-n” je oznaka iz karte plana 4. 11. 2026. §7 (nije broj iz D-265). Vlasnik je odabrao odgovore 4. 11. 2026. (#87 6639423372); to nije potvrda plana, tiketi DAN-522 do DAN-554 čekaju njegovu potvrdu. Upis odluka u `docs/DECISIONS.md` ide kroz Q-18.

- [x] Odlučeno i zapisano u `docs/DECISIONS.md` (tragovi na #87): `main` zaštićen 10. 10. (administrator smije zaobići, Q-15); raspored D-199 t. 6 (#87 `6551869348`: pilot 1. 3. 2027., kod 22. 2., kontrolne točke 30. 11. i 15. 1.; val 1 oko 93 do 126 jedinica naspram oko 100, NEPROVJERENO); D-37, D-39, D-71, D-74, D-142 do D-144, Ustav v1.4; D-08 razdvojen (dobavljači do B0.1), D-34, D-70, D-102 do D-105; D-16 samo AAI@EduHr; ime Ductura (D-186).
- [ ] Q-1, ugovor i pravna osoba (blokira pilot, ne demo). Odabir: osnovati pravnu osobu odmah, prije odobrenja FPZG-a, da rok probe ne ovisi o fakultetu (#87 6639423372; D-194 t. 3 i 9, #87 `6544045938`, govorile su: po odobrenju). Ugovor o obradi prije probe 22. 2. 2027. (D-264 Q13); model PRIJEDLOG `docs/privacy/05` A.1. Rok: 13. 11. 2026. Radnja: vlasnik.
- [ ] Q-2, dobavljači i B0.1. Odabir: otvoriti UpCloud, Scaleway i AWS KMS račune s 2FA i uskim ključevima; B0.2 ostaje obvezan kako piše u D-08 (#87 6639423372). D-38 i P-01 do P-04 čekaju potvrdu. Rok: 16. 11. 2026. (D-261 Q01). Radnja: vlasnik.
- [ ] Q-3, FPZG. Odabir: jedan paket svih pitanja, uključujući čuvanje (Q-16), poslan do 13. 11.; odgovori do 30. 11. 2026. (#87 6639423372). U paketu: koordinator pilota, kolegiji/mentori, kalendar, AAI administrator, DPO, D-04, D-29, D-30, D-31, D-35, zamjenski postupak, ispis razgovora, DPIA uz DPO-a (D-257), dio troška, ugovor s operaterom (D-199 t. 4, D-264 Q09). Radnja: vlasnik.
- [x] Q-4: DAN-517/518 (worker) idu prije DAN-381 (M7.1); vrijedi od sada (#87 6639423372; D-261 Q02, D-203 C2).
- [ ] Q-5, pristup podrške sadržaju (D-199 t. 3, D-172). Odabir: napisati ADR prije DAN-312, uz razlog produljenja i klasu podataka (P24) (#87 6639423372). ADR: tko daje pristanak, potvrda, najdulji istek, obavijest studentu. Rok: 30. 11. 2026.
- [x] Q-6: D-133 i D-134 potvrđeni kako su zapisane (`docs/DECISIONS.md:181`, D-226); M6 komentari se grade dalje, DAN-538 se odblokira (#87 6639423372).
- [ ] Q-7, pentest. Odabir: odrediti strop troška i dodati GO redak sada (`docs/PROGRAM.md:180` do 202); naručiti vanjski pentest za siječanj (#87 6639423372; D-264 Q14). Rok: 30. 11. 2026. Radnja: vlasnik.
- [x] Q-8: referentne slike (M6 #1454 O9, M5 D-235, M7 Q16) odobravaju se po ekranu čim prođu gate (#87 6639423372).
- [x] Q-9: za #1443 i #1458 vlasnik daje „Spoji n” za točan head kad gate bude zelen; M0 se zatvara s njima (F-035, F-045, F-046, F-180; D-97 putanje). Svaka naredba vrijedi samo za točan head (#87 6639423372).
- [ ] Q-10, AI pomoćnik u pilotu (D-194). Odabir: t. 6 (model računa) i t. 7 (pružatelj nakon testa hrvatskog) odlučiti do 15. 12. 2026.; M9 ostaje u valu 1 (#87 6639423372). Otvoreno: proračun 10.000 EUR bez PDV-a (D-199 t. 2), razina 2 i „objašnjenje pojma” (D-64 prema D-80), `docs/privacy/05` t. 23 do 28 (Q25 15. 1. 2027.). Radnja: vlasnik.
- [ ] Q-11, Lekta (dozvola 2. 11., #87 `6588746985`, `docs/lekta/RIGHTSSCOPE.md` §6a, DAN-513). Odabir: licencu i kanal isporuke odlučiti zajedno do 15. 12. 2026. (#87 6639423372). Otvoreno: vidljivost, potvrda za Lektin kod, DAN-513 naspram D-217, FPZG potvrda (D-219).
- [ ] Q-12, pilot. Odabir: zapisati pragove uspjeha (`docs/PRODUCT.md` §12) i milestone M12 (P20, P21) prije probe (#87 6639423372). Rok: 20. 12. 2026. Radnja: vlasnik.
- [ ] Q-13, pilot. Odabir: imenovati sve tri uloge prije razgovora s pravnikom: tko smije zaustaviti pilot, tko prijavljuje AZOP-u u 72 h (P1), zamjenik vlasnika (P11) (#87 6639423372; `docs/PROGRAM.md:197`, :202, `docs/privacy/05` A.12). Rok: 15. 1. 2027.
- [x] Q-14: cilj za cijeli proizvod je WCAG 2.2 AA (D-248, `docs/FEATURES.md:33`); DAN-428 i DAN-553 se odblokiraju, F-03 i axe uskladiti (#87 6639423372).
- [ ] Q-15, zaštita `main` (`docs/SECURITY.md:44`, :74). Odabir: isključiti zaobilaženje administratora prije GO, do tada samo uz Owner Override (#87 6639423372). Radnja vlasnika (DAN-552). Rok: 22. 2. 2027.
- [ ] Q-16, čuvanje (D-30 PRIJEDLOG; D-12 brisanje u kopijama, P17; DAN-297, M10 10. 2.). Odabir: odgovor tražiti u paketu za FPZG (Q-3) (#87 6639423372). Kod čuvanja se ne gradi na D-30. Rok: 15. 1. 2027.
- [x] Q-17: varijanta plana V-A do V-E (D-203 t. 1) bira se na kontrolnim točkama 30. 11. i 20. 12. 2026. prema izmjerenoj brzini; V-B mijenja D-198 t. 1, V-C D-199 t. 1 (#87 6639423372).
- [ ] Q-18, zapisi. Odabir: jedan docs PR koji samo bilježi donesene odluke u `docs/DECISIONS.md` (D-195, D-197 #87 `6548381010`, `6549030612`, D-260 #1484, D-157, odluke iz #87 6639423372) i usklađuje `docs/PROGRAM.md:65` (15. 12. naspram 20. 12.) i :192 (rok ugovora) (#87 6639423372). Rok: 30. 11. 2026.
- [x] Q-19: do odluke vrijede zapisane odluke (#87 6639423372). Neskladi ostaju otvoreni: D-68 naspram N-09 val 3 i D-265 Q21; D-265 Q29 naspram RAZRADA Z-11; D-70 (EN) naspram `docs/PROGRAM.md:172`.
- [ ] Q-20, poslovno (ne blokira kod). Odabir: jedan razgovor za sve stavke do 15. 1. 2027. (#87 6639423372): P8 žig/domena, P12 strop troška agenata, P14 fondovi i osiguranje, P22 SLA, P3 plagijat, P6 etika, P29 kraj studija, DAN-303 (P48). Radnja: vlasnik.
- [ ] Q-21, operacije. Odabir: zahtjev Srcu za Registar resursa (`docs/PROGRAM.md:198`) šalje vlasnik; kostur `docs/OPERATIONS.md` (DAN-299 je Done, a datoteke nema) ide kroz DAN-540 (#87 6639423372). Rok: 30. 11. 2026.
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
