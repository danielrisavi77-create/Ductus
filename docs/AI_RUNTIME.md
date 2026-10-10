# Lokalni read-only pregled kod drugog pružatelja

**DAN-41 · 10. 10. 2026. · suženi opseg po odluci vlasnika**

Kontroler `scripts/ductus_ai.py` pokreće na Danielovu računalu jedan ograničeni, read-only poziv CLI alata drugog pružatelja (Codex, Grok ili Mistral) nad zadanim commitom i sprema lokalni savjetodavni izvještaj. Razlog: dok je kvota drugog pružatelja iscrpljena, i drugi PASS daje Claude (`docs/ENGINEERING_SYSTEM.md` §6, kvotni fallback); ovim se alatom mišljenje drugog pružatelja može dobiti kontrolirano, bez dodatnog troška i bez prava pisanja.

Ovaj dokument ne mijenja nijedno pravilo o tome što vrijedi kao neovisni review ili QA. Mjerodavni su `docs/ENGINEERING_SYSTEM.md` §6 i `docs/ORKESTRATOR.md` §8.

## Što kontroler nije

- **Ne dodjeljuje zadatke i ne pokreće pisce.** Dodjelu, pisce, worktreeje za pisanje i orkestraciju radi orkestrator kroz podagente (`docs/ORKESTRATOR.md` §8). Uloge orkestratora, backenda, frontenda i platforme ovdje ne postoje, kao ni naredbe `prepare` i `mode`.
- **Ne mijenja repo.** Svaki zadatak mora imati `"scopes": []`; zadatak s ijednom putanjom za pisanje odbija se s `blocked_scope`. Adapteri nemaju način rada s pisanjem.
- **Ne piše na GitHub.** U kodu nema poziva prema GitHubu. Kontroler nikad ne objavljuje `Agent-Review`, `QA-Agent` ni `Owner-Override`.
- **Ne daje verdict.** Svaki rezultat nosi `canonical_review: false`. `completed` znači samo da je proces završio i da se u worktreeju ništa nije promijenilo.
- **Ne pokreće Claude.** Claude adapter je uklonjen, a ne samo isključen: Claude review već rade postojeće autentificirane sesije, a isključen kod koji zna složiti Claude naredbu s alatima za pisanje bio bi rizik bez koristi. Zadatak s `"provider": "claude"` odbija se s `blocked_provider`.

## Od lokalnog izvještaja do kanonskog komentara

Izlaz je mapa `runs/<run-id>/` izvan repoa: `task.json`, `output.txt` (redigirani izlaz alata), `result.json` i `HANDOFF.md`. To je **savjetodavni ulaz**, isto što i nalaz podagenta ili CLI posla u `docs/ORKESTRATOR.md` §8.

Kanonski review ili QA komentar i dalje nastaje samo onako kako propisuje `docs/ENGINEERING_SYSTEM.md` §6: objavljuje ga autentificirani GitHub App, iz sesije koja je sama pregledala aktualni head i koja je drugi principal od autora. Čovjek ili zasebno autentificirana sesija smije lokalni izvještaj pročitati i uzeti u obzir; ne smije ga samo prepisati kao verdict. Lijepljenje izvještaja u PR pod vlasničkim računom ne zadovoljava gate.

Zbog toga se u spremljenom izlazu svaka pojava `Agent-Review:`, `QA-Agent:` i `Owner-Override:` označava prefiksom `[advisory, not canonical]`, da kopirani tekst ne može početi kanonskim retkom. Model u uputi dobiva zabranu pisanja takvih blokova.

## Uloge i pružatelji

`roster` ispisuje osam uloga, sve bez prava pisanja: R1 reviewer, Q1 QA, H1 bug hunter, U1 product/UX te specijalisti S1 security, A1 accessibility, L1 privacy-pilot i X1 architecture. Uloga određuje samo brief koji model dobiva.

| Pružatelj | Kanal | Što alat smije |
| --- | --- | --- |
| `codex` | `chatgpt_subscription` | ugrađeni sandbox `read-only`, prijava ChatGPT pretplatom, bez multi-agenta i web pretrage |
| `grok` | `supergrok_subscription` | samo alati `Read,Grep,Glob`; shell, MCP, subagenti i web pretraga odbijeni |
| `mistral` | `mistral_free` | bez alata: vidi samo tekst zadatka, pa materijal mora stati u `goal` (do 8000 znakova) |

Meta, DeepSeek i svaki drugi kanal odbijaju se. Nema API omotača, rezervnog plaćenog modela ni kupnje kredita.

## Sigurnosne granice

