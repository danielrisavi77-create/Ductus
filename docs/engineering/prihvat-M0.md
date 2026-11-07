# Prihvat faze M0 (M0.Z)

Datum: 7. 11. 2026. · Korak M0.Z (plan rb25) · DAN-575 · po uzoru na `docs/engineering/prihvat-M1-tehnicki.md` (#1638) · autor `claude:p575a:platforma`

Zapis veže dokaz za fazu M0 uz jedan SHA `main`. Nedostajući dokaz ili crven CI posao je nalaz ovdje, ne popravak u ovom PR-u. Zapis ne označava M0 zatvorenim u Linearu; to potvrđuje Daniel. Pojedinosti sigurnosnih nalaza ne idu u javni repo, samo ID.

## Kako je rađeno

- **Jedan SHA:** `main` `b5d2b494d5a494dbc12aef1f89933180c4847800` (#1674, DAN-574 B3), najnoviji u trenutku rada; `main` se tijekom rada nije pomaknuo.
- **Dokaz za PR:** stanje i merge commit pročitani su s GitHub REST-a (`pulls/<n>`), ne iz naslova. Gdje se ticket ne može potvrditi na GitHubu, piše NEPROVJERENO.
- **CI:** push run `CI` `42358003658` na tom SHA-u; rezultati poslova su u odjeljku „CI na SHA-u”.
- Lokalno nije ništa pokretano: zapis je samo dokumentacija, a testove drži CI na istom SHA-u.

## CI na SHA-u

Run `CI` `42358003658` (događaj `push`, pokušaj 1, SHA `b5d2b494d5a494dbc12aef1f89933180c4847800`): ishod `success`, svi poslovi zeleni. Poslovi iz runa:

| Posao | ID posla | Ishod |
| --- | --- | --- |
| Classify CI scope | 128360207629 | success |
| Lint, typecheck, test and build | 128360249968 | success |
| Local stack (compose.yaml) | 128362652928 | success |
| Login E2E (1/6) | 128360250014 | success |
| Login E2E (2/6) | 128360250055 | success |
| Login E2E (3/6) | 128360250020 | success |
| Login E2E (4/6) | 128360250056 | success |
| Login E2E (5/6) | 128360250105 | success |
| Login E2E (6/6) | 128360250067 | success |
| Login E2E inventory | 128362154546 | success |
| Security scanners | 128360207785 | success |
| Standard E2E and database (1/3) | 128360250327 | success |
| Standard E2E and database (2/3) | 128360250034 | success |
| Standard E2E and database (3/3) | 128360250025 | success |
| Standard E2E inventory | 128362590205 | success |

Provjere izvan runa na istom SHA-u (`check-runs`), sve `success`: Analyze (javascript-typescript) `128360208770`, Analyze (python) `128360208759`, Analyze (actions) `128360208562` i Engineering gate evaluator `128360212354`. Pet dodatnih zapisa „Engineering gate evaluator” ima ishod `skipped` (preskočeni zapisi, ne neuspjesi).

**Standardni E2E po enginu** (artefakti `e2e-shard-1`, `e2e-shard-2`, `e2e-shard-3` istog runa, `results.json`): `desktop` 348 očekivanih, `firefox` 348, `mobile` 348 i `webkit` 348 testova, svi ishod `expected` (nijedan neuspjeh, preskočen ni nestabilan test). `desktop` je Chromium, `mobile` je Chromium viewport (nije zamjena za WebKit), `firefox` je Firefox, `webkit` je WebKit. Login E2E (6 shardova) vrti Chromium i WebKit prema planu u `scripts/engineering/login-shard-plan.mjs`; poslovi „Standard E2E inventory” i „Login E2E inventory” provjeravaju da shardovi zajedno pokrivaju cijeli skup.

## Stavke M0

| Plan | Tiket | PR | Merge commit | Dokaz |
| --- | --- | --- | --- | --- |
| rb1 | DAN-446 | #1170 | `6ee06832` | spojen 5. 11. 2026. |
| rb2 | DAN-178 | #1443 | `4fd0a227` | spojen 5. 11. 2026. (nalazi F-046, tablica klasa i guardovi, M0.6d) |
| rb3 | vlasnikov „Spoji” za #1443 (Q-9) | #1443 | `4fd0a227` | komentar vlasničkog računa na #1443 `issuecomment-6662544875` (i duplikat `6663063391`): `Owner-Command: merge` za head `5c808c79`, citat „Spoji 1443”; PR je potom spojen |
| rb4 | DAN-524 | #1538 | `2c67892e` | spojen 5. 11. 2026. |
| rb5 | DAN-522 | #1484 | `17ae14f0` | spojen 6. 11. 2026.; izvor vlasnikove odluke je sesija od 4. 11. 2026., trag na #87 `issuecomment-6621093184`. Opis PR-a navodi da komentar nije upisao Daniel osobno, nego Claude sesija na njegov izričit zahtjev |
| rb6 | DAN-522 | #1591 | `707120e6` | spojen 6. 11. 2026.; docs zapis odluka D-157, D-195, D-197 i vlasnikovih odgovora kao D-280 |
| rb7 | DAN-452 | #1561 | `b60d176d` | spojen 5. 11. 2026. |
| rb8 | DAN-570 | #1553 | `af2fb960` | spojen 5. 11. 2026.; ime „login-webkit” nije potvrđeno kao zaseban PR, vidi nalaz 3 |
| rb12 | DAN-572 | #641, #1622 | #641 nije spojen; #1622 `6e9e5c1c` | #641 zatvoren bez spajanja 6. 11. 2026. (zamijenjen); #1622 spojen 6. 11. 2026. |
| rb13 | DAN-573 | #1461 | `94b8f186` | #1461 spojen 5. 11. 2026., ali PR ne nosi oznaku DAN-573 (u `Task:` je D-251 i #87 c.6587383297); veza s DAN-573 je NEPROVJERENO |
| rb14 | DAN-233 | #550 | `950ce739` | spojen 5. 11. 2026. |
| rb15 | Dependabot | #1415 | `938200a4` | spojen 5. 11. 2026. (autor `dependabot[bot]`) |
| rb24 | DAN-574 | #1669 | `d54b88b9` | spojen 7. 11. 2026. |
| rb24 | DAN-574 B1 | #1672 | `58d5e338` | spojen 7. 11. 2026. |
| rb24 | DAN-574 B2 | #1673 | `ccabd332` | spojen 7. 11. 2026. |
| rb24 | DAN-574 B3 | #1674 | `b5d2b494` | spojen 7. 11. 2026.; to je SHA ovog zapisa |
| rb24 | plan napada | #1671 | — | issue (ne PR), stanje `open` |
| rb42 | DAN-432 | #1564 | `fecfa4d1` | spojen 5. 11. 2026. |
| rb43 | DAN-71 | #1051 | `9775fbeb` | spojen 5. 11. 2026. |
| rb81 | DAN-434 | #1566 | `83e7423c` | spojen 5. 11. 2026. |

## Uvjeti završetka M0 (`docs/PROGRAM-RAZRADA.md`)

| Uvjet | Dokaz | Stanje |
| --- | --- | --- |
| CI zelen na `main` uz obvezan E2E na Chromiumu, Firefoxu i WebKitu | odjeljak „CI na SHA-u”; engine projekti `desktop`, `mobile`, `firefox`, `webkit` iz `playwright.config.ts`; obvezan od #1097 (`34b94dab`) | ispunjeno: run `42358003658` zelen, a sva četiri engine projekta (Chromium `desktop` i `mobile`, Firefox, WebKit) prošla su po 348 testova |
| Zapis M0.1 postoji | `docs/engineering/prijenos-jezgre-M0.1.md` i `prijenos-jezgre-M0.1-jednakovrijednost.md`; zadnji ispravak #1313 (`22b3580a`, DAN-376) | datoteke postoje na SHA-u |
| Mjere D-91 1, 2, 4 i 6 spojene | `docs/engineering/d91-mjere.md` (#1036, #1045, #1073); mjera 3 (advisory lock) ide u B0.x, a #1051 (DAN-71, rb43) je njezin dio na strani alata | prema zapisu gotovo; nije ponovno provjereno na ovom SHA-u |
| Nalazi M0.6 zatvoreni u privatnom registru | F-010, F-011, F-012, F-013, F-014, F-015, F-017, F-023, F-027, F-033, F-035, F-039, F-040, F-041, F-045, F-046 | NEPROVJERENO: zatvaranje je u privatnom registru; ovdje samo ID-evi |
| Ljuska prošla vizualnu provjeru prema D-183 | smjer D-188 spojen (#972, #973, #974, `ced0ac8d`, `2f198d8f`, `cf765dd3`); odobrenje vizualne provjere nije nađeno u ovom pregledu | NEPROVJERENO |

## Nalazi

1. **Dokaz nije nađen (NEPROVJERENO), M0 se ne zaključuje na temelju njega:**
   - **rb13, DAN-573:** PR #1461 je spojen, ali ne nosi oznaku DAN-573 (u `Task:` su D-251 i #87 c.6587383297). Pretraga PR-ova po „DAN-573” nije dala nijedan pogodak. Veza tiketa i PR-a mora se potvrditi u Linearu.
   - **rb8, DAN-570:** PR #1553 je spojen, ali ime „login-webkit” nije potvrđeno kao zaseban PR. Pokrivenost WebKita u CI-ju vidi se u odjeljku „CI na SHA-u”, a ne u tom imenu.
   - **M0.6 (F-010 do F-046, 16 ID-eva):** zatvaranje je u privatnom registru; ovdje se ne može provjeriti.
   - **M0.5, vizualna provjera ljuske prema D-183:** odobrenje nije nađeno u ovom pregledu, iako je smjer D-188 spojen.
   - **D-91 mjere 1, 2, 4 i 6:** prema zapisu `docs/engineering/d91-mjere.md` gotove, ali nisu ponovno provjerene na ovom SHA-u.
2. **Stavke koje nisu spojen PR (stanje je drukčije od očekivanog):**
   - **rb12:** #641 je zatvoren bez spajanja (zamijenjen je s #1622, koji je spojen).
   - **rb24:** #1671 je issue (plan napada), ne PR, i ostaje `open`; PR-ovi plana su #1669, #1672, #1673 i #1674.
   - **rb3:** vlasnikov „Spoji” za #1443 vezan je uz head `5c808c79`; vrijedi samo za taj head (Q-9 u `STATE.md`).
3. **Izvor odluke nije vlasnikov osobni upis:** rb5 (#1484) oslanja se na komentar na #87 `issuecomment-6621093184` koji je upisala Claude sesija na vlasnikov izričit zahtjev, kako navodi opis PR-a. Daniel to potvrđuje pri zatvaranju M0.
4. **Nesklad izvora:** `STATE.md` još drži Q-9 otvoren iako su #1443 i #1458 spojeni. Ažurira ga zaseban mali docs PR (CLAUDE.md, Sinkronizacija); ovaj PR ga ne mijenja.
5. **Obuhvat zapisa:** zapis ne obuhvaća testove pokrenute lokalno (nisu pokretani) niti stanje Lineara; status zadataka vodi Linear.

## Što ostaje otvoreno

- Potvrda zatvaranja M0 u Linearu (Daniel).
- Zatvaranje nalaza M0.6 u privatnom registru: ovdje samo ID-evi i status NEPROVJERENO.
- Vizualna provjera ljuske prema D-183 (M0.5).
- `STATE.md` ne mijenja ovaj PR; Q-9 u njemu još stoji otvoren iako su #1443 i #1458 spojeni (nesklad prijavljen, ažurira ga zaseban mali docs PR).
