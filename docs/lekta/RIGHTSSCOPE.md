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
| Dokazni sloj profila: `data/profiles/*/drafts/**` (doslovan citat, stranica, `verifiedHash`, potpis), `verified-profiles-heavy.json`, `repair-map.json`, `data/verification/**`, `data/sources/**` | Lektin razred `PROPRIETARY-DATA`, bundle `forbidden`; Lekta ih opisuje kao srž svoje zaštite | `data/classification.json` |
| `data/profiles/verified-profiles.json` | Lektin razred `PROPRIETARY-DATA`, ali `bundle: derived` (izvor istine iz kojeg se generiraju projekcije index i heavy). To je status u Lekti, ne dozvola: odluka za Ductus je da ne ulazi, jer sadrži dokazni sloj; dopuštena je tek filtrirana projekcija iz §3 | `data/classification.json`; `scripts/gen-verified-split.mjs` |
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

### Ostala pravila Lektine klasifikacije (potpunost)

Izvor popisa: pravila 1 do 64 iz `data/classification.json` na SHA-u `c445a7193f08d1ca0f4c6a30b65fbbdbdbd338d2` (polje `note` izostavljeno). Vrijedi zadnje pravilo koje pogodi stazu (semantika kao `.gitignore`), pa npr. `data/profiles/fpzg-partial.json` (`PUBLIC`/`allowed`) nadjačava opće `data/**` (`PROPRIETARY-DATA`/`forbidden`). Zbog toga razred `PUBLIC` dolje nije licenca (§2).

Lekta za ove staze kaže `PUBLIC`/`allowed`. To je samo razred bundlea (§2), ne licenca. Sve niže je isključeno iz projekcije dok vlasnik ne da pisanu dozvolu i dok se sadržaj ne pregleda; iznimka su stavke već dopuštene u §3.

| Staza (pravilo) | Odluka | Razlog |
| --- | --- | --- |
| `data/catalog/**`, `data/coverage/**` | Ne ulazi (NEPROVJERENO) | Sadržaj nije pregledan; nije vrijednost pravila sa službenim izvorom |
| `data/submission/**`, `data/methodology/**` | Ne ulazi (NEPROVJERENO) | Sadržaj nije pregledan; D-221/D-222 dopuštaju samo formalna pravila sa službenim izvorom |
| `data/legal/**`, `data/declarations/**` | Ne ulazi (NEPROVJERENO) | Pravni tekstovi i izjave: autorstvo i prava nisu provjereni |
| `data/title-pages/**` | Samo kako je u §3 i §4 | D-223 |
| `data/tools/citation-specs/verified/**`, `verified-index.json` | Samo kako je u §3 (citatni stil, D-83) | D-83 |
| `data/profiles/fpzg-partial.json`, `profile-status.json`, `profile-authority.json`, `base-profiles.json`, `advisory-map.json`, `legal-departments.json`, `verified-profiles-index.json` | Ne ulaze izravno (NEPROVJERENO). FPZG vrijednosti stižu isključivo filtrirane iz paketa (§3, M4.2) | Datoteke nisu pregledane; mogu miješati više fakulteta i savjetodavni sloj izvan D-221 |
| `data/profiles/profile-claims.json` | Ne ulazi | Razine dokaza A–E su Lektin oblik provenijencije; Lektin dokazni sloj nije u opsegu (D-126) |
| `data/competitors/**`, `data/work-type-labels.json`, `data/work-type-scope.json`, `data/checks/**` | Ne ulaze (vidi i §5) | Nisu pregledane; `PUBLIC` nije licenca |
| `data/classification.json` | Ne ulazi | Lektin `PRIVATE-IP`; ovdje se samo čita kao izvor ovog inventara |
| `public/**`, `*.html`, `rad/*.html`, `moji-radovi/*.html`, `saznaj-vise/*.html`, `src/routes/shared/public-route-directory.json`, `src/assets/fonts/**` | Ne ulaze | Lektino sučelje, marketing i fontovi; nisu pravila oblika (fontovi: §5) |
| `src/ui/verification-console.ts`, `src/profiles/drafts-runtime.ts`, `src/profiles/advisory-demotion.ts`, `src/analysis/golden-entry.ts`, `src/repair/recipe.ts`, `src/repair/param-authority.ts`, `src/build/bundle-entry-graph.ts`, `src/corpus/{docx-shapes,prose-schema,tool-comparison,tool-feedback,tool-evals,defect-catalog,eval-catalog}.ts` | Ne ulaze | Lekta ih izdvaja kao `PRIVATE-IP` ili `SECURITY-SENSITIVE` (`forbidden`) unutar inače `PUBLIC` staze `src/**`; ionako je cijeli `src/**` isključen (§4) |
| Sve što nijedno pravilo ne pokriva | Ne ulazi | Lekta primjenjuje „deny-by-default”; isto vrijedi ovdje |

