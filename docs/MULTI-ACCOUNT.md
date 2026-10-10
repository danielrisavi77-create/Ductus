# Ductus: multi-account i multi-agent rad

Verzija 0.2 · 7. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Ovaj dokument definira runtime sloj za rad više AI računa nad istim Ductus repozitorijem. Vrijedi uz `CLAUDE.md`, `AGENTS.md`, `STATE.md`, `docs/SESSIONS.md` i `docs/ORKESTRATOR.md`. Ne mijenja proizvodna, sigurnosna ni arhitekturna pravila.

## 1. Cilj

Ductus mora biti moguće otvoriti iz novog Claude ili ChatGPT/Codex računa bez ručnog prepisivanja projektnog konteksta. Sve što je potrebno za razumijevanje projekta i radni postupak mora biti u repozitoriju. Račun služi samo kao runtime i nositelj autentikacije.

Repo je izvor istine za prihvaćene produktne/tehničke odluke, arhitekturu, implementacijske ugovore i razvojne upute. Linear je izvor istine za identifikator i razlog zadatka, prioritet, nositelja, rok i status. Memorija računa, povijest chata i privatni skillovi nisu izvori istine.

## 2. Control plane

GitHub je zajednički execution/evidence control plane za sve račune i providere. Ne zamjenjuje Linearov registar zadataka.

- **Zadatak, razlog, prioritet, nositelj, rok i status:** Linear Ductus issue/project.
- **Opseg, prihvaćeni kriteriji i odluke:** kanonski dokumenti u repo-u (`STATE.md`, `docs/PROGRAM.md`, `docs/PLAN-DEMO.md` i povezani product/technical docs).
- **Izvršenje:** zaseban branch i zaseban worktree na GitHubu.
- **Predaja i tehnički dokaz:** GitHub PR opis s `IZVJEŠTAJ`, commits, checks, reviewi i CI.
- **Blokada bez PR-a:** Linear issue ostaje kanonski zadatak; GitHub `IZVJEŠTAJ <id>` issue može nositi tehnički izvještaj uz poveznicu na Linear.
- **Stanje plana:** Linear za živi status zadatka; repo dokumenti za prihvaćeni scope i kriterije; GitHub za izvedbu i dokaze.
- **Ductus Space:** vremenski označen pregled tih izvora, ne paralelni roadmap ni registar statusa.

Poruke među Claude sesijama mogu ubrzati rad na istom računu, ali nikad nisu jedini zapis zadatka, odluke, predaje ili blokade. Sesije na različitim računima ne moraju se međusobno vidjeti.

## 3. Runtime identitet

Svaki aktivni agent ima četiri podatka:

```
runtime: claude | codex | chatgpt
slot: a | b | ...
role: orchestrator | platforma | backend | frontend | reviewer | qa | bug-hunter | product-ux | short
task: <id>
```

Primjer: `codex:b:backend:B-8`.

`slot` je lokalna oznaka računa i ne ulazi u poslovni kod. Ne stavljati e-mail, token, API ključ, ID pretplate ni druge vjerodajnice u repo, issue ili PR.

## 4. Načini rada

### Worker

Worker dobiva točno jedan zadatak ili eksplicitni lanac zadataka. Smije mijenjati samo mape dodijeljene ulozi. Radi od svježeg `origin/main`, testira, otvara PR, zapisuje izvještaj i staje.

Claude, Codex i ChatGPT mogu biti worker. Provider ne određuje vlasništvo mapa; uloga ga određuje.

### Reviewer

Reviewer ne mijenja granu koju pregledava. Traži kršenja tvrdih pravila, ispravnost, sigurnost, pravila proizvoda, nedostatne testove i prekoračenje opsega. Autor PR-a i neovisni reviewer ne smiju biti ista aktivna agent-instanca. Za kritične promjene koristi se drugi račun ili drugi provider kad je dostupan.

Ako pretplata ili kvota za treći provider (primjerice Grok) nije dostupna, odobreni fallback par je Fable na Claudeu i Astra na ChatGPT/Codexu; modeli mogu zamijeniti uloge reviewera i QA-a. PASS-ovi i dalje moraju doći preko dva različita autentificirana Appa (`claude` i `chatgpt-codex-connector`). Dvije sesije ili modela na istom Appu ne čine neovisni par, osim uz kvotni fallback iz `docs/ENGINEERING_SYSTEM.md` §6 (strojni dokaz iscrpljene kvote drugog Appa na istom PR-u, `Provider-Fallback` u QA komentaru i QA sesija neovisna o autoru i revieweru). U fallback komentarima zabilježi model i razlog; te su oznake auditni trag, a gate ne potvrđuje sam odabrani model ni dostupnost pretplate. Ako pretplata za Claude ili ChatGPT/Codex nije dostupna, gate ostaje pending dok se ne pribavi drugi prihvaćeni App ili Daniel ne unese Owner Override.

### Orkestrator

