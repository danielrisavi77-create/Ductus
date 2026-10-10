# Ductus: rad u paralelnim sesijama

Verzija 0.3 · 4. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Kako više AI coding sesija radi na Ductusu istodobno, uključujući više Claude i Codex/ChatGPT računa. Vrijedi uz `CLAUDE.md` i `docs/MULTI-ACCOUNT.md`; u sukobu vrijedi `CLAUDE.md`.

## 1. Uloge

| Uloga | Posao | Vlasnik mapa | Model i napor |
| --- | --- | --- | --- |
| **Orkestrator** | Plan, `STATE.md`, dodjela zadataka, dnevnik, Owner queue, praćenje tokena. Ne piše kod. | `STATE.md`, `docs/` (osim ARCHITECTURE kad ga drži druga sesija), `.claude/skills/` i `.agents/skills/` (`ORKESTRATOR.md` §4) | Opus, high |
| **Platforma** | Kostur projekta, CI, `docker compose`, lefthook, skeneri, migracijski alat, kasnije OpenTofu i operacije | korijenske konfiguracije (`package.json`, `tsconfig*`, `eslint*`, `vitest*`, `playwright*`), `.github/`, `compose.yaml`, `lefthook.yml`, `scripts/`, `infra/` | Sonnet, medium |
| **Backend** | Baza, uloge, RLS, pgTAP, RPC-i, evidencija, OIDC i sesije, worker, rekonstrukcija, potpisi | `src/domain/`, `src/application/`, `src/adapters/`, `src/server/`, `db/`, `app/api/`, `tests/` za te mape | Opus, high (evidencija, ovlasti, prijava); Sonnet za rutinu |
| **Frontend** | Editor (Tiptap), journal i sinkronizacija u pregledniku (Dexie), ekrani, hr/en, pristupačnost, zabranjene riječi | `app/` (osim `app/api/`), `src/components/`, `src/editor/`, `src/client/`, `src/lib/i18n/`, `e2e/` | Sonnet, medium; Opus za sinkronizaciju |
| **Kratkotrajna** | Jedan zadatak pa se arhivira: prepis dokumenta, spike, istraživanje | zadano u zadatku | prema zadatku |
| **Product/UX** | Tokovi, copy, dizajn, human UX evaluacija, product issuei; ne implementira vlastiti prijedlog | read-only po defaultu | medium/high |
| **QA** | Adversarial, offline, race, browser, chaos i regression testovi; smije dodavati testove/testne alate samo u zasebnom QA zadatku/branchu | `tests/`; `e2e/` samo po eksplicitnom QA zadatku, dok feature vlasništvo ostaje Frontendu | medium/high |
| **Independent Reviewer** | Neovisni pregled PR-a; ne mijenja pregledanu granu | read-only | prema risku |
| **Bug Hunter** | Pokušava razbiti main/staging i otvara reproducibilne issuee; ne popravlja nalaz | read-only | medium |

Neovisni reviewer može biti Claude, Codex, ChatGPT ili Grok s drugog `runtime:slot` identiteta od autora. Grok je dopušten kao autentificirani review/QA provider preko verificiranog GitHub App sluga `grok-by-xai`. Codex CLI je samo jedan mogući način pregleda (§5), ne jedini gate. Provider ne određuje ovlast; uloga i agent identitet je određuju.

Pravila vlasništva:

- Sesija mijenja samo svoje mape. Ako mora dirati tuđu, staje i javlja orkestratoru; orkestrator dogovara redoslijed.
- `package.json` i lockfile mijenja samo Platforma. Backend i Frontend traže novu ovisnost kroz izvještaj ("treba paket X, zašto"), a Platforma je dodaje u zasebnom malom PR-u. Iznimka: dok Platforma ne postoji, ovisnost dodaje sesija koja prenosi kod, uz napomenu u opisu PR-a.
- `src/domain/` dijele Backend i Frontend (sinkronizacija i dokument). Vlasnik je Backend; Frontend smije mijenjati `src/domain/sync`, `src/domain/document`, `src/domain/diff` i `src/domain/serverSync` uz oznaku u opisu PR-a.
- `e2e/` je feature-vlasništvo Frontenda. QA ga smije mijenjati samo u zasebnom QA zadatku i branchu koji je Orkestrator eksplicitno dodijelio; QA i Frontend nikad ne pišu u isti branch.
- `STATE.md` mijenja samo orkestrator.

