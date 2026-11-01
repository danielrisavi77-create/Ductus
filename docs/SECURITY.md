# Ductus: sigurnosni plan

Verzija 1.0 · 12. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Plan je potvrdio vlasnik 12. 10. 2026. (#187, `issuecomment-6124258798`). Izvorna analiza s matricom kontrola T1 do T26 i retcima koda je u #187 (pregled `main` @ `5a93c70`); ovaj dokument drži ono što vrijedi trajno. Zadaci iz §6 vode se u Linearu.

## 1. Što štitimo

| Imovina | Zašto je važna |
| --- | --- |
| Evidencija i hash lanac (JCS + SHA-256, D-92, D-96) | Dokaz nastanka rada; ako se može krivotvoriti, proizvod nema vrijednost |
| Potpisana potvrda (Ed25519, D-92; ključevi D-71) | Jedini dokaz da je poslužitelj primio točno te bajtove |
| Identitet i sesija (D-09, D-90, `BACKEND.md` §4.3) | Tko je autor; jedini put do RLS-a |
| Podaci institucije i studenata | Tuđi rad, članstvo, kodovi za upis; GDPR |
| Integritet razvoja | Agent ili ovisnost mogu potkopati sve gore navedeno |

## 2. Napadači

| Napadač | Lokalno (sintetski podaci) | Pilot (stvarni studenti) |
| --- | --- | --- |
| Student koji želi lažirati ili mijenjati trag | nizak | visok |
| Student koji čita tuđi rad | nizak | visok |
| Nastavnik ili admin izvan svoje institucije | nizak | srednji |
| Vanjski napadač na javnoj ruti | nema ga | srednji |
| Kompromitirana ovisnost | srednji | srednji do visok |
| Kompromitiran ili zaveden AI agent | srednji | visok uz vjerodajnice za produkciju |

## 3. Granice povjerenja

1. **Preglednik → rute i RPC.** Svaka mutacija provjerava `Origin` i `Sec-Fetch-Site`, kolačić je `__Host-`, principal se izvodi na poslužitelju, nikad iz tijela zahtjeva.
2. **Aplikacija → baza.** Identitet samo kroz `withActor` i `app.current_actor()`; RLS je uključen i prisilan; `ductus_app` nema prava pisanja u tablice, samo RPC (`CLAUDE.md`, tvrda pravila).
3. **Baza → potpis.** Za pilot potpisuje samo worker (`BACKEND.md` §3 pravilo 3). Web proces potpisuje samo u demou (D-98).
4. **Pohrana objekata.** Put-if-absent; različiti bajtovi na istoj adresi su sukob, nikad prepis.

## 4. Ključevi i tajne

- U repou su samo lokalne vrijednosti s oznakom „local-only”; gitleaks to provjerava u obveznom CI-ju.
- **Demo (odluka vlasnika, #187 t. 4):** razvojni potpisni ključ je trajan i lokalan, u datoteci koju git ignorira, i stvara se pri prvom pokretanju, pa potvrde ostaju provjerljive i nakon restarta. Produkcijska konfiguracija odbija razvojnog potpisnika. Provedba je plan napada #241.
- **KMS (odluka vlasnika, #187 t. 3):** B-9 smije graditi integraciju s AWS KMS prije potvrde D-71.
- **Prije pilota mora postojati:** tablica ključeva s opozivom i provjerom keyId-a; potpis samo u workeru uz IAM politiku samo za `kms:Sign` na jedan ključ; strojna brava protiv razvojnog potpisnika i lažnog OIDC-a u produkciji, s testom u CI-ju; pisani postupak curenja ključa; rotacija lozinki baze i ključeva pohrane.

## 5. Razvoj

- Jedina fizička brana je zaštita grane `main`. **Zaobilaženje za administratora isključuje se prije pilota** (odluka vlasnika, #187 t. 1); postavku mijenja samo vlasnik (Owner queue u `STATE.md`).
- Engineering gate (`docs/ENGINEERING_SYSTEM.md` §5, §6, §10) radi bez tajni i samo s `statuses: write`; pada zatvoreno.
- Hookovi koji nisu sigurnosni propuštaju rad pri grešci; sigurnosni padaju zatvoreno (`docs/SESSIONS.md` §4a).

## 6. Zadaci po riziku

Popis iz #187 §8, ukratko; nositelj i rok su u Linearu.

| Rizik | Prije demoa | Prije pilota |
| --- | --- | --- |
| visok | B-6 prijava s PKCE, state, nonce, `__Host-` kolačićem i provjerom Origin (#154); B-8 tablice evidencije s RLS-om i pgTAP-om (#155); jedna granica od 2 MiB u gatewayu; pravilo „ne vidi tuđi dokument” (#177) | CI test produkcijske konfiguracije; B-9 worker i D-92 v2 (#176); risk floor za `.claude/**` i hookove (DAN-111) |
| srednji | P-6 zabranjeni izrazi (spojeno) i dopuna (#179) | hookovi i deny lista (#171, #167); fiksni kodovi grešaka (#132); strogi validator potvrde; CSP, granica tijela, rate limit; postupak za ključeve; review identitet (#128 do #130); canary za logove |
| nizak | | Semgrep pin, CodeQL, CODEOWNERS (#168), lažni OIDC (#184), stari `merkleRoot`, provjera produkcijskog logina |

## 7. Kad se nađe rupa

1. **Prijava.**
   - Nalaz **visokog rizika** ide u zaseban privatni repo **`ductus-security`** (odluka vlasnika, #187 t. 2), nikad u javni issue. U ovaj repo ide samo ID nalaza i status.
   - Srednji i nizak rizik idu kao issue `BUG: …` s klasom problema, mjestom (datoteka:redak, SHA) i procjenom rizika, bez gotovog exploita.
2. **Trijaža** u 24 sata: rizik i Linear zadatak s nositeljem koji nije autor nalaza.
3. **Zaustavljanje.**
   - Visok rizik zaustavlja spajanje PR-ova na istoj granici dok popravak ne prođe `critical` review i QA, a prije pilota blokira GO (`docs/TESTING.md` §9).
   - Srednji rizik popravlja se prije sljedeće faze.
   - Nizak rizik ide u backlog.
4. **Popravak:** u istom PR-u test koji pada prije popravka; nalazač ne reviewa vlastiti nalaz.
5. **Zapis:** issue se zatvara tek uz PR, SHA i test.

## 8. Otvoreno

- Repo `ductus-security` stvara vlasnik.
- Isključivanje zaobilaženja zaštite grane za administratora: vlasnik, prije pilota.