Orkestrator ne piše proizvodni kod. Dodjeljuje zadatke, provjerava gateove, rješava ovisnosti, spaja dopuštene PR-ove i održava `STATE.md`. GitHub PR/commit/review/CI metapodaci imaju prednost pred tvrdnjom sesije o izvedbi; Linear ostaje mjerodavan za prioritet, nositelja i status Linear zadatka.

## 5. Skills

Repo sadrži adaptere za podržane runtimee:

```
.claude/skills/
  ductus-worker/
  ductus-handoff/
  ductus-browser-cli/
  ductus-orchestrator/
  ductus-review/
  ductus-qa/
  ductus-bug-hunter/
  ductus-product-ux/

.agents/skills/
  ductus-worker/
  ductus-handoff/
  ductus-browser-cli/
  ductus-orchestrator/
  ductus-review/
  ductus-qa/
  ductus-bug-hunter/
  ductus-product-ux/
```

Skillovi su namjerno tanki. Ne dupliciraju proizvodna pravila; upućuju na kanonske dokumente u korijenu i `docs/`. Tako se jedna promjena pravila ne mora ručno kopirati u više skillova.

Account-level skills mogu postojati, ali ne smiju biti nužni za rad na Ductusu.

## 6. Worktree pravilo

Svaki worker ima svoj worktree. Dva agenta nikad ne pišu u isti working directory.

Preporučeni raspored na računalu:

```
D:\Ductus                         # glavni checkout / orkestrator
D:\Ductus-worktrees\
  claude-a-backend-B-8\
  claude-b-frontend-F-8\
  codex-a-platforma-P-6\
  codex-b-review-PR-123\
```

Za ručni worker worktree koristi se `scripts/new-agent-worktree.ps1`. Skripta ne kopira tajne ni `.env.local`; runtime konfiguracija i vjerodajnice ostaju izvan repoa.

Claude Desktop/Code može i dalje koristiti vlastite session worktreeove. Bitno je samo da je svaki writer izoliran.

## 7. Autentikacija računa

Autentikacija je lokalna i nije dio Ductus konfiguracije.

- Svaki Claude/ChatGPT račun ima vlastitu prijavu i usage limit.
- Repo ne smije sadržavati session tokene, OAuth tokene, API ključeve ni lokalne auth datoteke.
- Ako dva računa rade na istom fizičkom računalu, njihove auth/profile direktorije treba držati odvojeno kad runtime to podržava; inače koristiti odvojene OS profile ili odvojene uređaje.
- GitHub pristup može biti isti GitHub identitet ako vlasnik tako želi; agent identitet se i dalje bilježi kroz `runtime/slot/role/task`, ne kroz GitHub korisničko ime.

## 8. Zadavanje rada

Minimalni cross-account zadatak:

```
ZADATAK <id>
Runtime slot: <claude:a | codex:b | chatgpt:c | auto>
Uloga: <platforma | backend | frontend | reviewer | qa | bug-hunter | product-ux | short>
Cilj: <jedna rečenica>
Ulaz: <točni dokumenti/odjeljci>
Mape: <dopuštene putanje>
Gotovo kad: <provjerljiv kriterij>
Ovisi o: <PR/issue ili ništa>
Risk: <low | standard | critical>
Review effort: <light | standard | critical>
```

Zadatak je u pravilu Linear issue ID. GitHub issue ili PR povezuje se kao tehnička rasprava i dokaz; ne kopira se u njega zaseban prioritetni status.

Ako runtime nije zadan, orkestrator bira slobodan kompatibilan worker.

## 9. Predaja

Svaki PR sadrži:

```
IZVJEŠTAJ <id> · status: PR otvoren
Agent: <runtime>:<slot>:<role>
Risk: <low | standard | critical>
Task: <id>
Napravljeno: <3-5 stavki>
Testovi: <naredbe i rezultat>
Review: <status>
Otvoreno ili blokira: <stavke ili ništa>
Treba Daniel: <odluka ili ništa>
```

`Task` upućuje na Linear issue. PR, review i CI opisuju izvedbu i provjeru, ne mijenjaju samostalno Linearov status zadatka.

Session URL može biti dodatak, ali nije potreban za nastavak rada s drugog računa.

## 10. Pravila prelaska između računa

Novi račun ne dobiva "predaju u chatu". Dobiva samo:

1. aktualni `main`;
2. `CLAUDE.md` ili `AGENTS.md`;
3. `STATE.md`;
4. Linear issue zadatka i povezani GitHub PR/issue;
5. odjeljke dokumenata navedene u zadatku.

Ako to nije dovoljno za nastavak rada, dokumentacija ili izvještaj su nepotpuni i treba popraviti njih, a ne oslanjati se na memoriju prethodnog računa.

## 11. Migracija postojećeg sustava

Postojeći Claude session-ID-ovi u `STATE.md` ostaju korisni kao optimizacija unutar istog računa. Od ove verzije nisu obvezni za koordinaciju.

Postojeći `scripts/codex-review.ps1` ostaje zadani neovisni Codex pregled. `AGENTS.md` sada dopušta i eksplicitni Codex worker način; `codex exec review` i zadaci označeni kao review i dalje su read-only pregled.
