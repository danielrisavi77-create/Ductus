# Dokument v2: navod i izvori

DAN-618, plan rb 217 M5.1-P03, `Risk: critical`. Ovo je ugovor bez koda. Određuje gornju razinu kanonskog dokumenta v2, zapis izvora, čvor navoda, format koraka `ductus-edit-steps-v2` i oblik v2 revizije nula. Kod dolazi u PR-ovima iz odjeljka 9 i mora imati testove iz odjeljka 10 prije prvog retka koda.

Izvori:
- D-225 (prijelaz na v2), D-226 (navod i izvori), D-134 preko D-266 (navod je čvor-atom);
- odgovori orkestratora na pitanja Q1 do Q6 iz #1711: #87 [c.6714929032](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6714929032) (dalje: „odgovor Qn”);
- B-8 i B-12 (`STATE.md`), D-98 dopuna (b) (`src/domain/document/revision-zero.ts`);
- plan napada #1711 (V1 do V4, K1 do K7, B1 do B6, N1 do N5, G1 do G4, klase 1 do 13, I1 i I2). Ugovor ga ne ponavlja, nego se poziva na njegove oznake;
- postojeći kod: `src/domain/document/{schema,validate,edit-step,revision-zero}.ts`, `src/adapters/evidence/edit-steps-v1-rules.ts`, `src/domain/citation/{types,format}.ts`, `db/migrations/20261019150000_evidence_open_work.sql` i kasnije redefinicije `app.open_student_work`.

Ugovor ne odlučuje ništa izvan D-225, D-226 i odgovora Q1 do Q6. Gdje ih provodi tehničkim izborom, to piše uz pravilo („izbor ugovora”), da review može provjeriti svaki takav izbor. Sve što ti izvori ne pokrivaju je u odjeljku „Poznate granice” ili ide kao BLOK na #1091.

## Invarijanta

