# Ductus SUB+Free — izvršni CLI kontroler

**DAN-41 · 6. 10. 2026. · kandidat za neovisni pregled**

Ovo je implementacija lokalne dodjele i ograničenog pokretanja CLI zadataka. Nije nova aplikacijska arhitektura, potpuni autonomni razvojni tim, servis za korisnike Ducture ili zamjena Engineering review gatea. Ne mijenja druge PR-ove ni produktne odluke.

## Pokretanje

Python 3.11+ i Git; nema novih Python ili aplikacijskih ovisnosti. Naredbe se izvršavaju iz checkouta koji sadrži ovaj kandidat:

```powershell
python -B scripts/ductus_ai.py roster
python -B scripts/ductus_ai.py status
python -B scripts/ductus_ai.py --repo D:\Ductus doctor
python -B -W error::ResourceWarning -m unittest discover -s scripts/ai_runtime/tests -v
```

`doctor` ispituje instalaciju te podržane Codex/Claude auth-status naredbe; ne pokreće model, login, kupnju ni promjenu računa. Postojanje instalacije nije potvrda kvote ili financiranja. Ne vraća tokene ili e-mail adrese.

## Dopuna dijagnostike prijave

Claude Code 2.1.291 koristi `authMethod: "claude.ai"`. `doctor` prepoznaje taj oblik uz ranije podrzane `oauth`/`claudeAi` oznake, ali samo uz izlazni kod 0, JSON objekt, `loggedIn: true` i `apiProvider: "firstParty"`. Nepoznat, API ili neispravan odgovor ne dokazuje pretplatnu prijavu. Osobna polja odgovora ne objavljuju se. Potvrda prijave ne potvrduje kvotu, financiranje ili native kontrole i ne ukljucuje `dispatch_ready`.

## Implementirano

Dvanaest uloga dostupno je kroz `roster`: O1 orkestrator, B1 backend, F1 frontend, P1 platforma, R1 reviewer, Q1 QA, H1 bug hunter, U1 product/UX te četiri specijalista S1/A1/L1/X1. To nisu dvanaest pokrenutih procesa.

SQLite transakcija `BEGIN IMMEDIATE` atomski čuva rezervacije istog taska, worktreea i ownera. Odbija drugog managed orkestratora, preklopljene writer putanje, više od tri managed posla i više od jednog teškog posla. Catch-up dopušta jednog writera; normal najviše dva. Grok i Mistral imaju po jedan managed slot. Promjena režima odbija se dok postoje rezervacije.

```powershell
python -B scripts/ductus_ai.py mode catch-up
```

Stanje je u `%LOCALAPPDATA%\DucturaRuntime` na Windowsu, odnosno `~/.local/share/DucturaRuntime` drugdje. Registar je zajednički managed zadacima istog OS profila, nije zaseban za svaki worktree. Ne koordinira drugi uređaj, drugi OS profil ili ručno pokrenute chatove. Projektni PR WIP 3/2/1 ostaje pravilo postojećeg Engineering Systema; ovaj kontroler ne preuzima Linear/GitHub prioritizaciju.

Svaki zadatak mora biti u zasebnom imenovanom Git worktreeu pravog repoa, čist na točnom početnom SHA-u. Primarni checkout, drugi remote, neočekivani SHA, symlinkovi/submoduli i lokalne `.env` datoteke odbijaju se. `prepare` dohvaća aktualni main i stvara novu granu/worktree; nikad ne prepisuje postojeći cilj.

## Task i prvi prolaz

Task je JSON s točnim poljima:

```json
{
  "id": "DAN-41-smoke",
  "owner": "codex:desktop:reviewer",
  "role": "reviewer",
  "provider": "codex",
  "base_sha": "b41d5633bfcee1550d83016dcce89adb9648af7a",
  "worktree": "D:/Ductus-worktrees/managed-dan-41-smoke",
  "scopes": [],
  "goal": "Pročitaj AGENTS.md i sažmi granice reviewerske uloge bez mijenjanja datoteka.",
  "acceptance": "Sažetak bez izmijenjenih datoteka i bez GitHub komentara.",
  "risk": "low",
  "heavy": false,
  "timeout": 120
}
```

`prepare` namjerno zamjenjuje ulazni worktree i SHA svježim vrijednostima i sprema dovršeni task izvan repoa. Ostale naredbe koriste taj dovršeni task:

```powershell
python -B scripts/ductus_ai.py --repo D:\Ductus prepare task.json
python -B scripts/ductus_ai.py --repo D:\Ductus check "$env:LOCALAPPDATA\DucturaRuntime\tasks\DAN-41-smoke.json"
python -B scripts/ductus_ai.py --repo D:\Ductus run "$env:LOCALAPPDATA\DucturaRuntime\tasks\DAN-41-smoke.json"
```

Bez provjerenog financiranja `check` i `run` završavaju `blocked_funding`, kodom 2, bez pokretanja modela. Taskovi writera imaju neprazan popis konkretnih relativnih write putanja; ostale uloge moraju imati prazan popis. Cilj i kriterij prihvata su brief modelu, ne izvršni shell.

