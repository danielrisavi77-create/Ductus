# Ductus: vanjski repozitoriji i plan uporabe

Verzija 0.1 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Popis GitHub projekata o kojima Ductus ovisi ili će ovisiti, s pripadnim zadatkom iz `docs/PLAN-DEMO.md` ili fazom iz `docs/PROGRAM.md`. Stanje repozitorija (zvjezdice, zadnja promjena, licenca, arhiviran ili ne) provjereno je preko GitHub API-ja 3. 10. 2026. Dokument ne donosi odluke: gdje je izbor PRIJEDLOG, vrijedi `docs/DECISIONS.md`.

## 1. Pravilo dodavanja

- Paket ulazi u `package.json` tek u PR-u koji ga prvi put koristi, preko Platforme (`SESSIONS.md` §1). Paket koji se ne koristi samo povećava napadnu površinu i šum u OSV-u i Dependabotu.
- Prije dodavanja: repozitorij nije arhiviran, imao je promjenu u zadnjih šest mjeseci, a licenca je na popisu u `.github/workflows/dependency-review.yml`.
- Docker slike i GitHub akcije pinaju se na točnu verziju ili SHA (ARCHITECTURE §10).
- Vlastiti kod ima prednost kad je posao malen i sigurnosno osjetljiv: JCS (`src/domain/json.ts`), i18n (`src/lib/i18n`) i provjera zabranjenih riječi ostaju naši.

## 2. Već u projektu

| Repozitorij | Kako ulazi | Uloga | Daljnji plan |
| --- | --- | --- | --- |
| `vercel/next.js`, `facebook/react` | npm | Aplikacija | Ostaje; Dependabot predlaže nove verzije uz odgodu |
| `vitest-dev/vitest`, `dubzzz/fast-check` | npm | Unit i property testovi | Property testovi za evidenciju (B-8) i rekonstrukciju (B-12) |
| `microsoft/playwright`, `dequelabs/axe-core-npm` | npm | E2E i pristupačnost | P-5 (E2E u CI-ju), K-4 (prolaz demoa s videom) |
| `evilmartians/lefthook` | npm | Git hookovi | Ostaje |
| `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` | CI | Osnova CI-ja | Dependabot ih osvježava (ovaj PR) |
| `gitleaks/gitleaks`, `zizmorcore/zizmor`, `semgrep/semgrep`, `google/osv-scanner` | Docker u CI-ju | Skeneri | Dependabot ne vidi slike u `docker run`; verzije ručno jednom mjesečno (Platforma) |
| `anthropics/claude-plugins-official` | Claude Code marketplace (korisnička razina) | Izvor pluginova | Vidi §6 |

Nijedan repozitorij nije dodan kao git submodul niti kopiran u repo.

## 3. Dodano ovim PR-om

| Repozitorij | Što radi | Zašto sada |
| --- | --- | --- |
| Dependabot (`.github/dependabot.yml`) | Tjedni prijedlozi za GitHub akcije i npm, odgoda 7 dana (30 za glavne verzije), grupirane manje verzije | ARCHITECTURE §10 ga traži, a nije postojao; pinane SHA vrijednosti inače zastarijevaju |
| `actions/dependency-review-action` v5.0.0 | Na svakom PR-u odbija novu ovisnost s poznatom ranjivošću (od `moderate`) ili licencom izvan popisa | Repo je javan pa je besplatno; OSV gleda cijeli lockfile, ovo gleda samo promjenu; nalaz je u sažetku provjere, bez komentara na PR-u (dozvole samo za čitanje) |
| Pluginovi `typescript-lsp`, `context7`, `claude-security` (`.claude/settings.json`) | Alati za sesije Claude Codea | Danielova odluka 3. 10. 2026.; vidi §6 |

Zaseban workflow, a ne izmjena `ci.yml`, da se ne sudara s otvorenim PR-om #13 i zadacima P-4 i P-5.

## 4. Plan po zadacima demoa

### Frontend

| Repozitorij | Licenca | Zadatak | Uporaba |
| --- | --- | --- | --- |
| `ueberdosis/tiptap` | MIT | P-9, F-3, F-8 | Editor (preneseno iz `pisac-editor`): naslovi, citat, bibliografija; shema u F4 |
| `dexie/Dexie.js` | Apache-2.0 | P-9, F-3, F-5, F-8 | Journal s 8 stanja sinkronizacije; brisanje pri odjavi i promjeni korisnika |
| `dumbmatter/fakeIndexedDB` | Apache-2.0 | P-9, F-3 | Testovi journala u Vitestu bez preglednika |

### Platforma

