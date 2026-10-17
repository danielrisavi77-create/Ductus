# Ductus Engineering System v1

Verzija 1.1 · 7. 10. 2026. · Odgovorna osoba: Daniel Rišavi

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

Iznimka: PR koji dira putanje ili zapise iz D-97 (`docs/DECISIONS.md`), tj. pravila o tome tko smije pisati, pregledavati, spajati ili zaobići provjeru, nije `low` ni kad je samo dokumentacija; otvara se kao `critical` kad dira putanju iz D-97, a kao `standard` ili viši kad dira samo `docs/DECISIONS.md` ("Automatski risk floor" niže), i spaja tek na Danielovu naredbu.

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
- sintetički staging prolaz kad BACKEND §6 točka 12 vrijedi;
- pravila rada za `critical` PR iz §14.

Izuzeće od QA-e (vlasnik, 11. 10. 2026., #87, `issuecomment-6112538306` i `6112555187`): `critical` PR koji mijenja samo testove ili samo dokumente, uključivo dokumente koji određuju gate i pravila rada te testove gatea u `scripts/engineering/`, ne traži zaseban QA PASS. Neovisni review ostaje. Izuzeće ne mijenja put spajanja: PR koji dira putanju iz D-97 spaja se po `docs/ORKESTRATOR.md` §4 (vlasnikova naredba s brojem PR-a, a noću i noćni prozor kad je uključen), ostali kao i dosad. Gate provodi pravilo od #275 (`qaExemption` u `scripts/engineering/protected-paths.mjs`) i gleda samo popis datoteka, nikad tijelo PR-a. "Testovi" su sve datoteke pod `tests/`, `e2e/` ili `db/tests/` (i pomoćne datoteke, fixturei i postavke u tim mapama, bez obzira na nastavak) te `*.test.*` i `*.spec.*` u js/ts varijantama; "dokumenti" su sve `*.md` datoteke, uključivo `.claude/agents/*.md` i `SKILL.md`. Datoteka `*.md` pod `tests/`, `e2e/` ili `db/tests/` broji se i kao test i kao dokument, pa ne kvari izuzeće ni PR-u sa samo testovima ni PR-u sa samo dokumentima. PR koji mijenja i testove i dokumente nije izuzet, kao ni PR koji uz njih mijenja bilo koju drugu datoteku (Python testovi i konfiguracije testova izvan tih mapa nisu "testovi" u ovom smislu). Preimenovanje se broji pod starim i novim imenom.

Za posebno osjetljiv auth/RLS/crypto PR Orkestrator može tražiti drugog reviewera iz drugog providera.

### Automatski risk floor

CI i Engineering review gate ponovno računaju minimalnu razinu prema promijenjenim putanjama:
- obični docs-only može biti `low`;
- runtime kod, infra, izvršne skripte i `docs/DECISIONS.md` (zapisi iz D-97 ne mogu se prepoznati po putanji) najmanje `standard`;
- identity/auth/authz/OIDC/login/evidence/ingest/submission/retention/crypto/signing/forensics/session/JCS/signature/replay, request middleware, sve `app/api/**` trust granice koje sadrže te segmente, security migracije, pgTAP matrica, forbidden-terms gate, `PRODUCT.md`, `CLAUDE.md`, `AGENTS.md`, `ENGINEERING_SYSTEM.md`, CODEOWNERS i **svaki GitHub workflow** najmanje `critical`;
- najmanje `critical` je i svaka putanja iz D-97 (`D97_PATHS` u `scripts/engineering/protected-paths.mjs`: cijeli `.github/`, `.claude/`, `.agents/`, `scripts/engineering/`, `scripts/hooks/`, `scripts/orchestrator/`, `plugins/ductura-engineering/`, `lefthook.yml` i nabrojeni dokumenti pravila) te `STATE.md`, `.worktreeinclude`, `.cc-safety-net/`, `osv-scanner.toml`, `plugins/`, `db/migrations/` (sve migracije), `db/local/`, `src/server/db/`, cijeli `tests/` i `vitest.config.ts`. Test u `tests/` može biti jedina provedba čuvara, pa nosi razinu čuvara; nova datoteka u `tests/` zato je `critical` bez dopune popisa.

Usporedba putanja ne ovisi o velikim i malim slovima, kosim crtama ni prefiksu `./`; preimenovana datoteka broji se pod oba imena, a obrisana pod svojim. Ako GitHub ne vrati cijeli popis promijenjenih datoteka, gate pada zatvoreno (`failure`). Poruka o preniskom `Risk` u statusu je nepromjenjiv tekst bez imena datoteka; imena su u logu CI posla.

Auto-merge: dok je na PR-u uključen auto-merge, a promijenjene datoteke traže Danielovu naredbu (putanje iz D-97 ili `docs/DECISIONS.md`), gate vraća `pending` bez obzira na review i QA. Hook `scripts/hooks/pr-auto-merge.mjs` uključuje auto-merge samo kad je deklarirani i izračunati rizik `low`, nema takvih putanja i popis promijenjenih datoteka se mogao pročitati. Granica: hook čita lokalni `git diff` prema `origin/main`, pa je strojna provjera gate, ne hook; sesija s tokenom može i dalje ručno spojiti PR, što gate ne sprječava (D-97 ostaje governance pravilo).

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

Verdict se ključa po `GitHub App + normalizirani runtime:slot`. Claude ostaje `claude:<slot>`; `codex` i `chatgpt`, jer dolaze kroz isti ChatGPT/Codex GitHub App, za usporedbu autora normaliziraju se u `openai:<slot>`. Za isti takav identitet vrijedi samo njegov najnoviji verdict na aktualnom headu. Aktualni `FAIL` ili `BLOCK` bilo kojeg valjanog neovisnog review identiteta drži gate blokiranim i ne može ga pregaziti PASS druge sesije istog Appa. Autor i reviewer moraju imati različit deklarirani/normalizirani principal. Sesija koja je napisala plan napada za zadatak (`docs/ORKESTRATOR.md` §8) ne daje review ni QA verdikt na PR-u tog zadatka (zabranu QA verdikta zapisao je vlasnik u DAN-122, a proširenje na review potvrdio ga je vlasnik: https://github.com/danielrisavi77-create/Ductus/pull/165#issuecomment-6100851850); isto vrijedi za pisca patcha koji je autor PR-a uz sesiju koja ga commita (`docs/ORKESTRATOR.md` §8); to je governance pravilo koje gate strojno ne provjerava.

Za `critical` PR QA komentar je također zaseban kanonski komentar čija prva neprazna linija mora biti `QA-Agent:`:

```
QA-Agent: <runtime>:<slot>:qa
QA-Head: <40-znamenkasti SHA>
QA-Verdict: PASS | FAIL | BLOCK
QA-Scope: <što je adversarialno provjereno>
```

Za `critical` PR reviewer i QA moraju biti strojno različiti po autentificiranom GitHub Appu koji je objavio komentar. To ograničenje vrijedi za **PASS**: isti App ne može dati oba potrebna PASS-a, osim uz kvotni fallback opisan niže. Međutim, svaki valjani ne-autorski QA `FAIL` ili `BLOCK` drži gate blokiranim bez obzira na to je li isti App već dao reviewer PASS. Trenutno se prihvaća Claude App (`claude`) za `claude:*:reviewer|qa`, ChatGPT/Codex App (`chatgpt-codex-connector`) za `chatgpt:*|codex:*`, te Grok by xAI App (`grok-by-xai`) za `grok:*`. Runtime `grok:*` je podržan i za gate. Stvarni Grok komentar potvrđen je kao GitHub App `grok-by-xai` (Grok by xAI), pa se prihvaća samo mapping `grok-by-xai → grok`. Jedan isti GitHub App ne može zadovoljiti i review i QA samo promjenom deklariranog runtimea.

### Fallback par modela kad drugi provider nije dostupan

Ako pretplata ili kvota za treći provider (primjerice Grok) nije dostupna, critical gate može zadovoljiti kombinacija **Fable na Claudeu** i **Astra na ChatGPT/Codexu**, u bilo kojem redoslijedu između reviewer i QA. Svaki PASS i dalje mora biti objavljen preko vlastitog autentificiranog GitHub Appa: `claude` i `chatgpt-codex-connector`. Fallback se oslanja na ta dva odvojena providera, uz korištenje ovih odabranih modela.

Radi auditabilnosti, fallback komentar bilježi model u ulozi koju je obavio, npr. `Review-Model: Fable` i `QA-Model: Astra` (ili obrnuto), uz točan runtime model ID ako ga runtime prikazuje. Bilježi se i `Provider-Fallback: <provider> — <razlog>`, primjerice `Grok — pretplata ili kvota nedostupna`. Ti su redci deklarirana governance evidencija, a ne kriptografska potvrda modela ili stanja pretplate. Automatizirani gate i dalje provjerava autentificirani App, principal, ulogu, aktualni head i verdict.

### Kvotni fallback: isti App, neovisna sesija

Dok je kvota drugog providera dokazano iskorištena, `critical` QA PASS smije doći s istog Appa kao reviewer PASS, ali samo iz neovisne sesije. Gate ga prihvaća kad su ispunjeni svi uvjeti:

1. **Strojni dokaz kvote.** Na istom PR-u postoji komentar samog iscrpljenog Appa (korisnik `<slug>[bot]`, `performed_via_github_app.slug` jednak `<slug>`) s porukom o iscrpljenoj kvoti, objavljen prije QA komentara i najviše 24 sata ranije. Deklaracija sesije nije dokaz. Trenutno je registriran samo `chatgpt-codex-connector` (poruka "reached your Codex usage limits"); obrazac za drugi App dodaje se tek nakon stvarno opažene poruke, kao kod registracije providera. Ako je dokaz stariji od 24 sata, svjež se dobiva novim pozivom tog Appa na PR-u (za Codex komentar `@codex review`). Poruka mora otvarati komentar: citat te rečenice u reviewu, bloku koda ili odgovoru nije dokaz. Dokaz prestaje vrijediti čim isti App na tom PR-u objavi kasniji komentar koji nije poruka o kvoti, kasnije uredi takav komentar (Codex uređuje jedan sažetak reviewa na mjestu) ili objavi kasniji PR review, jer tada dokazivo radi (#128). PR review ili komentar Appa bez čitljivog vremena, kao i aktivnost u istoj sekundi kao poruka o kvoti, također poništava dokaz, jer se redoslijed ne može utvrditi. Gate se ponovno računa i kad stigne PR review: workflow "Engineering gate review signal" bez ikakvih ovlasti samo prenosi taj događaj, a "Engineering review gate" se na njegov završetak (`workflow_run`) pokreće s default brancha. Granica: za PR iz forka GitHub ne navodi PR uz `workflow_run`, pa se gate preračuna tek na idući komentar ili push.
2. **Deklaracija u QA komentaru.** Kanonski QA blok sadrži `Provider-Fallback: <slug iscrpljenog Appa> — <razlog>`, npr. `Provider-Fallback: chatgpt-codex-connector — kvota iscrpljena`. Slug ne smije biti App koji objavljuje QA.
3. **Neovisan principal.** QA `runtime:slot` razlikuje se od autora i od svakog reviewera koji je dao PASS na tom headu.

Dovoljan je valjan dokaz kvote za *jedan* drugi registrirani App; ne traži se dokaz za sve ostale Appove. Primjer: Grok reviewer PASS i Grok QA PASS s `Provider-Fallback: chatgpt-codex-connector` uz valjan Codex dokaz prolaze, iako je Claude App možda dostupan. Odluka vlasnika 12. 10. 2026. (#128, `issuecomment-6123209198`); zaključava je test u `scripts/engineering/review-gate-quota-evidence.test.mjs`.

Uz strojne uvjete vrijedi governance pravilo neovisnosti: QA sesija je nova sesija s vlastitim slotom, nije pisala ni reviewala taj PR, nije podagent reviewer sesije i ne polazi od reviewerova izvještaja. Scenarije gradi i izvodi sama, a reviewerove nalaze smije pročitati tek nakon vlastitog verdikta. Ako je moguće, koristi drugi model od reviewera i bilježi ga kao `QA-Model`.

Fallback ne mijenja ništa drugo: QA `FAIL` ili `BLOCK` bilo koje valjane ne-autorske sesije i dalje blokira, novi push poništava i review i QA (osim prijenosa iz D-101), a status gatea navodi da je korišten kvotni fallback. Kad se kvota vrati, novi `critical` PR-ovi opet traže QA s drugog Appa; već spojeni PR-ovi se ne otvaraju ponovno.

Bez strojnog dokaza kvote i bez uvjeta iz sljedećeg odjeljka (D-139) dvije sesije ili dva modela unutar istog Appa ne zadovoljavaju odvojeni critical PASS. Gate tada ostaje pending dok nije dostupan drugi prihvaćeni App, dok ne nastane dokaz kvote ili dok Daniel ne zabilježi aktualni `Owner-Override` prema §7.

GitHub commit/PR API u ovom osobnom repou ne daje pouzdan App identitet autora svakog commita, pa **autor ≠ reviewer/QA nije kriptografski/stvarno autentificiran ovim gateom**. Ipak, gate kao defense-in-depth uspoređuje deklarirani author `runtime:slot` iz PR metadata s deklariranim reviewer/QA `runtime:slot` i odbija isti principal pod drugom ulogom. To ne zamjenjuje governance pravilo: Orkestrator i dalje mora dodijeliti odvojene instance/račune. Ako se kasnije uvedu zasebni GitHub identiteti/Appovi za writere, ova provjera se može pooštriti.

### Druga Claude sesija za critical QA (D-139)

Treći izvor `critical` QA PASS-a, uz zaseban App (D-138) i kvotni fallback: druga, neovisna Claude sesija, iako je review dao Claude App. Odluka vlasnika: `#87` komentar 6241681114. Vrijede SVA tri uvjeta:

1. **Vlastiti slot.** QA sesija ima vlastiti `runtime:slot` koji nije autor, reviewer tog PR-a (na bilo kojem headu, s bilo kojim verdiktom) ni pisac plana napada. Strojna granica gatea: odbija samo autora i reviewere s PASS-om na aktualnom headu; ostalo je governance pravilo iz §6.
2. **Codex na headu, niti odgovorene.** Na aktualnom headu postoji Codex review (App `chatgpt-codex-connector`, PR review s `commit_id` jednakim headu), a svaka njegova nit ima odgovor autora, popravkom ili obrazloženjem. Gate čita odgovor kao komentar u niti čiji autor nije Codex; nerazriješena nit i dalje blokira spajanje zaštitom grane. Codex komentar bez PR reviewa (npr. sažetak „nema nalaza” kao običan komentar) nema head u API-ju i ne vrijedi kao dokaz.
3. **Redak u QA komentaru.** Kanonski QA blok sadrži točno `Provider-Fallback: claude-second-session — Codex review na headu <sha>` s punim SHA-om aktualnog heada. Redak imenuje jedan head, pa se ne prenosi preko D-101.

Ako Codexa nema, vrijedi redoslijed iz D-138: Grok, kvotni fallback, zatim `Owner-Override`. Ovaj put ne mijenja ništa drugo: QA `FAIL` ili `BLOCK` bilo koje valjane sesije i dalje blokira, novi push poništava review i QA, a status gatea navodi da je korišten ovaj put. Gate kod je u zasebnom D-97 PR-u (#411); do njegova spajanja vrijedi stanje bez ovog puta.

### Provider registration pravilo

Novi AI provider ne dobiva trust samo zato što se deklarira u komentaru. Prvi korak je dijagnostički komentar iz stvarne provider sesije; GitHub API mora vratiti stabilan `performed_via_github_app.slug`. Tek nakon toga se slug dodaje u repo-tracked allowlist i pokrivaju se negativni/pozitivni testovi. Za Grok je taj proces dovršen: slug je `grok-by-xai`. Nikad se ne pogađa slug unaprijed.

PR metadata i review/QA komentari koriste **jedan zajednički parser** (`scripts/engineering/metadata-parser.mjs`) kako CI i review gate ne bi različito tumačili fenced ili uvučene Markdown primjere.

Novi push poništava review i QA jer `*-Head` više nije jednak aktualnom PR headu. Iznimka (D-101): verdikt na ranijem headu vrijedi i dalje kad su svi kasniji commiti samo spajanja osnovne grane (merge commiti) i diff PR-a prema osnovnoj grani identičan je onome na tom headu; gate to provjerava preko GitHub API-ja (hod po prvom roditelju i compare) i na svaku grešku ne prenosi ništa. Datoteka bez patcha (npr. binarna, prevelika ili čisto preimenovanje) ne prenosi ništa jer compare ne pokazuje njezinu stranu osnovne grane. Hod koji ne stigne do commita koji nije merge, ili više od pet headova s verdiktom iza samih spajanja, također ne prenose ništa, da stariji `FAIL` ili `BLOCK` ne ispadne tiho. Kad uspjeh gatea broji prenesen verdikt, status navodi s kojeg je heada prenesen. Owner Override se nikad ne prenosi. Formalni GitHub review state nije ulaz u ovaj agent gate; agent verdicti idu kroz kanonske PR komentare.

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
- PR se spaja samo ako njegov head sadrži aktualni `main` (zaštita grane, 11. 10. 2026.). PR koji je na redu u gateu spaja `main` neposredno prije reviewa (§15).
- Svaki push nakon reviewa automatski invalidira review preko `Review-Head`, osim čistog spajanja osnovne grane bez promjene diffa PR-a (D-101).
- Orkestrator ne tretira staro zeleno stanje kao dokaz za novi head.
- Stackani PR-ovi su dopušteni samo kada je ovisnost eksplicitna u opisu; nakon spajanja baze child PR se vraća na `main`.

## 10. Merge pravilo

Ciljno GitHub pravilo za `main`:

- direct push: zabranjen;
- force push: zabranjen;
- delete: zabranjen;
- PR obvezan;
- unresolved conversations: zabranjuju merge;
- grana mora biti ažurna prije spajanja (`strict`, uključeno 11. 10. 2026.; mijenja samo Daniel);
- obvezni statusi:
  - `Lint, typecheck, test and build`
  - `Local stack (compose.yaml)`
  - `Security scanners`
  - `Dependency review`
  - `Engineering review gate`
- merge metoda: squash.

Noćno spajanje D-97 PR-ova (vlasnik, 11. 10. 2026., #87, `issuecomment-6112586958`) opisano je u `docs/ORKESTRATOR.md` §4; ne mijenja zaštitu grane ni obvezne statuse.

Trust/governance putanje su označene u `.github/CODEOWNERS`. Dok je Daniel jedini GitHub code owner i ujedno autor većine PR-ova, branch protection **ne smije** uključiti obvezni Code Owner approval jer GitHub ne dopušta odobravanje vlastitog PR-a. Kad postoji drugi stvarni GitHub code-owner identitet, #53 može uključiti taj zahtjev. Do tada zaštitu daju critical risk floor, neovisni App-authenticated review/QA i Owner Override samo kao eksplicitna iznimka.

Engineering review status proizvodi privileged metadata-only workflow: `pull_request_target` služi za opened/synchronize/reopened/edited/ready_for_review/auto_merge_enabled/auto_merge_disabled, a `issue_comment` za agent verdict/override komentare. Workflow uvijek checkouta **default branch**, nikad PR head/merge ref, ne izvršava PR kod, nema repository secrets i jedina write ovlast mu je `statuses: write`.

Za javni repo owner mora prije 2. 11. 2026. potvrditi Actions event policy koja dopušta ovaj namjerni `pull_request_target` ili prijeći na okruženje gdje ga default politika ne blokira (issue #53). Ako GitHub administracijski API nije dostupan agentu, ova konfiguracija je Owner queue stavka i ne smije se lažno označiti dovršenom.

## 11. Token i kontekst politika

Posebna "token saver" sesija ne postoji. Orkestrator štedi kontekst.

- Worker čita samo kanonske dokumente navedene u zadatku.
- Velike pretrage daje kratkotrajnom auditoru.
- Low risk: fast/low ili medium.
- Standard: medium.
- Critical: high/xhigh.
- Sesija se rotira nakon logičkog sklopa ili kad ponovljeni kontekst postane skuplji od predaje novoj sesiji. Iznimka: sesija orkestratora se ne rotira, nego osvježava sažimanjem po `docs/ORKESTRATOR.md` §7.
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
- 1 PR u gateu (review, QA ili čekanje spajanja), i kad je to D-97 PR koji čeka vlasnika (§15);
- 1 PR alata u radu (§16).

Četvrti writer dopušten je samo ako ne dijeli datoteke, migracije, ugovore ni redoslijed s ostala tri.

Cilj nije maksimalan broj paralelnih agenata nego minimalno vrijeme od zadatka do provjerenog mergea.

## 14. Pravila rada za critical PR (D-106)

Vrijede za svaki `critical` PR uz gate iz §5; gate se njima ne mijenja. Izvor je vlasnikova odluka od 11. 10. 2026. (D-106). Kartice u `.claude/uloge/`, pravila u `.claude/rules/` i skillovi upućuju na ovaj odjeljak, ne na komentare na issueima.

1. **Ugovor prije koda.** Prije pisanja, u planu napada ili opisu PR-a stoje ova polja:
   - **Invarijanta:** jedna rečenica.
   - **Mjesta:** popis svih mjesta gdje invarijanta mora vrijediti.
   - **Stvarni pozivatelj:** produkcijska datoteka koja kod poziva, ili "još ne postoji". Ako ne postoji, opis kaže što PR jamči dok pozivatelja nema i što se odgađa do spajanja u proizvod.
   - **Poznate granice:** što izričito nije dio jamstva i za koje pozivatelje jamstvo vrijedi.
   - **Što bi ovaj PR moglo oboriti na QA-i?:** piščeva procjena najslabijeg mjesta (ulaz za §17).

   Bez tih polja orkestrator PR ne stavlja u red za review, a reviewer ga ne reviewa nagađanjem nego javlja orkestratoru.
2. **Poznate granice i suženje ugovora.** "Poznata granica" ili suženi ugovor u opisu PR-a umanjuje nalaz reviewa ili QA-e samo uz trag vlasnikova odobrenja (komentar ili zapis odluke s datumom). Nikad ne umanjuje nalaz koji dira tvrdo pravilo iz `CLAUDE.md`, `docs/PRODUCT.md` §5 ili granicu povjerenja; takav nalaz ostaje kakav jest. Odobreno suženje zapisuje uvjet koji granicu ponovno otvara (primjer: jamstva adaptera pohrane iz #233 vrijede za ulaz kakav predaje gateway; svaki novi pozivatelj ponovno otvara granicu i traži vlastiti plan napada).
3. **Veličina.** Vrijede oba ograničenja: svaki PR najviše oko 400 promijenjenih redaka koda, veći uz obrazloženje u opisu (`CLAUDE.md`); `critical` PR uz to najviše oko 300 redaka produkcijskog koda, veći se dijeli prije reviewa, a iznimku odobrava vlasnik.
4. **Stalan QA kriterij.** QA zadatak koristi isti tekst za sve PR-ove: FAIL samo za kvar koda (pogrešan ishod, gubitak podatka, prolaz kroz zaštitu, kršenje `docs/PRODUCT.md` §5). Jaz u testovima, preživjeli mutant bez dokazanog kvara i nepotpun opis su manji nalazi: bilježe se i idu u naknadni korak. Orkestrator u zadatak ne dopisuje strože kriterije.
5. **Oblik nalaza.** Svaki nalaz reviewa i QA-e ima redak **"Dohvatljivo kroz"**: pozivatelj i ulaz koji on stvarno može proizvesti, ili "nije pokazano". To je oblik izvještaja, ne kriterij; presuda ostaje reviewerova odnosno QA-ina. Uz svaki manji nalaz stoji "blokira" ili "ne blokira". Manji nalaz koji dira samo testove ili dokumentaciju, uz PASS i "ne blokira", ne traži novi push ni novi krug; prati se u zasebnom zadatku. Manji nalaz u produkcijskom kodu zatvara se novim headom prije spajanja.
6. **Najviše dva kruga.** Drugi FAIL reviewa ili QA-e na istom korijenu zaustavlja ispravke: pisac ne pusha treći ispravak, nego se piše novi ugovor (točka 1) ili se PR dijeli (točka 3). Krugovi se broje i po PR-u: treći krug na istom PR-u ide vlasniku s popisom krugova. Dva ispravka zaredom koja uvedu novi nalaz u istom kodu također idu vlasniku.
7. **Nedokazana dostižnost.** Nalaz čiji je redak "Dohvatljivo kroz" "nije pokazano", ili koji traži pozivatelja koji ne postoji, ne ide piscu na ispravak nego vlasniku, s izborom: ispraviti, ili suziti ugovor i zapisati poznatu granicu s uvjetom koji je ponovno otvara (točka 2).

## 15. Gate i spajanje (D-106)

- **Strogo jedan po jedan.** U gateu (review, QA, čekanje spajanja) je u svakom trenutku najviše jedan PR, i kad je to D-97 PR koji čeka vlasnika. Redoslijed određuje orkestrator.
- **Ažurna grana.** PR koji je na redu spaja `main` neposredno prije reviewa (§9). Čisto spajanje `main` koje ne mijenja diff PR-a prenosi review i QA verdikt (D-101); svaka druga promjena traži review i QA na novom headu.
- **Review i QA istodobno.** Za `critical` PR review i QA kreću istodobno na istom headu. QA ne čita review prije vlastitog verdikta. Ako review padne, QA na tom headu ne vrijedi.
- **Nakon spajanja.** Orkestrator čeka CI na `main` prije sljedećeg spajanja, zatim pokreće `pnpm orch:ready` za sljedeći PR u redu i traži spajanje `main` prije nego se na stari head potroše review i QA.
- **Zaštita grane.** Postavke zaštite (uključujući `strict`) mijenja samo vlasnik.

## 16. Skripte: okidač i vlasnik

Svaka skripta ima zapisan okidač (kada se pokreće) i vlasnika (tko ili što je pokreće). PR koji uvodi skriptu uvodi i njezino automatsko pokretanje; skripta bez okidača nije dovršen korak. Okidač za `orch:preflight` je odluka orkestratora da pokrene kanonski review ili QA: projektna vještina orkestratora obvezno poziva `pnpm orch:preflight <pr> --head <puni-sha>` neposredno prije pokretanja i ne pokreće sesiju ako izlaz nije `0`. Vlasnik skripte i njezina okidača je orkestrator. Naredba ne pokreće sesiju. Granice: spajanje i pokretanje QA sesije ne idu automatski, a D-97 PR-ovi i dalje čekaju vlasnikovu naredbu. Provjera ulaza u red za review blokira spajanje tek kad je vlasnik doda među obvezne provjere u zaštiti grane; do tada samo upozorava. U radu je najviše jedan PR alata odjednom.

## 17. Dnevna petlja učenja

1. **Okidač.** Analiza se radi za svaki slučaj u danu u kojem PR uđe u treći krug, QA padne nakon review PASS-a ili `main` pocrveni.
2. **Dva pitanja za svaki slučaj.** Na kojem se najranijem koraku ovo moglo vidjeti? Koje bi polje ili provjera na tom koraku to pokazalo?
3. **Prijedlog je polje ili provjera, ne savjet.** Svaki prijedlog glasi "dodaj polje ovdje" ili "dodaj provjeru ovdje"; vlasnik ga odobri ili odbije. Ništa se ne mijenja bez njegove odluke.
4. **Pitanje unaprijed.** Ako QA padne na nečemu što nije pisalo u retku "Što bi ovaj PR moglo oboriti na QA-i?" (§14, točka 1), to je ulaz za točku 2.
5. **Čišćenje.** Jednom tjedno petlja gleda unatrag: polje ili provjera koja mjesec dana nije ništa uhvatila predlaže se za brisanje.

Dok alata za dnevne podatke nema, dnevni popis na kraju radnog dana piše orkestrator na issueu #87.
