# Backend: spike, trošak, program i obveze vlasnika

Dio plana backenda. Verzija, status i popis svih odjeljaka su u indeksu `docs/BACKEND.md`; brojevi odjeljaka su isti kao u indeksu, pa referenca "`BACKEND.md` §N" vodi ovamo.

## 5. Što još nije potvrđeno (spike prije odluke)

| Stavka | Provjera | Gdje |
| --- | --- | --- |
| Uvjetni upis kod dobavljača pohrane (dodana provjera, odluka 11. 10. 2026., D-08) | Provjera kod dobavljača pohrane | B0.1 |
| Ključevi po spremniku kod dobavljača pohrane (dodana provjera, odluka 11. 10. 2026., D-08) | Provjera kod dobavljača pohrane | B0.1 |
| PostgreSQL 17 i ovlasti nad ulogama kod upravljane baze (dodana provjera, odluka 11. 10. 2026., D-08) | Provjera kod upravljane baze | B0.1 |
| Povrat u točku na UpCloud Developer: postupak (Hub, API ili podrška), stvarni RPO, trajanje, stvara li novu instancu | Dodatak A, oko 30 minuta i nekoliko centi | B0.1 |
| Cijene UpCloud VM-a: sažeci cjenika se razlikuju (Cloud Native 4 GB / 1 vCPU 12 EUR i 8 GB / 2 vCPU 24 EUR prema jednom, 2 vCPU / 4 GB 15 EUR prema drugom) i je li disk uključen | Pogledati cjenik u konzoli pri otvaranju računa | B0.1 |
| Uloge na upravljanoj bazi: `CREATE ROLE NOLOGIN`, `ALTER FUNCTION OWNER`, `GRANT role TO role`, `max_connections`, promjena log parametara, ekstenzije | Pokrenuti skriptu uloga i pgTAP | B0.1 |
| Zapisivanje parametara naredbi za aplikacijsku prijavu (F-036, DAN-169): smiju li se postaviti `log_parameter_max_length = 0` i `log_parameter_max_length_on_error = 0`, vodi li pružatelj zapis upita izvan PostgreSQL postavki, i prolazi li provjera web procesa (`src/server/db/log-settings.ts`) na upravljanoj bazi | Postavke u konzoli pružatelja i prvi `withActor` poziv na stagingu | B0.1 |
| Latencija VM do baze i trajanje `reserve` | Mjerenje | B0.1 |
| Jesu li UpCloud Cloud Native tipovi dostupni i po kojoj cijeni za računalo koje ne guši pri rekonstrukciji | Cjenik i narudžba | B0.1 |
| Rekonstrukcija 15.000 i 80.000 riječi (vrijeme, memorija, volumen kontrolnih točaka) | Lokalna osnovica gotova 3. 10. 2026. (`docs/spikes/B0.2.md`): CPU i memorija nisu problem, volumen točaka svakih 200 koraka jest. Ostaje ponoviti na stroju koji se stvarno kupuje | B0.2 |
| AWS KMS Ed25519 u eu-central-1: latencija potpisa | Mjerenje | B0.1 |
| Uvjeti za partnera AAI@EduHr (može li obrt ili fizička osoba), rokovi, trajnost identifikatora | Pitati Srce, ali tek ako FPZG put ne uspije (§4.3) | Owner queue |
| FINA: minimalna mjesečna naknada, uvjeti, tko je ugovorna strana | Upit | Owner queue |
| Sentry EU na besplatnom planu | Pročitati | B9 |

