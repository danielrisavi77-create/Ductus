# Ductus: multi-account i multi-agent rad

Verzija 0.1 · 4. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Ovaj dokument definira runtime sloj za rad više AI računa nad istim Ductus repozitorijem. Vrijedi uz `CLAUDE.md`, `AGENTS.md`, `STATE.md`, `docs/SESSIONS.md` i `docs/ORKESTRATOR.md`. Ne mijenja proizvodna, sigurnosna ni arhitekturna pravila.

## 1. Cilj

Ductus mora biti moguće otvoriti iz novog Claude ili ChatGPT/Codex računa bez ručnog prepisivanja projektnog konteksta. Sve što je potrebno za razumijevanje projekta i radni postupak mora biti u repozitoriju. Račun služi samo kao runtime i nositelj autentikacije.

Repo je izvor istine; memorija računa, povijest chata i privatni skillovi nisu izvor istine.

## 2. Control plane

GitHub je zajednički control plane za sve račune i providere.

- **Zadatak:** GitHub issue ili eksplicitna poruka vlasnika s identifikatorom zadatka.
- **Izvršenje:** zaseban branch i zaseban worktree.
- **Predaja:** PR opis s `IZVJEŠTAJ` blokom.
- **Blokada bez PR-a:** GitHub issue `IZVJEŠTAJ <id>`.
- **Pregled:** PR review ili komentar.
- **Stanje projekta:** `STATE.md` i odgovarajući dokumenti u `docs/`.

Poruke među Claude sesijama mogu ubrzati rad na istom računu, ali nikad nisu jedini zapis zadatka, odluke, predaje ili blokade. Sesije na različitim računima ne moraju se međusobno vidjeti.

## 3. Runtime identitet

Svaki aktivni agent ima četiri podatka:

```
runtime: claude | codex
slot: a | b | ...
role: orchestrator | platforma | backend | frontend | reviewer | qa | bug-hunter | product-ux | short
task: <id>
```

Primjer: `codex:b:backend:B-8`.

`slot` je lokalna oznaka računa i ne ulazi u poslovni kod. Ne stavljati e-mail, token, API ključ, ID pretplate ni druge vjerodajnice u repo, issue ili PR.

## 4. Načini rada

### Worker

Worker dobiva točno jedan zadatak ili eksplicitni lanac zadataka. Smije mijenjati samo mape dodijeljene ulozi. Radi od svježeg `origin/main`, testira, otvara PR, zapisuje izvještaj i staje.

Claude i Codex mogu biti worker. Provider ne određuje vlasništvo mapa; uloga ga određuje.

### Reviewer

Reviewer ne mijenja granu koju pregledava. Traži kršenja tvrdih pravila, ispravnost, sigurnost, pravila proizvoda, nedostatne testove i prekoračenje opsega. Autor PR-a i neovisni reviewer ne smiju biti ista aktivna agent-instanca. Za kritične promjene koristi se drugi račun ili drugi provider kad je dostupan.

### Orkestrator

Orkestrator ne piše proizvodni kod. Dodjeljuje zadatke, provjerava gateove, rješava ovisnosti, spaja dopuštene PR-ove i održava `STATE.md`. GitHub status ima prednost pred session-listom bilo kojeg pojedinog računa.

## 5. Skills

Repo sadrži adaptere za oba runtimea:

```
.claude/skills/
  ductus-worker/
  ductus-orchestrator/
  ductus-review/
  ductus-qa/
  ductus-bug-hunter/
  ductus-product-ux/

.agents/skills/
  ductus-worker/
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
Runtime slot: <claude:a | codex:b | auto>
Uloga: <platforma | backend | frontend | reviewer | qa | bug-hunter | product-ux | short>
Cilj: <jedna rečenica>
Ulaz: <točni dokumenti/odjeljci>
Mape: <dopuštene putanje>
Gotovo kad: <provjerljiv kriterij>
Ovisi o: <PR/issue ili ništa>
Risk: <low | standard | critical>
Review effort: <light | standard | critical>
```

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

Session URL može biti dodatak, ali nije potreban za nastavak rada s drugog računa.

## 10. Pravila prelaska između računa

Novi račun ne dobiva "predaju u chatu". Dobiva samo:

1. aktualni `main`;
2. `CLAUDE.md` ili `AGENTS.md`;
3. `STATE.md`;
4. zadani issue/PR;
5. odjeljke dokumenata navedene u zadatku.

Ako to nije dovoljno za nastavak rada, dokumentacija ili izvještaj su nepotpuni i treba popraviti njih, a ne oslanjati se na memoriju prethodnog računa.

## 11. Migracija postojećeg sustava

Postojeći Claude session-ID-ovi u `STATE.md` ostaju korisni kao optimizacija unutar istog računa. Od ove verzije nisu obvezni za koordinaciju.

Postojeći `scripts/codex-review.ps1` ostaje zadani neovisni Codex pregled. `AGENTS.md` sada dopušta i eksplicitni Codex worker način; `codex exec review` i zadaci označeni kao review i dalje su read-only pregled.
