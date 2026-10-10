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
- [ ] Potvrditi ili promijeniti D-08, D-16, D-20, D-34, D-38 te pragove P-01 do P-04.
- [ ] D-56: pravno mišljenje + Constitution Gate C-14/C-19 prije ikakvog bilježenja ritma; nije na kritičnom putu demoa.
- [ ] FPZG: koordinator pilota, kolegiji/mentori, akademski kalendar, AAI administrator, DPO, D-04, D-29, D-30, D-31, D-35, zamjenski postupak i zahtjev za ispis razgovora.
- [ ] FPZG AAI: ovlast za AAI@EduHr Lab i kasnije registracija Ductusa kao usluge. Blokira M1, ne demo.
- [ ] Lekta: licenca/pravo redistribucije prije punog M4 paketa.
- [ ] Dobavljači: UpCloud, Scaleway i AWS KMS računi + 2FA i uski ključevi; blokira B0.1.
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
- Novi push invalidira review/QA preko `Review-Head` / `QA-Head`.
- Owner Override je eksplicitna iznimka s razlogom i head SHA-om.

## Otvoreni razvojni stog

Stanje 10. 10. 2026. navečer prema `gh pr list` (nositelj statusa je Linear; review i QA stanje je na PR-u).

Otvoreno:

- #160 DAN-129 `withActor` hardening (critical).
- #173 DAN-137 `cc-safety-net` fail closed (critical, D-97).
- #175 B-7 2/2 zadaci i potvrda obavijesti (critical).
- #185, #186 orchestrator CI i metrike; #189, #191, #194, #196, #198, #199, #192 (vidi `gh pr list`).
- #180 DAN-138 test kopija skillova (draft); #94 DAN-41 drugi pružatelj reviewa (draft, nakon demoa).

Spojeno 10. 10.: #188 (docs), #174 DAN-127, #45 P-6, #164 DAN-130, #151 DAN-120, #170 DAN-135, #169 DAN-138 (CODEOWNERS), #163 B-7 1/2, #162 DAN-131, #159 DAN-110, #150 B-14, #148 B-5b, #133 B-8a, #165, #147 i #105 (docs).

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