- **Okolina procesa.** Dijete nasljeđuje samo popis sistemskih varijabli (`PATH`, profil, privremene mape). API ključevi, `GITHUB_TOKEN`, `GH_TOKEN` i varijable koje preusmjeravaju pružatelja ne prenose se.
- **Dokaz o pretplati.** Bez datoteke dokaza `check` i `run` završavaju s `blocked_funding` i kodom 2, prije dodira worktreeja i bez pokretanja modela. Dokaz vrijedi najviše 24 sata i veže se uz hash izvršne datoteke i konfiguracije alata.
- **Worktree.** Zadatak se izvršava samo u zasebnom worktreeju pravog repoa, čistom na točnom SHA-u. Primarni checkout, grana `main`, drugi remote, neočekivani SHA, symlinkovi, submoduli i lokalne `.env` datoteke odbijaju se.
- **Vrijeme i izlaz.** Ograničenje 1 do 1200 sekundi i najviše 1 MiB izlaza. Prekoračenje zaustavlja stablo procesa koje je kontroler sam pokrenuo.
- **Provjera da se ništa nije promijenilo.** Prije pokretanja snima se HEAD, grana te veličina i vrijeme izmjene svake nepraćene datoteke, uključujući ignorirane. Nakon izvršenja svaka razlika (izmjena, nova datoteka, brisanje, preimenovanje, commit, pomak HEAD-a) daje `blocked_write` i popis `changed_paths`. Izmjene se ne poništavaju, da dokaz ostane.
- **Lokalna brava.** SQLite u `review-registry.sqlite3` jamči najviše tri istodobna pokretanja, jedno po worktreeju i zadatku, jedno teško te po jedno za Grok i Mistral. To je brava protiv sudara na jednom računalu, a ne dodjela zadataka. Istekli heartbeat označava pokretanje kao `orphaned` i ne oslobađa mjesto; nema prisilnog oslobađanja ni ubijanja tuđih procesa.

Stanje je u `%LOCALAPPDATA%\DucturaRuntime` (drugdje `~/.local/share/DucturaRuntime`). Stari `registry.sqlite3` ranijeg kandidata više se ne čita i smije se obrisati.

## Što granice ne jamče

- Provjera nakon izvršenja otkriva pisanje, ne sprečava ga. Sprečavanje daju sandbox i ograničeni alati samog pružatelja, koji ovise o verziji alata.
- Ne vidi upise izvan worktreeja ni izmjenu ignorirane datoteke koja zadrži veličinu i vrijeme izmjene.
- Okolina je očišćena, ali vjerodajnice spremljene na disku (GitHub CLI, Git Credential Manager) ostaju na računalu. Štiti ih to što adapteri nemaju shell s mrežom, a ne ovaj kontroler.
- Dokaz o pretplati je zapis operaterove provjere, a ne potpis pružatelja ni tvrdi financijski limit. Kontroler ne može spriječiti promjenu postavki računa tijekom izvođenja.
- Redigiranje uobičajenih obrazaca tokena nije potpuna zaštita od curenja i ne opravdava stvarne studentske radove ni osobne podatke u zadatku.

## Naredbe

```powershell
python -B scripts/ductus_ai.py roster
python -B scripts/ductus_ai.py status
python -B scripts/ductus_ai.py --repo <worktree> doctor
python -B scripts/ductus_ai.py --repo D:\Ductus check <zadatak.json>
python -B scripts/ductus_ai.py --repo D:\Ductus run <zadatak.json>
python -B scripts/ductus_ai.py handoff <run-id>
```

`doctor` provjerava instalaciju, ispisuje hasheve i za Codex pokreće samo `login status`. Ne pokreće model, prijavu ni promjenu računa, ne ispisuje izlaz probe i uvijek vraća `dispatch_ready: false`.

## Testovi

```powershell
python -B -W error::ResourceWarning -m unittest discover -s scripts/ai_runtime/tests -v
```

Testovi koriste privremene stvarne Git repozitorije, SQLite i sintetičke Python procese; ne zovu modele ni mrežu. Neprivilegirani workflow `.github/workflows/ai-runtime-tests.yml` pokreće isti skup na Linuxu i Windowsu, bez tajni i s `contents: read`.

Na Windowsu skup stvara fiksture u `%TEMP%`. Ako je sistemski disk opterećen, svaki trajni SQLite commit i svaka Git naredba koja stvara datoteke traju i do sekunde; tada pomaže usmjeriti `TEMP` i `TMP` na brži disk prije pokretanja.

## Što Daniel mora napraviti prije prve uporabe

Agent ove korake ne smije odraditi umjesto vlasnika: traže uvid u račun i naplatu.