Dokument v2 je jedan JCS (RFC 8785) objekt čiji SHA-256 pokriva tekst, navode i zapise izvora. Nijedan put (validator, snimka, korak, replay, rekonstrukcija, poslužitelj) ne mijenja, ne skraćuje i ne briše tiho ništa od toga. Rad ima jednu verziju od revizije nula do predaje, a v1 rad ostaje bajt-jednak (D-225; #1711 K1, K2, K5).

## 1. Gornja razina dokumenta v2

Dokument v2 ima točno tri ključa:

| Ključ | Oblik | Pravilo |
| --- | --- | --- |
| `schemaVersion` | JSON broj `2` | Kao danas: bilo što drugo daje `SCHEMA_VERSION_INVALID`, bez zaokruživanja (#1711 V2). |
| `nodes` | niz blokova | Pravila v1 (`NODES_EMPTY`, ID-evi, naslovi, oznake) vrijede nepromijenjena, uz čvor navoda iz odjeljka 3. |
| `sources` | niz zapisa izvora, 0 do 500 | Obavezan i u praznom radu (`[]`). Odsutan ili nije niz: `SOURCES_NOT_ARRAY`. Više od 500: `SOURCES_TOO_MANY`. |

- Skup ključeva je zatvoren. Bilo koji drugi ključ daje `UNKNOWN_FIELD`. Dokument v1 s ključem `sources` daje `UNKNOWN_FIELD`, kao i danas.
- Gornja razina određuje se jednom (odgovor Q4), jer je u hashiranim bajtovima. Kasnije obavezno polje bilo bi nova verzija sheme, ne izmjena v2.
- `DOCUMENT_FIELDS` postaje skup po verziji: v1 `{schemaVersion, nodes}`, v2 `{schemaVersion, nodes, sources}`. `DOCUMENT_BLOCK_TYPES_BY_VERSION` dobiva `2` sa skupom blokova v1. Jedini popis verzija je i dalje taj `Map` (#1711 V1).
- Redoslijed u `sources` je redoslijed upisa i dio je hasha. Validator ga ne sortira i ne traži sortiran. Prikaz i bibliografija sortiraju sami (`sortBibliography`).
- Granica od 2 MiB (`MAX_DOCUMENT_SNAPSHOT_BYTES`) vrijedi za cijeli dokument, zajedno sa `sources` (odgovor Q6; #1711 G1).

## 2. Zapis izvora

Jedan model izvora služi popisu izvora rada i bilježnici izvora (D-226). Bilježnica (M5.9) sprema isti zapis izvan dokumenta. Bilješke iz bilježnice nisu dio zapisa: zapis nema polje za bilješku, pa `note` daje `UNKNOWN_FIELD`. Zapis se temelji na postojećem `Source` iz `src/domain/citation/types.ts`, da formatiranje (`formatInText`, `formatBibliographyEntry`) ostane jedno.

### 2.1 Polja

Svaki zapis ima zajednička polja i polja svoje vrste. Skup polja po vrsti je zatvoren (`UNKNOWN_FIELD`). Obavezno polje koje nedostaje daje `SOURCE_FIELD_MISSING`.

| Vrsta (`type`) | Obavezna polja | Neobavezna polja |
| --- | --- | --- |
| sve | `id`, `type`, `authors`, `year`, `title` | nema |
| `book` | `place`, `publisher` | nema |
| `article` | `journal` | `volume`, `issue`, `pages` |
| `chapter` | `editors`, `bookTitle`, `place`, `publisher` | `pages` |
| `web` | `url`, `accessed` | nema |

- `type` izvan četiri vrijednosti daje `SOURCE_TYPE_INVALID`.
- `id` je kanonski UUID v4 malim slovima (isti uzorak kao ID čvora u koraku, `STEP_NODE_ID`). Nil UUID, velika slova i druga verzija daju `SOURCE_ID_INVALID`. Isti `id` dvaput u `sources` daje `SOURCE_ID_DUPLICATE`. ID izvora i ID-evi blokova su odvojeni prostori: `sourceId` nikad ne upućuje na blok.
- `year` je JSON cijeli broj od 1000 do 9999 (kao `checkSource`). Inače `SOURCE_YEAR_INVALID`.
- `accessed` je datum `YYYY-MM-DD` koji postoji u kalendaru (kao `formatAccessed`, bez obrezivanja razmaka). Inače `SOURCE_ACCESSED_INVALID`.
- `url` ima 1 do 2048 znakova, samo ispisivi ASCII (0x21 do 0x7E) i počinje s `http://` ili `https://`. Inače `SOURCE_URL_INVALID`. Postojanje adrese se ne provjerava (D-48 je val 2, D-227).
- Izbor ugovora: zapis nema `yearSuffix`. Slovo uz godinu (2020a, 2020b) izvodi `assignYearSuffixes` iz cijelog popisa pri formatiranju. Spremljeno slovo moglo bi se razići s popisom. Domenski tip za formatiranje ga i dalje prima, ali ga dokument ne nosi.

### 2.2 Autori i urednici

- `authors`: niz od 1 do 50 elemenata. Prazan ili dulji daje `AUTHORS_INVALID`.
- `editors` (samo `chapter`): niz od 1 do 20 osoba. Prazan, dulji ili s organizacijom daje `EDITORS_INVALID`.
- Osoba: `{ "kind": "person", "family", "given" }`, oba polja obavezna.
- Organizacija: `{ "kind": "organization", "name" }`, uz neobavezan `acronym`.
- Element koji nije objekt, ima nepoznat `kind`, nepoznato polje ili mu nedostaje polje daje `AUTHOR_INVALID`. Točan put (npr. `sources[3].authors[0].given`) ide u grešku.

### 2.3 Tekstna polja

Tekstna polja su `title`, `family`, `given`, `name`, `acronym`, `journal`, `volume`, `issue`, `pages`, `bookTitle`, `place` i `publisher`. Za svako vrijedi:
- JSON niz s 1 do N Unicode kodnih točaka, gdje je N iz tablice;
- bez razmaka na početku i kraju (Unicode `White_Space`). Validator ne obrezuje, nego odbija, jer jedno značenje ima jedan zapis (B-8);
- bez znakova iz skupa ZABRANJENO (odjeljak 3.2);
- bez Unicode normalizacije: bajtovi ostaju kakvi jesu.

Prekršaj daje `SOURCE_FIELD_INVALID` s putem polja.

| Polje | N |
| --- | --- |
| `title`, `bookTitle` | 1000 |
| `journal` | 500 |
| `name`, `publisher` | 300 |
| `family`, `given`, `place` | 200 |
| `acronym`, `volume`, `issue`, `pages` | 50 |

`pages` je tekst kakav je student upisao („12–15”). Crticu ujednačava `normalizePages` pri prikazu, ne pri spremanju.

## 3. Čvor navoda

### 3.1 Oblik

Navod je inline atom (D-134, D-226):

```json
{ "locator": "str. 12", "sourceId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "type": "citation" }
```

| Ključ | Pravilo | Greška |
| --- | --- | --- |
| `type` | točno `"citation"` | nepoznat tip: `INLINE_TYPE_INVALID` |
| `sourceId` | obavezan, kanonski UUID v4 malim slovima, nil odbijen | `CITATION_SOURCE_ID_INVALID` |
| `locator` | neobavezan; ako postoji, 1 do 100 kodnih točaka, bez znakova iz skupa ZABRANJENO | `CITATION_LOCATOR_INVALID` |

- Ništa drugo. Navod nema `marks`, `id`, `text` ni `children`; svaki drugi ključ daje `UNKNOWN_FIELD` (#1711 N2).
- Odsutan lokator znači „bez lokatora”. Prazan niz se odbija, da isto značenje nema dva zapisa (izbor ugovora).
- Lokator se ne obrezuje i ne normalizira. Odgovor Q6 ne zabranjuje razmake, pa je i `" "` valjan lokator (Poznate granice).
- Izbor ugovora: navod smije biti dijete bloka `paragraph`, `bulletItem` i `quote`, ali ne `heading`. U naslovu daje `CITATION_NOT_ALLOWED`. Kasnije dopuštanje u naslovu ne mijenja bajtove postojećih dokumenata, a obrnuto bi ih mijenjalo.
- U dokumentu v1 navod je i dalje `INLINE_TYPE_INVALID`. Navod u v1 radu ostaje tekstni oblik iz #866 (odgovor Q3; #1711 K3, N5).
- Tekstni čvorovi s obje strane navoda nisu susjedni u smislu `ADJACENT_TEXT_SAME_MARKS`. Dva navoda smiju stajati jedan do drugog. Odlomak smije sadržavati samo navod.
- Nema zasebne granice broja navoda; vrijedi granica dokumenta od 2 MiB (odgovor Q6; #1711 G4). Validator i replay rade iterativno, bez rekurzije po broju navoda.

### 3.2 Skup ZABRANJENO

Jedna konstanta u domeni vrijedi za lokator i za tekstna polja izvora, u validatoru i u parseru koraka. Pojam „znak nulte širine” iz odgovora Q6 ugovor prevodi u zatvoreni popis kodnih točaka. Tako ishod ne ovisi o verziji Unicode tablica u Nodeu, pregledniku ili PostgreSQL-u. Skup čine:
- kontrolni znakovi U+0000 do U+001F i U+007F do U+009F (uključuje NUL, tab i prijelom retka);
- usamljeni surogat: U+D800 do U+DFFF koji nije dio ispravnog para (u JSON-u kao `\ud800`);
- znakovi nulte širine i nevidljivi oblikovni znakovi: U+00AD, U+061C, U+180E, U+200B do U+200F, U+202A do U+202E, U+2060 do U+2064, U+2066 do U+206F i U+FEFF.

### 3.3 Siročad i brisanje (odgovor Q4)

- Navod čiji `sourceId` nije u `sources` je valjan. Validator ga ne odbija, ne briše i ne mijenja. Prikaz ga pokazuje kao navod bez izvora (M5.1-P05).
- Izvor na koji ne upućuje nijedan navod je valjan i ostaje u popisu.
- Brisanje izvora je dopušteno i ostavlja sve navode na njega, bajt-jednake. Nijedan put ne briše navode zbog brisanja izvora.
- Nepoznato polje ili čvor se odbija, nikad ne briše (B-8; #1711 N1 do N3).

## 4. Bibliografija

**Odluka ugovora: bibliografija se ne sprema u kanonski dokument. Uvijek se izvodi.** Dokument v2 nema čvor ni polje bibliografije.

Iz D-226 to slijedi ovako:
1. D-226 kaže da se bibliografija „generira iz izvora na koje navodi upućuju”. Ti izvori i navodi već su u hashiranim bajtovima, pa bibliografija ne nosi nijedan podatak koji hash već ne pokriva.
2. Spremljena kopija bila bi drugi zapis istog sadržaja. Mogla bi se razići s izvorima i navodima, a svako njezino osvježavanje bilo bi promjena hashiranih bajtova bez studentova unosa.
3. Oblik unosa ovisi o stilu fakulteta (`CitationStyle`), koji se mijenja s paketom pravila (D-117). Spremljen tekst zaključao bi jedan stil u evidenciju.
4. D-229 broji bibliografiju odvojeno od tijela teksta, pa nije dio teksta koji student piše.

Riječ „blok” iz D-226 ugovor čita kao način prikaza: bibliografija se prikazuje i izvozi kao zaseban blok nakon teksta. Izvođenje je zapisano ovdje, a provodi ga DAN-619 (funkcija) i M5.1-P05 (prikaz):
- ulaz: `nodes` i `sources` jednog dokumenta te stil iz konfiguracije fakulteta;
- unosi: izvori iz `sources` na koje upućuje barem jedan navod, svaki jednom, sortirani s `sortBibliography`, sa slovima iz `assignYearSuffixes`;
- navodi bez izvora ne daju unos, nego vidljivu oznaku uz bibliografiju s brojem takvih navoda (odgovor Q4);
- izvori bez navoda ne ulaze u bibliografiju, ali ostaju u popisu izvora rada;
- izvođenje je čista funkcija: isti dokument i isti stil daju isti niz unosa;
- izvođenje je totalno: svaki dokument valjan po odjeljcima 1 do 3 daje bibliografiju, bez iznimke. Postojeći `assignYearSuffixes` baca `CitationInputError` za više od 26 djela istih autora iste godine, a 500 izvora to dopušta. DAN-619 zato nastavlja slova nakon `z` s `aa`, `ab`, … (izbor ugovora), s graničnim testom za 26, 27 i 500 izvora istih autora i godine.

Ako vlasnik ili orkestrator „blok” čitaju kao spremljeni čvor, to je otvoreno pitanje. Kod se tada ne piše dok se ne odgovori na #1091.

## 5. Format koraka `ductus-edit-steps-v2`

Format v2 je format v1 (`src/domain/document/edit-step.ts`) uz tri dodatka. Sva ostala pravila v1 vrijede nepromijenjena: zatvoreni ključevi, zabranjeni `__proto__`, `constructor` i `prototype`, ID novog bloka `null`, `MAX_EDIT_STEP_BYTES`, kanonski oblik i kodovi odbijanja.

### 5.1 Navod u sliceu

- Slice smije sadržavati čvor navoda u istom obliku kao u dokumentu (odjeljak 3.1, s istim kodovima za `sourceId` i lokator).
- Pozicija unutar atoma ne postoji. Navod zauzima točno jednu poziciju, a `from`, `to` i `gapFrom` koji bi ga presjekli odbijaju se s `invalid_position` (#1711 B3).
- Koraci `addMark` i `removeMark` preko raspona s navodom ostavljaju navod nepromijenjenim, jer navod nema oznaka. Replay to drži testom.
- Format v1 i dalje odbija navod u sliceu s `invalid_node` (#1711 B4).

### 5.2 B-12 za svaki raspon s navodom

- Svaki korak koji uklanja raspon u kojem je barem jedan navod nosi `removedSha256`. Takvi su `replace` s `to > from`, izrezivanje i zamjena navoda tekstom.
- Hash se računa kao u v1: SHA-256 nad `removedRangeCanonical`, tj. JCS sliceom sa svim atributima, uključujući `sourceId` i `locator` (#1711 B1, B2).
- Korak sa `structure` uklanja samo granice blokova. Raspon koji sadrži navod sa `structure` odbija se s `not_canonical`.
- `replaceAround` (promjena vrste bloka) zadržava sadržaj bloka, pa i navode u njemu. Ako blok postaje `heading`, a sadrži navod, rezultat nije valjan dokument v2 i korak se odbija.

### 5.3 Koraci nad izvorima (izbor ugovora)

D-226 traži da zapise izvora pokrivaju hash i rekonstrukcija. Zato svaka promjena popisa `sources` mora biti korak koji replay ponavlja. Format v2 dodaje dvije vrste koraka:

| `stepType` | Ključevi (zatvoreni) | Učinak |
| --- | --- | --- |
| `sourceSet` | `stepType`, `source`, `removedSha256?` | Ako `source.id` ne postoji, zapis se dodaje na kraj popisa i `removedSha256` ne smije postojati. Ako postoji, zapis se zamjenjuje na istom mjestu, a `removedSha256` je obavezan: SHA-256 JCS-a starog zapisa. |
| `sourceRemove` | `stepType`, `sourceId`, `removedSha256` | Uklanja zapis s tim `id`-em. `removedSha256` je SHA-256 JCS-a uklonjenog zapisa. Navodi ostaju. |

- `source` mora proći pravila odjeljka 2. Nevaljan zapis daje `invalid_value` s putem polja.
- Nepostojeći `sourceId` u `sourceRemove` daje `invalid_position`. Pogrešan ili nedostajući hash daje `invalid_removed_hash` ili `missing_field`.
- Svaki korak mora ostaviti valjan dokument v2. Na primjer, `sourceSet` koji bi napravio 501. izvor odbija se s `invalid_value`.
- Kako editor (DAN-620) sprema popis u Tiptapu, ugovor ne propisuje. Snimanje mora svaku promjenu popisa zapisati kao ove korake, a nijedna se ne smije dogoditi bez koraka.

### 5.4 Izbor formata i nepodudaranje (odgovor Q5)

- Replay bira format prema `schemaVersion` revizije nula rada: `1` znači `ductus-edit-steps-v1`, a `2` znači `ductus-edit-steps-v2`.
- `captureContext.transactionFormat` odsječka mora odgovarati tom formatu. Nepodudaranje se odbija bez upisa.
- Format v1 nad v2 radom se odbija, kao i obrnuto. Ništa se ne upisuje, a dnevnik klijenta se ne briše. Oporavak ne pretvara korake iz jednog formata u drugi.
- `parseEditSteps` prima oba formata i za nepoznat format vraća `unsupported_format`, kao danas. Poslužitelj ne bira format prema tome što je klijent poslao, nego prema reviziji nula.
- Validator odsječka `src/domain/forensics/evidence-segment-v2.ts` danas prima samo `ductus-edit-steps-v1` (retci 81 i 363). Mora primati oba formata, a nepoznat format i dalje odbija. Bez toga poslužitelj odbija svaki valjan odsječak v2.
- DAN-619 ne proširuje taj validator bez provjere naspram revizije nula iz sljedeće točke. Validator je dio poslužiteljskog prihvata (`verifyCanonicalEvidencePayloadV2`), pa bi sam prihvaćao odsječak v2 i za v1 rad. Zato proširenje ide u korak baze 1, u istom PR-u s tom provjerom (odjeljak 7, točka 6).
- Provjera nepodudaranja je u poslužiteljskom prihvatu (`src/server/evidence/evidence-commit-request.ts`), prije `putImmutable`. Kontekst commita (`app.evidence_commit_context`, `readEvidenceCommitContext`) vraća verziju rada izvedenu iz revizije nula. Danas je ne vraća, a ni RPC ni descriptor ne nose format. Odbijeni odsječak ne sprema objekt i ne upisuje ništa.
- `src/editor/capture.ts` piše `transactionFormat` prema verziji otvorenog rada, a ne konstantu.

## 6. v2 revizija nula

Oblik prema odgovoru Q1: struktura kao u v1 (jedan prazan odlomak s fiksnim ID-om `00000000-0000-4000-8000-000000000000`, polje `children` prazan niz), uz `schemaVersion: 2` i `sources: []`. JCS te vrijednosti ima ključeve redom `nodes`, `schemaVersion`, `sources`.

- Točne bajtove i SHA-256 daje zlatni vektor u PR-u koji ih uvodi (DAN-619). Ugovor ih ne navodi i ne izmišlja.
- Postojeće konstante v1 (`REVISION_ZERO_JCS`, `REVISION_ZERO_SHA256` = `a102ced8…ad14b`) ostaju nepromijenjene i vrijede za postojeće radove (#1711 K6). DAN-619 dodaje zasebne konstante v2 uz njih.
- Vektor v2 mora se u istom PR-u uspoređivati sa zapisanim heksom, a ne s ponovnim izračunom. Domena i SQL literal moraju dati isti hash.

## 7. Korak baze

Dva zasebna PR-a (odgovori Q1, Q2; redoslijed iz odjeljka 9, orkestrator #1091 [c.6715141315](https://github.com/danielrisavi77-create/Ductus/issues/1091#issuecomment-6715141315)). Svaka promjena u `db/migrations/` je nova migracija, a stare se ne mijenjaju.

Korak baze 1, nakon DAN-619 i prije DAN-620 (točke 1, 3, 4 i 6). Ne mijenja koju verziju dobiva novi rad, pa svi radovi, i novi, ostaju v1.

Korak baze 2, nakon DAN-620 (točka 2). Tek on uključuje v2 za nove radove.

1. Nova funkcija vraća v2 literal revizije nula. `evidence.revision_zero_document()` (v1) ostaje nepromijenjena.
2. `app.open_student_work` za novi rad, u istoj transakciji u kojoj upisuje `evidence.document`, reviziju 0 i kontrolnu točku, upisuje v2 reviziju nula. Rad otvoren prije migracije koraka baze 2 ostaje v1. Trenutak prihvata v2 je ta migracija, a ne spajanje domene, editora ni izdanje.
3. Verzija rada je `schemaVersion` u hashiranim bajtovima revizije nula. Ugovor ne uvodi zaseban stupac kao drugi izvor istine. Ako ga korak baze uvede radi upita, mora biti izveden iz revizije nula u istoj transakciji i provjeren testom.
4. Svaka sljedeća revizija mora imati istu `schemaVersion` kao revizija nula, inače se odbija bez upisa (#1711 K5, K7). Provjera je na poslužitelju u istoj transakciji kao upis revizije i vrijedi i za v1 radove (revizija v2 za v1 rad se odbija).
5. Postojeća pravila otvaranja ostaju: jedinstveni ključ odlučuje, a ne prethodni upit (komentar u `20261019150000_evidence_open_work.sql`); vrijede i zaključavanje i provjere iz `20261104100000_group_scope.sql`.
6. `app.evidence_commit_context` vraća verziju rada izvedenu iz revizije nula, a `commitEvidenceRequest` prije `putImmutable` odbija odsječak čiji `transactionFormat` ne odgovara toj verziji (odjeljak 5.4). Vrijedi i za v1 radove. U istom PR-u validator odsječka počinje primati `ductus-edit-steps-v2`.

## 8. Istodobnost

**I1. Stara kartica ili offline dnevnik s koracima v1 za v2 rad.**
- Poslužitelj vidi `schemaVersion: 2` revizije nula i odbija odsječak s formatom v1 (odjeljak 5.4). Ništa se ne upisuje.
- Dnevnik klijenta se ne briše i ostaje za oporavak. Klijent ne prikazuje spremljeno (F-3/F-8).
- Obrnut slučaj, koraci v2 za v1 rad, odbija se jednako.
- Obavezan negativni test u DAN-619 (parser i replay) i u koraku baze 1 (poslužitelj): integracijski test kroz `commitEvidenceRequest` pokazuje da odbijeni odsječak ne poziva `putImmutable` i ne upisuje reviziju.

**I2. Dva istodobna `app.open_student_work` za isti rad u trenutku migracije koraka baze 2.**
- Migracija je jedna transakcija. Poziv koji je počeo prije nje vidi staru funkciju i upisuje v1. Poziv poslije nje upisuje v2.
- Jedinstveni ključ rada i revizije u istoj transakciji odlučuje da postoji točno jedna revizija nula, pa i jedna verzija rada. Drugi poziv vraća postojeći rad, ne upisuje drugu reviziju nula i ne mijenja verziju.
- Obavezan test u koraku baze 2: dvije sesije otvaraju isti rad istodobno. Ishod je jedna revizija 0, jedan hash i ista verzija u oba odgovora. pgTAP test da revizija s drugom `schemaVersion` od revizije nula nije upisana ide već u korak baze 1.

## 9. Redoslijed PR-ova koda

1. **DAN-619, domena** (`src/domain/document`, `src/domain/citation`, `src/domain/forensics`, `src/adapters/evidence`, zlatni vektori): shema v2, validator, `ductus-edit-steps-v2` s replayerima (Node i preglednik), v2 konstante revizije nula, izvođenje bibliografije i domenski potrošači `InlineNode` iz odjeljka 9.1. Validator odsječka ne proširuje (odjeljak 5.4). Ako prijeđe oko 400 redaka, dijeli se tim redom:
   - (a) shema, validator i vektori;
   - (b) format koraka v2 i replay;
   - (c) bibliografija.
   Nijedan dio ne mijenja `app.open_student_work`, pa novi rad ne može postati v2 prije koraka baze 2.
2. **Korak baze 1** (odjeljak 7, točke 1, 3, 4 i 6): v2 funkcija revizije nula, provjera iste verzije na svakoj reviziji, provjera formata u poslužiteljskom prihvatu i validator odsječka koji prima oba formata, s pgTAP testom i integracijskim testom iz odjeljka 8 (I1). Integracijski test kroz stvarni commit put (`commitEvidenceRequest`) na v2 radu iz testnog fixturea prihvaća odsječak v2 i odbija odsječak v1, prije nego korak baze 2 uključi v2 za nove radove. v1 radovi ostaju kakvi jesu i novi radovi su i dalje v1.
3. **DAN-620, Tiptap i prikaz (M5.1-P05)**: čvor navoda u editoru, snimanje koraka v2 i izvora te komponente potrošači `InlineNode` iz odjeljka 9.1. Editor bira format (`transactionFormat`) i oblik dokumenta prema verziji revizije nula, pa radi i na v1 i na v2 radovima. Tekstni navodi iz #866 ostaju tekst (D-226).
4. **Korak baze 2** (odjeljak 7, točka 2): `app.open_student_work` počinje stvarati v2 radove, s integracijskim testom iz odjeljka 8 (I2). To je trenutak prihvata iz odgovora Q2. Spaja se tek kad su svi potrošači iz odjeljka 9.1 gotovi u DAN-619 i DAN-620, svaki sa svojim testom.

Svaki od ova četiri PR-a ostavlja `main` zelen, uključujući e2e. Redoslijed je odluka orkestratora na BLOK ovog ugovora (#1091 [c.6715141315](https://github.com/danielrisavi77-create/Ductus/issues/1091#issuecomment-6715141315), izbor (A)). Razlog: da korak baze uključi v2 prije DAN-620, editor bi i dalje slao `ductus-edit-steps-v1` (`src/editor/capture.ts`) i dokument bez `sources` (`src/editor/interop.ts`), pa bi poslužitelj odbio spremanje novog rada (odjeljci 5.4 i 7).

### 9.1 Potrošači `InlineNode`

Na `main` je `InlineNode` samo tekstni čvor (`src/domain/document/schema.ts:110`). Ovi potrošači čitaju `child.text` ili `child.marks` bez provjere tipa, pa bi na navodu pali ili ga tiho izostavili. Dodjela je odluka orkestratora (#1091, zadatak kruga popravka). Ishod za navod je jedan od dva:

- **vidljiv prikaz:** navod se pokazuje u obliku iz `formatInText` za izvor iz istog dokumenta, a navod bez izvora kao vidljiva oznaka (odjeljak 3.3);
- **jedna pozicija bez znakova:** u tekstu za sidra i sukobe navod ne dodaje znakove i ne pomiče pomake, a ostaje zaseban čvor, ne ispušta se iz dokumenta.

Nijedan potrošač navod ne izostavlja tiho, ne pretvara u tekstni čvor i ne baca iznimku na valjanom dokumentu v2.

| Potrošač | Mjesto na `main` | Ishod za navod | PR |
| --- | --- | --- | --- |
| `normalizeChildren` | `src/domain/document/normalize.ts:34` | navod ostaje zaseban čvor, bajt-jednak; susjedni tekstni čvorovi se ne spajaju preko njega | DAN-619 |
| `childrenEqual` | `src/domain/document/equality.ts:20` | navodi su jednaki samo uz isti `sourceId` i `locator`; navod nikad nije jednak tekstu | DAN-619 |
| `textBlocksOf` (brzi put nastavnika) | `src/domain/document/text-blocks.ts:20` | vidljiv prikaz u tekstu bloka | DAN-619 |
| naslov poglavlja | `src/domain/document/chapters.ts:82` | navod u naslovu je nevaljan (`CITATION_NOT_ALLOWED`, klasa 23); na valjanom v2 dokumentu naslov je nepromijenjen | DAN-619 |
| `wordCount` (sukob) | `src/domain/sync/conflict.ts:300` | jedna pozicija bez znakova | DAN-619 |
| `wordCount` (oporavak) | `src/domain/sync/recovery.ts:143` | jedna pozicija bez znakova | DAN-619 |
| `Block` (pregled predaje) | `src/components/student/SubmissionView.ts:54` | vidljiv prikaz | DAN-620 |
| `Block` (živi prikaz nastavnika) | `src/components/teacher/LiveText.tsx:53` | vidljiv prikaz; za oznake komentara jedna pozicija bez znakova | DAN-620 |
| `blockText`, `blockSegments` (sidra, D-133) | `src/components/teacher/comment-place.ts:16`, :78 | jedna pozicija bez znakova u citatu i pomacima sidra; u segmentima zaseban dio za prikaz | DAN-620 |
| `earlierDraftText` | `src/components/editor/earlier-draft.ts:28` | vidljiv prikaz u kopiranom tekstu | DAN-620 |

Svaki potrošač dobiva test na dokumentu v2 s navodom na izvor i sa siročetom: ishod iz tablice, bez iznimke. Korak baze 2 se ne spaja dok svi retci tablice nemaju spojen test (odjeljak 9, točka 4). Novi potrošač `InlineNode` dodan prije koraka baze 2 ulazi u ovu tablicu u istom PR-u.

## 10. Klase ulaza i obavezni testovi

DAN-619 ima tablični test (jedan redak po klasi i zapisan ishod, uključujući kod greške) i fast-check test sa svojstvima (a) do (d) iz #1711 §6, za validator i za parser koraka v2. Klase 1 do 13 iz #1711 vrijede. Ovaj ugovor ih proširuje:

| Klasa | Ulaz | Ishod |
| --- | --- | --- |
| 14 | v2 bez `sources`, `sources` nije niz, `sources` u v1 | `SOURCES_NOT_ARRAY`; za v1 `UNKNOWN_FIELD` |
| 15 | 0, 1, 500 i 501 izvor | prihvat do 500; 501: `SOURCES_TOO_MANY` |
| 16 | `id` izvora: velika slova, nil, v1 UUID, dvostruki | `SOURCE_ID_INVALID` ili `SOURCE_ID_DUPLICATE` |
| 17 | `type` izvan četiri vrijednosti; polje druge vrste (npr. `url` na `book`); `note`; `yearSuffix` | `SOURCE_TYPE_INVALID` ili `UNKNOWN_FIELD` |
| 18 | `year` 999, 10000, 2020.5, `"2020"`; `accessed` 2026-02-30, `2026-1-5`, s razmakom | `SOURCE_YEAR_INVALID` ili `SOURCE_ACCESSED_INVALID` |
| 19 | `authors` prazan i s 51 elementom; `editors` s organizacijom; osoba bez `given` | `AUTHORS_INVALID`, `EDITORS_INVALID` ili `AUTHOR_INVALID` |
| 20 | tekstno polje: prazno, s razmakom na rubu, N i N+1 kodnih točaka, sa znakom iz skupa ZABRANJENO | prihvat do N; inače `SOURCE_FIELD_INVALID` |
| 21 | `url`: `ftp:`, razmak, ne-ASCII, 2048 i 2049 znakova | prihvat do 2048; inače `SOURCE_URL_INVALID` |
| 22 | lokator: odsutan, `""`, 1, 100 i 101 kodna točka; 100 znakova izvan BMP-a (200 UTF-16 jedinica); svaki raspon iz ZABRANJENO | prihvat do 100 kodnih točaka; inače `CITATION_LOCATOR_INVALID` |
| 23 | navod s `marks`, `id`, `text`, `__proto__`; navod u `heading` | `UNKNOWN_FIELD` ili `CITATION_NOT_ALLOWED` |
| 24 | navod siroče; izvor bez navoda; dva navoda uzastopno | prihvat, bez promjene bajtova |
| 25 | korak v2: uklanjanje raspona s navodom bez hasha, s krivim hashom i s hashom drugog lokatora | `missing_field` ili `invalid_removed_hash` |
| 26 | korak v2: raspon unutar atoma; `structure` preko navoda; `replaceAround` u `heading` s navodom | `invalid_position` ili `not_canonical` |
| 27 | `sourceSet` novi i postojeći, sa i bez `removedSha256`; `sourceRemove` nepostojeći i s krivim hashom | prema odjeljku 5.3 |
| 28 | format v1 nad v2 radom i obrnuto; `transactionFormat` koji se ne slaže s revizijom nula | odbijeno, ništa upisano |
| 29 | po jedno izostavljeno obavezno polje za svaku vrstu iz odjeljka 2.1 (npr. `book` bez `publisher`, `article` bez `journal`, `chapter` bez `editors`, `web` bez `accessed`) i za zajednička polja | `SOURCE_FIELD_MISSING` |
| 30 | `editors` na `chapter` s 0, 1, 20 i 21 osobom | prihvat od 1 do 20; 0 i 21: `EDITORS_INVALID` |

Dodatna svojstva za fast-check:
- (e) bibliografija je deterministička i ne ovisi o redoslijedu u `sources`;
- (f) replay nasumičnog niza koraka v2 (umetanje i brisanje navoda, `sourceSet` i `sourceRemove`) iz v2 revizije nula daje JCS bajt-jednak dokumentu koji je editor proizveo, u oba replayera (#1711 B5);
- (g) nijedan korak ne mijenja navod osim koraka koji ga uklanja s ispravnim `removedSha256`.

Generatori koriste samo sintetičke podatke iz #1711: „Izvor 1”, „str. 12” i UUID-e oblika `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`. Nema stvarnih radova, osoba, knjiga ni DOI-ja.

## Mjesta

- Ovaj PR: samo `docs/contracts/document-schema-v2.md`.
- DAN-619: `src/domain/document/{schema,validate,edit-step,revision-zero}.ts`, potrošači iz odjeljka 9.1 (`src/domain/document/{normalize,equality,text-blocks,chapters}.ts`, `src/domain/sync/{conflict,recovery}.ts`), `src/adapters/evidence/edit-steps-v1-rules.ts` i novi replayeri v2, `src/domain/citation/` (izvođenje bibliografije), `src/domain/forensics/golden-vectors/` (rezervacija i vektori v2, #1711 V3).
- Korak baze 1: nova migracija za v2 funkciju revizije nula, provjeru verzije i verziju rada u `app.evidence_commit_context`; `src/server/evidence/{evidence-commit,evidence-commit-request}.ts` (provjera formata naspram revizije nula u `commitEvidenceRequest`, prije `putImmutable`; port `src/application/ports/evidence-ingest.ts` format ne nosi i ostaje bez te provjere); `src/domain/forensics/evidence-segment-v2.ts` (retci 81 i 363: prima oba formata, tek uz tu provjeru, odjeljak 5.4); `db/tests/` i integracijski test commita.
- Korak baze 2: nova migracija za `app.open_student_work`, `db/tests/` i integracijski test.
- DAN-620: `src/editor/` (shema, `capture.ts`), potrošači iz odjeljka 9.1 (`src/components/student/SubmissionView.ts`, `src/components/teacher/{LiveText.tsx,comment-place.ts}`, `src/components/editor/earlier-draft.ts`); `src/components/editor/sources.ts` ostaje za v1 radove.
- Napomena: DAN-619 ne proširuje parser odsječka (`evidence-segment-v2.ts`) bez provjere formata naspram revizije nula. Inače bi se između DAN-619 i koraka baze 1 prihvaćao odsječak v2 za v1 rad.

## Stvarni pozivatelj

- `app.open_student_work` (upis revizije nula i verzije rada).
- Upis revizije i odsječka evidencije na poslužitelju (provjera iste verzije i formata).
- Replay i rekonstrukcija pri predaji (`evidence-replay-v2.ts`, `projection/replay-timeline.ts`).
- Editor i snimanje koraka (`src/editor/capture.ts`) od DAN-620.

## Poznate granice

- Lokator od samih razmaka (`" "`) je valjan, jer odgovor Q6 ne zabranjuje razmake. Editor ga može obrezati prije umetanja, ali validator ga ne mijenja.
- U+2028 i U+2029 nisu u skupu ZABRANJENO, jer nisu ni kontrolni znakovi ni znakovi nulte širine. Proširenje skupa promijenilo bi koji su dokumenti valjani, pa se ne radi bez odluke.
- Izvor bez godine („b. d.”), DOI, ISBN i vrste izvan četiri postojeće nisu u v2. Dodavanje neobaveznog polja ili nove vrste ne mijenja bajtove postojećih dokumenata, ali traži izmjenu ovog ugovora.
- Granice duljina (odjeljak 2.3) i 500 izvora su izbor ugovora prema odgovoru Q6. Nisu izmjerene na stvarnim radovima.
- Bilježnica izvora (M5.9) sprema isti zapis izvan dokumenta. Kako ga sprema i štiti, određuje njezin ugovor.
- Prikaz navoda bez izvora i oznaka u bibliografiji pripadaju M5.1-P05. Ovaj ugovor određuje samo da se ne brišu i da su vidljivi.

## Što bi ovaj PR moglo oboriti na QA-i?

- Čitanje „blok” iz D-226 kao spremljenog čvora (odjeljak 4). Ako review tako čita, to je BLOK, a ne popravak u ovom PR-u.
- Koraci `sourceSet` i `sourceRemove` (odjeljak 5.3) su tehnički izbor ugovora koji provodi D-226 i odgovor Q5. Drugi oblik je moguć, ali svaka promjena popisa izvora mora biti korak s B-12 hashom.
- Pravilo „nema navoda u naslovu” je izbor ugovora. Kasnije ga je moguće olabaviti, a ne pooštriti.
