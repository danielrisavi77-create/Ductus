# Ductus Managed Agents

Tri agenta za Claude Managed Agents (platform.claude.com). Nisu dio aplikacije, ne zamjenjuju orkestrator (`docs/ORKESTRATOR.md`) ni Grok botove. Svi rade u vlastitom sandboxu nad javnim klonom `main`a, **ne pišu na GitHub**, ne diraju produkciju i koriste samo izmišljene podatke. Isporuka je izvještaj u `/mnt/session/outputs/`; vlasnik ili sesija s ulogom odlučuje što od toga postaje issue.

| Agent | Kada | Model | Isporuka |
| --- | --- | --- | --- |
| `invariant-hunter` | noću (pon. do pet. 02:17) | Sonnet 5.5 | izvještaj i nacrti `bug` issuea za prekršene invarijante B-8, F-3/F-8, B-12 |
| `doc-consistency-auditor` | tjedno (nedjelja 20:43) | Opus 5.5 | popis proturječja među dokumentima, gradnje na PRIJEDLOG-u i zastarjelih upućivanja |
| `hr-provider-eval` | jednokratno | Opus 5.5 | usporedba pružatelja za AI pomoćnika na hrvatskom akademskom tekstu (ulaz za Q-10 t. 7, rok 15. 12. 2026.) |

Strop troška agenata je otvoren (Q-20 P12). Dok vlasnik ne odluči, deploymente ostavi pauzirane i pokreći ih ručno.

## Primjena

Prije primjene provjeri da nema nepopunjenih mjesta:

```bash
grep -rn YOUR_ agents/
```

Za `hr-provider-eval` prvo napravi vault i u konzoli dodaj ključeve pružatelja (nikad u repo), pa upiši ID vaulta u `kickoff`-ov session. Zatim:

```bash
ant apply --dry-run agents/<agent>   # pa imenovanjem datoteka, vidi Predaja
```

Deployment odmah pauziraj i pokreni jednom ručno; ponovno uključivanje rasporeda je vlasnikova odluka.

## Zašto bez pisanja na GitHub

Botovi pišu samo kao `ductus-botovi[bot]` i imaju stroga ograničenja (`CLAUDE.md`, „Vanjski botovi”). Automatsko otvaranje issuea iz ovih agenata tražilo bi token te aplikacije u vaultu i novu vlasnikovu odluku.

## Predaja (13. 11. 2026.)

Grana `claude/dazzling-ride-aq0p7q`, prethodni head `62963002`. Nema PR-a, issuea ni `DAN` tiketa; PR se otvara samo na vlasnikov zahtjev.

- Gotovo: konfiguracije triju agenata s početnim rubrikama. Pre-push hook (unit testovi) prošao je na `62963002`.
- Nije učinjeno: ništa nije primijenjeno na platform.claude.com; `claude-lock.json` ne postoji.
- Sljedeća radnja (lokalna sesija): provjeriti `ant --version` (≥ 1.34.0), `jq` i `ant auth status` (prijavu radi vlasnik). Zatim samo `doc-consistency-auditor`: `--dry-run`, potvrda vlasnika, apply agenta i okoline, apply deploymenta i pauza u istoj naredbi, jedan ručni run. Pokazati cijenu runa i `audit.md`, pa tek onda `invariant-hunter` i `hr-provider-eval`. Nakon applyja commitati `claude-lock.json`.
- Čeka vlasnika: (1) koje pružatelje testira `hr-provider-eval`, tj. host umjesto `YOUR_PROVIDER_API_HOST`; (2) ključeve u vault upisuje sam, u svom terminalu; (3) uključivanje rasporeda i strop troška (Q-20 P12). Nacrt pitanja za Owner queue nije objavljen; sadržaj je u gornjem odjeljku i u ovoj predaji.
- Ne provjereno: točan oblik polja `name` u deployment datotekama i prihvaća li `ant apply` ove datoteke; vidi se tek u `--dry-run`.

Zamka: `ant apply` pri obilasku mape može ovu `README.md` u mapi `agents/` pokušati čitati kao resurs; zato primjenjuj imenovanjem datoteka, nikad `ant apply agents/` bez provjere u `--dry-run`.
