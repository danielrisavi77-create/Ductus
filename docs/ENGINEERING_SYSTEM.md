# Ductus Engineering System v1

Verzija 1.0 · 4. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Ovaj dokument definira kako AI tim razvija Ductus. Ne mijenja proizvodni Ustav, `PRODUCT.md` ni tehničku arhitekturu. Cilj je povećati brzinu bez gubitka neovisnog pregleda, testabilnosti i jasnog vlasništva.

## 1. Načelo

Ductus nije tvornica koda. Sustav optimizira za:

1. ispravnost;
2. povjerenje i sigurnost;
3. dokazivost odluka;
4. male, reverzibilne promjene;
5. brzinu tek nakon prva četiri uvjeta.

Normalno rade **tri stalna writera**: Backend, Frontend i Platforma. Četvrti writer dopušten je privremeno samo za potpuno neovisan zadatak. Više od četiri istodobna writera nije dopušteno.

## 2. Stalne uloge

| Uloga | Piše proizvodni kod | Odgovornost |
| --- | --- | --- |
| Orkestrator / Tech Lead | ne | red rada, scope, ovisnosti, risk, review, merge, stanje |
| Backend + Data | da | baza, identity, authz, evidence, submission, worker, projekcije |
| Frontend + Editor | da | Tiptap/ProseMirror, Dexie, sync, recovery, studentsko i nastavničko sučelje |
| Platform / SRE | da | CI, Docker, deploy, migracijski tooling, backup, restore, observability, supply chain |
| Product + UX + Design | ne po defaultu | korisnički tokovi, copy, dizajn, evaluacija novih funkcija |
| QA / Adversarial | samo testove i testne alate | specifikacijski, E2E, race, offline, chaos, browser i regression testovi |
| Independent Reviewer / Security | ne | pregled PR-a neovisno o autoru |
| Bug Hunter / Product Critic | ne | pokušava razbiti main/staging i otvara reproducibilne bugove |

Privremene uloge: Architecture/Performance Auditor i Privacy/Legal/Pilot Auditor.

## 3. Odvajanje odgovornosti

- Product/UX ne implementira vlastiti prijedlog. Otvara issue.
- Bug Hunter ne popravlja vlastiti bug. Otvara issue.
- Autor PR-a ne smije biti njegov neovisni reviewer.
- QA ne smije proglasiti vlastitu implementaciju adversarialno provjerenom.
- Orkestrator ne piše proizvodni kod.
- Backend i Frontend ne mijenjaju Platformine workflowe bez koordinacije.
- Platforma ne potvrđuje sama da sigurnosni gate koji je napisala stvarno hvata kvar; QA ga mora pokušati srušiti.

## 4. Runtime identitet

Svaki agent ima identitet:

```
<runtime>:<slot>:<role>
```

Primjeri:

```
claude:a:backend
claude:b:frontend
codex:a:platforma
chatgpt:b:reviewer
claude:c:qa
```

GitHub korisničko ime nije agent identitet jer više agenata može koristiti isti GitHub račun.

## 5. Risk razine

Svaki PR mora imati jednu razinu.

### low

Dokumentacija, copy bez promjene značenja, preimenovanja, jednostavna konfiguracija, mali dependency update bez runtime promjene.

Gate:
- CI;
- Dependency review kad je primjenjivo;
- jedan neovisni review ili eksplicitni Owner Override.

### standard

Frontend ponašanje, editor, adapteri, API bez novih ovlasti, migracije bez security granice, CI promjene, portovi, refaktori.

Gate:
- CI;
- Dependency review;
- jedan neovisni reviewer na aktualnom headu;
- dodatni QA kad Orkestrator procijeni da je promjena sklona race/offline/browser regresiji.

### critical

Identity, authz, RLS, pgTAP matrica, evidence, hash/JCS, potpisi, KMS, session management, submission, rekonstrukcija, retention, backup/restore, migracije koje mijenjaju ovlasti, PRODUCT §5 ili druga trust granica.

Gate:
- svi standard gateovi;
- neovisni reviewer;
- zaseban QA/adversarial PASS na aktualnom headu;
- sintetički staging prolaz kad BACKEND §6 točka 12 vrijedi.

Za posebno osjetljiv auth/RLS/crypto PR Orkestrator može tražiti drugog reviewera iz drugog providera.

### Automatski risk floor

CI i Engineering review gate ponovno računaju minimalnu razinu prema promijenjenim putanjama:
- obični docs-only može biti `low`;
- runtime kod, obični workflowi, infra i izvršne skripte najmanje `standard`;
- identity/auth/authz/OIDC/login/evidence/ingest/submission/retention/crypto/signing/forensics/session/JCS/signature/replay, request middleware, sve `app/api/**` trust granice koje sadrže te segmente, security migracije, pgTAP matrica, forbidden-terms gate, `PRODUCT.md`, `CLAUDE.md`, `AGENTS.md`, `ENGINEERING_SYSTEM.md`, CODEOWNERS i **svaki GitHub workflow** najmanje `critical`.

