# Besplatni savjetodavni AI pregled PR-a (DAN-200)

**Status:** predloženo kroz PR; aktivira se tek nakon spajanja na `main` i postavljanja API ključa. Nije novi službeni reviewer ni QA gate.

## Kako radi

- `.github/workflows/free-ai-pr-review.yml` pokreće se na otvoren, ponovno otvoren ili izmijenjen PR (i kada draft postane spreman), **samo ako PR dolazi iz istog repozitorija**. Fork PR-ovi se preskaču kako ne bi trošili vlasnikovu besplatnu AI kvotu.
- Koristi isključivo **zaštićeni `main`** i GitHubov API za diff; ne checkouta niti izvršava kod s PR-a.
- U `Actions → Advisory free AI PR review → Summary` zapisuje nalaze uz datoteku, dodani redak, konkretan scenarij i prijedlog. Nema komentarâ, commita, mergea, deploya ni kanonskih `Review-Verdict` / `QA-Verdict` polja.
- Ako nema ključa, ispiše jasan `Preskočeno` umjesto lažnog `Bez nalaza`. Ako model nije dostupan, status je `Nedostupno`.
- Prikazuje `DJELOMIČAN PREGLED` ako nije pročitan cijeli diff. Analizira najviše 12 datoteka i 10.500 znakova patcha; ne pokriva binarne, credential i lock datoteke. Ne zamjenjuje lokalni CI, gitleaks, dependency review, formalnu neovisnu reviziju ni odvojeni QA.

## Besplatna aktivacija (jedina ručna radnja vlasnika)

1. Otvori [Groq Console](https://console.groq.com/keys), otvori **Free** račun/projekt i generiraj API ključ. Ne prelazi na naplatni Developer plan. Free kvote su ograničene i mogu se promijeniti.
2. U GitHub repozitoriju idi na **Settings → Secrets and variables → Actions → New repository secret**. Ime: `GROQ_API_KEY`; vrijednost: ključ. Ključ nikada ne šalji u chat ni ne stavljaj u kod.
3. Nakon što je workflow spojen u `main`, ažuriraj jedan ne-draft PR; u njegovu Actions runu provjeri **Summary**, rezultat `Izvršeno` i pokrivenost.
4. Za provjeru kvota koristi [Groq Limits](https://console.groq.com/settings/limits) i ostani na Free planu. Naplata se ne uključuje automatski ovim workflowom.

## Privatnost i prijetnje

PR patch iz javnog repozitorija šalje se Groq API-ju **samo kada je secret postavljen**; izbjegavajte studentske radove, stvarne osobne podatke i vjerodajnice u PR-ovima. Redci koji izgledaju kao uobičajeni credentiali maskiraju se, ali maskiranje nije zamjena za secret scanning. Prompt injection u patchu se tretira kao nepouzdan tekst, a izlaz modela filtrira se na datoteke i retke stvarno promijenjene u dostavljenom patchu.

Workflow je namjerno savjetodavan i read-only. **Nije** obvezna provjera u branch protectionu. Svaka izmjena workflowa ili `scripts/engineering/` potpada pod D-97 i spaja se isključivo na Danielovu izričitu naredbu za konkretan PR/head.

Lokalni test: `node --test scripts/engineering/free-ai-pr-review.test.mjs`.
