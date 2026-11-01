# Ductus: plan i program backenda

Verzija 0.3 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi · Status: PRIJEDLOG (čeka potvrdu dijela D-08 o dobavljačima i trošku, rok B0.1 16. 11. 2026., te D-72, D-73 (samo izbor biblioteke; vlastiti OIDC klijent odlučen 11. 10. 2026., a sesije u bazi i identitet u RLS-u potvrđeni u D-90) i D-75; D-71 i D-74 potvrđene 10. 10. 2026.; dio D-08 o aplikaciji i D-34 odlučeni 11. 10. 2026., D-71 i D-72 dopunjeni 11. 10. 2026. domenom evidencije, D-102)

Ovaj dokument zamjenjuje otvoreni D-08. Izvori: dokument "Pisač: Backend arhitektura i vizija vNext" (dalje vNext), tri istraživanja (hosting, potpisi i vrijeme, prijava i ovlasti), `ARCHITECTURE.md` v0.2, te dva neovisna pregleda (arhitektonsko-sigurnosni i provjera činjenica na primarnim izvorima). **Verzija 0.1 imala je pogrešku koja je mijenjala preporuku: Scaleway Managed PostgreSQL nema PITR ni na jednom tipu čvora** (provjereno u službenom repozitoriju dokumentacije `scaleway/docs-content`, commit od 2. 10. 2026.). Ova verzija to ispravlja i ugrađuje ostale nalaze pregleda (šest kritičnih, 19 važnih). Cijene su s datumom 3. 10. 2026.; gdje nešto nije potvrđeno s primarnog izvora, piše NEPROVJERENO.

Tekst plana je po temama u `docs/backend/`; ovdje je samo indeks. Brojevi odjeljaka su ostali isti, pa referenca "`BACKEND.md` §N" vodi u datoteku navedenu pod tim odjeljkom. Pravila se mijenjaju u toj datoteci, ne ovdje.

## 1. Sažetak odluke

[`backend/pregled.md`](backend/pregled.md)

## 2. vNext: što uzimamo, što odgađamo

[`backend/pregled.md`](backend/pregled.md)

## 3. Topologija pilota

[`backend/pregled.md`](backend/pregled.md)

## 4. Ključne dizajnerske odluke

- 4.1 Evidencija, potpis i bucket: [`backend/evidencija.md`](backend/evidencija.md)
- 4.2 Dnevni korijen i vanjsko vrijeme: [`backend/evidencija.md`](backend/evidencija.md)
- 4.3 Prijava, sesije i identitet u bazi (`withActor`, `openSession`): [`backend/prijava-i-ovlasti.md`](backend/prijava-i-ovlasti.md)
- 4.4 Ovlasti: [`backend/prijava-i-ovlasti.md`](backend/prijava-i-ovlasti.md)
- 4.5 Poslovi, obavijesti, AI (worker): [`backend/poslovi-i-predaja.md`](backend/poslovi-i-predaja.md)
- 4.6 Rekonstrukcija i predaja: [`backend/poslovi-i-predaja.md`](backend/poslovi-i-predaja.md)
- 4.7 Kopije, povrat, čuvanje: [`backend/baza-i-pogon.md`](backend/baza-i-pogon.md)
- 4.8 Migracije i sheme: [`backend/baza-i-pogon.md`](backend/baza-i-pogon.md)
- 4.9 Opservabilnost i curenje sadržaja: [`backend/baza-i-pogon.md`](backend/baza-i-pogon.md)
- 4.10 Trenutno stanje rada (B-11): [`backend/suradnja.md`](backend/suradnja.md)
- 4.11 Komentari uz odlomak (B-10): [`backend/suradnja.md`](backend/suradnja.md)
- 4.12 Prikaz uživo (B-LIVE): [`backend/suradnja.md`](backend/suradnja.md)
- 4.13 Ruta `ingest` (B-8): [`backend/evidencija.md`](backend/evidencija.md)

## 5. Što još nije potvrđeno (spike prije odluke)

[`backend/program.md`](backend/program.md)

## 6. Obvezna kontrolna lista za svaku backend komponentu

[`backend/kontrolna-lista.md`](backend/kontrolna-lista.md)

## 7. Trošak

[`backend/program.md`](backend/program.md)

## 8. Program backenda

[`backend/program.md`](backend/program.md)

## 9. Što treba od vlasnika

[`backend/program.md`](backend/program.md)

## Dodaci

- Dodatak A: proba povrata u točku na UpCloud-u (B0.1): [`backend/program.md`](backend/program.md)
- Dodatak B: zahtjev FPZG-u za AAI@EduHr: [`backend/program.md`](backend/program.md)
