# Stanje rada

Ažurira se nakon svakog spojenog PR-a. Najviše 80 redaka.

## Trenutna faza

M0 Temelj: plan proizvoda u pregledu (PR #1). Prvi cilj: demo za fakultet (D-76, `PROGRAM.md`), početak studenog 2026.; sastanak s FPZG-om tek nakon njega. Zatim val 1 i val 2 oko 22. 2. 2027., kontrolna točka 15. 12. 2026.

## Owner queue (samo Daniel)

Agent nikad ne uzima ove stavke i nikad ne čeka na njih.

- [ ] Pregledati i spojiti plan proizvoda (PR #1).
- [ ] Spojiti `pisac-editor` PR #49 i #50 (izvor za prijenos jezgre).
- [ ] Potvrditi ili promijeniti prijedloge D-07, D-08, D-10, D-11, D-16, D-20, D-24, D-34, D-36, D-37, D-38 u `docs/DECISIONS.md`; odlučiti D-06 ili stroža D-39.
- [ ] Potvrditi zadane pragove P-01 do P-04.
- [ ] FPZG (prodekan Višeslav Raos): koordinator pilota, kolegiji i mentori, akademski kalendar ljetnog semestra, AAI administrator, službenik za zaštitu podataka.
- [ ] Pravno mišljenje za D-55 (kontrolna točka uživo) i bilježenje ritma iz D-56.
- [ ] Constitution Gate: izmjena Ustava C-14 i C-19 za reprodukciju s ritmom (D-56), u Driveu.
- [ ] FPZG: treba li "ispis razgovora" (čl. 9 Smjernica GenUI) i kad je AI korišten samo za lekturu ili prijevod.
- [ ] FPZG: D-29 (pravna osnova), D-30 (rokovi čuvanja), D-31 (GO uvjeti), D-35 (dopušteni AI pružatelji), D-04 (obveznost u pilotu).
- [ ] Lekta: odluka o licenci i pravu na redistribuciju pravila prije paketa za Ductus.
- [ ] 15. 12. 2026.: kontrolna točka roka (`PROGRAM.md`).
- [ ] Odlučiti o vidljivosti repoa (preporuka: privatan).
- [ ] Konačno ime proizvoda (D-18).
- [ ] Potvrditi prijedlog iz D-77 (ispis razgovora iz vanjskog AI-ja uz izjavu).
- [ ] Pitanja za sastanak s FPZG-om: FPZG-ov kalendar ljetnog semestra; je li Turnitin Clarity u Srceovoj licenci; tko je DPO; koja tri kolegija i koji nastavnici u valu 1; što referada traži pri predaji; zamjenski postupak kad student odbije Ductus ili Ductus ne radi (D-79); je li ispis razgovora po čl. 15 obavezan i kad je AI korišten samo za lekturu.
- [ ] Model podrške u pilotu (tko, kojim kanalom, u koje vrijeme, zamjenski postupak predaje kad Ductus ne radi pred rok).
- [ ] Sučelje na engleskom u pilotu ili Erasmus studenti izvan pilota (D-67).
- [ ] Potvrditi D-08 i D-71 do D-75 iz `docs/BACKEND.md` (istraživanje i neovisni pregled gotovi 3. 10. 2026.; preporuka UpCloud + Scaleway S3/TEM + AWS KMS, bez Supabasea; odluka o trošku iznad D-66, BACKEND §7); do tada M0 ne veže kod uz dobavljača.
- [ ] FPZG (odgovorna osoba za AAI@EduHr): ovlastiti Daniela za AAI@EduHr Lab e-porukom na `aai@srce.hr` i kasnije registrirati Ductus kao uslugu FPZG-a u Registru resursa. Fizička osoba to ne može sama (pravila AAI@EduHr). Draft je u Gmailu; poslati na sastanku nakon demoa ili odmah poslije (D-76). Blokira M1, ali ne demo.
- [ ] FINA: tek kad postoji obrt (ili FPZG kao ugovorna strana); do tada dva besplatna TSA-a (D-72).
- [ ] Otvoriti račune UpCloud, Scaleway (Object Storage, TEM) i AWS (samo KMS, IAM s uskim ovlastima), 2FA, ograničeni ključevi po okolišu za agenta. Blokira B0.1.
- [ ] Računovođa: PDV za fizičku osobu bez obrta; FINA zahtijeva poslovni subjekt.

## Agent queue

Uzima se prva stavka koju ništa iz Owner queuea ne blokira.

- [ ] M0: prijenos jezgre iz `pisac-editor` s testovima (blokirano: PR #49 i #50).
- [ ] B0.1 (blokirano: računi) i B0.2: spikeovi okruženja (PITR povrat na UpCloud, uloge, latencija, KMS) i rekonstrukcije 15.000 i 80.000 riječi (`docs/BACKEND.md` §8).
- [ ] M0: CI, lefthook, `docker compose` okruženje u CI-ju (lokalni Claude Code, treba Docker).
- [ ] M1: AAI@EduHr spike (blokirano: pristup Labu).
- [ ] M2: model fakulteta i pgTAP matrica pristupa (nakon M0).
- [ ] M4: paket pravila u Lekti po uzoru na `katedra-pack` (blokirano: odluka o licenci).

## Gotovo

- 3. 10. 2026.: inicijalni commit repoa; plan proizvoda v0.1 i v0.2.