## 5. Prava trećih i nepotvrđene stavke

| Stavka | Status | Napomena |
| --- | --- | --- |
| Službeni dokumenti fakulteta kao izvor pravila (upute, pravilnici) | **NEPROVJERENO** | Ni vlasnikova dozvola ni Lektina klasifikacija ne daju pravo preuzimanja teksta tuđih dokumenata. U projekciju idu vrijednosti pravila i poveznica, ne doslovni tekst. Primjenjivost na eseje i podneske potvrđuje FPZG (D-219) |
| Fontovi Instrument Serif i Geist Mono (Lekta ih isporučuje kao woff2 s OFL tekstovima) | **NEPROVJERENO** | U Lekti su kopije teksta SIL OFL 1.1 (`src/assets/fonts/OFL-*.txt`), nisu uspoređene s izvornim LICENSE datotekama autora. Ductura ih ne koristi (`docs/design/DESIGN-SYSTEM.md`), pa ne ulaze u projekciju |
| Ikone `lucide` (ovisnost u Lektinom `package.json`) | **NEPROVJERENO** | Licenca nije provjerena iz izvornog LICENSE-a. Ne ulazi iz Lekte; svaka uporaba u Ductusu ide kroz vlastitu provjeru ovisnosti |
| Hrvatski rječnik `src/audits/hr-dict` | **NEPROVJERENO** | Lekta navodi „LGPL/SISSL, 2003” u `DICTIONARY-LICENSE.txt`; tekst licencija nije provjeren. Jezična provjera nije u opsegu (D-222), pa ne ulazi |
| Sadržaj `data/checks/check-items.json`, `work-type-labels.json`, `work-type-scope.json`, `academic-deadlines.json` | Nije pregledan | Lekta ih označava `PUBLIC`, što nije licenca. Ne ulaze dok se ne pregledaju. Rokove po zadatku zadaje nastavnik u Ductusu |

## 6. Otvoreno za vlasnika (Owner queue, bez čekanja)

1. ~~Pisana dozvola za §3~~ zapisana 2. 11. 2026. (§6a). Ostaje neobavezan LICENSE/NOTICE u Lekti, ako ga vlasnik poželi.
2. Hoće li Lekta dobiti licencu i ostati javna (D-217: vidljivost Lekte je zasebna odluka).
3. Potvrda FPZG-a za primjenjivost na eseje i podneske i za objavu pravila (D-219).

## 6a. Zapis dozvole i opseg distribucije (M4.1-P02, DAN-513)

Izvor: #87 [c.6578722946](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6578722946), zapisao orkestrator `claude:b:orchestrator`; uvjet iz D-217 i M4-Q1 (O1).

**Pisana dozvola vlasnika Lekte** (Daniel, 2. 11. 2026., doslovno): „Odobravam sve, pogotovo ovo za letku, pa to je moj projekt tako da mož.”

| Pitanje | Zapis |
| --- | --- |
| Što dozvola pokriva | Vlasnikov kod i podaci Lekte, u opsegu §3 (minimalna projekcija u `config/faculties/`, samo FPZG profili, samo vrste rada sa službenim izvorom, D-219) |
| Što dozvola ne mijenja | Isključenja iz §4 ostaju (to su odluke Ductusa, ne pravna ograničenja). Prava trećih iz §5 ostaju NEPROVJERENO; vlasnik ne može dati dozvolu za tuđe dokumente, fontove ni ovisnosti |
| Lektin kod (zajednički modul citiranja) | Nije potvrđeno da ga ovaj citat izričito obuhvaća: ostaje zasebna pisana potvrda i zasebni zadatak (§4). Pitanje je postavljeno na #1091 |
| Rok | Dozvola je stigla prije roka 15. 12. 2026. (D-218) |
| Oblik zapisa | Komentar na #87 i ovaj zapis (§6 t. 1 ranije); LICENSE/NOTICE u Lekti nije uvjet |

**Opseg distribucije paketa (O1, opcija 2):** oba repoa su javna, pa „privatni izvor” iz M4-Q1 znači privatni kanal. Paket izvodi Lekta sesija (D-224) i do Ductusa stiže privatnim kanalom (vlasnikov privatni prijenos), a ne kao javni artefakt Lekte. U javni repo Ductusa ulazi samo minimalna projekcija iz §3, uz verziju i hash paketa. Svaki uvoz paketa spaja se isključivo na „Spoji n” (D-217). Dozvola ne daje pravo na drugu distribuciju (npr. javno objavljen cijeli paket od 135 jedinica i 423 profila). Zapis ne rješava vidljivost ni licencu Lekte (§6 t. 2); ako Lekta postane privatna, privatni kanal ostaje bez promjene.

Sljedeći koraci (Lekta strana): M4.2, paket i test zanošenja, izvodi Lekta sesija uz tiket povezan s DAN-392 (D-224). Ovaj dokument ga ne zamjenjuje.
