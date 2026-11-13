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
ant apply agents/
```

Deployment odmah pauziraj i pokreni jednom ručno; ponovno uključivanje rasporeda je vlasnikova odluka.

## Zašto bez pisanja na GitHub

Botovi pišu samo kao `ductus-botovi[bot]` i imaju stroga ograničenja (`CLAUDE.md`, „Vanjski botovi”). Automatsko otvaranje issuea iz ovih agenata tražilo bi token te aplikacije u vaultu i novu vlasnikovu odluku.
