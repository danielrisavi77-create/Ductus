# Lekta za Ducturu: inventar prava i podataka (RightsScope, C01)

Korak M4.1-P01 (DAN-496), izvor: `docs/ARCHITECTURE.md` §5c, `docs/PROGRAM-RAZRADA.md` M4.1, odluke M4 D-217 do D-224 (#87 c.6578722946). Samo inventar; ne mijenja nijednu odluku ni licencu. Pravno tumačenje nije pravni savjet.

## 1. Izvor i granice

- **Lekta je pročitana kroz GitHub na pinanom SHA-u** `c445a7193f08d1ca0f4c6a30b65fbbdbdbd338d2` (javni repo `danielrisavi77-create/Lekta`, commit od 18. 10. 2026.). Nije korišten nijedan lokalni klon vlasnika. Svaka tvrdnja niže vrijedi za taj SHA; novi SHA traži novi inventar.
- Lektini fixturei i testni podaci nisu otvarani. Lektina oznaka na `tests/**` kaže da su `tests/fixtures/docx` stvarni studentski radovi (GDPR).
- Oznaka **NEPROVJERENO** znači da stavka nije provjerena iz izvornog LICENSE-a ili izvornog dokumenta.
- Imena osoba, tajne i stvarni podaci ne ulaze u ovaj dokument.

## 2. Pravni status Lekte (činjenice na pinanom SHA-u)

| Činjenica | Izvor (Lekta, SHA iznad) |
| --- | --- |
| `"license": "UNLICENSED"` | `package.json` |
| Nema datoteke LICENSE u korijenu repoa | popis datoteka na SHA-u |
| Repo je javan | popis repoa vlasnika |
| `PUBLIC` je razred u klasifikaciji staza, tj. smije li staza u javni preglednički bundle. Nije licenca za drugi proizvod | `data/classification.json` (`bundle: allowed`), `scripts/security/classification.mjs` |

Zaključak: javna vidljivost i razred `PUBLIC` ne daju Ductusu pravo preuzimanja. Za sve iz §3 treba vlasnikova pisana dozvola za vlastiti kod i podatke (D-217). Vlasnikova dozvola ne pokriva prava trećih (službeni dokumenti fakulteta, §5). Odluka o licenci i vidljivosti Lekte ostaje u Owner queueu (`STATE.md`, stavka „Lekta: licenca/pravo redistribucije”); rok za dozvolu je 15. 12. 2026. (D-218).

## 3. Što smije u minimalnu projekciju (`config/faculties/`)

Uvjeti za cijeli §3: pisana dozvola vlasnika (D-217), samo FPZG profili, samo vrste rada sa službenim izvorom (D-219), svaki uvoz na „Spoji n” (D-217), pravila ostaju konfiguracija (`docs/PRODUCT.md` §5 pravilo 12).

| Stavka | Smije? | Razlog | Izvor |
| --- | --- | --- | --- |
| Pravila oblika FPZG profila: raspon riječi i stranica, najmanji broj izvora, font, veličina, razmak, obvezni dijelovi | Da, kao vrijednosti | Pravila potječu iz službenih dokumenata fakulteta, a Ductus uvozi samo vrijednost i izvor, ne Lektin dokazni sloj (D-126) | `src/integrations/katedra-pack.ts`; `docs/ARCHITECTURE.md` §5c |
| Poveznica na službeni izvor pravila (naslov i URL), najviše pet po profilu | Da | Pravilo bez službenog izvora ne ulazi u profil (D-126); izvor je javni dokument fakulteta | polje `sources` u `katedra-pack.ts` |
| Identifikator profila, oznaka, status, vrste rada, datum provjere | Da | Potrebno za verziju paketa i test zanošenja (§5c) | `katedra-pack.ts` |
| Preporučeni citatni stil FPZG (konfiguracijska datoteka) | Da | Već dopušteno odlukom D-83; zamjenjuje se paketom u M4 | `data/tools/citation-specs/verified/**` (PUBLIC); D-83 |
| Elementi naslovnice samo iz službenog predloška ili propisa (`official-template`, `official-rules`) | Da, uvjetno | D-223: naslovnica samo iz službenih predložaka | `data/title-pages/README.md` (hijerarhija autoriteta) |
| Izvedeni oblik `dist-packs/katedra-pack(.min).json` kao polazište za projekciju | Samo filtriran na FPZG | Paket sadrži 135 jedinica i 423 profila, a Ductusu treba FPZG; ostalo je višak podataka bez namjene | `dist-packs/katedra-pack.json` (`meta.counts`) |

Verzija i hash paketa upisuju se uz projekciju, a zadatak pamti verziju paketa (§5c).

## 4. Što ne smije u projekciju

| Stavka | Razlog | Izvor |
| --- | --- | --- |
| Dokazni sloj profila: `data/profiles/*/drafts/**` (doslovan citat, stranica, `verifiedHash`, potpis), `verified-profiles.json`, `verified-profiles-heavy.json`, `repair-map.json`, `data/verification/**`, `data/sources/**` | Lektin razred `PROPRIETARY-DATA`, bundle `forbidden`; Lekta ih opisuje kao srž svoje zaštite | `data/classification.json` |
| `data/generated/**` | `SECURITY-SENSITIVE`; poslužiteljski artefakti | `data/classification.json` |
| Kanarinci `LEKTA-KANARINAC-*` | Služe za otkrivanje curenja; datoteka u kojoj se pojave ne smije u Ductus. Ako se pojave u projekciji, to je incident i zaustavlja se uvoz | `data/classification.json` (`canaries`) |
| Lektin kod (`src/**`: popravci, citati, DOCX) | `PUBLIC` je samo razred bundlea, a repo je `UNLICENSED`. Zajednički modul citiranja (§5c, druga faza) traži zasebnu pisanu dozvolu i zaseban zadatak | `package.json`; `data/classification.json` |
| `supabase/**` | `SECURITY-SENSITIVE` | `data/classification.json` |
| `docs/**`, `scripts/**`, `schemas/**`, `config/**`, `prototype/**`, `design/**`, `reference/**`, `src/verification/**` | Lektin razred `PRIVATE-IP` | `data/classification.json` |
| `tests/**`, svi fixturei | Stvarni studentski radovi (GDPR); u Ductusu ne smiju stvarni radovi ni osobni podaci | `data/classification.json`; `CLAUDE.md` Ductusa |
| Laya (`scripts/laya/**`, `docs/laya/**`, `schemas/**`) | `PRIVATE-IP`; nije predmet M4 | `data/classification.json` |
| „Konsenzus javnih radova” za naslovnicu, `data/title-pages/evidence/**`, PID-ovi uzoraka | D-223; dokazi su iz prvih stranica javnih radova autora, nemaju prava za preuzimanje | `data/title-pages/README.md` |
| Znak FPZG-a | D-223: ne koristi se dok ga FPZG ne dopusti | D-223 |
| Pravila bez službenog izvora i vrste rada bez službenog izvora | D-126, D-219: za njih stoji „provjera oblika za ovu vrstu rada nije dostupna” | D-126, D-219 |
| Sadržajne provjere i bodovi (npr. „tezna rečenica”) | D-221, D-222: samo formalna pravila sa službenim izvorom | D-221, D-222 |
| Prilagodbe mentora po radu | D-220: mentor ne mijenja pravila; nastavnik samo sužava unutar granica paketa | D-220 |
| `data/competitors/**`, `public/assets/**` (video, slike), `.claude/katedra-pkg/**` | Nisu pravila oblika; Lekta/Katedra-ov vlastiti sadržaj bez dozvole za drugi proizvod | popis datoteka na SHA-u |

## 5. Prava trećih i nepotvrđene stavke

| Stavka | Status | Napomena |
| --- | --- | --- |
| Službeni dokumenti fakulteta kao izvor pravila (upute, pravilnici) | **NEPROVJERENO** | Ni vlasnikova dozvola ni Lektina klasifikacija ne daju pravo preuzimanja teksta tuđih dokumenata. U projekciju idu vrijednosti pravila i poveznica, ne doslovni tekst. Primjenjivost na eseje i podneske potvrđuje FPZG (D-219) |
| Fontovi Instrument Serif i Geist Mono (Lekta ih isporučuje kao woff2 s OFL tekstovima) | **NEPROVJERENO** | U Lekti su kopije teksta SIL OFL 1.1 (`src/assets/fonts/OFL-*.txt`), nisu uspoređene s izvornim LICENSE datotekama autora. Ductura ih ne koristi (`docs/design/DESIGN-SYSTEM.md`), pa ne ulaze u projekciju |
| Ikone `lucide` (ovisnost u Lektinom `package.json`) | **NEPROVJERENO** | Licenca nije provjerena iz izvornog LICENSE-a. Ne ulazi iz Lekte; svaka uporaba u Ductusu ide kroz vlastitu provjeru ovisnosti |
| Hrvatski rječnik `src/audits/hr-dict` | **NEPROVJERENO** | Lekta navodi „LGPL/SISSL, 2003” u `DICTIONARY-LICENSE.txt`; tekst licencija nije provjeren. Jezična provjera nije u opsegu (D-222), pa ne ulazi |
| Sadržaj `data/checks/check-items.json`, `work-type-labels.json`, `work-type-scope.json`, `academic-deadlines.json` | Nije pregledan | Lekta ih označava `PUBLIC`, što nije licenca. Ne ulaze dok se ne pregledaju. Rokove po zadatku zadaje nastavnik u Ductusu |

## 6. Otvoreno za vlasnika (Owner queue, bez čekanja)

1. Pisana dozvola za §3 (oblik: komentar na #87 ili datoteka LICENSE/NOTICE u Lekti) s rokom 15. 12. 2026. (D-218).
2. Hoće li Lekta dobiti licencu i ostati javna (D-217: vidljivost Lekte je zasebna odluka).
3. Potvrda FPZG-a za primjenjivost na eseje i podneske i za objavu pravila (D-219).

Sljedeći koraci (Lekta strana): M4.2, paket i test zanošenja, izvodi Lekta sesija uz tiket povezan s DAN-392 (D-224). Ovaj dokument ga ne zamjenjuje.
