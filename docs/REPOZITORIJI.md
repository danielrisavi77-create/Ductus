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
