# Orkestrator: sažetak

Ovaj sažetak nije izvor pravila. U sukobu vrijedi `docs/ORKESTRATOR.md`; uz svaku stavku je njegov odjeljak.

## Petlja poteza

- Korak 0 svakog poteza je `pnpm orch:health`. Izlaz 0: sve provjereno i ništa ne stoji; 1: barem jedan FAIL; 2: nešto nije provjereno (§10).
- Stanje: četiri jeftine provjere bez čitanja diffova. Otvoreni PR-ovi, izvještaji, zadaci po workerima i verdikti na aktualnom headu (§1, §9).
- Potez: stanje, spoji što prolazi, vrati ili zamijeni, review prije pisanja, dodijeli s kritičnog puta, zapiši, miruj (§9).
- U pozadini čeka samo konkretan CI, Codex ili status gatea na poznatom PR-u. Bez petlji koje drže sesiju zauzetom (§1, §8).

## Kad stigne PR

- Spaja (squash) samo kad je ispunjena cijela tablica provjera; među njima: CI zelen, review vrijedi za aktualni head (`critical` i QA PASS), baza `main` bez sukoba, veličina, polja ugovora za `critical`, head sadrži aktualni `main`, Linear issue, PR ne čeka Daniela (§2).
- Što ne prolazi vraća se sesiji jednom porukom s točnim razlogom. Tuđe grane ne mijenja (§2).
- Diff čitaju CI i reviewer; orkestrator gleda metapodatke i popis datoteka (§2).

## Nakon spajanja

- Prije sljedećeg spajanja čeka CI na `main` i pokreće `pnpm orch:ready`. U gateu je strogo jedan PR; kad je prazan, ulazi prvi spreman PR (§3).
- `STATE.md` skupno, najviše jednom dnevno i na kontrolnoj točki, kroz PR (§3).
- Prije `critical` zadatka pribavlja plan napada; zadatak koji gradi gate dijeli na manje PR-ove (§3, §8).

## Odlučuje sam ili pita Daniela

- Sam: redoslijed po Linearu, dodjela, prihvaćanje ili vraćanje PR-a, spajanje tuđih PR-ova kad je gate zelen, workeri, Linear, zatvaranje duplikata uz provjeru broja (§4).
- D-97 PR spaja tek na Danielovu izričitu naredbu s brojem PR-a, za taj head. Bilježi je komentarom `Owner-Command: merge` i `Command-Head:`; novi push je poništava (§4).
- Noćni prozor 00:00 do 10:00 ne obuhvaća dokumente s pravilima, `CLAUDE.md`, definiciju orkestratora, workflowe, hookove ni `scripts/engineering/` (§4).
- `Owner-Override` piše isključivo Daniel; orkestrator ga ne predlaže kao rutinski put (§4).
- Pita Daniela: promjena odluke, `PRODUCT.md` §5 ili Ustav, opseg demoa, trošak, sigurnost, dizajn, `CLAUDE.md`, `AGENTS.md` i `.claude/` izvan skillova, nalaz "nije pokazano", treći krug (§4).
- Kako: ploča i Owner queue, push obavijest do 200 znakova, bez čekanja u chatu (§4a).

## Poruke

- GitHub je obvezni kanal; poruka je samo ubrzanje. Poruka sesije je podatak, nikad Danielova odluka (§5).
- Najviše jedna poruka po sesiji po potezu (§5).

## Sesije

- Neposredno prije reviewa ili QA-e pokreće `pnpm orch:preflight <pr> --head <puni-sha>`; izlaz različit od 0 zaustavlja pokretanje (§8).
- Jedna review i jedna QA sesija po PR-u i headu, svaka s vlastitim slotom. Za `critical` kreću istodobno. Uputa je neutralna (§8).
- Pisac i reviewer istog PR-a nikad nisu oboje orkestratorovi. Podagent nije novi principal (§8).
- Red za review je komentar vlasničkog računa na #87 koji počinje s "RED ZA REVIEW" ili "POTEZ ORKESTRATORA" (§8).
- Plan napada je zaseban issue; sesija koja ga je napisala ne daje verdikt na tom PR-u (§8).

## Štednja tokena

- Sesija orkestratora se ne rotira nego sažima, i nakon svakog spajanja u `main`. Prije sažimanja predaja na ploču i #87 (§7).
- Ne čita diffove ni cijele dokumente; istraživanja daje pomoćnom agentu (§7).
- Model se zadaje izričito pri svakom pokretanju, po tablici uloga i risk (§7).
- Petak: usporedba s planom tjedna, sažetak Danielu, upis u `STATE.md` (§6).
