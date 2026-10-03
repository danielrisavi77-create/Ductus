# Stanje rada

Ažurira se nakon svakog spojenog PR-a. Najviše 80 redaka.

## Trenutna faza

M0 Temelj: plan proizvoda spojen (PR #1); postavljen rad u paralelnim sesijama (`docs/SESSIONS.md`). Prvi cilj: demo za fakultet u ponedjeljak 2. 11. 2026. (D-76, D-82; zadaci u `docs/PLAN-DEMO.md`); sastanak s FPZG-om tek nakon njega. Zatim val 1 i val 2 oko 22. 2. 2027., kontrolna točka 15. 12. 2026.

## Owner queue (samo Daniel)

Agent nikad ne uzima ove stavke i nikad ne čeka na njih.

- [ ] Proba demoa u subotu 31. 10. 2026. i snimka prolaza (PLAN-DEMO D-3, D-4).
- [ ] Potvrditi ili promijeniti prijedloge D-08, D-16, D-20, D-34, D-37, D-38 u `docs/DECISIONS.md`; odlučiti D-06 ili stroža D-39.
- [ ] Potvrditi zadane pragove P-01 do P-04.
- [ ] FPZG (prodekan Višeslav Raos): koordinator pilota, kolegiji i mentori, akademski kalendar ljetnog semestra, AAI administrator, službenik za zaštitu podataka.
- [ ] Pravno mišljenje za D-55 (kontrolna točka uživo) i bilježenje ritma iz D-56.
- [ ] Constitution Gate: izmjena Ustava C-14 i C-19 za reprodukciju s ritmom (D-56), u Driveu.
- [ ] FPZG: treba li "ispis razgovora" (čl. 9 Smjernica GenUI) i kad je AI korišten samo za lekturu ili prijevod.
- [ ] FPZG: D-29 (pravna osnova), D-30 (rokovi čuvanja), D-31 (GO uvjeti), D-35 (dopušteni AI pružatelji), D-04 (obveznost u pilotu).
- [ ] Lekta: odluka o licenci i pravu na redistribuciju pravila prije paketa za Ductus.
- [ ] 15. 12. 2026.: kontrolna točka roka (`PROGRAM.md`).
- [ ] Vidljivost repoa: zasad javan (odluka 3. 10. 2026.); preporuka ostaje privatan prije stvarnih podataka.
- [ ] Konačno ime proizvoda (D-18).
- [ ] Pitanja za sastanak s FPZG-om: FPZG-ov kalendar ljetnog semestra; je li Turnitin Clarity u Srceovoj licenci; tko je DPO; koja tri kolegija i koji nastavnici u valu 1; što referada traži pri predaji; zamjenski postupak kad student odbije Ductus ili Ductus ne radi (D-79); je li ispis razgovora po čl. 15 obavezan i kad je AI korišten samo za lekturu; potvrda izvedenih oblika citatnog stila označenih "derived" u `config/faculties/fpzg/citation.json` (poglavlje, mrežni izvor, "i sur." za 3+ autora, više autora u popisu, akronim institucije).
- [ ] Model podrške u pilotu (tko, kojim kanalom, u koje vrijeme, zamjenski postupak predaje kad Ductus ne radi pred rok).
- [ ] Sučelje na engleskom u pilotu ili Erasmus studenti izvan pilota (D-67).
- [ ] Potvrditi D-08 i D-71 do D-75 iz `docs/BACKEND.md` (istraživanje i neovisni pregled gotovi 3. 10. 2026.; preporuka UpCloud + Scaleway S3/TEM + AWS KMS, bez Supabasea; odluka o trošku iznad D-66, BACKEND §7); do tada M0 ne veže kod uz dobavljača.
- [ ] FPZG (odgovorna osoba za AAI@EduHr): ovlastiti Daniela za AAI@EduHr Lab e-porukom na `aai@srce.hr` i kasnije registrirati Ductus kao uslugu FPZG-a u Registru resursa. Fizička osoba to ne može sama (pravila AAI@EduHr). Draft je u Gmailu; poslati na sastanku nakon demoa ili odmah poslije (D-76). Blokira M1, ali ne demo.
- [ ] FINA: tek kad postoji obrt (ili FPZG kao ugovorna strana); do tada dva besplatna TSA-a (D-72).
- [ ] Otvoriti račune UpCloud, Scaleway (Object Storage, TEM) i AWS (samo KMS, IAM s uskim ovlastima), 2FA, ograničeni ključevi po okolišu za agenta. Blokira B0.1.
- [ ] Računovođa: PDV za fizičku osobu bez obrta; FINA zahtijeva poslovni subjekt.

## Agent queue

Zadatke dodjeljuje orkestrator po `docs/ORKESTRATOR.md`. Do demoa vrijedi tablica u `docs/PLAN-DEMO.md` §4; ovdje je samo ono što je u radu ili sljedeće.

**Adresa orkestratora:** "Ductus orkestrator" [local_98c824a6-a2aa-47cf-90d1-622973929825] (od 3. 10. 2026.; mijenja se pri rotaciji, `SESSIONS.md` §2a).

**Repo je na `D:\Ductus` (SSD, od 3. 10. 2026.).** P-8: C: je tvrdi disk; instalacija 879 s na C: prema 15 s na D:, typecheck i testovi 462 s prema 10 s. pnpm pohrana je `D:\pnpm-store` (globalno, mora biti na istom disku). Nove sesije i worktreeovi otvaraju se iz `D:\Ductus`; stara kopija `C:\Users\Daniel\Ductus` ostaje dok se stare sesije ne arhiviraju.

**Predaje za nove sesije (3. 10. 2026.):** Backend issue #34, Frontend #35, Platforma #36. Nova sesija čita svoj issue uz ovaj odjeljak i zatvara ga kad preuzme. Odgovori orkestratora na otvorena pitanja iz predaja: tekst stanja spremanja ("spremljeno na uređaju", "spremljeno na poslužitelju") mijenja se u F-8 uz ključeve hr i en; `en.ts` (D-70) radi Frontend kao zaseban PR odmah nakon F-4; `CI=true` u lefthooku radi Platforma (mali PR iz #36); `process-history` bez `durationMs` ne prenosi se do vala 3; o `verified-object-activity` (ovisi o `academic-graph`) odlučuje se kad Frontend prenese `lib/process-ledger`; vlasnik P-6 je Platforma, Frontend daje popis ključeva teksta.

**Predaja orkestratora (3. 10. 2026., noć).** Orkestrator se rotira: Daniel otvara novu sesiju "Ductus orkestrator" iz `D:\Ductus` i arhivira staru (adresa gore). Otvorenih PR-ova nema. Platforma, Backend i Frontend dobivaju nove sesije iz `D:\Ductus` s predajama u issueima #34 do #36; stare sesije (worktreeovi na C:) za arhiviranje. Sesija Citiranje nastavlja kao Arhitektura.

Prvi potezi nove sesije orkestratora:
1. PR koji u `STATE.md` upisuje novu adresu orkestratora; ista adresa porukom svim aktivnim sesijama (`ORKESTRATOR.md` §7).
2. Popis sesija: potvrditi da su Platforma 2, Frontend 2 i Backend 2 pokrenute i zatvorile svoje issuee; postaviti effort po zadatku (Platforma P-4 medium, Frontend medium, Backend B-5 high).
3. Poruke stižu samo dok orkestrator miruje: bez dugotrajnih pozadinskih petlji (`ORKESTRATOR.md` §1); kad sesija javi da poruka nije potvrđena, čitati njezin transkript.
4. Pult: https://claude.ai/artifact/UY9VUZPW4mePTZjhCPGLSd (podaci preko ArtifactData, kolekcije `board`, `sessions`, `days`); pitanja Danielu obaviješću (§4a).
5. Kontrolna točka T1 u petak 9. 10. (`PLAN-DEMO.md` §3): kostur, CI i lokalni stog spojeni, dizajn odobren; uz to prijenos jezgre (T2) je za Backend gotov, za Frontend 5 od 11 koraka.
6. Kad se stare sesije arhiviraju, stara kopija `C:\Users\Daniel\Ductus` može se ukloniti (Daniel ručno; memorija orkestratora vezana je uz putanju projekta).

- [ ] Platforma (nova sesija): P-4 (dbmate, pgTAP u CI-ju); mali PR: lefthook `secrets` uz upozorenje preskače gitleaks kad Docker ne radi (CI ionako skenira) i naredbe u lefthooku s `CI=true` (inače `pnpm exec` visi na skrivenom upitu); zatim P-5, P-6.
- [ ] Backend (nova sesija; predaja u opisu PR #23): spojeni #9, #18, #20, #23 (D-88), #29 (nepoznata polja u descriptoru), #30 (gateway, outbox, development signer; Codex Astra 3 važna ispravljena), #32 (aws-kms signer s popisom pouzdanih verzija ključa). Prijenos backend jezgre je gotov. Sljedeće: B-5 kad P-4 bude spojen (`critical`). Čeka Frontendov editor: `forensics/verified-*`, `evidence-v2-legacy-compat.test`. Ne prenose se vremenski moduli (PRODUCT §5 pravilo 4, D-63), reference-model, Azure signer, nekorišteni portovi.
- [ ] Uvjeti za B-8 (Codex na #20): `evidence-ingest` odbija nepoznata polja u descriptoru (spojeno, #29) i provjerava kanonski JCS segment i SHA-256 prema `descriptor.segmentHash` (spojeno u gatewayu, #30, s testom); ruta `ingest` mora koristiti taj gateway. Uz to (Codex na #24, odgođeno): commit dokumenta i `reserve` odsječka u istom RPC-u mijenjaju `CommitRequest` i `CommitOutcome` u `domain/serverSync/contract.ts` u istom PR-u kao klijent (journal, drainRunner); klijentska granica veličine (`JSON.stringify`) usklađuje se s poslužiteljskom.
- [ ] Uvjeti za F-3 i F-8 (Codex na #26, odgođeno, ne smije se izgubiti): `SYNCED` tek uz potpisanu potvrdu (novo stanje uz B-8 i F-8); ishod spremanja ili CAS-a koji je u tijeku (`SYNC_STALE_BASE`, `LOCAL_SAVE_FAILED`) obrađuje se i nakon novog `EDIT`; `restoreSyncState` ne vraća prekinutu operaciju kao aktivnu; `rebase` i `salvage-local` prema redoslijedu iz journala. Svaki uz test redoslijeda u PR-u s journalom i drainRunnerom.
- [ ] Uvjet za B-12 (Codex na #21): `forensics/replay.ts` za `delete`, `cut` i `replace` uspoređuje hash uklonjenog raspona s hashom u događaju i prekida replay pri nepodudaranju.
- [ ] Frontend (nova sesija; izvor `pisac-editor@6cd0b75`, plan F1 do F12 u opisu #8): spojeni #19, #21, #24, #26 (sync A). Redom, svaki PR od svježeg `origin/main`, Codex `standard`: (1) sync B: conflict, recovery, drain, `index.ts` (102 testa); (2) editor schema i interop (52); (3) process-capture, `Editor.tsx`, `SyncStatusChip` (25); (4) `lib/process-ledger` (14), nakon njega Backend prenosi `forensics/verified-*`; (5) `lib/journal` db, lock, recovery (26), `journal.ts` (98), `lib/sync/drainRunner` (40), uz uvjete za F-3 niže; (6) F-4 ljuska po dizajnu v6 (D-89). Ispravke Codex nalaza u prenesenom kodu staviti u `*.hardening.test.ts`, prenesene testove ne mijenjati; u svaki PR tablica izvor, preneseno, nije preneseno.
- [ ] Okolina: lefthook `secrets` traži pokrenut Docker Desktop (do popravka Platforme); git i pnpm naredbe s `CI=true`; worktree u dugoj putanji ruši vitest (MAX_PATH); `pnpm test` ne uključuje `tests/integration`.
- [ ] Sljedeće iz PLAN-DEMO: P-4 (dbmate, pgTAP u CI-ju), P-5 (E2E u CI-ju), P-6 (provjera zabranjenih riječi, Frontend ili Platforma), B-5 (uloge baze, sesije).
- [ ] Prije prvog poziva `diffText` nad cijelim radom (usporedba verzija, M5 do M7): granica ulaza ili diff po odlomcima, plus ispravci negacije i razmaka (Codex nalazi na PR #8).
- [ ] Izvan demoa: B0.2 ostaje otvoren do mjerenja na stroju koji se kupuje (nakon B0.1); B0.1 blokiran računima; M1 blokiran pristupom Labu; M4 blokiran licencom Lekte.

## Gotovo

- 3. 10. 2026.: inicijalni commit repoa; plan proizvoda v0.1 i v0.2 (PR #1).
- 3. 10. 2026.: `pisac-editor` PR #49 i #50 spojeni.
- 3. 10. 2026.: faza S: uloge i protokol sesija, Codex pregled, mjerenje tokena, čišćenje worktreeova, nadzorna ploča (PR #2).
- 3. 10. 2026.: odluke D-81 do D-89 (potvrđeni D-07, D-10, D-11, D-24; demo 2. 11.; dizajn v6 odobren; rezovi odobreni; `ductus-evidence-*`); plan demoa (`docs/PLAN-DEMO.md`); pravila orkestratora (`docs/ORKESTRATOR.md`).
- 3. 10. 2026.: B0.4 prepis `docs/ARCHITECTURE.md` (PR #3); pravila za izgubljene poruke među sesijama (PR #5); B0.2 lokalna osnovica rekonstrukcije, `docs/spikes/B0.2.md` (PR #6): CPU i memorija nisu problem, volumen kontrolnih točaka svakih 200 koraka raste kvadratno (prijedlog oko 2.000 koraka ide uz B0.3).
- 3. 10. 2026.: M0 krenuo: kostur (#7), CI sa skenerima (#10), F1 i18n i diff (#8), forensics jezgra (#9), FPZG citatni stil (#12), lokalni stog s lažnim OIDC-om i RustFS-om (#13), ARCHITECTURE v0.4 (#14), paketi za editor (#15), pravila orkestratora i Codex razine (#16, #22), Dependabot (#17), forensics replay (#18), domain/document (#19), portovi evidencije (#20), collaboration i evidence (#21), `ductus-evidence-*` (#23).
