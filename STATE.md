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

**Stanje orkestratora (3. 10. 2026., večer).** Nova sesija orkestratora preuzela; Daniel pitanja dobiva obaviješću (`ORKESTRATOR.md` §4a). Spojeno i #13 (P-3). Sesija Citiranje nastavlja kao Arhitektura (Danielova želja); Dizajn za arhiviranje.

- [ ] Platforma: P-9 paketi za Frontend (Tiptap, Dexie, fake-indexeddb), pa P-8 istraga spore `pnpm install` na Windowsu. Zatim rotacija; P-4 ide svježoj sesiji.
- [ ] Backend: PR2 (#18) i PR3 (#20) spojeni; D-88 `ductus-evidence-*` kao zaseban PR, zatim rotacija.
- [ ] Uvjet za B-8 (Codex na #20): `evidence-ingest` provjerava kanonski JCS segment i SHA-256 prema `descriptor.segmentHash` te odbija nepoznata polja u descriptoru.
- [ ] Frontend: F-2 u pet PR-ova (document; collaboration i evidence; serverSync; sync u dva dijela). Editor, journal i drainRunner čekaju P-9; nakon toga F-4 ljuska (D-89).
- [ ] Arhitektura: `ARCHITECTURE.md` §5 i §6 usklađeni s B0.2 (kontrolne točke oko 2.000 koraka, PRIJEDLOG do B0.3).
- [ ] Sljedeće iz PLAN-DEMO: P-4 (dbmate, pgTAP u CI-ju), P-5 (E2E u CI-ju), P-6 (provjera zabranjenih riječi, Frontend ili Platforma), B-5 (uloge baze, sesije).
- [ ] Prije prvog poziva `diffText` nad cijelim radom (usporedba verzija, M5 do M7): granica ulaza ili diff po odlomcima, plus ispravci negacije i razmaka (Codex nalazi na PR #8).
- [ ] Izvan demoa: B0.2 ostaje otvoren do mjerenja na stroju koji se kupuje (nakon B0.1); B0.1 blokiran računima; M1 blokiran pristupom Labu; M4 blokiran licencom Lekte.

## Gotovo

- 3. 10. 2026.: inicijalni commit repoa; plan proizvoda v0.1 i v0.2 (PR #1).
- 3. 10. 2026.: `pisac-editor` PR #49 i #50 spojeni.
- 3. 10. 2026.: faza S: uloge i protokol sesija, Codex pregled, mjerenje tokena, čišćenje worktreeova, nadzorna ploča (PR #2).
- 3. 10. 2026.: odluke D-81 do D-89 (potvrđeni D-07, D-10, D-11, D-24; demo 2. 11.; dizajn v6 odobren; rezovi odobreni; `ductus-evidence-*`); plan demoa (`docs/PLAN-DEMO.md`); pravila orkestratora (`docs/ORKESTRATOR.md`).
- 3. 10. 2026.: B0.4 prepis `docs/ARCHITECTURE.md` (PR #3); pravila za izgubljene poruke među sesijama (PR #5); B0.2 lokalna osnovica rekonstrukcije, `docs/spikes/B0.2.md` (PR #6): CPU i memorija nisu problem, volumen kontrolnih točaka svakih 200 koraka raste kvadratno (prijedlog oko 2.000 koraka ide uz B0.3).
- 3. 10. 2026.: M0 krenuo: kostur (#7), CI sa skenerima (#10), F1 i18n i diff (#8), forensics jezgra (#9), FPZG citatni stil (#12), lokalni stog s lažnim OIDC-om i RustFS-om (#13).
