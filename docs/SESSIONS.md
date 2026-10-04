# Ductus: rad u paralelnim sesijama

Verzija 0.3 · 4. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Kako više AI coding sesija radi na Ductusu istodobno, uključujući više Claude i Codex/ChatGPT računa. Vrijedi uz `CLAUDE.md` i `docs/MULTI-ACCOUNT.md`; u sukobu vrijedi `CLAUDE.md`.

## 1. Uloge

| Uloga | Posao | Vlasnik mapa | Model i napor |
| --- | --- | --- | --- |
| **Orkestrator** | Plan, `STATE.md`, dodjela zadataka, dnevnik, Owner queue, praćenje tokena. Ne piše kod. | `STATE.md`, `docs/` (osim ARCHITECTURE kad ga drži druga sesija) | Opus, high |
| **Platforma** | Kostur projekta, CI, `docker compose`, lefthook, skeneri, migracijski alat, kasnije OpenTofu i operacije | korijenske konfiguracije (`package.json`, `tsconfig*`, `eslint*`, `vitest*`, `playwright*`), `.github/`, `compose.yaml`, `lefthook.yml`, `scripts/`, `infra/` | Sonnet, medium |
| **Backend** | Baza, uloge, RLS, pgTAP, RPC-i, evidencija, OIDC i sesije, worker, rekonstrukcija, potpisi | `src/domain/`, `src/application/`, `src/adapters/`, `src/server/`, `db/`, `app/api/`, `tests/` za te mape | Opus, high (evidencija, ovlasti, prijava); Sonnet za rutinu |
| **Frontend** | Editor (Tiptap), journal i sinkronizacija u pregledniku (Dexie), ekrani, hr/en, pristupačnost, zabranjene riječi | `app/` (osim `app/api/`), `src/components/`, `src/editor/`, `src/client/`, `src/lib/i18n/`, `e2e/` | Sonnet, medium; Opus za sinkronizaciju |
| **Kratkotrajna** | Jedan zadatak pa se arhivira: prepis dokumenta, spike, istraživanje | zadano u zadatku | prema zadatku |

Codex je zadano neovisni recenzent PR-a (§5), ali može biti worker kad zadatak izričito zada `worker` način. U tom slučaju vrijede ista vlasništva mapa i isti PR protokol kao za Claude worker; vlastiti PR ne smije sam proglasiti neovisno pregledanim.

Pravila vlasništva:

- Sesija mijenja samo svoje mape. Ako mora dirati tuđu, staje i javlja orkestratoru; orkestrator dogovara redoslijed.
- `package.json` i lockfile mijenja samo Platforma. Backend i Frontend traže novu ovisnost kroz izvještaj ("treba paket X, zašto"), a Platforma je dodaje u zasebnom malom PR-u. Iznimka: dok Platforma ne postoji, ovisnost dodaje sesija koja prenosi kod, uz napomenu u opisu PR-a.
- `src/domain/` dijele Backend i Frontend (sinkronizacija i dokument). Vlasnik je Backend; Frontend smije mijenjati `src/domain/sync`, `src/domain/document`, `src/domain/diff` i `src/domain/serverSync` uz oznaku u opisu PR-a.
- `STATE.md` mijenja samo orkestrator.

Normalno rade tri stalna writera (Backend, Frontend, Platforma). Četvrti je dopušten samo za potpuno neovisan zadatak. WIP limit, risk razine i kontrolne uloge definirani su u `docs/ENGINEERING_SYSTEM.md`.

## 2. Tijek jednog zadatka

