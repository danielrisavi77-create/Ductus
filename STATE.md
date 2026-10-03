# Stanje rada

Ažurira se nakon svakog spojenog PR-a. Najviše 80 redaka.

## Trenutna faza

M0 Temelj: plan proizvoda u pregledu (PR #1). Cilj: val 1 i val 2 spremni oko 22. 2. 2027. (puno radno vrijeme), kontrolna točka 15. 12. 2026.

## Owner queue (samo Daniel)

Agent nikad ne uzima ove stavke i nikad ne čeka na njih.

- [ ] Pregledati i spojiti plan proizvoda (PR #1).
- [ ] Spojiti `pisac-editor` PR #49 i #50 (izvor za prijenos jezgre).
- [ ] Potvrditi ili promijeniti prijedloge D-07, D-08, D-10, D-11, D-16, D-20, D-24, D-34, D-36, D-37, D-38 u `docs/DECISIONS.md`; odlučiti D-06 ili stroža D-39.
- [ ] Potvrditi zadane pragove P-01 do P-04.
- [ ] Srce: registracija u AAI@EduHr Registru resursa i pristup AAI@EduHr Labu.
- [ ] FPZG (prodekan Višeslav Raos): koordinator pilota, kolegiji i mentori, akademski kalendar ljetnog semestra, AAI administrator, službenik za zaštitu podataka.
- [ ] Pravno mišljenje za D-55 (kontrolna točka uživo) i bilježenje ritma iz D-56.
- [ ] Constitution Gate: izmjena Ustava C-14 i C-19 za reprodukciju s ritmom (D-56), u Driveu.
- [ ] FPZG: treba li "ispis razgovora" (čl. 9 Smjernica GenUI) i kad je AI korišten samo za lekturu ili prijevod.
- [ ] FPZG: D-29 (pravna osnova), D-30 (rokovi čuvanja), D-31 (GO uvjeti), D-35 (dopušteni AI pružatelji), D-04 (obveznost u pilotu).
- [ ] Lekta: odluka o licenci i pravu na redistribuciju pravila prije paketa za Ductus.
- [ ] 15. 12. 2026.: kontrolna točka roka (`PROGRAM.md`).
- [ ] Odlučiti o vidljivosti repoa (preporuka: privatan).
- [ ] Konačno ime proizvoda (D-18).
- [ ] Model podrške u pilotu (tko, kojim kanalom, u koje vrijeme, zamjenski postupak predaje kad Ductus ne radi pred rok).
- [ ] Sučelje na engleskom u pilotu ili Erasmus studenti izvan pilota (D-67).
- [ ] Potvrditi D-08 i D-71 do D-75 iz `docs/BACKEND.md` (istraživanje gotovo 3. 10. 2026.; preporuka Hetzner + Scaleway, bez Supabasea); do tada M0 ne veže kod uz dobavljača.
- [ ] Srce (`aai@srce.hr`): OIDC registracija, Lab, atributi, uvjeti, rokovi (proširuje stavku iznad).
- [ ] FINA: upit o RFC 3161 pristupu (ugovor, certifikat, minimalna naknada) za D-72.
- [ ] Otvoriti račune Hetzner i Scaleway (2FA), ograničeni API ključevi po okolišu za agenta.

## Agent queue

Uzima se prva stavka koju ništa iz Owner queuea ne blokira.

- [ ] M0: prijenos jezgre iz `pisac-editor` s testovima (blokirano: PR #49 i #50).
- [ ] B0.1 i B0.2: spikeovi hostinga (PITR, latencija) i rekonstrukcije 15.000 i 80.000 riječi (`docs/BACKEND.md` §8).
- [ ] M0: CI, lefthook, `docker compose` okruženje u CI-ju (lokalni Claude Code, treba Docker).
- [ ] M1: AAI@EduHr spike (blokirano: pristup Labu).
- [ ] M2: model fakulteta i pgTAP matrica pristupa (nakon M0).
- [ ] M4: paket pravila u Lekti po uzoru na `katedra-pack` (blokirano: odluka o licenci).

## Gotovo

- 3. 10. 2026.: inicijalni commit repoa; plan proizvoda v0.1 i v0.2.