Heuristika je samo donja granica. Orkestrator smije podići risk; agent ga ne smije spustiti ispod semantičke ozbiljnosti promjene. Edit PR bodyja na istom headu ponovno pokreće trusted gate, pa promjena `Risk`, `Agent` ili `Task` ne nasljeđuje stari zeleni status.

## 6. PR metadata

Svaki PR mora sadržavati:

```
Agent: <runtime>:<slot>:<role>
Risk: low | standard | critical
Task: <ID ili kratki identifikator>
```

Review komentar je zaseban kanonski komentar. **Prva neprazna linija mora biti `Agent-Review:`**; primjer u code blocku ili tekst nakon preambule ne vrijedi kao verdict.

```
Agent-Review: <runtime>:<slot>:reviewer
Review-Head: <40-znamenkasti SHA>
Review-Verdict: PASS | FAIL | BLOCK
```

Verdict se ključa po `GitHub App + normalizirani runtime:slot`. Claude ostaje `claude:<slot>`; `codex` i `chatgpt`, jer dolaze kroz isti ChatGPT/Codex GitHub App, za usporedbu autora normaliziraju se u `openai:<slot>`. Za isti takav identitet vrijedi samo njegov najnoviji verdict na aktualnom headu. Aktualni `FAIL` ili `BLOCK` bilo kojeg valjanog neovisnog review identiteta drži gate blokiranim i ne može ga pregaziti PASS druge sesije istog Appa. Autor i reviewer moraju imati različit deklarirani/normalizirani principal.

Za `critical` PR QA komentar je također zaseban kanonski komentar čija prva neprazna linija mora biti `QA-Agent:`:

```
QA-Agent: <runtime>:<slot>:qa
QA-Head: <40-znamenkasti SHA>
QA-Verdict: PASS | FAIL | BLOCK
QA-Scope: <što je adversarialno provjereno>
```

Za `critical` PR reviewer i QA moraju biti strojno različiti po autentificiranom GitHub Appu koji je objavio komentar. To ograničenje vrijedi za **PASS**: isti App ne može dati oba potrebna PASS-a. Međutim, svaki valjani ne-autorski QA `FAIL` ili `BLOCK` drži gate blokiranim bez obzira na to je li isti App već dao reviewer PASS. Trenutno se prihvaća Claude App (`claude`) za `claude:*:reviewer|qa` i ChatGPT/Codex App (`chatgpt-codex-connector`) za `chatgpt:*|codex:*`. Runtime `grok:*` je podržan u agent metadata, ali je **fail-closed** za review/QA dok se iz stvarnog Grok komentara ne očita `performed_via_github_app.slug` i taj se slug eksplicitno ne registrira u `APP_RUNTIMES`. Jedan isti GitHub App ne može zadovoljiti i review i QA samo promjenom deklariranog runtimea.

GitHub commit/PR API u ovom osobnom repou ne daje pouzdan App identitet autora svakog commita, pa **autor ≠ reviewer/QA nije kriptografski/stvarno autentificiran ovim gateom**. Ipak, gate kao defense-in-depth uspoređuje deklarirani author `runtime:slot` iz PR metadata s deklariranim reviewer/QA `runtime:slot` i odbija isti principal pod drugom ulogom. To ne zamjenjuje governance pravilo: Orkestrator i dalje mora dodijeliti odvojene instance/račune. Ako se kasnije uvedu zasebni GitHub identiteti/Appovi za writere, ova provjera se može pooštriti.

### Provider registration pravilo

Novi AI provider ne dobiva trust samo zato što se deklarira u komentaru. Prvi korak je dijagnostički komentar iz stvarne provider sesije; GitHub API mora vratiti stabilan `performed_via_github_app.slug`. Tek nakon toga se slug dodaje u repo-tracked allowlist i pokrivaju se negativni/pozitivni testovi. Do tada provider može analizirati PR, ali njegov PASS/BLOCK nije gate identitet. Nikad se ne pogađa slug unaprijed.

PR metadata i review/QA komentari koriste **jedan zajednički parser** (`scripts/engineering/metadata-parser.mjs`) kako CI i review gate ne bi različito tumačili fenced ili uvučene Markdown primjere.

Novi push poništava review i QA jer `*-Head` više nije jednak aktualnom PR headu. Formalni GitHub review state nije ulaz u ovaj agent gate; agent verdicti idu kroz kanonske PR komentare.

## 7. Owner Override

Daniel može svjesno preskočiti gate. Override je iznimka, ne normalni tijek.