Normalno rade tri stalna writera (Backend, Frontend, Platforma). Četvrti je dopušten samo za potpuno neovisan zadatak. WIP limit, risk razine i kontrolne uloge definirani su u `docs/ENGINEERING_SYSTEM.md`.

## 2. Tijek jednog zadatka

1. Orkestrator šalje zadatak (predložak u §3) sesiji odgovarajuće uloge.
2. Sesija radi u svom worktreeu na grani `<uloga>/<kratki-opis>` (npr. `backend/m0-port-domain`), od svježeg `origin/main`.
3. Testovi i provjere lokalno zeleni (`pnpm lint`, `pnpm typecheck`, `pnpm test`); lefthook to radi pri commitu.
4. Sesija otvara PR (jedan korak iz `STATE.md`, do oko 400 redaka; veći PR obrazlaže zašto) i obvezno upisuje `Agent`, `Risk` i `Task` metadata iz `docs/ENGINEERING_SYSTEM.md`.
5. PR dobiva neovisni pregled na aktualnom headu. Za `critical` PR obvezan je i zaseban QA/adversarial PASS. Za deklarirani author guard `codex` i `chatgpt` na istom slotu tretiraju se kao isti OpenAI principal (`openai:<slot>`), jer koriste isti GitHub App. Autor, reviewer i QA moraju biti različite aktivne agent-instance po governance pravilu; gate strojno provjerava da reviewer i QA dolaze iz različitih autentificiranih GitHub Appova. Autor ispravlja prihvaćene nalaze, a odbijene obrazlaže.
6. Sesija zapisuje izvještaj u PR (predložak u §3) i staje. Claude sesija na istom računu uz to šalje orkestratoru jednu poruku po `docs/ORKESTRATOR.md` §5; rad s drugog računa ili providera o poruci ne ovisi.
7. Spaja samo aktivni Ductus orkestrator, kad su CI, Engineering review gate i svi risk-specifični gateovi zeleni te PR ne čeka Danielovu odluku. Radne sesije nikad ne spajaju PR, ne mijenjaju `.claude/` postavke i ne diraju postavke repoa na GitHubu.
8. Orkestrator ažurira `STATE.md` i dnevnik, šalje sljedeći zadatak ili arhivira sesiju koju sam može arhivirati (podagent ili CLI posao; arhiviranje briše worktree). Sesije u oblaku i desktop aplikaciji arhivira Daniel (`docs/ORKESTRATOR.md` §4 i §8).

Kad sesija zapne na odluci (PRIJEDLOG, nejasan zahtjev, tuđa mapa), ne nagađa: šalje izvještaj sa statusom "blokirano" i staje.

### 2a. Kad poruka ne stigne

Izvještaj u opisu PR-a je izvor istine; poruka je samo obavijest. Ništa u tijeku ne smije čekati na poruku.

1. **Sesija:** ako slanje vrati "nije dostavljeno", pokuša još jednom. Ako ni tad ne prođe, doda PR-u oznaku `izvjestaj-ceka` (oznaku jednom stvara Daniel; dok ne postoji, umjesto nje komentar na PR-u "IZVJEŠTAJ čeka orkestratora") i staje. Ne ponavlja u petlji i ne čeka odgovor.
   **Kad PR ne postoji** (status "blokirano" prije PR-a ili "gotovo bez PR-a"), sesija nakon neuspjelog ponovnog pokušaja otvara GitHub issue s naslovom `IZVJEŠTAJ <id>`, izvještajem u tijelu i istom oznakom (ili bez nje dok ne postoji), i staje.