B0.1 je pomaknut naprijed (odluka vlasnika 11. 10. 2026., D-08), rok 16. 11. 2026.; preduvjet su računi dobavljača (Owner queue u `STATE.md`). **Odluka vlasnika 11. 10. 2026. (tumačenje točke 3, potvrđeno; issue #87, komentar 6105263690):** migracije na kritičnom putu demoa (#240 i sljedeći korak B-8) se ne zaustavljaju; B0.1 kreće čim postoje računi dobavljača; rizik prepisa migracija do tada ostaje zapisan.

Riješeno 3. 10. 2026.: cijena KMS-a (službeni cjenik), uvjeti besplatnih TSA-ova (ne postoje objavljeni, zato dva neovisna žiga), tko registrira AAI klijenta (§4.3), PITR mehanizam na UpCloud-u (dokumentacija). Ostaje samo ono što traži račun: stvarni povrat i cijene u konzoli.

## 7. Trošak (procjena 3. 10. 2026., EUR godišnje)

| Stavka | Bez PDV-a | Napomena |
| --- | --- | --- |
| UpCloud Cloud Native VM (2 vCPU / 4 GB, 15 EUR mjesečno) | oko 180 | Veći tip (4 vCPU / 8 GB, 32 EUR mjesečno, oko 384) ako B0.2 traži; disk možda dodatno |
| UpCloud Managed PG Developer 2 GB (14 EUR mjesečno) | oko 168 | PITR 3 dana; bez HA i SLA; disk NEPROVJEREN |
| Scaleway Object Storage | 5 do 10 | |
| Scaleway TEM | oko 14 | |
| Replika bucketa (drugi račun) | 10 do 40 | |
| AWS KMS (2 ključa, 100.000 potpisa mjesečno) | oko 40 | 1 USD po ključu mjesečno + 0,15 USD na 10.000 potpisa, službeni cjenik |
| Domena `.hr` | 15 do 30 | sekundarni izvor |
| TSA žigovi | 0 | Dva besplatna TSA-a; FINA kasnije oko 40 EUR godišnje + certifikat 86,27 EUR na 5 godina |
| Praćenje grešaka i vanjski monitor | 0 do 20 | |
| Staging (privremeni resursi tjednima prije aktivacije, naplata po satu NEPROVJERENA) | 30 do 100 | Staging mora koristiti upravljanu bazu, KMS i S3 (§6 točka 12) |
| **Ukupno** | **oko 460 do 600** | |
| **S PDV-om (oko +25 %)** | **oko 575 do 750** | PDV se naplaćuje fizičkoj osobi bez obrta u sustavu PDV-a; potvrditi sa računovođom |

To je bilo **iznad D-66** (infrastruktura 300 do 500 plus domena i e-pošta 50 do 100). Od 1. 11. 2026. proračun pilota je 10.000 EUR (D-199 t. 2), a PRIJEDLOG raspodjele daje infrastrukturi oko 1.000 EUR, pa obje varijante stanu bez rezanja sigurnosne stavke. Izbor varijante i dalje je odluka vlasnika nakon B0.1:

- **Varijanta A (preporuka ako B0.1 prođe):** gore opisano. Ranije je dodatni trošak trebala pokriti rezerva iz D-69 uz smanjenje stavke "sigurnost"; uz D-199 to više nije potrebno.
- **Varijanta B:** Hetzner VM (ako se CX tip stvarno može naručiti; CPX32 dodaje oko 280 EUR godišnje) + PostgreSQL s WAL-G na vlastitom VM-u, bez upravljane baze. Jeftinija, ali PITR, nadogradnje i proba povrata postaju tvoj posao; baza ima javnu adresu ili tunel.
- Rezanje po potrebi: FINA tek s ugovorom, staging samo u zadnjim tjednima, replika bucketa na jeftiniji spremnik, jedan KMS ključ za prvi mjesec.
- Pri 5 puta većem broju korisnika procjena je 160 do 300 EUR mjesečno, iznad stavke infrastrukture iz D-199 t. 2; to je tada pitanje financiranja.

## 8. Program backenda

Backend nije posebna faza nego okomiti rez kroz M0 do M11. **Procjena dodatka prema `PROGRAM.md`: realno 18 do 25 večeri** (v0.1 je rekao +6 do +10 bez osnove; uklonjeni Supabase poslovi nikad nisu bili zasebno procijenjeni, pa se "neto" ne može izračunati). Preporučujem da se dodatak vodi kao zaseban red u valu 1.

| Korak | Sadržaj | Izlazni kriterij | Faza | Večeri |
| --- | --- | --- | --- | --- |
| B0.1 Spike okruženja | UpCloud VM + Managed PG, skripta uloga, PITR povrat u točku, RTT, log parametri, KMS ključ | Zapis s brojkama; PITR radi ili se odabire varijanta B | prije M2 (migracije demoa ne čekaju B0.1, §5); pomaknut naprijed 11. 10. 2026., rok 16. 11. 2026., uz tri dodatne provjere (§5) | 2 do 3 |
| B0.2 Spike rekonstrukcije | ProseMirror u Nodeu za 15.000 i 80.000 riječi na stvarnom stroju | Vrijeme, memorija, volumen; granice posla određene | prije M3 | 1 do 2 |
| B0.3 Odluka | Vlasnik potvrđuje dio D-08 o dobavljačima i trošku, D-72, D-73 (samo izbor biblioteke; vlastiti OIDC klijent odlučen 11. 10. 2026., a sesije u bazi i identitet u RLS-u potvrđeni u D-90) i D-75 prema rezultatima (D-71 i D-74 potvrđene 10. 10. 2026.; dio D-08 o aplikaciji odlučen 11. 10. 2026.) | ODLUČENO u `DECISIONS.md` | | 0 |
| B0.4 Prepis ARCHITECTURE | Cijeli dokument (uključujući §2, §3, §8, §11), §12 s točnim popisom prijenosa | Bez Supabasea i Netlifyja | M0 | 1 do 2 |
| B1 Okruženja | `docker compose` (Postgres, S3-kompatibilna pohrana (RustFS), Mailpit, lažni OIDC), OpenTofu (dva računa), CI deploy, migracijski alat, `sops`/`age`, uloge, Caddy, deploy s VM-a | `docker compose up` i `npm test` zeleno; staging se podiže iz koda | M0 | 5 do 7 |
| B2 Identitet | OIDC klijent s popisom iz §4.3, sesije, `current_actor()`, `withActor`, test GUC-a, odjava | Prijava na AAI Labu; svi testovi iz §4.3 zeleni; nema lažnog pružatelja u produkciji | M1 | 3 do 5 (uz sigurnosni pregled, neovisan o autoru) |
| B3 Ovlasti | Novi referentni model, `can()`, RLS, pgTAP matrica, diferencijalni test | Matrica zelena | M2 | uključeno u M2, +1 |
| B4 Evidencija | Točan popis prijenosa (§2), novi RPC-i, okidači, uloge, jedan RPC za commit i `reserve`, worker potpis preko KMS-a, kontrolne točke, praznine | Ugovorni testovi nad in-memory i pg/S3; B4 test dokazuje 0-based indekse bez praznina pod konkurentnim prihvatima, rollbackom i idempotentnim retryjem; property testovi; sintetički prolaz na stagingu s povratom | M3 | +5 do 8 |
| B5 Dnevni korijen i žig | Kumulativni log i dnevna kontrolna točka (D-93), consistency dokaz, KMS potpis uz usporedbu s potpunom vanjskom append-only poviješću, TSA, objava, neovisni primatelji i CLI verifikator | Neovisna provjera prolazi; C2SP known-answer vektor kontrolne točke iz §4.1 prolazi standardnim verifierom, uključujući negativne slučajeve; promjena odsječka ruši provjeru; dan bez TSA-a se oporavlja; test povrata baze dokazuje da se regresivni ili razgranati checkpoint ne potpisuje, žigoše ni objavljuje; konkurentni `reserve` tijekom cutovera s praznim inventarom ne može upasti između snapshot-a i prve vanjski pohranjene kontrolne točke, a nakon otvaranja gatea dobiva indeks 0; kvar cutovera ostavlja gate zatvorenim | M3 do M7 | 4 do 5 |
| B6 Poslovi i obavijesti | pg-boss, retention (uklj. verzije), e-pošta, `notification` s prozorom P-03 | Ponovljen posao ne duplicira učinak; nastavnik ne dobiva obavijest češće od P-03 | M6, M7, M10 | +1 do 2 |
| B7 AI proxy | U pilotu (D-194, mijenja D-77); pružatelj i model računa su otvoreni, pa je sadržaj paketa PRIJEDLOG | Samo odobreni pružatelji; kineski pružatelji i modeli nedostupni; regija obrade zabilježena uz odgovor | M9 | procjena nije dana |
| B8 Predaja | `requested_at`, rekonstrukcija u workeru, usporedba JCS | Točna na svim scenarijima uključujući prazninu i pred-rokovni val | M7 | uključeno u M7 |
| B9 Operacije i GO | Backup i replika bucketa, mjesečna proba povrata (baza i bucket), alarmi, statusna stranica, `OPERATIONS.md`, load test, OWASP, popis podizvršitelja s DPA-ima | Svi crveni GO uvjeti zeleni; zapisana proba povrata | M11 | +3 do 4 |

Redoslijed i kontrolna točka 15. 12. 2026.:

1. B0.1 i B0.2 dolaze prije vezivanja za dobavljača; do tada M0 piše samo kod iza sučelja (baza, objekti, e-pošta, potpis, vrijeme).
2. B0.1 je **blokiran računima** kod UpCloud-a i AWS-a (Owner queue).
3. B5 se ne reže u prvom rezu. Ako treba rezati: prvo web verifikator (ostaje CLI), zatim objava u javni repozitorij (korijen, potpis i žig ostaju). **FINA ugovor nije GO preduvjet**; produkcija može krenuti s besplatnim TSA-om uz upisanu posljedicu.
4. Vanjske ovisnosti na kritičnom putu: Srce (2 do 6 tjedana je moja procjena, ne izvor; privatni subjekt možda mora preko FPZG administratora ili postati partner federacije), FINA, PR #49 i #50 (blokiraju M0), računi dobavljača.
5. Kapacitet iz `PROGRAM.md` (10 jedinica tjedno) računa samo Ductus; M4 traži rad u Lekti, a vlasnik vodi i druge projekte. Zato kontrolna točka ostaje stvarna, ne formalna.

## 9. Što treba od vlasnika

- Potvrditi ili promijeniti dio D-08 o dobavljačima i trošku, D-72, D-73 (samo izbor biblioteke; vlastiti OIDC klijent odlučen 11. 10. 2026., a sesije u bazi i identitet u RLS-u potvrđeni u D-90) i D-75 (D-71 i D-74 potvrđene 10. 10. 2026.; dio D-08 o aplikaciji odlučen 11. 10. 2026.; vidi i odluku o troškovima u §7).
- Računi: UpCloud, Scaleway (Object Storage, TEM), AWS (samo KMS, IAM korisnik s uskim ovlastima), 2FA svugdje, agent dobiva ograničene ključeve po okolišu.
- **FPZG, ne Srce, je prvi korak za AAI:** zamoliti odgovornu osobu FPZG-a za AAI@EduHr da (1) e-poštom na `aai@srce.hr` ovlasti Daniela za AAI@EduHr Lab i (2) registrira Ductus kao uslugu FPZG-a u Registru resursa (OIDC klijent, redirect URI, scopeovi). Tekst zahtjeva je u Dodatku B.
- FINA: tek kad postoji obrt (ili ako FPZG želi biti ugovorna strana); do tada dva besplatna TSA-a.
- Računovođa: PDV za fizičku osobu bez obrta.
- Lokalni stroj s Dockerom za M0.

## Dodatak A: proba povrata u točku na UpCloud-u (B0.1)

Cilj: dokazati da povrat u točku stvarno radi, izmjeriti RPO i trajanje. Traje oko 30 minuta, trošak je nekoliko centi (naplata po satu, instanca se briše nakon probe).

1. U UpCloud Hubu stvoriti Managed PostgreSQL, plan Developer, zona `de-fra1` (ili `fi-hel1`), u privatnoj mreži s jednim malim VM-om.
2. S VM-a pokrenuti pisanje markera svakih 10 sekundi, 20 minuta:
   ```sql
   create table pitr_probe (id bigserial primary key, written_at timestamptz not null default clock_timestamp());
   ```
   ```bash
   for i in $(seq 1 120); do psql "$DATABASE_URL" -qc "insert into pitr_probe default values"; sleep 10; done
   ```
3. Zapisati točno vrijeme T (UTC) oko 12. minute; zatim obrisati sve: `delete from pitr_probe;` (simulirana greška).
4. U Hubu (ili kroz podršku ako Hub to ne nudi) zatražiti povrat u točku T. Zapisati: gdje je opcija, stvara li novu instancu ili prepisuje postojeću, koliko traje.
5. Na vraćenoj bazi: `select max(written_at) from pitr_probe;` RPO = T minus `max(written_at)`. Očekivano do 5 minuta prema dokumentaciji.
6. Isto na istoj instanci: provjera uloga (`create role ductus_evidence nologin; grant ...; alter function ... owner to ...`), `show max_connections;`, smije li se mijenjati `log_statement` i `log_min_error_statement`.
7. Rezultat u `docs/spikes/B0.1.md`: koraci, vremena, RPO, slike zaslona, odluka. Obrisati instance.

Ako povrat u točku nije dostupan na Developer planu ili traje predugo: Neon Launch (PITR 7 dana) ili varijanta B, odluka vlasnika.

## Dodatak B: zahtjev FPZG-u za AAI@EduHr

> Poštovani, za pilot alata Ductus na FPZG-u (pisanje studentskih radova uz evidenciju procesa) prijava studenata i nastavnika ide isključivo preko AAI@EduHr. Prema pravilima AAI@EduHr uslugu može registrirati matična ustanova, a pristup AAI@EduHr Labu odobrava ovlašteni predstavnik ustanove. Molim (1) da ovlastite Daniela Rišavija za korištenje AAI@EduHr Laba e-porukom na aai@srce.hr i (2) da, kad Lab test prođe, registrirate Ductus kao uslugu FPZG-a u Registru resursa (OpenID Connect; tražimo samo atribute hrEduPersonUniqueID, hrEduPersonHomeOrg, hrEduPersonAffiliation i ime; OIB ne). Tehničke podatke (redirect URI, logout URI) dostavit ću. Hvala.