Komentar:

```
Owner-Override: PASS
Override-Head: <40-znamenkasti SHA>
Override-Reason: <konkretan razlog>
```

Engineering gate prihvaća override samo iz zasebnog komentara GitHub vlasnika repoa čija je prva neprazna linija `Owner-Override:`, i samo za aktualni head. Ne može razlikovati je li isti vlasnički račun komentar napisao čovjek ili agent; zato je override governance dokaz, a ne sigurnosna granica.

## 8. Tijek promjene

```
Product/bug signal
      ↓
Orkestrator: scope + risk + owner + acceptance criteria
      ↓
Backend | Frontend | Platform
      ↓
PR + CI
      ↓
Independent Review
      ↓
QA/adversarial ako risk traži
      ↓
Orkestrator
      ↓
Squash merge
      ↓
Post-merge smoke
      ↓
STATE / issue / odluka
```

Product/UX i Bug Hunter nikad ne preskaču issue fazu i ne prelaze ravno u implementaciju.

## 9. Stale branch politika

- Svaki writer počinje od svježeg `origin/main`.
- Draft smije zaostajati dok se radi.
- Prije ready-for-review autor ponovno dohvaća `main` i provjerava stvarni overlap.
- Ako je `main` promijenio datoteku koju PR dira, autor osvježava branch prije reviewa.
- Svaki push nakon reviewa automatski invalidira review preko `Review-Head`.
- Orkestrator ne tretira staro zeleno stanje kao dokaz za novi head.
- Stackani PR-ovi su dopušteni samo kada je ovisnost eksplicitna u opisu; nakon spajanja baze child PR se vraća na `main`.

## 10. Merge pravilo

Ciljno GitHub pravilo za `main`:

- direct push: zabranjen;
- force push: zabranjen;
- delete: zabranjen;
- PR obvezan;
- unresolved conversations: zabranjuju merge;
- obvezni statusi:
  - `Lint, typecheck, test and build`
  - `Local stack (compose.yaml)`
  - `Security scanners`
  - `Dependency review`
  - `Engineering review gate`
- merge metoda: squash.

Trust/governance putanje su označene u `.github/CODEOWNERS`. Dok je Daniel jedini GitHub code owner i ujedno autor većine PR-ova, branch protection **ne smije** uključiti obvezni Code Owner approval jer GitHub ne dopušta odobravanje vlastitog PR-a. Kad postoji drugi stvarni GitHub code-owner identitet, #53 može uključiti taj zahtjev. Do tada zaštitu daju critical risk floor, neovisni App-authenticated review/QA i Owner Override samo kao eksplicitna iznimka.

Engineering review status proizvodi privileged metadata-only workflow: `pull_request_target` služi za opened/synchronize/reopened/edited/ready_for_review, a `issue_comment` za agent verdict/override komentare. Workflow uvijek checkouta **default branch**, nikad PR head/merge ref, ne izvršava PR kod, nema repository secrets i jedina write ovlast mu je `statuses: write`.

Za javni repo owner mora prije 2. 11. 2026. potvrditi Actions event policy koja dopušta ovaj namjerni `pull_request_target` ili prijeći na okruženje gdje ga default politika ne blokira (issue #53). Ako GitHub administracijski API nije dostupan agentu, ova konfiguracija je Owner queue stavka i ne smije se lažno označiti dovršenom.

## 11. Token i kontekst politika

Posebna "token saver" sesija ne postoji. Orkestrator štedi kontekst.

- Worker čita samo kanonske dokumente navedene u zadatku.
- Velike pretrage daje kratkotrajnom auditoru.
- Low risk: fast/low ili medium.
- Standard: medium.
- Critical: high/xhigh.
- Sesija se rotira nakon logičkog sklopa ili kad ponovljeni kontekst postane skuplji od predaje novoj sesiji.
- Predaja mora stati u GitHub issue/PR i repo; chat povijest nije obvezan kontekst.
- Puni logovi testova čitaju se samo za pad; zeleni testovi koriste sažetak.

## 12. Post-merge

Nakon mergea Orkestrator:

1. provjerava post-merge CI/smoke;
2. ažurira zavisne PR-ove;
3. zatvara obrađeni issue;
4. ažurira `STATE.md` skupno;
5. dodjeljuje sljedeći zadatak tek kad je review kapacitet slobodan.

## 13. WIP limit

Normalno najviše:
- 3 aktivna writer PR-a;
- 2 PR-a u reviewu;
- 1 critical PR u QA-u.

Četvrti writer dopušten je samo ako ne dijeli datoteke, migracije, ugovore ni redoslijed s ostala tri.

Cilj nije maksimalan broj paralelnih agenata nego minimalno vrijeme od zadatka do provjerenog mergea.