| Repozitorij | Licenca | Zadatak | Uporaba |
| --- | --- | --- | --- |
| `rustfs/rustfs` | Apache-2.0 | P-3 (PR #13) | S3-kompatibilna pohrana u `compose.yaml` |
| `axllent/mailpit` | MIT | P-3, F-6 | Lokalna e-pošta; E2E čita obavijest S3 iz Mailpitova API-ja |
| `panva/node-oidc-provider` | MIT | P-3, B-6 | Lažni OIDC pružatelj "demo prijava", samo lokalno i u CI-ju (D-09) |
| `amacneil/dbmate` | MIT | P-4 | Migracije čistim SQL-om; uloge i grantovi u zasebnoj migraciji |
| `theory/pgtap` (+ `pg_prove`) | PostgreSQL | P-4, B-5, B-7, B-8, B-10 | Matrica pristupa; slika Postgresa s pgTAP-om u compose i CI-ju |
| `webpro-nl/knip` | ISC | Nakon P-9 | Nekorištene ovisnosti, datoteke i izvozi u CI-ju; hvata paket dodan "za svaki slučaj" |

### Backend

| Repozitorij | Licenca | Zadatak | Uporaba |
| --- | --- | --- | --- |
| `brianc/node-postgres` (`pg`) | MIT | B-5 | Veza prema bazi; `withActor` postavlja GUC sa `SET LOCAL` unutar transakcije. pg-boss koristi isti `pg`, pa jedan klijent umjesto dva |
| `panva/openid-client` | MIT | B-6 | OIDC s PKCE, `state`, `nonce` [PRIJEDLOG D-73]; Better Auth (`better-auth/better-auth`) ostaje kandidat za M1 spike |
| `timgit/pg-boss` | MIT | B-9, B-12 | Red poslova u workeru, `migrate: false` [PRIJEDLOG D-74] |
| `colinhacks/zod` | MIT | B-6, B-8, B-12 | Provjera ulaza ruta i tijela `ingest`; greška bez ispisa sadržaja |
| `paulmillr/noble-curves` | MIT | B-4 (ako treba) | Ed25519 samo ako `node:crypto` ne pokrije razvojni potpisnik; prvo probati `node:crypto` |
| `pinojs/pino` | MIT | B-8, B-9 | Strukturirani logovi s `redact` za tijela i tekst rada (BACKEND §4.9); canary test |

### Nakon demoa

| Repozitorij | Licenca | Faza | Uporaba |
| --- | --- | --- | --- |
| `PeculiarVentures/PKI.js` | BSD-3 (GitHub ne prepoznaje) | M3 ostatak, dnevni korijen | RFC 3161 vremenski žigovi od dva besplatna TSA-a (D-72) |
| `transparency-dev/merkle` | Apache-2.0 | Dnevni korijen | Go referenca i ispitni vektori za RFC 6962 consistency dokaze; implementacija je naša, u TypeScriptu |
| `aws/aws-sdk-js-v3` (`client-kms`, `client-s3`) | Apache-2.0 | B0.1, M11 | KMS potpis nad digestom (D-71) i S3 adapter; tek nakon D-08 |
| `getsentry/sentry-javascript` | MIT (GitHub ne prepoznaje) | M11 | SDK za GlitchTip EU, `sendDefaultPii: false`, `beforeSend` bez tijela |
| `opentofu/opentofu`, `UpCloudLtd/terraform-provider-upcloud`, `scaleway/terraform-provider-scaleway` | MPL-2.0 | B0.1, M11 | `infra/` za okoliše; tek nakon računa dobavljača |
| `caddyserver/caddy` | Apache-2.0 | M11 | TLS, HSTS, access log bez query stringova |
| `getsops/sops`, `FiloSottile/age` | MPL-2.0, BSD-3 | M11 | Tajne na VM-u i šifrirani `pg_dump` |
| `wal-g/wal-g` | Apache-2.0 | Samo varijanta B (Hetzner) | PITR ako UpCloud padne na B0.1 |

## 5. Razmotreno i odbijeno

| Repozitorij | Razlog |
| --- | --- |
| `erdtman/canonicalize` | JCS već imamo u `src/domain/json.ts` s property testovima; strana implementacija bila bi druga istina |
| `amannn/next-intl` | i18n već imamo (F1); demo je samo na hrvatskom (D-84) |
| `kysely-org/kysely`, `porsager/postgres` | Pristup ide kroz RPC funkcije u bazi, pa graditelj upita malo donosi; dva klijenta uz pg-boss nepotrebna |
| `testcontainers/testcontainers-node` | `docker compose` iz P-3 već daje isti stog lokalno i u CI-ju |
| `Automattic/harper` | Provjera gramatike samo za engleski |
| `CycloneDX/cyclonedx-node-pnpm` | Arhiviran |
| `ossf/scorecard-action`, `step-security/harden-runner`, `github/codeql-action` | Korisni, ali Semgrep, zizmor i OSV već pokrivaju glavno; vratiti se na M11 prije GO uvjeta |
| `anthropics/claude-code-action` | Neovisni pregled radi Codex (`SESSIONS.md` §5); drugi automatski recenzent troši kvotu i dupla nalaze |

## 6. Alati za Claude Code

Uključeni u `.claude/settings.json` (`enabledPlugins`, službeni marketplace), na Danielov zahtjev 3. 10. 2026. Vrijede za sve sesije i worktreeove nakon spajanja.

1. **`typescript-lsp`**: skok na definiciju i reference umjesto pretraživanja tekstom; štedi tokene u Backend i Frontend sesijama. Na svakom stroju treba `npm install -g typescript-language-server typescript` (na Danielovom računalu instalirano).
2. **`context7`** (`upstash/context7`): dokumentacija za točnu verziju Tiptapa, Dexieja, pg-bossa i `openid-client`; troši tokene samo kad se pozove. Hostirani MCP traži prijavu pri prvom pozivu.
3. **`claude-security`**: dubinsko skeniranje na zahtjev, jednom prije demoa (T4) i prije GO uvjeta (M11), ne stalno.

Ne uključuju se: `playwright` MCP (aplikacija već ima ugrađeni preglednik), `github` MCP (`gh` CLI radi isto), `security-guidance` (pregled na svakom zaustavljanju u četiri paralelne sesije previše troši).


## 7. Datirana dopuna inventara — 6. 10. 2026. (DAN-45)

Ova je dopuna zaseban opaženi presjek i čuva povijesne tvrdnje iz §§1–6 s datumom 3. 10. 2026. One nisu ponovno provjerene ovim zadatkom. Završeni audit R-01 obuhvatio je **14 upstream izvora u 16 lokalnih Git klonova** u `D:\lekta-alati`, od `2026-10-06T20:41:52.363378+00:00` do `2026-10-06T20:42:13.065602+00:00`. Svih 16 imalo je čist Git status za praćene i neignorirane nepratene datoteke; to ne obuhvaća svaki ignorirani cache/build. Nije skeniran ostatak diska niti su osvježeni upstream HEAD-ovi.

Dokaz integracije odnosi se samo na tada provjereni main **`0025d1fc60798afcf7c3100f891d07438829b036`**. R-01 je zabilježio odsutnost `.gitmodules`, deklarirane dependencyje i pretragu imenovanih referenci bez rezultata. Za ovih 14 pomoćnih izvora **nije demonstrirana imenovana integracija** na tom SHA-u. To ne isključuje anonimno kopiran kod, sve moguće aliase, druge grane ni kasnije commitove; nije iscrpna pretraga svih GitHub izvora. Ova dokumentacijska promjena polazi od `ac65c71d797e29417d3d0f07aa9bd7ad63f2ff06` i ne proširuje R-01 zaključak na novu bazu.

**Clone** je lokalna kopija izvora; **paket** ulazi kroz odgovarajući package manager s pinom; **referenca** je dokaz ili usporedni materijal; **kopirani izvor/fixture** traži konkretan odabir datoteka, prava i attribution; **funkcionalna integracija** traži stvarni diff uporabe i izvršenu provjeru na njegovu SHA-u. Postojeće npm/CI ovisnosti iz §2 ne trebaju dodatni clone. Nijedan izvor u ovoj dopuni nije odabran za kopiranje ili pokrenut; integracijski task, owner i ciljna putanja ostaju nepoznati (`null`).

Strojni inventar: [external-repositories-20261006.json](engineering-tools/external-repositories-20261006.json). Čuva točne origin URL-ove, svih 16 opažanja, datume, pune HEAD-ove, SHA-256/Git blob identitete dokaznih dokumenata i pinane primarne URL-ove. Nazivi R-01 audit artefakata u manifestu označavaju podrijetlo, nisu javne repo putanje. Putanje u tablici i JSON-u relativne su prema `D:\lekta-alati`.

### 7.1. Opaženi izvori i sljedeća odluka

Faze/moduli su planirana namjena prema ovoj dodjeli, bez dodijeljenog integracijskog taska. **DOCX uvoz/izvoz i pripadni audit/fixturei pripadaju kasnijem M8, nakon demoa**; prisutnost clonea ih ne uvodi u demo. U stupcu integracije „Nije demonstrirano” znači ograničeni nalaz na navedenom main SHA-u. Statusi „Čeka provjeru” i „Odgođeno” preneseni su iz R-01 i nisu pravno odobrenje.

| Upstream | Lokalna putanja | Točan HEAD | Planirani modul / faza | Licenca i pinani dokaz (opažanje) | Status / integracija | Sljedeća odluka prije uporabe |
| --- | --- | --- | --- | --- | --- | --- |
| `citation-style-language/locales` | `izvori/citation-style-language__locales` | `a89adece41013402236e2c9020972d7e931fbab8` | Citati i bibliografija; Postojeći citation modul; tek uz konkretan task | CC-BY-SA-3.0 (README i prava unutar HR XML-a); [README.md](https://github.com/citation-style-language/locales/blob/a89adece41013402236e2c9020972d7e931fbab8/README.md) | Čeka provjeru / Nije demonstrirano | Pridružiti konkretan citation task; odabrati locales-hr-HR.xml i checksum; sačuvati attribution; HR očekivani citat/bibliografija mora proći i ne promijeniti kanonski tekst/evidenciju. |
| `citation-style-language/locales` | `repos/locales` | `a89adece41013402236e2c9020972d7e931fbab8` | Citati i bibliografija; Postojeći citation modul; tek uz konkretan task | CC-BY-SA-3.0 (README i prava unutar HR XML-a); [README.md](https://github.com/citation-style-language/locales/blob/a89adece41013402236e2c9020972d7e931fbab8/README.md); [locales-hr-HR.xml](https://github.com/citation-style-language/locales/blob/a89adece41013402236e2c9020972d7e931fbab8/locales-hr-HR.xml) | Čeka provjeru / Nije demonstrirano | Pridružiti konkretan citation task; odabrati locales-hr-HR.xml i checksum; sačuvati attribution; HR očekivani citat/bibliografija mora proći i ne promijeniti kanonski tekst/evidenciju. |
| `citation-style-language/styles` | `izvori/citation-style-language__styles` | `2e9355847feffe53d0e9f82cd8ee119c4a0ff2db` | Citati i bibliografija; Postojeći citation modul; tek uz potvrđen stil | CC-BY-SA-3.0 (README obje revizije); [README.md](https://github.com/citation-style-language/styles/blob/2e9355847feffe53d0e9f82cd8ee119c4a0ff2db/README.md) | Čeka provjeru / Nije demonstrirano | Potvrditi prihvaćeni vodič, konkretan .csl i eventualni parent; izabrati jednu od dvije lokalne revizije; očuvati prava i metapodatke; golden test pokriva autore, godinu, stranice i bibliografiju. |
| `citation-style-language/styles` | `repos/styles` | `3c6698d791a83016d699f50cbbea857f6ee3d2f8` | Citati i bibliografija; Postojeći citation modul; tek uz potvrđen stil | CC-BY-SA-3.0 (README obje revizije); [README.md](https://github.com/citation-style-language/styles/blob/3c6698d791a83016d699f50cbbea857f6ee3d2f8/README.md) | Čeka provjeru / Nije demonstrirano | Potvrditi prihvaćeni vodič, konkretan .csl i eventualni parent; izabrati jednu od dvije lokalne revizije; očuvati prava i metapodatke; golden test pokriva autore, godinu, stranice i bibliografiju. |
| `mnater/Hyphenopoly` | `izvori/mnater__Hyphenopoly` | `798afbabebaf41def5c60d47e8819a42075d2b60` | Prikaz teksta; Odgođeno; prihvaćeni zahtjev i mjerenje prije izbora | MIT za kod; jezični patterni imaju vlastite uvjete; [README.md](https://github.com/mnater/Hyphenopoly/blob/798afbabebaf41def5c60d47e8819a42075d2b60/README.md); [LICENSE](https://github.com/mnater/Hyphenopoly/blob/798afbabebaf41def5c60d47e8819a42075d2b60/LICENSE); [package.json](https://github.com/mnater/Hyphenopoly/blob/798afbabebaf41def5c60d47e8819a42075d2b60/package.json) | Odgođeno / Nije demonstrirano | Potvrditi HR pattern i prava; test uskog prikaza, kopiranja i undo toka; soft hyphen ne smije promijeniti kanonski tekst, offsete ili hash evidencije; izmjeriti bundle. |
| `xarsh/ooxml-validator` | `izvori/xarsh__ooxml-validator` | `11e3e8c5430d054c8d9102e3e5f5e15c6697c7b2` | Validacija DOCX izvoza; M8, nakon demoa | MIT; THIRD-PARTY-NOTICES.md navodi Open XML SDK pod MIT; [README.md](https://github.com/xarsh/ooxml-validator/blob/11e3e8c5430d054c8d9102e3e5f5e15c6697c7b2/README.md); [LICENSE](https://github.com/xarsh/ooxml-validator/blob/11e3e8c5430d054c8d9102e3e5f5e15c6697c7b2/LICENSE); [package.json](https://github.com/xarsh/ooxml-validator/blob/11e3e8c5430d054c8d9102e3e5f5e15c6697c7b2/package.json); [THIRD-PARTY-NOTICES.md](https://github.com/xarsh/ooxml-validator/blob/11e3e8c5430d054c8d9102e3e5f5e15c6697c7b2/THIRD-PARTY-NOTICES.md) | Čeka provjeru / Nije demonstrirano | Pozitivan sintetički DOCX i namjerno strukturno nevaljan DOCX; pin verzije/platformnog binaryja i notice; razumjeti exit code/JSON; ograničiti veličinu i vrijeme; test povezati s konkretnim export taskom. |
| `inukshuk/anystyle` | `repos/anystyle` | `c6f5fb2fa6e8ce9456ad1e1e88d6bba5f3d7731d` | Uvoz bibliografije; Kasnije, uz prihvaćeni task | BSD-2-Clause (LICENSE i gemspec); [README.md](https://github.com/inukshuk/anystyle/blob/c6f5fb2fa6e8ce9456ad1e1e88d6bba5f3d7731d/README.md); [LICENSE](https://github.com/inukshuk/anystyle/blob/c6f5fb2fa6e8ce9456ad1e1e88d6bba5f3d7731d/LICENSE); [anystyle.gemspec](https://github.com/inukshuk/anystyle/blob/c6f5fb2fa6e8ce9456ad1e1e88d6bba5f3d7731d/anystyle.gemspec) | Odgođeno / Nije demonstrirano | Task za bibliografski uvoz; odvojena prava modela/podataka; HR/EN ručno označeni primjeri; nepouzdan zapis ostaje za pregled, bez automatske promjene citiranog izvora. |
| `ThirstyHead/docx-a11y` | `repos/docx-a11y` | `456f76613efb469aa0131caca557e975e7763cf2` | Pristupačnost DOCX izvoza; M8, nakon demoa | MIT (LICENSE i pyproject); [README.md](https://github.com/ThirstyHead/docx-a11y/blob/456f76613efb469aa0131caca557e975e7763cf2/README.md); [LICENSE](https://github.com/ThirstyHead/docx-a11y/blob/456f76613efb469aa0131caca557e975e7763cf2/LICENSE); [pyproject.toml](https://github.com/ThirstyHead/docx-a11y/blob/456f76613efb469aa0131caca557e975e7763cf2/pyproject.toml) | Čeka provjeru / Nije demonstrirano | Točan kriterij (npr. jezik, heading redoslijed, tablična zaglavlja) i mali vlastiti ili licencno provjeren fixture; očekivani finding i čisti negativni kontrolni slučaj; audit ne mijenja ulaz; ishod nije certifikat pune WCAG sukladnosti. |
| `BaymaxStudio/docx-content-guard` | `repos/docx-content-guard` | `b6bda242c66510419d241d47bc72e887944eac0c` | Usporedba DOCX roundtripa; M8, nakon demoa | MIT (LICENSE i pyproject); [README.md](https://github.com/BaymaxStudio/docx-content-guard/blob/b6bda242c66510419d241d47bc72e887944eac0c/README.md); [LICENSE](https://github.com/BaymaxStudio/docx-content-guard/blob/b6bda242c66510419d241d47bc72e887944eac0c/LICENSE); [pyproject.toml](https://github.com/BaymaxStudio/docx-content-guard/blob/b6bda242c66510419d241d47bc72e887944eac0c/pyproject.toml) | Čeka provjeru / Nije demonstrirano | Povezati svaku prenesenu provjeru s Ductus invariantom; format-only par ne daje tekstualnu promjenu, zamjena jedne riječi mora je dati; sintetički ulazi, bez mutacije; autoritet ostaje postojeći canonical/evidence model. |
| `JSv4/Docxodus` | `repos/Docxodus` | `959b4741f0f636e74886e5667469fcd73832015b` | Uvoz/izvoz OOXML; M8, nakon demoa | MIT jezgra; zasebni uvjeti za demo/font materijale; [README.md](https://github.com/JSv4/Docxodus/blob/959b4741f0f636e74886e5667469fcd73832015b/README.md); [LICENSE](https://github.com/JSv4/Docxodus/blob/959b4741f0f636e74886e5667469fcd73832015b/LICENSE); [docs/demo/vendor/NOTICE.md](https://github.com/JSv4/Docxodus/blob/959b4741f0f636e74886e5667469fcd73832015b/docs/demo/vendor/NOTICE.md); [docs/demo/fonts/LICENSE.txt](https://github.com/JSv4/Docxodus/blob/959b4741f0f636e74886e5667469fcd73832015b/docs/demo/fonts/LICENSE.txt) | Odgođeno / Nije demonstrirano | Dokaz prednosti nad postojećim putem; ograničen strukturirani roundtrip s očekivanim gubicima; test accept/reject usporedbe na razini stvarno potrebnih struktura; test troška i resursa; odabrani artefakt i prava njegovih dijelova. |
| `openpreserve/format-corpus` | `repos/format-corpus` | `366f068cec399d0cdfd61fa473de3ab6dc858098` | Regresijski korpus uvoza/izvoza; M8, nakon demoa | README: CC0 osim gdje je drukčije navedeno; [README.md](https://github.com/openpreserve/format-corpus/blob/366f068cec399d0cdfd61fa473de3ab6dc858098/README.md) | Čeka provjeru / Nije demonstrirano | Za svaku datoteku zabilježiti izvornu putanju/commit, prava/iznimku, veličinu i checksum, očekivani ishod te test; odbiti nejasna prava ili nepotrebno velike datoteke. |
| `krunose/hunspell-hr` | `repos/hunspell-hr` | `5a81badfdfe687ae08964865f661059b0d7453bf` | Savjetodavni hrvatski pravopis; Odgođeno; zasebna odluka o opsegu | README_hr_HR.txt: 'LGPL/SISSL license, 2003'; [README.md](https://github.com/krunose/hunspell-hr/blob/5a81badfdfe687ae08964865f661059b0d7453bf/README.md); [README_hr_HR.txt](https://github.com/krunose/hunspell-hr/blob/5a81badfdfe687ae08964865f661059b0d7453bf/README_hr_HR.txt) | Odgođeno / Nije demonstrirano | Razjasniti prava odabranog .dic/.aff, odabrati engine i mjeriti HR lažne uzbune; sve izmjene tek izričitom korisničkom radnjom, bez tihog mijenjanja rada/evidencije. |
| `mwilliamson/mammoth.js` | `repos/mammoth.js` | `791a189230977143cde64dbf9f1d24dce96ac8a1` | DOCX uvoz; M8, nakon demoa | BSD-2-Clause (LICENSE i package.json); [README.md](https://github.com/mwilliamson/mammoth.js/blob/791a189230977143cde64dbf9f1d24dce96ac8a1/README.md); [LICENSE](https://github.com/mwilliamson/mammoth.js/blob/791a189230977143cde64dbf9f1d24dce96ac8a1/LICENSE); [package.json](https://github.com/mwilliamson/mammoth.js/blob/791a189230977143cde64dbf9f1d24dce96ac8a1/package.json) | Odgođeno / Nije demonstrirano | Test podržanih struktura i izričit gubitak nepodržanih; sanitizacija HTML-a i negativni javascript:/vanjski file reference slučajevi; vanjski pristup mora biti onemogućen; dokument se ne proglašava očuvanim samo zato što je HTML proizveden. |
| `agilesix/nofo-design-prep-checker` | `repos/nofo-design-prep-checker` | `b83375df402b25dc7dce810fb0b56ff1a667cef9` | Referenca za pripremu dokumenata; Odgođeno; opseg prava nerazriješen | Apache-2.0 u LICENSE; README istodobno navodi interni HHS alat; [README.md](https://github.com/agilesix/nofo-design-prep-checker/blob/b83375df402b25dc7dce810fb0b56ff1a667cef9/README.md); [LICENSE](https://github.com/agilesix/nofo-design-prep-checker/blob/b83375df402b25dc7dce810fb0b56ff1a667cef9/LICENSE); [package.json](https://github.com/agilesix/nofo-design-prep-checker/blob/b83375df402b25dc7dce810fb0b56ff1a667cef9/package.json) | Odgođeno / Nije demonstrirano | Razjasniti napomenu o distribuciji i točan sadržaj; pokazati podudarnost s prihvaćenim Ductus zahtjevom; vlastiti sintetički fixture i attribution za eventualno odabrani kod. |
| `srivtx/officelens` | `repos/officelens` | `b35b226a678c4cb13642cb9ccf5e831a467e6804` | Audit DOCX/PPTX pristupačnosti; M8, nakon demoa | MIT (LICENSE i package.json); [README.md](https://github.com/srivtx/officelens/blob/b35b226a678c4cb13642cb9ccf5e831a467e6804/README.md); [LICENSE](https://github.com/srivtx/officelens/blob/b35b226a678c4cb13642cb9ccf5e831a467e6804/LICENSE); [package.json](https://github.com/srivtx/officelens/blob/b35b226a678c4cb13642cb9ccf5e831a467e6804/package.json) | Čeka provjeru / Nije demonstrirano | Dokazati stvarni izvršni put na našoj platformi bez automatskog shell instaliranja; pozitivan/negativan sintetički DOCX; parsirati JSON/exit code; usporediti pokriće s docx-a11y i izabrati najmanji dovoljan alat. |
| `clarinsi/reldi-tokeniser` | `repos/reldi-tokeniser` | `9a90b6ca1e9429ba40722ac0e43253c399085306` | HR segmentacija teksta; Kasnije, samo uz dokazan zahtjev | Apache-2.0 (LICENSE; setup.py navodi apache-2.0); [README.md](https://github.com/clarinsi/reldi-tokeniser/blob/9a90b6ca1e9429ba40722ac0e43253c399085306/README.md); [LICENSE](https://github.com/clarinsi/reldi-tokeniser/blob/9a90b6ca1e9429ba40722ac0e43253c399085306/LICENSE); [setup.py](https://github.com/clarinsi/reldi-tokeniser/blob/9a90b6ca1e9429ba40722ac0e43253c399085306/setup.py) | Odgođeno / Nije demonstrirano | Jasan zadatak za segmentaciju, ljudski očekivani HR primjeri i offseti; pravila za standardni/nestandardni tekst; ne zamjenjivati tokenizer Laya checkpointa niti transformirati canonical evidence. |

**Granice licencnih opažanja.** CSL locale i stilovi imaju share-alike uvjete CC-BY-SA-3.0; sačuvati attribution, autore i prevoditeljske metapodatke. Hyphenopoly MIT kod ne pokriva automatski jezične patterne; HR pattern nije zasebno provjeren. AnyStyle BSD kod nije blanket odobrenje modela ili trening podataka, čiji su neki izvori ograničeni copyrightom. `format-corpus` navodi CC0 uz iznimke po datoteci; nijedan fixture nije pojedinačno odabran. Hunspell HR stari zapis „LGPL/SISSL license, 2003” ne razjašnjava verziju/izbor LGPL-a ni novije doprinose. Docxodus MIT jezgra ne obuhvaća sve demo materijale: Doom GPL, Freedoom BSD-3-Clause te Bitstream/DejaVu font uvjeti ostaju zasebni. NOFO LICENSE navodi Apache-2.0, dok README ograničava javnu distribuciju internog HHS alata; taj sukob ostaje otvoren, bez pravnog zaključka. Officelens README kaže da nije objavljen na npm; dokumentirani Bun/GitHub/binary put nije pokrenut ni potvrđen na našoj platformi. Potpuni opaženi scope i otvorene provjere nalaze se uz svaki JSON zapis.

Prije odabira treba dodijeliti konkretan task i owner, izabrati najmanji artefakt/paket i ciljnu putanju, zaključati verziju ili commit, pregledati prava odabranih dijelova, očuvati attribution/notice te izvršiti pozitivan i negativan test. Dokumentirani instalacijski put nije već izvršena ni odobrena instalacija. License/status opažanja nisu audit svih transitive ovisnosti, fixturea, modela ili asseta, ni potvrda runtime kompatibilnosti, sigurnosti, pristupačnosti ili performansi.

### 7.2. Laya: zaseban dokaz sadržaja pet datoteka

[laya-bundle-20261006.json](engineering-tools/laya-bundle-20261006.json) informativni je per-file manifest završene C-01 provjere: repo **`convaiinnovations/laya`**, revizija **`55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`**, podmapa **`multilingual`**. To nije zasebni repo `convaiinnovations/laya-multilingual`. Lokalni sirovi bajtovi opaženi su od `2026-10-06T20:59:33.825755+00:00` do `2026-10-06T20:59:35.518907+00:00`; dvije velike datoteke podudarne su po službenom pinanom LFS SHA-256 i veličini (`21:01:02 UTC`). Dopuna završena `2026-10-06T21:06:43.586630+00:00` potvrđuje tri mala configa po nepromijenjenim raw upstream bajtovima, SHA-256, veličini i zasebnim Git blob OID/ETag te revision zaglavljima. Početni nalaz samo veličine za confige ostaje u povijesti; završeni status svih pet je podudaran. U DAN-45 nisu ponovljeni hashiranje, HTTP dohvat ili model load.

| Datoteka | Bajtova | SHA-256 sirovih bajtova | Dokaz |
| --- | ---: | --- | --- |
| `model.safetensors` | 643835514 | `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204` | [Pinani izvor](https://huggingface.co/convaiinnovations/laya/resolve/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/multilingual/model.safetensors); LFS SHA-256 + veličina podudarni |
| `rl_agent_config.json` | 472 | `25061739243b617ad88d1219ba6f8a9c86c5881ca28df024fa2d9b3b2fcc30c6` | [Pinani izvor](https://huggingface.co/convaiinnovations/laya/resolve/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/multilingual/rl_agent_config.json); raw HTTP SHA-256 + veličina; Git blob/revision podudarni |
| `encoder/config.json` | 1938 | `83f6916d13ef0f556ac461f28308dc2bffa7ebeadee8ec9e2db5812020ea5bb4` | [Pinani izvor](https://huggingface.co/convaiinnovations/laya/resolve/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/multilingual/encoder/config.json); raw HTTP SHA-256 + veličina; Git blob/revision podudarni |
| `tokenizer/tokenizer.json` | 34363188 | `609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f` | [Pinani izvor](https://huggingface.co/convaiinnovations/laya/resolve/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/multilingual/tokenizer/tokenizer.json); LFS SHA-256 + veličina podudarni |
| `tokenizer/tokenizer_config.json` | 524 | `6c6b2d8e3c84ce0e671c129cd6b374b235d6f9863042a5836358d00a89bbb5a1` | [Pinani izvor](https://huggingface.co/convaiinnovations/laya/resolve/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/multilingual/tokenizer/tokenizer_config.json); raw HTTP SHA-256 + veličina; Git blob/revision podudarni |

Ukupno: **678201636 bajtova**. SHA-256 se odnosi na svaku zasebnu datoteku, bez JSON reserializacije ili zamišljenog zajedničkog digesta mape; Git blob SHA-1 zaseban je identitet. Stabilna veličina/mtime tijekom ranijeg čitanja kontrola je očite promjene, ne dokaz protiv svake konkurentne zamjene. Dokaz ne potvrđuje potpis izdavača ni podrijetlo trening podataka.

Povijesni `D:\laya\registry-lokalni.json` ostaje nepromijenjen: `weightsSha256` **`1793ac850c9b50a324737e7b62f68993415bce62e806a1533e72d7dd03578d4b`** ne odgovara `model.safetensors`, iako njegova očekivana veličina 643835514 B odgovara. `tokenizerSha256` **`6852bbf6ae96eb7f9a550306f31a6fe617efc89231d18d5235517e4ab6450840`** ne odgovara nijednoj od pet datoteka; cilj/algoritam starog tokenizer zapisa ostaje nepoznat. To je neslaganje registry očekivanja s potvrđenim per-file sadržajem, ne dokaz oštećenja modela. Nije pretpostavljen niti isproban aggregate algoritam; usklađenje treba izričitu pregledanu migraciju.

Novi dokumentacijski manifest **nije povezan s loaderom** i ne aktivira model. Offline učitavanje, tokenizer i final prompt/options preflight, inferencija, kvaliteta/kalibracija, RAM i latencija nisu testirani. Vrijeme hashiranja nije benchmark učitavanja ili inferencije. Te provjere i controller integracija zahtijevaju zaseban dodijeljeni zadatak; ovaj dokaz ne potvrđuje 3 GiB ni P95 kriterij.

## 8. Datirana dopuna — 10. 10. 2026.: globalni alati i pluginovi

Stanje na Danielovoj radnoj stanici, na njegov zahtjev. Odjeljci 1 do 7 ostaju povijesni presjeci i nisu ponovno provjereni.

### 8.1. Što "globalno" znači po vrsti

| Vrsta | Gdje živi | Kako je dobiva svaka sesija |
| --- | --- | --- |
| Knjižnica koju kod uvozi (Tiptap, Dexie, `pg`...) | `package.json` + lockfile na `main` | Worktree od svježeg `main` i `pnpm install`; pnpm ih drži u jednoj zajedničkoj pohrani na disku. Knjižnica se ne može instalirati "globalno" tako da je kod vidi bez `package.json` |
| Alat naredbenog retka | Korisnički `PATH` radne stanice | Svaka nova sesija (stare treba ponovno otvoriti) |
| Plugin za Claude Code | Korisnička razina (`~/.claude/settings.json`) i `.claude/settings.json` projekta | Korisnička razina vrijedi za sve projekte na stroju; projektna vrijedi i na drugom stroju ili računu |
| Lokalni klonovi iz §7 | `D:\lekta-alati\repos` i `D:\lekta-alati\izvori` | `permissions.additionalDirectories` u `.claude/settings.local.json`, koji se kopira u svaki novi worktree (`.worktreeinclude`). Samo čitanje kao referenca; pravila uporabe iz §7 vrijede i dalje |

### 8.2. Knjižnice iz §4: stanje na `main`

U `package.json`: Tiptap, Dexie, `fake-indexeddb`, `pg`. Još nisu, ulaze sa svojim PR-om: dbmate i pgTAP (#39), `openid-client` i `node-oidc-provider` (prijava), pg-boss, zod, pino, knip. Pravilo iz §1 ostaje.

### 8.3. Alati naredbenog retka instalirani globalno

| Alat | Izvor | Instalacija | Čemu služi lokalno |
| --- | --- | --- | --- |
| `dbmate` 2.36.0 | `amacneil/dbmate` | `npm install -g dbmate` | Migracije (#39) bez Dockera |
| `zizmor` 1.30.1 | `zizmorcore/zizmor` | `uv tool install zizmor` | Provjera workflowa prije pusha; ista verzija kao u CI-ju |
| `osv-scanner` | `google/osv-scanner` | winget `Google.OSVScanner` | Provjera lockfilea prije PR-a koji dira ovisnosti |
| `actionlint` | `rhysd/actionlint` | winget `rhysd.actionlint` | Sintaksa i izrazi u GitHub workflowima |
| `gitleaks` | `gitleaks/gitleaks` | winget (otprije) | Tajne; hook i dalje koristi Docker sliku s pinanom verzijom |
| `age`, `sops` | `FiloSottile/age`, `getsops/sops` | winget `FiloSottile.age`, `SecretsOPerationS.SOPS` | Tajne na VM-u i šifrirani dump (M11) |
| `tofu` | `opentofu/opentofu` | winget `OpenTofu.Tofu` | `infra/` (B0.1, M11) |
| `typescript-language-server` | `typescript-language-server/typescript-language-server` | `npm install -g` (otprije) | Plugin `typescript-lsp` |

Mjerodavan ostaje CI: lokalni alat ubrzava provjeru, ali ne zamjenjuje pinane verzije u `ci.yml`. Semgrep i `pg_prove` nemaju pouzdanu Windows instalaciju i ostaju u Dockeru.

### 8.4. Pluginovi

| Plugin | Razina | Zašto |
| --- | --- | --- |
| `typescript-lsp` | korisnička + projektna | Definicije i reference bez pretraživanja tekstom |
| `claude-security` | korisnička + projektna | Dubinsko skeniranje na zahtjev prije demoa i GO uvjeta |
| `context7` | projektna (plugin) + korisnička (MCP poslužitelj otprije) | Dokumentacija za točnu verziju knjižnice. Na ovom stroju se zato pojavljuje dvaput; bezopasno, a projektna razina ostaje radi drugih strojeva |
| `linear` (novo) | korisnička + projektna | Linear je mjerodavan za zadatak, prioritet, nositelja i status (`MULTI-ACCOUNT.md`), a claude.ai konektori su u projektu isključeni. Traži jednokratnu prijavu u Linear |
| `codex`, `agents-observe` | korisnička (otprije) | Neovisni pregled i nadzor sesija |

Pregledani i ne uključuju se: `pr-review-toolkit`, `code-review`, `feature-dev` (dupliciraju agente i skillove `ductus-*` te Codex), `security-guidance` i `hookify` (hookovi na svakom potezu u više paralelnih sesija), `commit-commands` (zaobilazi pravilo `git add <putanje>`), `frontend-design` (izgled je određen odobrenim dizajnom, D-85 i D-89), `session-report` (pokrivaju `scripts/usage-report.ps1` i `agents-observe`), `playwright` i `github` MCP (pokrivaju `@playwright/test` i `gh`), `serena` (pokriva `typescript-lsp`). `terraform` MCP razmotriti tek uz `infra/`.
