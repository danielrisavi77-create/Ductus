# Savjetodavno usmjeravanje razvoja — DAN-42

Ovo je izolirani temelj C-02: ugovor, mala deterministička pravila i adapter za
izričito ubrizgan backend. Ne mijenja zadatak, vlasnika, datoteku ni konfiguraciju.
Svaki rezultat ima `advisory=true`; `accepted` znači samo prijedlog domene.
Nema učitavanja modela, uvoza `laya`, `torch` ili `transformers`, mreže ni izvršavanja
naredbi. Pozivatelj mora unaprijed ukloniti osobne podatke i tajne iz sažetka;
validator provjerava oblik i veličinu, a ne tvrdi da može dokazati redakciju teksta.

## Ugovor i granice

`validate_request(raw)` prihvaća isključivo običan `dict` s devet polja:
`schema_version=ductura.dev_route.v1`, `project_id=Ductus`, neprazan
`project_task_id`, `source_commit` od točno 40 malih heksadekadskih znakova,
`language` (`hr`, `en`, `mixed`), `purpose=ductura.dev_route`, `summary`, `paths`,
`labels`. Sažetak ima najviše 4096 UTF-8 bajtova; ID zadatka najviše 128.
Liste imaju najviše 128 stavki, putanja 1024 i oznaka 256 UTF-8 bajtova po stavci.
Odbijaju se pogrešni tipovi, surogati Unicodea, nepoznata/nedostajuća polja,
prazne ili apsolutne putanje, segmenti `.`/`..`/prazno, obrnute kose crte,
dvotočke i kontrolni znakovi. Putanje se nikada ne otvaraju na disku.
Greške sadrže samo stabilni kod, bez korisničkog ključa, vrijednosti ili iznimke.
Nalozi u sažetku ostaju tekst. Prag, model, URL, naredba i upstream zadatak nisu
polja zahtjeva. Validirani zahtjev je zamrznuta kopija s tuple listama.

`validate_result(raw, policy)` provjerava sve izlazne invarijante.
`recommended_domain` postoji samo kod prihvaćenog prijedloga jedne od šest domena.
`candidate` je jedna od sedam oznaka ili `null`; tehnički ishod nema kandidata.
Probabilnosti su `null` za pravila, nevaljan ulaz i tehnički ishod. Za model moraju
sadržavati točno svih sedam konačnih brojeva u [0, 1], sa zbrojem unutar 0.001 od 1.
`choice` mora biti maksimum vektora (izjednačeni maksimum dopušten), a
`answer_confidence` odgovarati njegovoj vrijednosti unutar 1e-9.
Entropijska pouzdanost ne zamjenjuje `answer_confidence`.

Provenijencija sadrži SHA-256 kanonskog lokalnog JSON zapisa validiranog zahtjeva
(uređeni ključevi, UTF-8, kompaktni separatori), `source_commit`, hash pravila i
hash lokalne politike. Redoslijed lista dio je ulaza; redoslijed ključeva nije.
Hashovi nisu tvrdnja o provjerenom modelu niti kriptografski dokaz istinitosti
ulaznih metapodataka. Za nevaljan zahtjev `input_hash` i `source_commit` su `null`.
`checkpoint_hash` i `measurement_hash` su `null`, a `calibration_status=not_evaluated`.

## Pravila v1

Fiksni redoslijed oznaka je `domain_contracts`, `editor_ui`, `sync_storage`,
`backend_auth`, `ci_tooling`, `documentation`, `unknown_mixed`.
Koriste se samo sljedeći prefiksi i točna imena; ne pretražuju se ključne riječi
u sažetku ili nazivu datoteke. Pravila ne predstavljaju izmjerenu klasifikacijsku
preciznost. Sve različite domene iz putanja i točnih oznaka se akumuliraju:
jedna daje `rules_clear`, nijedna `rules_no_signal`, više `rules_conflict`.
Posljednja dva ishoda imaju kandidata `unknown_mixed` i nemaju probabilnosti.

| Domena | Prefiksi ili točne putanje |
| --- | --- |
| `domain_contracts` — domene, događaji, invarijante, kanonikalizacija | `src/domain/document/`, `evidence/`, `forensics/`, `citation/`, `diff/`, `collaboration/` (svi pod `src/domain/`); točno `src/domain/json.ts`, `src/domain/json.test.ts` |
| `editor_ui` — editor, sučelje, pristupačnost | `src/editor/`, `src/components/`, `src/lib/i18n/` |
| `sync_storage` — sync, redovi, offline, pohrana, oporavak | `src/domain/sync/`, `src/domain/serverSync/`; `src/client/sync/`, `journal/`, `storage/`, `recovery/` (svi pod `src/client/`) |
| `backend_auth` — server, actor, auth, sesija, pristup | `src/server/`, `app/api/` |
| `ci_tooling` — build, runner, pipeline, razvojni alati | `.github/workflows/`, `scripts/`, `infra/`; točno `package.json`, `pnpm-lock.yaml`, `lefthook.yml`, `compose.yaml`, `eslint.config.mjs`, `vitest.config.ts`, `tsconfig.json`, `playwright.config.ts` |
| `documentation` — dokumentacija | `docs/`, točno `README.md` |

