# Stanje rada

Ažurira se nakon svakog spojenog PR-a. Najviše 80 redaka.

## Trenutna faza

M0 Temelj: plan proizvoda u pregledu (PR `docs/product-plan`).

## Owner queue (samo Daniel)

Agent nikad ne uzima ove stavke i nikad ne čeka na njih.

- [ ] Pregledati i spojiti plan proizvoda (PR `docs/product-plan`).
- [ ] Spojiti `pisac-editor` PR #49 i #50 (izvor za prijenos jezgre).
- [ ] Potvrditi ili promijeniti prijedloge D-01 do D-08, D-10 do D-12 i D-16 u `docs/DECISIONS.md`.
- [ ] Javiti se Srcu: registracija u AAI@EduHr Registru resursa i pristup AAI@EduHr Labu.
- [ ] Javiti se FPZG-u: koordinator pilota, AAI administrator, službenik za zaštitu podataka.
- [ ] Odlučiti o vidljivosti repoa (preporuka: privatan).
- [ ] Konačno ime proizvoda (D-18).
- [ ] Potvrditi zadane pragove P-01 i P-02.
- [ ] Pokrenuti s FPZG-om D-13 (pravna osnova), D-14 (rokovi čuvanja) i D-15 (GO uvjeti).

## Agent queue

Uzima se prva stavka koju ništa iz Owner queuea ne blokira.

- [ ] M0: prijenos jezgre iz `pisac-editor` s testovima (blokirano: PR #49 i #50).
- [ ] M0: CI i lefthook.
- [ ] M1: AAI@EduHr spike (blokirano: pristup Labu).
- [ ] M2: model ustanove i pgTAP matrica pristupa (nakon M0).

## Gotovo

- 3. 10. 2026.: inicijalni commit repoa.