1. Orkestrator šalje zadatak (predložak u §3) sesiji odgovarajuće uloge.
2. Sesija radi u svom worktreeu na grani `<uloga>/<kratki-opis>` (npr. `backend/m0-port-domain`), od svježeg `origin/main`.
3. Testovi i provjere lokalno zeleni (`pnpm lint`, `pnpm typecheck`, `pnpm test`); lefthook to radi pri commitu.
4. Sesija otvara PR (jedan korak iz `STATE.md`, do oko 400 redaka; veći PR obrazlaže zašto) i obvezno upisuje `Agent`, `Risk` i `Task` metadata iz `docs/ENGINEERING_SYSTEM.md`.
5. PR dobiva neovisni pregled na aktualnom headu. Za `critical` PR obvezan je i zaseban QA/adversarial PASS. Autor i reviewer/QA moraju biti različite aktivne agent-instance; drugi provider se preferira za kritične trust granice. Autor ispravlja prihvaćene nalaze, a odbijene obrazlaže.
6. Sesija zapisuje izvještaj u PR (predložak u §3) i staje. Direktna poruka orkestratoru je dodatna obavijest samo kad su obje sesije mogu međusobno komunicirati.
7. Spaja samo aktivni Ductus orkestrator, kad su CI, Engineering review gate i svi risk-specifični gateovi zeleni te PR ne čeka Danielovu odluku. Radne sesije nikad ne spajaju PR, ne mijenjaju `.claude/` postavke i ne diraju postavke repoa na GitHubu.
8. Orkestrator ažurira `STATE.md` i dnevnik, šalje sljedeći zadatak ili arhivira sesiju (arhiviranje briše worktree).

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
Runtime slot: <claude:a | codex:b | auto>
Cilj: <jedna rečenica>
Ulaz: <dokumenti i odjeljci koje treba pročitati, ništa više>
Opseg: <što ulazi>; Izvan opsega: <što ne ulazi>
Mape: <smije dirati>
Gotovo kad: <provjerljiv kriterij, npr. naredba i očekivani ishod>
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

Izvještaj obvezno ide u opis PR-a ili, bez PR-a, u `IZVJEŠTAJ <id>` issue. Direktna poruka orkestratoru je opcionalna optimizacija za sesije koje se međusobno vide; cross-account rad nikad ne ovisi o njoj.

## 4. Štednja tokena

- **Rotacija sesije.** Svaki potez ponovno šalje cijeli kontekst sesije, pa je duga sesija skupa i kad radi malo. Uloga (Platforma, Backend, Frontend) nastavlja u istoj sesiji dok joj kontekst ne prijeđe oko 150.000 tokena; tada zapiše predaju u izvještaj, orkestrator je arhivira i otvara se svježa sesija iste uloge. Kratkotrajna sesija se arhivira čim joj je PR spojen. Orkestrator rotira po `docs/ORKESTRATOR.md` §7.
- **Lanci zadataka.** Kad je redoslijed jasan, sesija dobiva više zadataka odjednom (svaki svoj PR), pa treba manje poruka i manje ponovnog čitanja uputa.
- **Čitaj samo ulaz iz zadatka.** `CLAUDE.md` traži `STATE.md`; ostale dokumente samo odjeljke navedene u zadatku.
- **Pretraživanje preko pomoćnog agenta** (Explore) kad treba pregledati mnogo datoteka; u glavni razgovor vraća se zaključak, ne sadržaj.
- **Testovi kroz naredbe s kratkim izlazom** (npr. `vitest run --reporter=dot`); puni izlaz samo za test koji pada.
- **Bez nepotrebnih pluginova i konektora** u ovom projektu (`.claude/settings.local.json`, §7).
- **Model po ulozi** iz tablice u §1. Opus samo gdje je pogreška skupa.
- **Predaja posla kroz `STATE.md` i opis PR-a**, ne kroz prepričavanje u razgovoru.
- **Codex pregledava samo diff PR-a**, ne cijeli repo.

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
- **Paketi**: pnpm (zajednička pohrana paketa, manje mjesta na disku po worktreeu). Node 24 (`.nvmrc`).
- **Praćenje**: orkestrator vodi nadzornu ploču "Ductus pult" (privatni artifact, https://claude.ai/artifact/UY9VUZPW4mePTZjhCPGLSd) s vremenskom crtom, stanjem sesija i potrošnjom tokena. Potrošnju po sesiji daje `powershell -File scripts/usage-report.ps1` (ccusage nad lokalnim zapisima; trošak je procjena po API cijenama, ne naplata pretplate).