2. **Orkestrator ne ovisi o porukama:** na početku svakog poteza pregleda otvorene PR-ove (`gh pr list --label izvjestaj-ceka` i PR-ove svih dodijeljenih zadataka) i otvorene issuee s naslovom `IZVJEŠTAJ` (`gh issue list --search "IZVJEŠTAJ in:title"`), obrađuje izvještaje i zatvara obrađene issuee.
3. **Stanje sesija:** popis sesija vrijedi samo za runtime/račun koji ga može vidjeti. `notify_when_idle` ne radi za sesije desktop aplikacije (provjereno 3. 10. 2026.), pa orkestrator može pogledati lokalno vidljive sesije, ali stanje drugih računa zaključuje samo iz GitHub issuea/PR-ova i njihovih izvještaja.
4. **Jedan orkestrator:** aktivan je samo jedan orkestrator. Session ime/ID u `STATE.md` može ostati pomoćna adresa za isti račun, ali nije cross-account identitet. Za drugi račun vrijedi GitHub zadatak/PR; ako session adresa nije dostupna, ništa ne smije stati zbog toga.
5. **Sesija koja šuti:** ako sesija ne otvori PR u očekivanom vremenu, orkestrator prvo provjeri GitHub. Za sesiju na istom računu može dodatno pogledati runtime stanje i pitati je jednom. Sesiju drugog računa ne smatra završenom ili zaglavljenom samo zato što je nema na lokalnom popisu sesija.

## 3. Predlošci

### Zadatak (orkestrator → sesija)

```
ZADATAK <id> · uloga: <uloga> · korak iz STATE.md: <naziv>
Orkestrator: <ime; session ref je opcionalan>
Runtime slot: <claude:a | codex:b | chatgpt:c | auto>
Cilj: <jedna rečenica>
Ulaz: <dokumenti i odjeljci koje treba pročitati, ništa više>
Opseg: <što ulazi>; Izvan opsega: <što ne ulazi>
Mape: <smije dirati>
Gotovo kad: <provjerljiv kriterij, npr. naredba i očekivani ishod>
Lokalne provjere prije pusha: <npr. actionlint i zizmor kad PR dira workflowe, osv-scanner kad dira lockfile; inače "standardne">
Ovisi o: <PR ili ništa>
```

### Izvještaj (sesija → orkestrator)

```
IZVJEŠTAJ <id> · status: PR otvoren | blokirano | gotovo bez PR-a
PR: <poveznica>
Agent: <runtime>:<slot>:<uloga>
Napravljeno: <3 do 5 stavki>
Testovi: <naredba i rezultat>
Review: <reviewer, head, nalaz/PASS; odbijeni nalazi uz razlog>
QA: <za critical: QA head + scope + PASS; inače n/a>
Otvoreno ili blokira: <stavke ili "ništa">
Treba Daniel: <odluka ili "ništa">
```

Izvještaj obvezno ide u opis PR-a ili, bez PR-a, u `IZVJEŠTAJ <id>` issue. Poruka orkestratoru šalje se po `docs/ORKESTRATOR.md` §5 kad su sesije na istom računu; ona je upućivanje na izvještaj, a cross-account rad nikad ne ovisi o njoj.

## 4. Štednja tokena

- **Rotacija sesije.** Svaki potez ponovno šalje cijeli kontekst sesije, pa je duga sesija skupa i kad radi malo. Uloga (Platforma, Backend, Frontend) nastavlja u istoj sesiji dok joj kontekst ne prijeđe oko 150.000 tokena; tada zapiše predaju u izvještaj, orkestrator je arhivira (sesiju u oblaku ili desktop aplikaciji arhivira Daniel) i otvara se svježa sesija iste uloge. Kratkotrajna sesija se arhivira čim joj je PR spojen. Iznimka je orkestrator: njegova sesija se ne zamjenjuje, nego osvježava sažimanjem po `docs/ORKESTRATOR.md` §7.
- **Lanci zadataka.** Kad je redoslijed jasan, sesija dobiva više zadataka odjednom (svaki svoj PR), pa treba manje poruka i manje ponovnog čitanja uputa.
- **Čitaj samo ulaz iz zadatka.** `CLAUDE.md` traži `STATE.md`; ostale dokumente samo odjeljke navedene u zadatku.
- **Pretraživanje preko pomoćnog agenta** (Explore) kad treba pregledati mnogo datoteka; u glavni razgovor vraća se zaključak, ne sadržaj.
- **Testovi kroz naredbe s kratkim izlazom** (npr. `vitest run --reporter=dot`); puni izlaz samo za test koji pada.
- **Bez nepotrebnih pluginova i konektora** u ovom projektu (`.claude/settings.local.json`, §7).
- **Model po ulozi** iz tablice u §1. Opus samo gdje je pogreška skupa.
- **Predaja posla kroz `STATE.md` i opis PR-a**, ne kroz prepričavanje u razgovoru.
- **Neovisni reviewer pregledava samo diff PR-a i relevantna kanonska pravila**, ne cijeli repo bez razloga.

