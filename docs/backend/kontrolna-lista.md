# Backend: obvezna kontrolna lista

Dio plana backenda. Verzija, status i popis svih odjeljaka su u indeksu `docs/BACKEND.md`; brojevi odjeljaka su isti kao u indeksu, pa referenca "`BACKEND.md` §N" vodi ovamo.

## 6. Obvezna kontrolna lista za svaku backend komponentu

PR se ne spaja dok nije ispunjeno ili dok nije zapisano zašto nije primjenjivo.

1. Domenski ugovor (tipovi + Zod shema, verzionirana).
2. Validacija na granici (veličine, nepoznata polja odbijena).
3. Redak u pgTAP matrici i test odbijanja.
4. Matrica kvarova.
5. Idempotencija i ponovni pokušaji.
6. Klasa podataka i rok čuvanja, uključujući kopije.
7. Neprijateljski testovi (izmijenjeni bajtovi, ponovljeni ID s drugim sadržajem, tuđa i istekla sesija, uklonjeni nastavnik, SQL pod `ductus_app` koji pokušava glumiti drugog).
8. Plan migracije i povrata.
9. Opservabilnost bez sadržaja; canary test.
10. Konfiguracijska brava (zatvoreno bez potpune konfiguracije).
11. CI zelen, uključujući pgTAP i property testove.
12. Ako dira povjerenje: za **lokalni sintetički FPZG demo do 2. 11. 2026.** (D-76, D-159) dovoljan je provjerljiv prolaz s izmišljenim podacima u izoliranom lokalnom worktreeju i Dockeru, uz čiste relevantne lokalne i CI testove, propisani neovisni review i QA prema `docs/ENGINEERING_SYSTEM.md` §5, zapis punog testiranog SHA-a te dokaz povrata i čišćenja gdje je primjenjivo. To je dokaz lokalnog demoa, ne spremnosti za udaljeni deploy ili pilot. **Za svaku novu komponentu i svaku naknadnu promjenu koja dira povjerenje, prije njezina udaljenog deploya (uključujući javni preview) ili pilota obvezan je sintetički prolaz te komponente ili promjene na živom stagingu koji koristi iste vrste resursa kao produkcija (upravljana baza, KMS, S3), s povratom.** Lokalni prolaz ne mijenja ostale točke ovog popisa, RLS i auth granice, ograničenje razvojnih ključeva i lažnog OIDC-a na lokalno/CI, niti pravila za FAIL/BLOCK. Pouka iz R4: prvi stvarni RPC poziv otkrio je grešku koju je migracija prešla.

Dodatna matrica kvarova:

| Kvar | Ispravno ponašanje |
| --- | --- |
| VM pada | Klijent nastavlja lokalno ("čeka poslužitelj"); rezervni put na drugom računu; FPZG zamjenski postupak ako traje preko praga |
| Worker pada | Ingest prima; potvrde ostaju `pending_signature`; backlog je alarm |
| Baza nedostupna | Ingest 503, klijent ponavlja; potvrda ne postoji bez zapisa u bazi |
| Bucket nedostupan | Nema metapodataka ni potvrde |
| KMS nedostupan | `pending_signature`; ponovni potpis iste potvrde; dnevni korijen čeka |
| TSA nedostupan | Kontrolna točka potpisana i objavljena "bez žiga"; posao ponavlja; vrijeme žiga se ne unazađuje; paket dokaza ostaje "još nije sidren" |
| Ključ potvrda kompromitiran | Postupak iz `ARCHITECTURE.md` §8; listovi su bez potpisa pa ponovni potpis ne ruši dokaze |
| Račun kod dobavljača blokiran | Povrat iz kopija na drugi račun (baza iz PITR/dumpa, bucket iz replike); proba ovo mjeri |
| Greška pri deployu | Migracije samo naprijed (expand/contract); povrat slike |
