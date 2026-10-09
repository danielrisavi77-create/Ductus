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

## Otvoreni razvojni stog — provjera 9. 10. 2026.

- [ ] #105 / DAN-23: docs D-91–93 (dbmate, receipt v2, kumulativni log), `critical`; CI zelen, neovisni current-head review i zaseban QA još nisu potvrđeni. Zamjenjuje neprihvaćeni #103; ne spajati oba.
- [ ] #39 / DAN-23: P-4 dbmate + pgTAP je draft na staroj bazi; review/QA PASS vrijedi za `aac95bd5`, ali refresh nakon #105 mijenja head i traži nove dokaze prije mergea.
- [ ] DAN-71: sedam D-91 zaštita (checksum, strict order, lock, schema drift, roles, prod-only forward, pg-boss pin) u zasebnom PR-u nakon #39; nije implementirano.
- [ ] #46 / DAN-24: B-5a identity/session/RLS čeka #39 i novi critical review + drugi App QA; DAN-32 OIDC demo i DAN-33 B-7 nadalje ovise o tim temeljima.
- [ ] #97 / DAN-25: sync hardening je otvoren; stari ACK P1 obrađen, ali novi P1 (`parseCommitOutcome` gubi receipt) i P2 (salvage-local stale base) ostaju neriješeni; current-head review/QA/gate i browser adapter nisu gotovi.
- [ ] DAN-54: receipt v2 samo u lokalnom, neobjavljenom worktreeu; prije spajanja D-92 docs prihvat, stvarna read-only inventura durable v1 signed/pending, neovisni critical review + QA.
- [ ] DAN-55: kumulativni log D-93 je specifikacijski kandidat #105, ne dovršen B5 runtime. Bez sintetičkih listova; checkpoint signer mora štititi od rollbacka/forka.
- [ ] #42 / DAN-26 lefthook, #44 / DAN-27 E2E, #45 / DAN-28 forbidden terms, #48 / DAN-30 app shell: otvoreni kandidati; pregled, potrebna osvježenja i gateovi nisu dovršeni.
- [ ] #89 / DAN-39: subscription-first review routing ima blokirajući security review; ne mergeati privilegirani `pull_request_review` workflow prije popravka.
- [ ] DAN-49: F-3 journal/drainRunner/editor integracija čeka provjerenu #97 sync/receipt granicu; ne poistovjetiti sa spojenim editor-schema PR #49.
- [ ] DAN-50: relativni `node_modules/pg` import zaobilazi ESLint boundary; odvojeni critical security fix i testovi ostaju otvoreni.
- [ ] DAN-72 / GitHub #60: ažurirati izvedeni STATE; provjeriti preostale docs nesklade tek nakon prihvata #105, bez prijepisa tuđih kandidata.

## Ne smije se izgubiti

- B-8: canonical JCS + SHA-256, unknown fields reject, commit+reserve atomically, client/server size limit.
- F-3/F-8: SYNCED tek uz potpisanu potvrdu; stale/local-save ishodi nakon novog EDIT-a; recovery/rebase/salvage redoslijed testirati.
- B-12: replay za delete/cut/replace provjerava hash uklonjenog raspona.
- Prije velikog `diffText`: input granica ili diff po odlomcima + postojeći hardening nalazi.
- B0.2 ponoviti na stvarno kupljenom stroju; M1 čeka Lab; M4 čeka Lekta licencu.

## Gotovo
- #99: koordinacija izvora istine Linear/GitHub/Space; #100: proširena pg import granica (ne pokriva DAN-50); #104: sigurnosni Next.js 15.5.27, post-merge main CI zelen (8. 10. 2026.).
- #49: editor schema/interop je spojen; nije isto što i DAN-49 F-3 integration.
- #95 / DAN-42: savjetodavni Laya C1/C2 temelj spojen 9. 10. 2026. (model i dalje isključen; bez pilot/production aktivacije).

- Plan proizvoda, odluke i demo-plan; arhitektura v0.4.
- CI/skeneri, lokalni stog, prijenos prve jezgre, citatni stil, evidence/forensics osnova.
- PR #51: multi-account/provider-neutral agent runtime i repo-local skills.
