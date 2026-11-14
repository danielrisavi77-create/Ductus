# S-0.3: PGlite kao lažna baza (DAN-715, #1836)

Izmjereno 14. 11. 2026. sondom `probe.mjs` (ručno, izvan CI-ja) i lokalnim PostgreSQL-om 16.15 iz `pnpm db:up:native` / `pnpm test:db:native`.
PGlite 0.3.14 (WASM Postgres, prema `SELECT version()` PostgreSQL 17.5, 32-bit, u memoriji; jedan backend prema dokumentaciji PGlitea, sonda to ne mjeri). CI i `compose.yaml` koriste PostgreSQL 17.11 (D-08), pa se usporedba brzine s lokalnim 16.15 odnosi na različite verzije. Nijedan produkcijski kod nije mijenjan.

Pokretanje (bez lockfilea, jer CI-jev OSV popis lockfileova je D-97 putanja; verzija je pinana točno u `package.json`): `cd spikes/pglite && npm install --no-package-lock && node probe.mjs [--tests] [--json izlaz.json]`.

## 1. Migracije

**Svih 111 migracija prolazi** u PGlite-u, svaka kao `ductus_migrator` (ne-superuser, bez BYPASSRLS) kroz `SET LOCAL ROLE` u zasebnoj transakciji, abecednim redoslijedom imena datoteka i samo dio između `-- migrate:up` i `-- migrate:down`, kao dbmate (sonda ne pokreće dbmate, nego oponaša taj dio njegova rada). Nijedna ne pada. Ukupno oko 0,7 s (uz oko 1,1 s za podizanje PGlitea).

Što je trebalo oko migracija, ne u njima:

- `db/local/migrator.sql` i `app-login.sql` rade nepromijenjeni.
- `worker-login.sql` i `auth-login.sql` koriste psql `\if`, `\gset`, `\gexec` i lozinku iz varijable pa se ne mogu pokrenuti u PGlite-u; sonda stvara zamjenske uloge `ductus_worker_local` i `ductus_auth_local` (lažna lozinka, samo za probu) i superusera `ductus`.
- Dodatak `pgtap` i contrib `pageinspect` dolaze s paketom (`@electric-sql/pglite/...`).

## 2. Uloge, SET ROLE, RLS, SECURITY DEFINER (sonda)

Četiri ciljane provjere prolaze (peta stavka sonde je samo informativna i ne može pasti): migrator nije superuser ni BYPASSRLS; `SET ROLE`/`RESET ROLE` mijenjaju `current_user`; RLS filtrira retke, odbija tuđi INSERT i `FORCE` veže vlasnika; SECURITY DEFINER radi s pravima vlasnika (utvrđivanje `search_path`-a funkcije nije mjereno). Ograničenje (NEPROVJERENO sondom): PGlite je prema svojoj dokumentaciji jedan backend bez drugog spoja; sonda to ne dokazuje, samo ispisuje broj redaka `pg_stat_activity`, pa istodobnost nije mjerena.

## 3. pgTAP testovi iz `db/tests` (99 datoteka)

Pokrenuto kroz PGlite uz minimalnu emulaciju psql-a (ugradnja `\ir`, `\gset`, razdvajanje naredbi): **97 od 99 prolazi, 2 padaju** (PASS traži da TAP plan `1..N` bude jednak broju izvršenih testova, bez `not ok` i bez dijagnostike `# Looks like`; provjereno izvođenjem na headu s tom provjerom, ista brojka):

| Datoteka | Razlog | Vrsta |
|---|---|---|
| `010-roles-and-privileges.sql` | očekuje bazu `ductus`; u sondi je baza `template1` (PGlite se na njoj otvara; stvaranje i spajanje na bazu `ductus` nije pokušano) | ograničenje PGlitea kako je sonda koristi |
| `118-actor-scope-initplan.sql` | `\gset <prefiks>` (118:408, `EXECUTE scope_cm \gset s1_`) nije emuliran: sonda odbacuje sve nakon `\gset`, pa varijabla nikad nije postavljena (sintaksna greška na `:`). Rupa u sondi; da PGlite ovdje nije ograničenje je PRETPOSTAVKA (061 i 063 koriste `\gset` + `:'var'` i prolaze), nije provjereno sondom s ispravljenom emulacijom | rupa u emulaciji psql-a |

(Opažanje iz razvojne verzije sonde, nije ponovljivo predanom sondom: 102, 103 i 127 padaju ako se skripta pošalje kao jedna poruka, jer je `statement_timestamp()` tada konstantan (izvor: dokumentacija PostgreSQL-a, „Current Date/Time”: vrijeme primitka zadnje poruke od klijenta); psql šalje svaku naredbu zasebno. Rješenje u sondi je razdvajanje naredbi, što je nužna zamjena ponašanja psql-a.)

