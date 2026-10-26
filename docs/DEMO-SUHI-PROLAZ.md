# Suhi prolaz demoa

Tehnički postupak suhog prolaza demoa na `main` (DAN-348, dio DAN-38). Probni prolaz je 26. 10. 2026., radni 29. 10. (PLAN-DEMO §7 t. 3). Proba 31. 10. i snimka za sastanak (D-3, D-4) ostaju vlasnikove i nisu dio ovog postupka.

Samo izmišljeni podaci i lažni OIDC pružatelj s oznakom "Demo prijava", lokalno (D-09). Prolaz se izvodi na čistom `main`, bez lokalnih izmjena.

## 1. Priprema

Jednom na stroju: Node.js 24 i pnpm 10.33.0, za Docker put još i Docker Desktop (`docs/DEMO-UP.md`).

```powershell
git fetch origin main
git switch --detach origin/main
git status --porcelain            # mora biti prazno
pnpm install --frozen-lockfile
pnpm --dir infra/fake-oidc install --frozen-lockfile
pnpm exec playwright install chromium   # preglednik za spec; jednom po verziji Playwrighta
$sha = git rev-parse HEAD
$dir = "$env:USERPROFILE\Ductus-prolazi\$(Get-Date -Format yyyy-MM-dd)-$($sha.Substring(0,8))"
New-Item -ItemType Directory -Force $dir | Out-Null
"$sha`n$(git status --porcelain)" | Out-File -Encoding utf8 "$dir\SHA.txt"
```

`$dir` je mapa prolaza izvan repoa (§3). Zapisi oba prozora idu ravno u nju, pa radna kopija ostaje čista. U drugom prozoru `$dir` treba postaviti istom naredbom.

Prolaz kreće od praznih podataka. Stare podatke ne briši nego ih odmakni sa strane, da se prethodni prolaz može pregledati:

- nativni runner: zaustavi ga (`pnpm demo:up:native --stop`) pa preimenuj `%LOCALAPPDATA%\Ductus\native-data` u `native-data.<datum>-<vrijeme>`;
- Docker: `docker compose down -v` briše volumene lokalnog stoga.

Obriši i izlaze prethodnog pokretanja u repou: `test-results-login\` i `playwright-report-login\`.

Port 3000 mora biti slobodan. Ako ga drži tuđi proces (npr. E2E druge sesije), pričekaj; ne gasi ga.

## 2. Pokretanje

**Windows bez Dockera (nativni runner).** U prvom prozoru:

```powershell
pnpm demo:up:native *> "$dir\runner.log"
```

Kad zapis pokaže `Ready`, u drugom prozoru:

```powershell
$env:CI = "1"                 # video cijelog prolaza, ne samo pada
$env:E2E_REUSE_SERVER = "1"   # koristi aplikaciju koju je pokrenuo runner
$env:E2E_DEMO_NATIVE = "1"    # nastavnik se potvrđuje kroz nativnu bazu
pnpm exec playwright test --config playwright.login.config.ts e2e/login/demo-flow.spec.ts --timeout 300000 *> "$dir\flow.log"
```

**Docker.** `pnpm demo:prepare`, pa ista naredba za spec, ali bez `E2E_REUSE_SERVER` i `E2E_DEMO_NATIVE`: konfiguracija sama pokreće `pnpm dev`, a `AUTH_DATABASE_URL` mora biti postavljen (`.env.example`). Tako prolaz izvodi i posao Login E2E u CI-ju, čiji se video za isti SHA čuva uz nativni (§3).

Zašto te vrijednosti:

- `CI=1` u `playwright.login.config.ts` mijenja samo dvije stvari: video se čuva za cijeli prolaz (inače samo uz pad) i ispis testa ostaje zadani. Ništa drugo u tom prolazu ne čita `CI`.
- `--timeout 300000`: `next dev` prevodi svaku rutu pri prvom zahtjevu. Na Windowsima to u prvom prolazu nakon pokretanja troši više od zadanih 90 s za cijeli test, pa prolaz pada na prevođenju, ne na proizvodu (probni prolaz 26. 10.).

Na kraju Ctrl+C u prvom prozoru, ili `pnpm demo:up:native --stop`.

## 3. Što se čuva i gdje

CI artefakti istječu, pa se svaki prolaz čuva izvan repoa i izvan CI-ja, u mapi `%USERPROFILE%\Ductus-prolazi\<datum>-<prvih 8 znakova SHA>\`:

| Datoteka | Izvor |
|---|---|
| `SHA.txt` | `git rev-parse HEAD` i izlaz `git status --porcelain` (prazan), zapisani u §1 prije pokretanja |
| `prolaz.webm` | `test-results-login\demo-flow-demo-walk-through-login-chromium\video.webm` |
| `izvjestaj\` | cijela mapa `playwright-report-login\` (snimke zaslona svakog koraka, prikaz: `pnpm exec playwright show-report <mapa>`) |
| `trace.zip` | iz iste mape kao video, ako postoji (postoji samo uz pad) |
| `runner.log`, `flow.log` | zapisi oba prozora, pisani izravno u mapu (§2) |
| `ZAPIS.md` | ispunjen predložak iz §4 |
| `izvjestaj-ci\`, `prolaz-ci.webm` | izvještaj posla Login E2E za isti SHA na `main` (`gh run download <run> -n playwright-report-login-<n>`); video `demo walk-through` je u `data\` |

```powershell
$res = "test-results-login\demo-flow-demo-walk-through-login-chromium"
Copy-Item "$res\video.webm" "$dir\prolaz.webm"
if (Test-Path "$res\trace.zip") { Copy-Item "$res\trace.zip" $dir }
Copy-Item -Recurse playwright-report-login "$dir\izvjestaj"
git status --porcelain            # i nakon prolaza mora biti prazno
```

`test-results-login\` i `playwright-report-login\` su u `.gitignore`. Ako `git status --porcelain` nakon prolaza nije prazan, to se upisuje u zapis.

Trajna kopija: `ZAPIS.md` i `prolaz.webm` prilažu se na Linear DAN-38 (ili zadatak suhog prolaza). Sadrže samo izmišljene podatke. Na GitHub ide samo sažetak ishoda (komentar na #87), bez videa.

## 4. Predložak zapisa

```markdown
# Suhi prolaz demoa <datum>

