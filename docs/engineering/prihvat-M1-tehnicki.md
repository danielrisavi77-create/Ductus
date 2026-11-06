# Prihvat tehničkog M1 (M1.Z)

Datum: 6. 11. 2026. · Korak M1.Z iz `docs/PROGRAM-RAZRADA.md` · DAN-609 · prema D-203 t. 4 · autor `claude:b609a:platforma`

Zapis po uzoru na prihvat M0 (#1313): za svaki tehnički korak M1 navodi dokaz na jednom `main` SHA-u. Nedostajući dokaz ili pad testa je nalaz ovdje, ne popravak u ovom PR-u. Detalji sigurnosnih nalaza ne idu u javni repo, samo ID.

## Kako je rađeno

- **Jedan SHA:** `main` `3160f329cd7b0271ebb84befd3fc9ed48d825881` (#1636), push run `42260995601`.
- **Unit i property testovi:** pokrenuti lokalno na tom SHA-u (`vitest run` nad datotekama iz tablice): 29 datoteka, 878 testova, 0 palih. Brojke po datoteci su iz tog pokretanja.
- **pgTAP, integracijski i E2E testovi:** lokalno nema Dockera, pa dokaz je CI posao na istom SHA-u. U poslu „Standard E2E and database (1/3)” koraci „pgTAP (pg_prove)”, „Run pnpm test:integration” i „E2E tests” su `success`; poslovi (2/3) i (3/3) su `success`. „Lint, typecheck, test and build” je `success` (unit 11076 testova, korak `pnpm test:unit`). Pojedinačni pgTAP i integracijski testovi nisu ponovno pokretani lokalno; CI potvrđuje da je cijeli skup prošao, a ne svaki redak zasebno.
- Dokaz „test postoji” provjeren je čitanjem datoteka PR-a (`pulls/<n>/files`) i datoteka na tom SHA-u.

## Tablica

| Korak | PR | Tiket | Test ili CI posao | Rezultat na `3160f329` |
| --- | --- | --- | --- | --- |
| M1.3b oznaka djelatnika bez prava afilijacije za administratora | #1287 | DAN-478 | pgTAP `db/tests/026-teacher-affiliation-flag.sql`, `030-institution-access-matrix.sql` | CI pgTAP `success`; samo pgTAP, nema unit ni E2E testa |
| M1.4b odjava kod pružatelja, back-channel (baza, `sid`) | #1623 | DAN-474 | pgTAP `109-backchannel-logout.sql` (plan 92), `024-session-idle.sql`, `033-institution-key.sql`; `tests/integration/backchannel-logout-race.integration.test.ts`, `open-session.integration.test.ts`; unit `src/server/auth/claims.test.ts` (97), `tests/unit/auth/aai-flow.test.ts` (19) | pgTAP i integracija `success` u CI-ju; unit 0 palih |
| M1.4b odjava kod pružatelja, back-channel (ruta) | #1625 | DAN-474 | unit `src/server/auth/logout-token.test.ts` (65), `tests/unit/auth/backchannel.test.ts` (17), `routes.test.ts` (4); `infra/fake-oidc/accounts.integration.test.mjs` | unit 0 palih; `accounts.integration` nije pokrenut lokalno (traži lažni OIDC), CI posao „Local launcher and fake OIDC account tests” `success`; E2E back-channel odjave nema |
| M1.5b ugovorni test za svaku pohranu evidencije | #1342 | DAN-491 | unit `tests/unit/evidence/payload-store-contract.test.ts` | 39 prolazi, 0 palih |
| M1.6a istek neaktivne sesije, odjava svuda, čišćenje | #1253 | DAN-296 | pgTAP `020-identity-session.sql` (plan 43), `024-session-idle.sql`; `tests/integration/session-idle-migration.integration.test.ts` | pgTAP i integracija `success` u CI-ju |
| M1.6b nonce CSP, HSTS, Permissions-Policy | #1323 | DAN-489 | unit `src/server/http/content-security-policy.test.ts` (21), `src/components/shell/dev-indicator.test.ts` (2); E2E `e2e/content-security-policy.spec.ts`, `e2e/security-headers.spec.ts` | unit 0 palih; standardni E2E (1/3 do 3/3) `success` |
| M1.7a zatvaranje sesija pri promjeni ustanove | #1255 | DAN-169 | pgTAP `020-identity-session.sql`, `025-session-institution-change.sql`; `tests/integration/session-close-race.integration.test.ts` | pgTAP i integracija `success` u CI-ju |
| M1.7b odbijanje pristupa bazi kad prijava loga parametre | #1259 | DAN-169 | unit `src/server/db/log-settings.test.ts` (27); `tests/integration/log-settings.integration.test.ts` | unit 0 palih; integracija `success` u CI-ju |
| Nalaz F-020 | — | — | samo ID, pojedinosti nisu u javnom repou | zatvaranje u privatnom registru sigurnosne sesije |
| Nalaz F-021 | — | — | samo ID, pojedinosti nisu u javnom repou | zatvaranje u privatnom registru sigurnosne sesije |
| Nalaz F-022 | — | — | samo ID, pojedinosti nisu u javnom repou | zatvaranje u privatnom registru sigurnosne sesije |
| Nalaz F-036 | — | — | samo ID, pojedinosti nisu u javnom repou | zatvaranje u privatnom registru sigurnosne sesije |
| Nalaz F-151 | — | — | samo ID, pojedinosti nisu u javnom repou | zatvaranje u privatnom registru sigurnosne sesije |

Ostali uvjeti završetka tehničkog M1 (`docs/PROGRAM-RAZRADA.md`): `app_user` vezan uz `hrEduPersonUniqueID` i test da drugi izdavatelj s istim identifikatorom ne dobiva isti račun (D-104): `UNIQUE (oidc_issuer, hr_edu_person_unique_id)` u `20261003210100_identity_session.sql` i pgTAP 021 (gore), CI `success`. Test da produkcijski build nema lažnog pružatelja: `tests/unit/auth/build-mode.test.ts` (2), 0 palih.

## Nalazi

1. **CI na `3160f329` nije zelen.** „Login E2E (1/6)” pada: `e2e/login/evidence.spec.ts:523` (#1542, odjava dok commit nema odgovor, DAN-511) očekuje `SYNCED`, a prima `LOCAL_DURABLE` nakon 30 s. Zbog toga padaju „Login E2E inventory” i „Local stack (compose.yaml)”, a run je `failure`. Tri prethodna `main` commita (`003ee857`, `a5538314`, `390ed1da`) nemaju pao posao „Login E2E”. Nije utvrđeno je li uzrok #1636 ili nestabilan test; jedan run to ne razlikuje. Test pokriva odjavu (D-118), ne zaseban korak M1, ali „CI zelen” je preduvjet zapisa. Nije popravljeno ovdje.
2. **M1.5b i tablica plana.** Zadatak navodi #1342 (DAN-491, ugovor pohrane evidencije), a red M1.5 u planu je DAN-307 (`flow.ts`, `oidc.ts`). Taj dio je spojen u #1084 i na SHA-u prolazi: `tests/unit/auth/flow.test.ts` 44, `oidc.test.ts` 83, `flow-branches.test.ts` 46, `flow-logout.test.ts` 15, `oidc-keys-time.test.ts` 24. Nesklad oznaka je otvoren; plan i oznaka koraka nisu mijenjani.
3. **F-151:** zatvaranje u privatnom registru sigurnosne sesije; ovdje su samo ID i status.
4. **Pokrivenost back-channel odjave** (M1.4b) je unit, pgTAP i integracija; nema E2E-a kroz preglednik. Nije nedostajući dokaz prema uvjetu završetka, ali je granica dokaza.
5. **Koraci izvan popisa zadatka:** uvjet završetka traži „M1.3 do M1.8”. Na `main` su spojeni i #1256 (DAN-304, M1.3a), #1252 (DAN-212, M1.4a) i #1242 (DAN-378, M1.8); dokaz za njih nije skupljan u ovom zapisu.

## Što ostaje otvoreno

- **M1.1 i M1.2 (DAN-196, DAN-198, DAN-377):** vanjski ulaz vlasnika (ovlast za AAI@EduHr Lab i registracija usluge, prolaz prijave na Labu s testnim računom). Ne zatvaraju se ovim zapisom. Lažni OIDC i CI nisu dokaz stvarnog AAI toka (D-203 D1).
- **Zatvaranje nalaza F-020, F-021, F-022, F-036 i F-151:** zatvaranje u privatnom registru sigurnosne sesije; ovdje su samo ID-evi i status.
- Tehnički M1 ne smije se označiti prihvaćenim dok nisu ispunjena sva tri uvjeta: (a) nalaz 1 razriješen na zelenom SHA-u; (b) skupljen dokaz za korake M1.3 do M1.8 koji ovdje nisu pokriveni (nalaz 5: #1256, #1252, #1242); (c) potvrđeno zatvaranje nalaza F-020, F-021, F-022, F-036 i F-151 u privatnom registru sigurnosne sesije.