1. **Prijava.** Instalirati i prijaviti CLI pružatelja pretplatom (za Codex prijava ChatGPT računom, ne API ključem).
2. **Worktree za PR koji se pregledava** (primjer za PR 123):

   ```powershell
   git -C D:\Ductus fetch origin pull/123/head
   $sha = git -C D:\Ductus rev-parse FETCH_HEAD
   git -C D:\Ductus worktree add --detach D:\Ductus-worktrees\codex-review-pr-123 $sha
   ```

3. **Hashevi kroz `doctor`**, pokrenut za taj worktree:

   ```powershell
   python -B scripts/ductus_ai.py --repo D:\Ductus-worktrees\codex-review-pr-123 doctor
   ```

   Iz odjeljka pružatelja prepisati `executable_sha256` i `config_sha256`. Za Codex mora stajati `native_subscription_login_verified: true`.
4. **Datoteka dokaza** `%LOCALAPPDATA%\DucturaRuntime\evidence\<pružatelj>.json` (`codex.json`, `grok.json` ili `mistral.json`), sa svih dvanaest polja:

   ```json
   {
     "provider": "codex",
     "channel": "chatgpt_subscription",
     "login_verified": true,
     "extra_spend_disabled": true,
     "included_quota_available": true,
     "observed_at": 0,
     "expires_at": 0,
     "source": "ručna provjera postavki računa",
     "executable_sha256": "<iz doctor>",
     "configuration_reviewed": true,
     "config_sha256": "<iz doctor>",
     "native_controls_verified": true
   }
   ```

   Svako `true` upisuje se tek nakon stvarne provjere, nikad po pretpostavci:
   - `login_verified`: prijava je pretplatnička (točka 3);
   - `extra_spend_disabled`: u postavkama računa pružatelja isključena je dodatna potrošnja i dokup kredita;
   - `included_quota_available`: stranica potrošnje pokazuje preostalu uključenu kvotu;
   - `configuration_reviewed`: pregledana je konfiguracija alata (`~/.codex/config.toml`, `~/.grok/config.toml` ili `~/.vibe/config.toml` te iste datoteke u worktreeju i mapama iznad njega) i u njoj nema hookova, MCP poslužitelja ni drugog endpointa;
   - `native_controls_verified`: instalirana verzija alata poznaje zastavice koje adapter šalje (za Codex `codex exec --help` navodi `--sandbox` s vrijednošću `read-only`).

   `observed_at` je trenutak provjere, a `expires_at` najviše 24 sata kasnije, u Unix sekundama: `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()`. Vrijednosti `0` iz primjera namjerno ne prolaze. `channel` mora odgovarati tablici pružatelja. Nakon nadogradnje alata ili izmjene konfiguracije hashevi se mijenjaju i dokaz treba ponoviti.
5. **Zadatak** izvan repoa, npr. `%LOCALAPPDATA%\DucturaRuntime\tasks\pr-123-review.json`:

   ```json
   {
     "id": "PR-123-codex-review",
     "owner": "codex:a:reviewer",
     "role": "reviewer",
     "provider": "codex",
     "base_sha": "<puni SHA iz točke 2>",
     "worktree": "D:/Ductus-worktrees/codex-review-pr-123",
     "scopes": [],
     "goal": "Pregledaj razliku između origin/main i HEAD prema odjeljku Neovisni pregled u AGENTS.md. Ne mijenjaj datoteke.",
     "acceptance": "Popis nalaza u obliku iz AGENTS.md ili Bez nalaza; bez verdikta i bez GitHub komentara.",
     "risk": "standard",
     "heavy": false,
     "timeout": 900
   }
   ```

6. **Prva proba.** Prvo `check`, koji ne troši kvotu, pa `run`:

   ```powershell
   python -B scripts/ductus_ai.py --repo D:\Ductus check "$env:LOCALAPPDATA\DucturaRuntime\tasks\pr-123-review.json"
   python -B scripts/ductus_ai.py --repo D:\Ductus run "$env:LOCALAPPDATA\DucturaRuntime\tasks\pr-123-review.json"
   ```

   `check` mora vratiti `ready_for_read_only_run`. Nakon `run` pročitati `output.txt` u mapi iz polja `artifacts` i potvrditi `status: completed`, `changed_paths: []` i `canonical_review: false`.
7. **Nakon probe.** Ukloniti worktree (`git -C D:\Ductus worktree remove D:\Ductus-worktrees\codex-review-pr-123`). Izvještaj koristiti kao savjetodavni ulaz; kanonski komentar objavljuje se samo putem iz odjeljka "Od lokalnog izvještaja do kanonskog komentara".