- SHA: <puni SHA na main>, radna kopija čista: da/ne
- Put: nativni runner (Windows, bez Dockera) / Docker
- Podaci: prazni na početku: da/ne
- Izveo: <slot ili osoba>
- `demo-flow.spec.ts`: prošao / pao u koraku "<naziv koraka>" (<trajanje>)

| Točka (PLAN-DEMO §1) | Ishod | Dokaz | Nedostatak |
|---|---|---|---|
| 1. kolegij i zadatak s obaviješću | radi / zapne / nije pokriveno | snimka, vrijeme u videu | #issue ili opis |
| 2. editor, naslovi, citat, bibliografija, stvarna stanja, bez mreže i povratak | | | |
| 3. nastavnik vidi spremljeno stanje i komentira odlomak | | | |
| 4. predaja, rekonstrukcija, potpisana potvrda | | | |
| 5. isti sažetak, bez zabranjenih izraza i postotaka | | | |
| 6. brz put nastavnika | | | |
| 7. čl. 8 na prvom ekranu zadatka | | | |
| 8. dvije izmišljene povijesti | | | |

**Ishod: GO / PARTIAL / NO-GO**

- GO: točke 1 do 5 rade u istom prolazu, spec prolazi, video postoji.
- PARTIAL: točke 1 do 5 rade, ali neka od 6 do 8 zapne, ili spec pada samo na koraku koji je imenovan nedostatak okoline (ne proizvoda).
- NO-GO: bilo koja točka 1 do 5 zapne.

Imenovani nedostaci (svaki s issueom i nositeljem):
1. ...

Što ne pokriva automatski prolaz (točke 6 do 8 prolaze se ručno, snimkom zaslona):
```

Točke 6 do 8 nisu u `demo-flow.spec.ts` i nisu u izlaznom kriteriju (PLAN-DEMO §1); u zapisu se prolaze ručno i dokazuju snimkom.

## 5. Poznate granice

- Na Windowsima s nativnim runnerom `demo-flow.spec.ts` staje u koraku "2. F-8: naslovi, citat i bibliografija bez mreže". `context.setOffline(true)` tamo ne zaustavi kontrolni zahtjev na `/api/evidence/commit`, pa on stigne do poslužitelja (N2). Raniji prekid mreže u istom prolazu zahtjev zaustavlja, a na Linuxu u CI-ju korak prolazi. Dok se uzrok ne nađe, točke 4 i 5 za testirani SHA dokazuje video posla Login E2E iz CI-ja (§3). Zapis tada nosi ishod najviše PARTIAL. Točke 4 i 5 vlasnik na probi prolazi ručno.
- Spec nativno ispisuje "Login E2E: no evidence environment": pomoćnik čita domenu evidencije iz Docker stoga. Uz `E2E_REUSE_SERVER=1` aplikacija koristi okolinu runnera.

## 6. Probni prolaz 26. 10. 2026.

`main` 37de702e, nativni runner na Windowsima 10, prazni podaci. Ishod **PARTIAL**: točke 1 i 3 rade, spec nativno staje u koraku "2. F-8: naslovi, citat i bibliografija bez mreže" jer prekid mreže iz testa ne zaustavi kontrolni zahtjev (na Linuxu u CI-ju isti korak prolazi). Točke 4 i 5 za isti SHA dokazuje posao Login E2E u CI-ju. Puni zapis s imenovanim nedostacima je na Linear DAN-348; odatle je u ovaj postupak ušao `--timeout 300000` i pravilo da prolaz kreće od praznih podataka.
