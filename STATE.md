# Stanje rada

Ažurira se nakon svakog spojenog PR-a. Najviše 80 redaka.

## Trenutna faza

M0 Temelj: plan proizvoda v0.2 u pregledu (PR #1). Cilj: val 1 spreman oko 22. 2. 2027.

## Owner queue (samo Daniel)

Agent nikad ne uzima ove stavke i nikad ne čeka na njih.

- [ ] Pregledati i spojiti plan proizvoda (PR #1).
- [ ] Spojiti `pisac-editor` PR #49 i #50 (izvor za prijenos jezgre).
- [ ] Potvrditi ili promijeniti prijedloge D-07, D-08, D-10, D-11, D-16, D-20, D-24, D-34, D-36, D-37, D-38 u `docs/DECISIONS.md`; odlučiti D-06 ili stroža D-39.
- [ ] Potvrditi zadane pragove P-01 do P-04.
- [ ] Srce: registracija u AAI@EduHr Registru resursa i pristup AAI@EduHr Labu.
- [ ] FPZG (prodekan Višeslav Raos): koordinator pilota, kolegiji i mentori, akademski kalendar ljetnog semestra, AAI administrator, službenik za zaštitu podataka.
- [ ] FPZG: D-29 (pravna osnova), D-30 (rokovi čuvanja), D-31 (GO uvjeti), D-35 (dopušteni AI pružatelji), D-04 (obveznost u pilotu).
- [ ] Lekta: odluka o licenci i pravu na redistribuciju pravila prije paketa za Ductus.
- [ ] 15. 12. 2026.: kontrolna točka roka (`PROGRAM.md`).
- [ ] Odlučiti o vidljivosti repoa (preporuka: privatan).
- [ ] Konačno ime proizvoda (D-18).

## Agent queue

Uzima se prva stavka koju ništa iz Owner queuea ne blokira.

- [ ] M0: prijenos jezgre iz `pisac-editor` s testovima (blokirano: PR #49 i #50).
- [ ] M0: CI, lefthook, `supabase start` u CI-ju (lokalni Claude Code, treba Docker).
- [ ] M1: AAI@EduHr spike (blokirano: pristup Labu).
- [ ] M2: model fakulteta i pgTAP matrica pristupa (nakon M0).
- [ ] M4: paket pravila u Lekti po uzoru na `katedra-pack` (blokirano: odluka o licenci).

## Gotovo

- 3. 10. 2026.: inicijalni commit repoa; plan proizvoda v0.1 i v0.2.