## Financiranje i native konfiguracija

Dopušteni kanali: `chatgpt_subscription`, `claude_subscription`, `supergrok_subscription`, `mistral_free`. Meta web i DeepSeek bez potvrđenog kanala ne pokreću CLI. Nema API wrappera, rezervnog plaćenog modela ili automatskog kupovanja kredita.

Za svaki provider kontroler traži `%LOCALAPPDATA%\DucturaRuntime\evidence\<provider>.json`. Zapis mora sadržavati: `provider`, točan `channel`, `login_verified: true`, `extra_spend_disabled: true`, `included_quota_available: true`, `observed_at`, `expires_at`, `source`, `executable_sha256`, `configuration_reviewed: true`, `config_sha256`, `native_controls_verified: true`. Vremena su Unix sekunde; valjanost je najviše 24 sata. Hashovi se mogu očitati kroz `doctor` za odgovarajući worktree.

**Ovo je evidencija stvarne provjere operatera, ne providerov digitalni potpis, pouzdan API za billing ili tvrdi financijski limit.** Zapis se ne smije popuniti s `true` na temelju pretpostavke. Nije automatski napravljen za Danielove račune. Promjene naplate, auth profila, verzije alata ili konfiguracije traže novu provjeru. Kontroler ne može spriječiti da vlasnik promijeni postavke na webu tijekom izvođenja; jamstvo naplate daje postavka samog pružatelja.

Native konfiguracija mora biti pregledana zbog hookova, MCP-a, dodatnih alata i preusmjeravanja. Okolina procesa ne nasljeđuje API ključeve, GitHub tokene ili alternativne provider varijable. Native credential store ostaje na svojem mjestu; ne kopira se u projekt.

## Adapteri

Codex koristi ChatGPT način prijave, ugrađeni sandbox, isključen multi-agent i mrežu za workspace shell. Writer dobiva `workspace-write`, reviewer `read-only`. Nema bypass zastavice. Claude koristi `--restricted`, eksplicitne file alate i prazan MCP; nema API-only `--bare`. Grok je početno advisory, bez subagenata i uz odbijen shell/MCP. Mistral Free je prompt-only advisory, bez alata. To su verzijski osjetljivi adapteri: test naredbe nije dokaz da je stvarni model ili račun uspješno izvršio zadatak.

Plan mode sam nije opća read-only sigurnosna granica. Controller scope audit uspoređuje rezultat s početnim SHA-om i uključuje nepoznate datoteke, brisanja i oba kraja renamea. Kršenje zadržava izmjene i vraća `blocked_scope`; ne radi `reset --hard`. Audit detektira, ne sprečava sve moguće upise. OS/native sandbox i kontrolirani operator ostaju potrebni. Ručno pokrenute CLI-jeve ili shell potomke izvan podržanog managed protokola ne treba predstavljati kao kontrolirane dodatne sesije.

## Izvršavanje, oporavak i značenje statusa

Proces ima timeout 1–1200 sekundi i izlaz do 1 MiB. Uspješni izlaz, neuspjeh, timeout i prekoračenje izlaza ostavljaju lokalni rezultat i predaju. Uobičajeni token-obrasci redigiraju se; to nije potpuni DLP i ne opravdava uporabu stvarnih studentskih podataka.

`completed` znači da je proces završio bez detektiranog kršenja, **ne** da je feature odobren, CI zelen ili critical PR spreman za merge. Rezultat uvijek nosi `canonical_review: false`. Kontroler nikad ne objavljuje App-authenticated PASS ni Owner Override.

Istek heartbeata označava `orphaned` i ne oslobađa kapacitet. Interni API `recover` može oporaviti samo rezervaciju prije početka djeteta uz potvrdu da kontroler ne postoji. Već pokrenuti orphan ostaje blokiran za neovisnu provjeru cijelog process treea. Nema javnog `force release` niti ubijanja tuđih procesa.

Lokalni `runs/<run-id>/` sadrži task, redigirani output, `result.json` i `HANDOFF.md`. Zapis tokena rezervacije ne izlaže se kroz status. Ti zapisi nisu task backlog: Linear i GitHub ostaju mjerodavni prema prihvaćenim pravilima.

## Provjera i granice ove isporuke

Testovi koriste privremene stvarne Git repozitorije, SQLite konkurenciju i sintetičke Python procese. Nisu pozivi pravim AI modelima. Poseban neprivilegirani workflow pokreće istu testnu zbirku na Linuxu i Windowsu; workflow datoteka sama po sebi nije dokaz da je CI prošao.

Fizički desktop worktree pripremljen je prije prekida Desktop Commander veze. Nove datoteke i njihovo Windows izvršavanje ne smiju biti označeni instaliranima dok to nije pročitano s uređaja. Native login/kvota/naplatne provjere i neovisni critical review/QA ostaju odvojeni preduvjeti.