## 4. Brzina

| | PostgreSQL 16 (nativno) | PGlite |
|---|---|---|
| podizanje + provisioning + 111 migracija | 4,8 s | oko 2 s |
| pgTAP (`db/tests`) | 57 s (99 datoteka, 8099 testova, `pg_prove`) | oko 162 s (jedan proces, serijski; uključuje 39 s za `118`, koja pada; bez nje oko 123 s) |

Zaključak: PGlite je **brži samo za početak** (oko 2 s naspram 5 s, bez servisa i Dockera), ali **cijeli pgTAP paket je u PGlite-u oko 2 do 3 puta sporiji (oko 2,2 puta bez datoteke `118` koja pada; PostgreSQL stupac je 99 uspješnih datoteka, pa omjer nije strogo usporediv)** od stvarnog PostgreSQL-a (obje usporedne vrijednosti su serijske, `pg_prove` je pokrenut bez `-j`, pa paralelizam ne objašnjava razliku). Uzrok nije izoliran: WASM i jedan backend su PRETPOSTAVKA, ne mjerenje (usporedba mijenja i izvršno okruženje i našu psql emulaciju, pa dio razlike može potjecati iz emulacije). Zaključak vrijedi samo za izmjereni pgTAP paket; za druge skupove upita nije mjereno.

## 5. Što smije na PGlite, a što mora na pravi PostgreSQL

**Smije na PGlite (brza lokalna provjera, nikad jedini dokaz):**
- unit testovi i brzi integracijski testovi koji trebaju migriranu shemu, a ne tvrde ništa o ovlastima ni istodobnosti;
- primjena svih migracija kao dbmate-ekvivalent (smoke: sintaksa, redoslijed, nema pada).

**Mora na pravi PostgreSQL (CI ostaje mjerodavan):**
- ovlasti, RLS i SECURITY DEFINER: u jednoj sesiji tehnički rade (§2), ali bez prijave uloga, bez imena baze `ductus` i bez drugog spoja (drugi spoj nije pokušan; jedan backend prema dokumentaciji PGlitea) ne dokazuju ponašanje produkcije;
- pgTAP (`db/tests`): izmjereni paket je u PGlite-u 2 do 3 puta sporiji (§4; uzrok nije izoliran) i 2 datoteke ne prolaze (§3);
- istodobnost: zaključavanja, advisory lockovi, utrke, `pg_stat_activity`, više spojeva;
- pg_boss i sve što radi preko više spojeva;
- prijava uloga i lozinke (`ductus_*_local`, `\gset` iz okoline), socket naspram TCP-a;
- vremenska semantika unutar jedne transakcije/poruke;
- svaka tvrdnja o paritetu s produkcijom (verzija, ekstenzije, planer, performanse) i završni gate.

## 6. Preporuka

Preporuka plana §3 (prema DAN-715): PGlite za unit i brze integracijske testove; ovlasti, RLS, SECURITY DEFINER, pgTAP, utrke i pg-boss na pravom PostgreSQL-u.

**Preporuka se potvrđuje bez izmjene podjele.** Razlozi iz mjerenja:

1. Migracije prolaze sve (111/111, §1), pa PGlite može dati migriranu shemu za unit i brze integracijske testove, bez Dockera i servisa, za oko 2 s naspram oko 5 s (§4).
2. pgTAP nema razloga seliti: izmjereni pgTAP paket je u PGlite-u 2 do 3 puta sporiji (§4; uzrok nije izoliran), a 2 od 99 datoteka ne prolaze (§3).
3. Ovlasti, RLS i SECURITY DEFINER provjereni su samo u jednoj sesiji, u bazi `template1`, bez prijave uloga (§1, §2); takav prolaz nije dokaz za produkciju.
4. Utrke i pg-boss nisu pokušani u ovoj sondi (NEPROVJERENO). Pretpostavka da ih PGlite ne podržava temelji se na njegovoj dokumentaciji (jedan backend, jedan spoj), ne na našem mjerenju; do provjere ostaju na pravom PostgreSQL-u.

Jedno pojašnjenje uz §3, ne izmjena podjele: „brzi” znači brz start i rad bez Dockera, ne brže izvođenje upita. Za integracijske testove nije mjereno; iz pgTAP rezultata se ne može zaključiti da bi bili brži ili sporiji, pa se ubrzanje ne smije pretpostavljati. Pravi PostgreSQL (CI: 17.11, D-08) ostaje jedini izvor istine za CI i završni gate; PGlite ga ne zamjenjuje ni u jednom CI koraku.

## Ograničenja probe

Jedan backend (prema dokumentaciji PGlitea), baza `template1`, psql emulacija je minimalna i napisana samo za ovaj repo, mjerenje je jedno izvođenje na jednom stroju. Sintetski podaci, bez stvarnih osoba.
