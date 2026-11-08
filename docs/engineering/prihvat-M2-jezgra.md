# Prihvat jezgre M2 (M2.Z1)

Datum: 8. 11. 2026. · Korak M2.Z1 iz `docs/PROGRAM-RAZRADA.md` (odjeljak M2) · DAN-582 · rok jezgre 30. 11. 2026. (D-205 t. 1) · autor `claude:p582a:platforma`

Zapis po uzoru na `docs/engineering/prihvat-M1-tehnicki.md` (#1638): za svaku stavku uvjeta završetka jezgre M2 navodi dokaz na jednom `main` SHA-u. Nedostajući dokaz je nalaz ovdje, ne popravak u ovom PR-u. Nema promjene koda proizvoda.

## Kako je rađeno

- **Jedan SHA:** `main` `3998880563e77379001dd729ca11d16d8106882f` (#1717). Push run CI-ja: [`42454434903`](https://github.com/danielrisavi77-create/Ductus/actions/runs/42454434903), zaključak `success`; svi poslovi nabrojeni ispod su `success`.
- **CI posao je dokaz za pgTAP, integracijske i E2E testove.** Lokalno nema Dockera. Dokaz je ispis posla iz CI-ja na istom SHA-u (REST `actions/jobs/<id>/logs`); lokalno su pokrenuti samo unit testovi (vitest).
- **Unit na SHA-u:** posao „Lint, typecheck, test and build” ([`128650378147`](https://github.com/danielrisavi77-create/Ductus/actions/runs/42454434903/job/128650378147)): 360 datoteka, 12191 test, 0 palih.
- Dokaz „test postoji” provjeren je čitanjem datoteka na tom SHA-u.

## Tablica

| Stavka uvjeta | Tiket (PR) | Test ili CI posao | Rezultat na `39988805` |
| --- | --- | --- | --- |
| pgTAP matrica pristupa za sedam aktera | DAN-505 (#1436) | `db/tests/103-m2-actor-matrix.sql`; korak „pgTAP (pg_prove)” u poslovima „Standard E2E and database” [1/3 `128650378185`](https://github.com/danielrisavi77-create/Ductus/actions/runs/42454434903/job/128650378185), [2/3 `128650378161`](https://github.com/danielrisavi77-create/Ductus/actions/runs/42454434903/job/128650378161), [3/3 `128650378237`](https://github.com/danielrisavi77-create/Ductus/actions/runs/42454434903/job/128650378237) | `103-m2-actor-matrix.sql … ok` u sva tri posla; svaki posao: `Files=84, Tests=6703`, `Result: PASS` |
| E2E administrator → nastavnik → kolegij → upis → potvrda | DAN-526 (#1661) | `e2e/login/m2-flow.spec.ts:94`, test „M2: the administrator confirms the teacher, who publishes an assignment the student enrolls in and confirms”; posao „Login E2E (2/6)” [`128650378270`](https://github.com/danielrisavi77-create/Ductus/actions/runs/42454434903/job/128650378270) | `✓ 13 [login-chromium] … m2-flow.spec.ts:94:1 … (12.6s)`; shard: `34 passed`; „Login E2E inventory” `success` |
| Inventar RPC→HTTP | DAN-487 (#1305) | `tests/unit/rpc-http-inventory.test.ts` (19 testova) i `tests/unit/rpc-http-exceptions.json` (27 zapisa); korak `pnpm test:unit` | CI unit 0 palih; lokalno 19 od 19 prolazi. Uvjet je ispunjen prema testu, uz nalaz 2 |
| A-02 korisnici i uloge u sučelju | DAN-581 (#1593, #1595, #1599, #1603, #1609), DAN-525 (#1526) | ruta `app/ustanova/korisnici/page.tsx`; unit `src/components/admin/*` i `src/server/institution/teacher-roles.test.ts`; E2E `e2e/login/teacher-roles-page.spec.ts` (3 testa) i `m2-flow.spec.ts`; pgTAP `106-institution-admin-appointment.sql` | E2E sva tri `✓`; pgTAP 106 `ok` u sva tri posla; unit lokalno: `src/components/admin` + `src/server/institution` 33 datoteke, 708 testova, 0 palih |
| A-01 pregled ustanove u sučelju | nije utvrđen tiket (vidi nalaz 1) | ruta `app/ustanova/page.tsx`; unit `InstitutionOverview.test.ts` (4), `institution-access.test.ts` (23), `institution-overview.test.ts` (21); pgTAP `097-institution-overview.sql` (plan 44) | unit 0 palih; pgTAP 097 `ok` u sva tri posla; **E2E kroz preglednik: nije dokazano** (nalaz 1) |

Pregled sedam aktera u `103-m2-actor-matrix.sql` (zaglavlje i redak 79 do 80): student, nastavnik, mentor, komentor, član povjerenstva, administrator i osoba druge ustanove, uz kontrole bez sesije i sa zatvorenom sesijom. Matrica je `no_plan()`, pa broj ćelija nije zapisan u planu; zeleno znači da datoteka prolazi cijela.

## Nalazi

1. **A-01 nema E2E kroz preglednik.** Nijedna E2E datoteka ne otvara `/ustanova`. A-02 (`/ustanova/korisnici`), A-03 (`/ustanova/kolegiji`) i A-04 (`/ustanova/pravila`) imaju svoje spec datoteke s istim obrascem (odjavljen, student 404, administrator). A-01 ima unit i pgTAP dokaz, pa je „administracija ustanove radi u sučelju” za A-01 dokazana na razini komponente i baze, a ne u pregledniku. Nije popravljeno ovdje.
2. **Inventar RPC→HTTP: 17 od 27 zapisa je „ruta dolazi”, ne trajan razlog.** Test prolazi jer svaki zapis ima razlog i tiket, što doslovno ispunjava „ima HTTP rutu ili zapisan razlog”. Preostalih 10 zapisa je „bez rute” s trajnim razlogom (interni koraci i radnici). Zapisi „ruta dolazi” po tiketu: DAN-351 (9: seminarske grupe, nositelj i urednik kolegija, zamjene), DAN-515 (3: zahtjev za mentorstvo, odobrenje, povlačenje), DAN-379 (2: pravo na rad za komentora i povjerenstvo, čeka odluku U-1), DAN-296 (2: odjava svuda i bilježenje aktivnosti sesije), DAN-315 (1: objava verzije pravila fakulteta). Provjerom `app` i `src` (bez testova) nijedan od tih 17 RPC-ova nije pozvan iz koda aplikacije, pa je zapis istinit. Je li „ruta dolazi” prihvatljiv razlog za jezgru ili samo za ostatak M2 do 20. 12. 2026., odluka je vlasnika; ovdje se ne tumači.
3. **Granice inventara.** Test čita katalog iz `db/migrations`, ne iz žive baze, i navodi vlastite granice (ne čita GRANT, ne vidi `EXECUTE format(...)` ni ime sastavljeno u izvođenju; vidi zaglavlje `tests/unit/rpc-http-inventory.test.ts`). Neovisna provjera naspram `pg_proc` nije rađena jer lokalno nema Dockera.
4. **E2E koristi lažni OIDC.** `m2-flow.spec.ts` prolazi na lažnom pružatelju (D-09). To nije dokaz stvarnog AAI@EduHr toka (D-203 D1); prijava na Labu ostaje uvjet prije stvarne uporabe.
5. **Svaka E2E stavka je jedan run.** Test `m2-flow.spec.ts` je u CI-ju prošao jednom na ovom SHA-u; jedan run ne dokazuje da nije nestabilan.

## Što ostaje otvoreno

- Jezgra M2 nije u cijelosti prihvaćena dok nalaz 1 nije razriješen (E2E za A-01 ili izričita odluka da pokrivenost komponentom i bazom dostaje) i dok vlasnik ne odluči o nalazu 2.
- Koraci M2 izvan ove četiri stavke (rok 20. 12. 2026.) nisu skupljani u ovom zapisu: M2.6 mentorstva (DAN-515), M2.7 nastavni tim (DAN-351), M2.8 komentor i povjerenstvo (DAN-379, čeka U-1), M2.12 pravila fakulteta (DAN-315), M2.15 do M2.17.
- Zaključak o prihvatu daje vlasnik; ovaj zapis ne mijenja status u Linearu.
