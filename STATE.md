# Stanje rada

Ažurira se nakon svakog spojenog PR-a. Najviše 80 redaka.

## Trenutna faza

M0 Temelj: plan proizvoda spojen (PR #1); postavljen rad u paralelnim sesijama (`docs/SESSIONS.md`). Prvi cilj: demo za fakultet u ponedjeljak 2. 11. 2026. (D-76, D-82; zadaci u `docs/PLAN-DEMO.md`); sastanak s FPZG-om tek nakon njega. Zatim val 1 i val 2 oko 22. 2. 2027., kontrolna točka 15. 12. 2026.

## Owner queue (samo Daniel)

Agent nikad ne uzima ove stavke i nikad ne čeka na njih.

- [ ] Odobriti dizajnerski sustav i ekrane demoa (PLAN-DEMO D-2) prije frontend ekrana.
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
- [ ] Pitanja za sastanak s FPZG-om: FPZG-ov kalendar ljetnog semestra; je li Turnitin Clarity u Srceovoj licenci; tko je DPO; koja tri kolegija i koji nastavnici u valu 1; što referada traži pri predaji; zamjenski postupak kad student odbije Ductus ili Ductus ne radi (D-79); je li ispis razgovora po čl. 15 obavezan i kad je AI korišten samo za lekturu.
- [ ] Model podrške u pilotu (tko, kojim kanalom, u koje vrijeme, zamjenski postupak predaje kad Ductus ne radi pred rok).
- [ ] Sučelje na engleskom u pilotu ili Erasmus studenti izvan pilota (D-67).
- [ ] Potvrditi D-08 i D-71 do D-75 iz `docs/BACKEND.md` (istraživanje i neovisni pregled gotovi 3. 10. 2026.; preporuka UpCloud + Scaleway S3/TEM + AWS KMS, bez Supabasea; odluka o trošku iznad D-66, BACKEND §7); do tada M0 ne veže kod uz dobavljača.
- [ ] FPZG (odgovorna osoba za AAI@EduHr): ovlastiti Daniela za AAI@EduHr Lab e-porukom na `aai@srce.hr` i kasnije registrirati Ductus kao uslugu FPZG-a u Registru resursa. Fizička osoba to ne može sama (pravila AAI@EduHr). Draft je u Gmailu; poslati na sastanku nakon demoa ili odmah poslije (D-76). Blokira M1, ali ne demo.
- [ ] FINA: tek kad postoji obrt (ili FPZG kao ugovorna strana); do tada dva besplatna TSA-a (D-72).
- [ ] Otvoriti račune UpCloud, Scaleway (Object Storage, TEM) i AWS (samo KMS, IAM s uskim ovlastima), 2FA, ograničeni ključevi po okolišu za agenta. Blokira B0.1.
- [ ] Računovođa: PDV za fizičku osobu bez obrta; FINA zahtijeva poslovni subjekt.

## Agent queue

Zadatke dodjeljuje orkestrator, jedan po sesiji (`docs/SESSIONS.md`). Do demoa vrijedi tablica zadataka u `docs/PLAN-DEMO.md` §4; ovdje je samo ono što je u radu ili sljedeće.

- [ ] P-1 (Platforma): M0.1 kostur projekta. U radu.
- [ ] K-1 (Arhitektura): B0.4 prepis `docs/ARCHITECTURE.md`. U radu.
- [ ] D-1 (Dizajn): S8 dizajnerski sustav i ekrani demoa po prototipu (D-85). U radu.
- [ ] B-1 i F-1 (Backend, Frontend): planovi prijenosa jezgre. U radu.
- [ ] Sljedeće nakon P-1: P-2, P-3 (Platforma), B-2 (Backend), F-2 (Frontend), K-2 (citatni stil).
- [ ] Izvan demoa: B0.2 spike rekonstrukcije (nakon M0.2); B0.1 blokiran računima; M1 blokiran pristupom Labu; M4 blokiran licencom Lekte.

## Gotovo

- 3. 10. 2026.: inicijalni commit repoa; plan proizvoda v0.1 i v0.2 (PR #1).
- 3. 10. 2026.: `pisac-editor` PR #49 i #50 spojeni.
- 3. 10. 2026.: faza S: uloge i protokol sesija, Codex pregled, mjerenje tokena, čišćenje worktreeova, nadzorna ploča (PR #2).
- 3. 10. 2026.: odluke D-81 do D-86; plan demoa (`docs/PLAN-DEMO.md`).
