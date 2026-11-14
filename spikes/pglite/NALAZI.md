# S-0.3: PGlite kao lažna baza (DAN-715, #1836)

Izmjereno 14. 11. 2026. sondom `probe.mjs` (ručno, izvan CI-ja) i PostgreSQL-om 16 iz `pnpm db:up:native` / `pnpm test:db:native`.
PGlite 0.3.14 (WASM Postgres, jedan backend, u memoriji). Nijedan produkcijski kod nije mijenjan.

Pokretanje: `cd spikes/pglite && npm install && node probe.mjs [--tests] [--json izlaz.json]`.

## 1. Migracije

**Svih 111 migracija prolazi** u PGlite-u, svaka kao `ductus_migrator` (ne-superuser, bez BYPASSRLS) kroz `SET LOCAL ROLE` u zasebnoj transakciji, isti redoslijed i isti `migrate:up` kod kao dbmate. Nijedna ne pada. Ukupno oko 0,7 s (uz oko 1,1 s za podizanje PGlitea).

Što je trebalo oko migracija, ne u njima:

- `db/local/migrator.sql` i `app-login.sql` rade nepromijenjeni.
- `worker-login.sql` i `auth-login.sql` koriste psql `\if`, `\gset`, `\gexec` i lozinku iz varijable pa se ne mogu pokrenuti u PGlite-u; sonda stvara zamjenske uloge `ductus_worker_local` i `ductus_auth_local` (lažna lozinka, samo za probu) i superusera `ductus`.
- Dodatak `pgtap` i contrib `pageinspect` dolaze s paketom (`@electric-sql/pglite/...`).

## 2. Uloge, SET ROLE, RLS, SECURITY DEFINER (sonda)

Svih pet ciljanih provjera prolazi: migrator nije superuser ni BYPASSRLS; `SET ROLE`/`RESET ROLE` mijenjaju `current_user`; RLS filtrira retke, odbija tuđi INSERT i `FORCE` veže vlasnika; SECURITY DEFINER radi s pravima vlasnika i fiksnim `search_path`. Ograničenje: nema drugog spoja, pa `pg_stat_activity` je prazan i nema istodobnosti.

## 3. pgTAP testovi iz `db/tests` (99 datoteka)

Pokrenuto kroz PGlite uz minimalnu emulaciju psql-a (ugradnja `\ir`, `\gset`, razdvajanje naredbi): **97 od 99 prolazi, 2 padaju**:

| Datoteka | Razlog | Vrsta |
|---|---|---|
| `010-roles-and-privileges.sql` | očekuje bazu `ductus`; PGlite je uvijek `template1` | ograničenje PGlitea |
| `118-actor-scope-initplan.sql` | psql interpolacija `:'var'` iz `\gset` unutar skripte nije potpuno emulirana (sintaksna greška na `:`) | ograničenje emulacije psql-a |

(Prethodni međukorak: 102, 103 i 127 padaju ako se skripta pošalje kao jedna poruka, jer je `statement_timestamp()` tada konstantan; psql šalje svaku naredbu zasebno. Rješenje u sondi je razdvajanje naredbi, što je nužna zamjena ponašanja psql-a.)

## 4. Brzina

| | PostgreSQL 16 (nativno) | PGlite |
|---|---|---|
| podizanje + provisioning + 111 migracija | 4,8 s | oko 2 s |
| pgTAP (`db/tests`) | 57 s (99 datoteka, 8099 testova, `pg_prove`) | oko 162 s (jedan proces, serijski, uključuje 39 s za `118`) |

Zaključak: PGlite je **brži samo za početak** (oko 2 s naspram 5 s, bez servisa i Dockera), ali **cijeli pgTAP paket je u PGlite-u oko 3 puta sporiji** od stvarnog PostgreSQL-a, jer je WASM, jedan backend i bez paralelizma. Ubrzanje se ne postiže; dobiva se samo prenosivost (nema servisa, radi svugdje gdje radi Node).

## 5. Što smije na PGlite, a što mora na pravi PostgreSQL

**Smije (brza lokalna provjera, nikad jedini dokaz):**
- primjena svih migracija kao dдимbate-ekvivalent (smoke: sintaksa, redoslijed, nema pada);
- katalog i shema: tablice, RLS uključen, grantovi, ugovori o funkcijama;
- jednosesijska logika RLS-a, `SET ROLE` i SECURITY DEFINER RPC-ova;
- pgTAP tvrdnje koje ne ovise o vremenu, istodobnosti, imenu baze ni psql meta-naredbama.

**Mora na pravi PostgreSQL (CI ostaje mjerodavan):**
- istodobnost: zaključavanja, advisory lockovi, utrke, `pg_stat_activity`, više spojeva;
- prijava uloga i lozinke (`ductus_*_local`, `\gset` iz okoline), socket naspram TCP-a;
- testovi koji ovise o psql-u (meta-naredbe, `:'var'`) ili o imenu baze `ductus`;
- vremenska semantika unutar jedne transakcije/poruke;
- pg_boss i sve što radi preko više spojeva;
- svaka tvrdnja o paritetu s produkcijom (verzija, ekstenzije, planer, performanse) i završni gate.

## 6. Preporuka

Plan §3 nije bio priložen ovom zadatku, pa preporuka stoji na izmjerenom: **PGlite ne zamjenjuje stvarni PostgreSQL u CI-ju ni za pgTAP.** Potvrđuje se (ili, ako §3 predviđa zamjenu, mijenja se na) ovo: PGlite se smije koristiti najviše kao opcionalna brza lokalna provjera (migracije + jednosesijska RLS/RPC logika, npr. za agente bez Dockera), dok pravi PostgreSQL 16 ostaje jedini izvor istine za CI i sve testove s istodobnošću, prijavom i vremenom. Gašenje stvarne baze u korist PGlitea ne isplati se: nema dobitka u brzini (3 puta sporije) i gubi se pokrivenost.

## Ograničenja probe

Jedan backend, baza `template1`, psql emulacija je minimalna i napisana samo za ovaj repo, mjerenje je jedno izvođenje na jednom stroju. Sintetski podaci, bez stvarnih osoba.