### 4a. Tehnička provedba (DAN-93)

Pravila iz ovog odjeljka provodi `.claude/settings.json`; vlastiti hookovi su u `scripts/engineering/agent-hooks.mjs` i pri svakoj grešci propuštaju rad (fail-open). Iznimka je `cc-safety-net`, koji pri grešci vlastite analize blokira naredbu.

| Mehanizam | Što radi | Pravilo koje provodi |
| --- | --- | --- |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` | Sažimanje se pokreće prije 200k tokena i uz model s prozorom od 1M. | Gornja granica konteksta |
| Hook `budget` (UserPromptSubmit) | Iznad 150k tokena dodaje agentu uputu prema ulozi sesije (tablica ispod); iznad 250k uputa je stroža (doseže se samo u sesiji u kojoj granica od 200k ne vrijedi, primjerice pokrenutoj prije ove postavke). Novi zadatak zabranjuje samo prepoznatom workeru i kontrolnoj ulozi, nikad orkestratoru ni sesiji nepoznate uloge. Orkestratoru od 200k dodaje da je dosegnuta gornja sigurnosna granica iz `ORKESTRATOR.md` §7. Ispod 150k i odmah nakon sažimanja ne dodaje ništa. Zapis sesije čija je stvarna putanja pod `Read` deny pravilima ne otvara; čita ga kroz provjereni deskriptor (opis ispod tablice). | Rotacija sesije; iznimka za orkestratora (`ORKESTRATOR.md` §7) |
| Hook `read` (PreToolUse: Read) | Odbija čitanje cijelog `.md` dokumenta većeg od 16 KB i vraća popis naslova s brojevima redaka; čitanje s `offset`/`limit` prolazi. Odbija `pnpm-lock.yaml`, `*.tsbuildinfo` i `.next/`. Vrijedi samo za datoteke unutar repoa, i u subagentima. Putanje pod `Read` deny pravilima (`secrets/`, `.env*`, `*.age`) hook ne otvara i ne odlučuje o njima: odluka ostaje sustavu dozvola, pa im ni naslovi ne dospijevaju u kontekst. Mjerodavna je stvarna putanja nakon razrješenja poveznica, gledana od korijena projekta: poveznicu u repou koja vodi na takvu datoteku ili izvan repoa hook također ne otvara, a repo smješten ispod mape imena `secrets/` radi normalno. Sadržaj čita kroz provjereni deskriptor (opis ispod tablice). Ne pokriva čitanje kroz `cat` ili `sed` u ljusci. | Čitaj samo ulaz iz zadatka |
| Hook `start` (SessionStart) | Učitava `STATE.md` iz korijena projekta u kontekst pri pokretanju, `/clear` i nakon sažimanja, uz putanju iz koje je pročitan, pa ga sesija ne čita zasebnim pozivom. Ako `STATE.md` prijeđe 9000 znakova, hook ne dodaje ništa i sesija ga čita sama. Isto vrijedi ako `STATE.md` nije obična datoteka u korijenu projekta, primjerice ako je simbolička poveznica na bilo koju drugu datoteku: hook je tada ne čita. Čita kroz provjereni deskriptor (opis ispod tablice). | `CLAUDE.md`: prvo `STATE.md` |
| `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` | Subagent bez vlastitog modela radi na Sonnetu. Profili s `model: inherit` i dalje nasljeđuju model sesije (Claude Code 2.1.251 ili noviji; starije inačice daju prednost varijabli). | Model po ulozi |
| `ductus-scout` (Haiku, samo Read/Grep/Glob) | Jeftino lociranje koda i odjeljaka; ugrađeni Explore radi na modelu glavne sesije. | Pretraživanje preko pomoćnog agenta |
| `CLAUDE_CODE_GLOB_NO_IGNORE=false` | Glob preskače sve iz `.gitignore`: `node_modules`, `.next`, worktreeove, ali i `test-results/` i `playwright-report/`; njih se nalazi kroz `ls`. | — |
| `enabledPlugins: false` za `knowledge-work-plugins` | Isključuje sales, marketing, finance, data, design, productivity i pdf-viewer u ovom projektu. | Bez nepotrebnih pluginova |
| Hook `cc-safety-net` (PreToolUse: Bash, PowerShell) | Projektna pravila (`.cc-safety-net/rules/ductus-rules/rulebook.json`): `git add -A`/`.`/`-u`, `git stage -A`, `git commit -a`, `--no-verify` na commitu i pushu, i kad su umotani u `bash -c`. Ugrađena pravila: force push, `git branch -D`, `git stash drop`, `git worktree remove --force`, `find -delete`, `rm -rf` izvan radnog direktorija i svaka naredba koja imenuje `.env*` datoteku osim `.env.example` (i `cp .env.example .env.local`; to radi Daniel). `git restore`, `git checkout -- <datoteka>`, `git clean` i `git reset --hard` bez reference dopušteni su samo u povezanom worktreeu (`CC_SAFETY_NET_WORKTREE=1`); `git reset --hard <ref>` je blokiran svugdje. Hook nema korisničko odobrenje: blokiranu naredbu izvršava Daniel ručno. | `CLAUDE.md`: tvrda pravila |
| `skillOverrides`: `supabase-postgres-best-practices` = `name-only` | Opis skilla ne ulazi u popis; Backend i Security profili ga učitavaju po potrebi. | Bez nepotrebnog konteksta |

Pravila hvataju uobičajene oblike, ne sve: `git add *` u PowerShellu, `git -c core.hooksPath=... commit` i `LEFTHOOK=0 git commit` prolaze, pa `deny` pravila, lefthook i CI ostaju obvezni. Lažno blokira `git -C . add <datoteka>` i commit poruku koja je točno `-a` ili `-am`; takvu poruku treba dati kroz `-F`. Slučajeve iz rulebooka izvršava `scripts/engineering/safety-rules.test.mjs` kroz stvarni hook, za Bash i PowerShell.

Provjereni deskriptor. Nijedan hook ne čita datoteku po imenu nakon provjere putanje, jer bi se ime tada razriješilo drugi put i zamjena datoteke ili mape poveznicom u međuvremenu odvela bi čitanje drugamo. Hook datoteku otvara jednom (uz `O_NOFOLLOW` gdje postoji), a zatim na otvorenom deskriptoru provjerava da je obična datoteka, da se provjerena putanja i dalje razrješava u samu sebe i da je datoteka na toj putanji upravo ona otvorena (isti uređaj i inode). Na Linuxu dodatno uspoređuje putanju koju jezgra vodi za deskriptor (`/proc/self/fd`), što vrijedi bez obzira na to kako se imena mijenjaju tijekom provjere. Čita samo iz tog deskriptora; ako se išta razlikuje, ne vraća ništa i odlučuje sustav dozvola.

Ograničenja provjerenog deskriptora: na Windowsu nema putanje deskriptora, pa ostaju samo provjere po imenu; zamjena koja je na mjestu točno pri otvaranju i pri usporedbi inodea, a uklonjena točno pri razrješenju putanje, ondje se ne može otkriti. Tvrdu poveznicu (hard link) na zaštićenu datoteku hook ne prepoznaje ni na jednoj platformi. Datotečni sustav koji ne daje inode hook tretira kao neprovjerljiv i ne čita ništa.

Hook `budget` po ulozi. Ulogu određuje profil agenta s kojim je sesija pokrenuta (`.claude/agents/`); Claude Code ga hooku predaje u polju `agent_type` (provjereno na inačici 2.1.296).

| Uloga sesije | Profil | Što hook kaže iznad 150k | Gdje je predaja (`ductus-handoff`) |
| --- | --- | --- | --- |
| Orkestrator | `ductus-orchestrator` | Samo podsjetnik: sesija je trajna i ne rotira se, smije uzeti novi posao; na kraju sklopa predaja pa sažimanje. Od 200k dodaje da je dosegnuta gornja sigurnosna granica i da treba sažeti prije sljedećeg sklopa. | Ploča i komentar na koordinacijskom issueu (`ORKESTRATOR.md` §7 i §8) |
| Worker | `ductus-backend-data`, `ductus-frontend-editor`, `ductus-platform-sre` | Dovrši korak, predaj, zatraži rotaciju; bez novog zadatka. | IZVJEŠTAJ u tijelu vlastitog PR-a ili vlastiti issue |
| Kontrolna uloga (Reviewer, QA, Bug Hunter, Product/UX, auditi) | ostali profili osim `ductus-scout` | Isto kao worker. | Vlastiti komentar na PR-u ili issueu koji provjerava; nikad tuđe tijelo PR-a |
| Nepoznata | sesija bez profila ili s profilom izvan popisa | Ništa ne zabranjuje. Navodi iznimku za orkestratora, a ostalim ulogama savjetuje predaju i rotaciju. | Prema ulozi, po skillu |

Ograničenja: sesija pokrenuta bez profila (samo skillom ili običnim razgovorom), starija inačica Claude Codea bez polja `agent_type` i svaki drugi runtime nemaju prepoznatljivu ulogu. Tada je poruka namjerno blaga, jer bi zabrana pogodila i orkestratora; worker bez profila zato dobiva savjet, a ne nalog. Orkestrator vlastiti podsjetnik dobiva samo kad je sesija pokrenuta s profilom `ductus-orchestrator`; bez profila dobiva blagu poruku za nepoznatu ulogu. Hook ne provjerava identitet: profil je postavka sesije, a ne dokaz ovlasti, i o gateu ništa ne odlučuje. Novi profil mora dobiti ulogu u `PROFILE_ROLES`; test pada dok je nema.

Mjerenje: `pnpm tokens:report` ili `node scripts/engineering/token-report.mjs [--days N] [--budget N] [--json]` čita lokalne zapise sesija i ispisuje samo brojeve: ukupni ulaz, udio početnog konteksta, udio iznad budžeta i veličinu izlaza po alatu. `pnpm tokens:codeburn` daje drugi pogled (nekorišteni MCP poslužitelji, ponovljena čitanja), a `pnpm agents:lint` provjerava `CLAUDE.md`, `AGENTS.md`, skillove i hookove. Polazno stanje 1.–10. 10. 2026.: 198,7 M ulaznih tokena u 829 poziva; 42 % je kontekst iznad 150k po pozivu, 30 % početni kontekst od oko 72k ponovljen u svakom pozivu.

Konektori claude.ai (Gmail, Drive, Netlify, Gamma, Desktop Commander i slični) u desktop aplikaciji uključuju se po sesiji i ne gase se ovom datotekom; Daniel ih isključuje u postavkama konektora. Za Ductus trebaju samo Linear i, po zadatku, Supabase.

## 5. Neovisni pregled

Codex CLI je zadani automatizirani reviewer kad je dostupan, ali nije jedini dopušteni reviewer. Za lokalni Codex review može se pokrenuti:

```
powershell -File scripts/codex-review.ps1 -Level <light|standard|critical>
```

Razinu zadaje orkestrator u zadatku; kad je ne zada, sesija bira po tablici (Daniel, 3. 10. 2026.):

| Razina | Codex model, effort | Zadaci |
| --- | --- | --- |
| `light` | GPT-6-Luna, medium | dokumenti, CI i konfiguracija, paketi, preimenovanja |
| `standard` | GPT-6-Sol, high | doslovni prijenos s testovima, portovi i adapteri, ekrani i tokovi sučelja, migracije bez novih ovlasti |
| `critical` | GPT-6-Astra, xhigh | evidencija, potpis i kriptografija, prijava i sesije, RLS i pgTAP matrica, predaja i rekonstrukcija, sve što dira `PRODUCT.md` §5 |

Claude worker sesije trenutačno su na Opusu; effort orkestrator postavlja po zadatku: `light` → low, `standard` → medium, `critical` → high. Codex worker koristi model/effort koji orkestrator eksplicitno zada ili računov zadani coding model.

Codex radi i desetak minuta, pa se skripta pokreće u pozadini s vremenskim ograničenjem od najmanje 20 minuta; inače se prekine prije objave komentara. Skripta pokreće `codex exec review --base origin/main` (samo diff grane); `AGENTS.md` prepoznaje review način, a nalaz ide kao komentar na PR. Codex troši ChatGPT kvotu, ne Claude kvotu. Autor ispravlja prihvaćene nalaze i u izvještaju navodi odbijene s razlogom. Kritičan nalaz koji autor ne može riješiti znači status "blokirano".

## 6. Dizajn

1. Prije koda: dizajnerski sustav i ključni ekrani demoa kao Design artifact; Daniel ih komentira i odobrava. Frontend gradi samo po odobrenom.
2. Svaki frontend PR prilaže snimke zaslona iz Playwrighta (širok i mobilni prikaz, hr i en).
3. Na zahtjev: lokalno pokretanje i pregled u pregledniku unutar aplikacije. Javni preview tek nakon D-08.

## 7. Okruženje i održavanje

- **Lokalne postavke** (`.claude/settings.local.json`, nije u gitu, kopira se u svaki worktree preko `.worktreeinclude`): isključeni claude.ai pluginovi, skillovi i konektori koji ne trebaju Ductusu; poruke između sesija primaju se bez dodatnog odobrenja. Datoteku stvara Daniel (agent ne mijenja vlastite postavke):

  ```json
  {
    "syncClaudeAiPlugins": false,
    "syncClaudeAiSkills": false,
    "disableClaudeAiConnectors": true,
    "crossSessionInbound": "accept"
  }
  ```
- **Worktreeovi**: Claude aplikacija može ih stvarati u `.claude/worktrees/`. Za ručni Claude/Codex worker postoji `scripts/new-agent-worktree.ps1`, koji ne kopira `.env.local` ni vjerodajnice. Dva writera nikad ne koriste isti working directory. `scripts/cleanup-worktrees.ps1` uklanja preostale worktreeove čija je grana spojena u `main`.
- **Automatika u Claude Code sesijama** (`hooks` u `.claude/settings.json`; vrijedi za svaku Claude sesiju u projektu, ne za Codex):
  - na početku sesije u pozadini se pokreće `scripts/cleanup-worktrees.ps1`: uklanja worktreeove i lokalne grane čiji je PR spojen ili zatvoren; worktree s nespremljenim izmjenama se preskače;
  - prije `gh pr create` i `gh pr edit` `scripts/hooks/pr-metadata-precheck.mjs` provjerava `Agent`, `Risk` i `Task` u opisu PR-a istim pravilima kao CI (`scripts/engineering/pr-metadata-core.mjs`) i blokira naredbu ako ne prolaze.
  - nakon `gh pr create` `scripts/hooks/pr-auto-merge.mjs` za PR s `Risk: low` uključuje GitHub auto-merge (squash). GitHub spaja tek kad su zelene sve obvezne provjere na `main`, uključujući `Engineering review gate`, pa neovisni review ili Owner Override i dalje trebaju. PR-ove `standard` i `critical` spaja orkestrator.
- **Paketi**: pnpm (zajednička pohrana paketa, manje mjesta na disku po worktreeu). Node 24 (`.nvmrc`).
- **Praćenje**: orkestrator vodi nadzornu ploču "Ductus pult" (privatni artifact, https://claude.ai/artifact/UY9VUZPW4mePTZjhCPGLSd) s vremenskom crtom, stanjem sesija i potrošnjom tokena. Potrošnju po sesiji daje `powershell -File scripts/usage-report.ps1` (ccusage nad lokalnim zapisima; trošak je procjena po API cijenama, ne naplata pretplate).
