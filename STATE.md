# Stanje rada

Ažurira se skupno nakon spojenih PR-ova i kontrolnih točaka. Ovaj presjek čuva gateove, ciljeve i vlasničke obveze; za živi prioritet, nositelja i status zadatka mjerodavan je Linear. Cilj: najviše 80 redaka.

## Trenutna faza

M0 Temelj. Prvi cilj ostaje radni demo za FPZG 2. 11. 2026. (`docs/PLAN-DEMO.md`). Ductus Engineering System v1 uvodi risk-based review, QA/Bug Hunter/Product uloge, GitHub za izvršenje i dokaze te Linear za zadatke, prioritete, nositelje i statuse.

## Owner queue (samo Daniel)

Agent nikad ne uzima ove stavke i nikad ne čeka na njima ako drugi posao može naprijed.

- [ ] Nakon mergea Engineering System v1 zaštititi `main`: PR obvezan; direct/force push i delete zabranjeni; unresolved conversations blokiraju; obvezni statusi CI, Local stack, Security scanners, Dependency review i Engineering review gate; squash only.
- [ ] Proba demoa 31. 10. 2026. i snimka prolaza (PLAN-DEMO D-3, D-4).
- [ ] Odlučiti D-06 ili strožu D-39 nakon UX testa iz `docs/UX-EVAL.md`.
- [ ] Potvrditi ili promijeniti D-08, D-16, D-20, D-34, D-37, D-38 te pragove P-01 do P-04.
- [ ] D-56: pravno mišljenje + Constitution Gate C-14/C-19 prije ikakvog bilježenja ritma; nije na kritičnom putu demoa.
- [ ] FPZG: koordinator pilota, kolegiji/mentori, akademski kalendar, AAI administrator, DPO, D-04, D-29, D-30, D-31, D-35, zamjenski postupak i zahtjev za ispis razgovora.
- [ ] FPZG AAI: ovlast za AAI@EduHr Lab i kasnije registracija Ductusa kao usluge. Blokira M1, ne demo.
- [ ] Lekta: licenca/pravo redistribucije prije punog M4 paketa.
- [ ] Dobavljači: UpCloud, Scaleway i AWS KMS računi + 2FA i uski ključevi; blokira B0.1.
- [ ] Računovođa: PDV; FINA tek uz obrt ili FPZG kao ugovornu stranu.
- [ ] Vidljivost repoa: prije stvarnih podataka ponovno odlučiti ostaje li javni.
- [ ] Konačno ime proizvoda.

## Engineering System v1

Kanonski dokument: `docs/ENGINEERING_SYSTEM.md`.

- Normalno 3 writera: Backend, Frontend, Platforma; četvrti samo za potpuno neovisan posao.
- Kontrolne uloge: Orkestrator, Product/UX, QA, Independent Reviewer, Bug Hunter.
- Autor ne reviewa vlastiti PR; Bug Hunter/Product ne implementiraju vlastite nalaze.
- `low` i `standard`: neovisni review na aktualnom headu.
- `critical`: neovisni review + zaseban QA PASS na aktualnom headu.
- Novi push invalidira review/QA preko `Review-Head` / `QA-Head`.
- Owner Override je eksplicitna iznimka s razlogom i head SHA-om.

## Otvoreni razvojni stog

Novi feature rad je privremeno ograničen dok se postojeći stog ne osvježi na aktualni `main`.

- [ ] #39 P-4 dbmate + pgTAP — prvo osvježiti; baza za #46.
- [ ] #41 Frontend sync B — osvježiti i review `standard`.
- [ ] #42 lefthook Docker/CI — osvježiti i review `standard`.
- [ ] #44 P-5 E2E stack — osvježiti; pri tome uključiti browser politiku iz `docs/TESTING.md`.
- [ ] #45 P-6 zabranjeni izrazi — osvježiti; `critical` jer štiti PRODUCT §5.
- [ ] #46 B-5a identity/RLS — nakon #39 retarget na `main`; `critical` + QA.
- [ ] #47 pg import boundary — osvježiti nakon odluke o redoslijedu s #46.
- [ ] #48 F-4 shell/design — osvježiti i provjeriti UX/accessibility.
- [ ] #49 editor schema/interop — osvježiti nakon #41 gdje je potrebno.

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