Oznake u `labels` su signal samo ako su točno jedno od šest imena domena.
`unknown_mixed` i druge oznake ne dodaju kategoriju. Prefiks `tests/` sam nije
`ci_tooling`. Omotači `tests/unit/`, `tests/property/`, `tests/integration/` i
`tests/` uklanjaju se samo kad ostatak počinje s `src/`, `app/api/` ili `scripts/`;
inače test nema signal putanje. Kolocirani `src/domain/document/schema.test.ts`
zadržava svoju domenu. `tests/unit/runner.test.ts` ostaje nejasan.
`RulesPolicy.version=ductura.dev_route.rules.v1`; `rules_hash` obuhvaća tablice,
omotače testova i semantiku odluke. Pravila nemaju poziv modela ni mutaciju ulaza.

## Adapter i budući backend

`route_task(request, policy, backend)` ponovno validira zahtjev i prvo pokreće
pravila. Jasan signal daje prihvaćen prijedlog bez poziva backenda. Nevaljan ulaz
daje `invalid`. Za nejasan signal zadana `RoutePolicy()` ima model isključen i
vraća `abstained/model_disabled`. `route_by_rules` zasebno otkriva uzrok nejasnoće.

Samo izričita lokalna testna politika `RoutePolicy(model_enabled=True,
confidence_threshold=0.75)` aktivira ubrizgani `LayaBackend.score(request)`.
0.75 je sintetički prag primjera testova, bez tvrdnje o kalibraciji; cilj preciznosti
projekta 0.95 nije automatski prag probabilnosti. Ni jedan prag nije dio zahtjeva.

Ubrizgani backend mora vratiti normalizirani obični `dict`:

```python
{
    "answers": {"dev_route": {
        "choice": "editor_ui",
        "probabilities": {  # svih sedam oznaka; primjer samo oblika
            "domain_contracts": 0.02, "editor_ui": 0.88,
            "sync_storage": 0.02, "backend_auth": 0.02,
            "ci_tooling": 0.02, "documentation": 0.02, "unknown_mixed": 0.02,
        },
        "answer_confidence": 0.88,
    }},
    "usage": {"final_input_tokens": 100, "truncated": False},
}
```

`usage.final_input_tokens` je izričiti ugovor našeg budućeg backenda: pozitivan
cijeli broj do 512 za konačni prompt **zajedno s opcijama** nakon pripreme.
`usage.truncated=False` mora biti izričito potkrijepljen. To nisu tvrdnje da izvorni
Laya 0.3.21 već vraća takve metapodatke. Njegov `usage.input_tokens` ne smije se
samo preimenovati bez dokaza što stvarno broji. Nedostajući dokaz, skraćivanje ili
prekoračenje daju `backend_usage_unverified`; bez vektora i bez prihvaćanja.

`unknown_mixed` daje `model_unknown`; kandidat ispod lokalnog praga daje
`model_low_confidence`. Nevaljan vektor/odgovor daje `backend_malformed`,
iznimka `backend_error`, a backendov `TimeoutError` daje `backend_timeout`.
Tehnički ishodi imaju `source=none`; semantičke apstinencije imaju `source=model`
i zadržavaju validirani vektor. Dodatna upstream polja `action`/`command` se
ignoriraju i nikad ne izvršavaju. Adapter ne može prekinuti sinkroni CPU poziv;
vremenske/procesne granice i vlasništvo workera ostaju u postojećem kontroleru.

## Izvediv sintetički primjer

Iz korijena repoa; koristi stvarne funkcije bez modela:

```python
from scripts.engineering.laya.contracts import RoutePolicy, validate_request
from scripts.engineering.laya.baseline import RulesPolicy, route_by_rules
from scripts.engineering.laya.adapter import route_task

request = validate_request({
    "schema_version": "ductura.dev_route.v1", "project_id": "Ductus",
    "project_task_id": "SYNTHETIC-DOCS-42", "source_commit": "a" * 40,
    "language": "hr", "purpose": "ductura.dev_route", "summary": "Sintetički opis.",
    "paths": ["docs/engineering/laya.md"], "labels": [],
})
decision = route_by_rules(request, RulesPolicy())
result = route_task(request, RoutePolicy(), backend=None)  # pravila ne trebaju backend
print(decision.candidate, result.status, result.source, result.probabilities, result.advisory)
# documentation accepted rules None True
```

Provjera: `python -B -m unittest discover -s scripts/engineering/laya/tests -v`.
Fixturei su maleni ručno izvedeni sintetički primjeri; nisu ljudski označen
pilot-skup niti mjerenje kvalitete modela.

## Zatečeno lokalno stanje (6. 10. 2026.)

Prema prethodnom read-only otkrivanju zabilježeni su metapodaci `laya 0.3.21`,
`torch 2.14.0`. Cached bundle je `convaiinnovations/laya`, podmapa `multilingual`,
revizija `55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`, težine 643835514 bajtova.
To nije samostalni `convaiinnovations/laya-multilingual` na reviziji
`e4e9ddf21a7b1903b7acffd8814ad4307bf63a67`. Registrirani digest težina i tokenizera
nije ponovno izračunat; cilj digestiranja tokenizera nije poznat. Zato nema
provjerenih pinova. Model nije učitan. Učitavanje može normalizirati datoteke
tokenizera, a nedostajuće datoteke pokrenuti preuzimanje encodera. Budući backend
čeka potpunu provjeru datoteka, offline kontrolu i provjeru konačnog broja tokena.
