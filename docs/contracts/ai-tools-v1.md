# Upute poslužitelja, omeđeni podaci i alati pomoćnika v1 (C-37)

DAN-401, plan rb54 M9.0-S3. Ovo je ugovor bez koda. Određuje:
- kako poslužitelj sastavlja upute i omeđuje nepouzdane podatke;
- kako se računa dopušteni skup alata po zadatku;
- kako se čuva odlazni dohvat;
- koje su granice izlaza;
- kako se proširuju port i sintetički adapter iz `ai-request-v1.md`;
- koji testovi moraju postojati prije prvog retka koda.

Izvori:
- `docs/PRODUCT.md` §5 pravilo 16 i §8 (C-37, C-38, D-46);
- D-64, D-194 t. 2 i 4, D-267 O9 i O10, D-268 O2 i O4, D-270 O11, D-263 Q03;
- `docs/backend/poslovi-i-predaja.md` §4.5 („Alati pružatelja”, odluka vlasnika 1. 11. 2026., #87 c.6551403710);
- `docs/contracts/ai-request-v1.md` (M9.0-S2): tablice, stanja, RPC-ovi, port i ishodi koje ovaj ugovor proširuje, a ne mijenja;
- katalog svrha `src/domain/assistant/purpose-catalog.ts` (DAN-402).

Plan napada je #1664. Ovaj ugovor se poziva na njegove oznake i ne ponavlja ih:
- S3-U1 do S3-U5, S3-O1 do S3-O5, S3-D1 do S3-D6;
- S3-N1 do S3-N5, S3-I1 do S3-I5, S3-K1 do S3-K3;
- S3-Z1, S3-S1 do S3-S3;
- otvorena pitanja [OC-1] do [OC-5].

Stavke iz #1662 (R, P, T, G, M, Z, I, S) i #1659 (C10, C11) zadržavaju svoje oznake. Ako se ovaj ugovor razlikuje od #1662 ili #1664, vrijedi stroža stavka, a neslaganje ide na #1091.

## Što ugovor ne odlučuje

- Pružatelja i model računa (D-194 t. 6 i 7, D-267 O1: PRIJEDLOG) ne bira. Oni ostaju otvoreni za vlasnika pod Q-10 ([OA-1], [O-1]). Testovi koriste `provider-test-a` i `model-test-1` iz `ai-request-v1.md`.
- Gdje živi prekidač ustanove i tko ga mijenja je [OC-1]. Do odluke prekidač je u kodu konstanta „isključeno” (odjeljak „Prekidač ustanove”), bez tablice, polja konfiguracije i RPC-a.
- Odredišta pretrage i sadržaj upita su [OC-2]. Do odluke je popis odredišta u kodu prazan, pa alat pretrage nije u dopuštenom skupu ni kad je sve ostalo uključeno.
- Izvršavanje koda i datoteke pružatelja su [OC-3]. Nisu u zatvorenom skupu alata, a ugovor ih ne dodaje ni iza prekidača.
- Ulaz za transkripciju je [OC-4]. Gradi se samo zastavica prekidača; vrsta podataka za transkript nije u ovoj verziji.
- Čuvanje rezultata alata, upita i zapisa odbijenih koraka je [OC-5] ([OA-3], D-30 PRIJEDLOG). Ugovor sadržaj rezultata i upita ne sprema; sprema samo metapodatke (L1) i hash.

## Načela

| Pravilo | Ugovor | Plan |
| --- | --- | --- |
| Upute su funkcija samo stanja poslužitelja | `composeInstructions` je čista funkcija verzije pravila zadatka, svrhe i verzije kataloga. Nema ulaz za odlomak, povijest, rezultat alata, odgovor ni zaglavlje. | S3-U1, S3-U4 |
| Podaci nikad ne ulaze u kanal uputa | Port ima zasebno polje `instructions` i niz dijelova `data`. Ductus nikad ne spaja podatak s uputama u isti niz znakova. | S3-O1 |
| Dopušteni skup alata je presjek | zatvoren skup u kodu ∩ prekidač ustanove ∩ alati koje je nastavnik uključio za zadatak ∩ alati spremni za rad (pretraga: neprazan popis odredišta). Računa se u bazi za svaki korak. | S3-D1, S3-Z1 |
| Nijedan alat ne dohvaća adresu iz teksta | Sloj alata nema funkciju koja prima adresu. Pretraga prima samo ID odredišta s poslužiteljskog popisa i upit. | S3-N2, S3-N3 |
| Izlaz je ograničen i nije radnja | Rezultat alata, broj koraka i odgovor imaju granice. Zahtjev alata vrijedi samo iz strukturiranog polja izlaza porta, a tekst odgovora se prikazuje kao tekst. | S3-I1 do S3-I5 |
| Put AI-ja ne piše pravila | Uloga baze i kod rute AI-ja nemaju pravo pisanja u pravila zadatka, postavku alata ni prekidač. | S3-U5 |

## Sastav uputa

- `composeInstructions(rules, purpose, catalogVersion)` vraća upute u kodu za svrhu iz te verzije kataloga. `rules` je zatvoren tip iz verzije zadatka koja vrijedi (`ai_policy`, svrhe). Funkcija je čista i bez I/O-a.
- Za isti ulaz izlaz je bajtovno isti. Test uspoređuje sve snimljene pozive s referentnim izlazom za (zadatak, svrha, verzija). To je svojstvo 1 iz S3-K2.
- Upute ne ovise ni o dopuštenom skupu alata. Alati idu u zasebno polje porta, pa opoziv alata između koraka (S3-Z1) ne mijenja upute.
- Svrhe u verzijama kataloga 1 i 2 nemaju parametar. Zahtjev s parametrom svrhe se odbija s `invalid_request` (Z4, Z5 iz #1662; S3-U3). Parametar se smije uvesti samo u novoj verziji kataloga, kao zatvoren skup vrijednosti koji ulazi u upute iz koda, nikad kao tekst iz zahtjeva.
- Povijest razgovora čita se iz `assistant.message` na poslužitelju. Tijelo zahtjeva nema polje za povijest, ulogu ni poruku (S3-U2).

## Omeđeni podaci

Svaki nepouzdani podatak ide portu kao jedan dio `{ kind, text, truncated }`. `kind` postavlja poslužitelj iz zatvorenog skupa:

| `kind` | Što | Izvor |
| --- | --- | --- |
| `paragraph` | odlomak tekućeg zahtjeva, i kad sadrži tekst iz uvezene datoteke | zahtjev, nakon Z9 i Z10 |
| `prior_paragraph` | odlomak ranijeg zahtjeva istog razgovora | `assistant.message`, `student_paragraph` |
| `prior_response` | raniji odgovor pružatelja istog razgovora | `assistant.message`, `provider_response` |
| `tool_result` | rezultat izvršenog koraka alata | čuvar dohvata, nakon S3-I1 |
| `tool_denied` | odbijen korak; tekst je kod iz zatvorenog skupa, ne slobodan tekst | vrata alata |

- Polje `truncated` postavlja samo poslužitelj (S3-I1). Oznaka skraćenja nije tekst unutar podatka, pa je podatak ne može krivotvoriti.
- Stvarni adapter dijelove predaje strukturirano, kao zasebne dijelove poruke pružatelja, kad pružatelj to podržava. Inače ih kodira funkcijom `encodeDataParts` iz `src/domain/assistant`: JSON niz objekata `{kind, text, truncated}` sa standardnim izbjegavanjem znakova. Upute kažu da je sve u tom nizu podatak. Ductus ne izmišlja vlastiti omeđivač.
- Svojstvo povratnog puta (S3-O2, svojstvo 4 iz S3-K2): `decodeDataParts(encodeDataParts(p))` jednako je `p`, a broj dijelova jednak je broju ulaza. To vrijedi i kad tekst sadrži navodnike, kose crte, nizove koji nalikuju JSON-u ili oznaci vrste te bilo koji znak koji Z10 propušta.
- Z10 iz `ai-request-v1.md` vrijedi za svaki dio koji odlazi, ne samo za odlomak (S3-O4). To uključuje rezultate alata. Znakovi koje sučelje studentu ne prikazuje (Z10 i znakovi za smjer teksta) se u odlomku odbijaju, a u rezultatu alata uklanjaju prije granice S3-I1.
- Ukupna granica podataka `DATA_MAX_BYTES` (S3-O5) broji UTF-8 bajtove nakon NFC-a. Tekući `paragraph` i dijelovi alata tekućeg zahtjeva se nikad ne izostavljaju. Ako zbroj prelazi granicu, izostavljaju se cijeli dijelovi povijesti od najstarijeg; poruka se nikad ne reže po sredini. Upute se nikad ne skraćuju.
- Konstante zadovoljavaju `DATA_MAX_BYTES ≥ 4 × PARAGRAPH_MAX + TOOL_STEP_MAX × TOOL_RESULT_MAX_BYTES`. Jedinični test to provjerava nad konstantama, pa tekući zahtjev uvijek stane.
- Skriveni tekst iz DOCX-a i PDF-a uklanja uvoz (M8.2 DAN-396, M8.3 DAN-397; bilježenje M8.9 DAN-436). Ovaj ugovor traži samo test s kraja na kraj iz S3-O3, od uvoza do snimljenog poziva. Ako M8.2 ili M8.3 nisu spojeni, PR to navodi, a test ulazi s njima.

## Prekidač ustanove

- Prekidač ima dvije zastavice, `transcription` i `tools`, obje isključene po zadanom (D-267 O10). Dvije su jer transkripcija nije alat, a DPIA i mišljenje mogu dopustiti jedno bez drugoga. Čita se samo kroz `readInstitutionAiSwitch(institutionId)`.
- Do odluke [OC-1] produkcijski izvor te funkcije je konstanta s obje zastavice isključene. Testovi ubacuju sintetički izvor samo u testnoj kompoziciji, a produkcijska kompozicija nema put kojim se izvor mijenja.
- Nijedan put za studenta, nastavnika ni administratora ne mijenja prekidač (S3-D6). Kad [OC-1] odluči mjesto, dodaje se novi izvor, a testovi ovog ugovora ostaju.
- Dok je `transcription` isključena, ruta svrhu `transcription` odbija s `purpose_not_allowed` prije `begin_request`. Ne nastaje redak zahtjeva ni rezervacija.
- Gumba ni rute za snimanje nema. Ulaz za transkripciju čeka [OC-4].

## Dopušteni skup alata

Zatvoren skup u kodu u ovoj verziji ima jedan alat, `web_search`. Shema mu je zatvorena: točno jedan ključ `query`, niz duljine 1 do `QUERY_MAX` točaka nakon NFC-a. Izvršavanje koda i datoteke pružatelja nisu u skupu ([OC-3], S3-N4). Ugrađeni alati pružatelja, uključujući njegovu pretragu weba, nikad se ne nude (S3-D2).

### `assistant.assignment_tool_setting`

| Stupac | Oblik | Klasa |
| --- | --- | --- |
| `assignment_id` | `uuid` NOT NULL FK | L4 |
| `version_no` | `integer`, raste po zadatku bez rupa; PK `(assignment_id, version_no)` | L4 |
| `tools` | `text[]` NOT NULL, jednodimenzionalan, ⊆ zatvoren skup u kodu, bez duplikata | L4 |
| `set_by`, `set_at` | `uuid` iz aktera, `timestamptz` iz sata baze | L4 |

- Retci se samo dodaju. Vrijedi najviša verzija; bez retka skup je prazan. To je uključivanje po zadatku kao kod svrha razine 2 (D-64, §4.5).
- Tablica ima `ENABLE` i `FORCE ROW LEVEL SECURITY` i retke u pgTAP matrici. Uloga weba i uloga rute AI-ja nemaju `INSERT`, `UPDATE`, `DELETE` ni `TRUNCATE` (S3-U5). Okidač odbija `UPDATE`, `DELETE` i `TRUNCATE`.

### `assistant.tool_step`

| Stupac | Oblik | Klasa |
| --- | --- | --- |
| `request_id` | `uuid` NOT NULL FK na `assistant.request` | L1 |
| `step_no` | `integer` 1 do `TOOL_STEP_MAX`; PK `(request_id, step_no)` | L1 |
| `tool_name` | `text` NULL; CHECK: samo ime iz zatvorenog skupa u kodu; NULL kad traženo ime nije u njemu | L1 |
| `requested_name_sha256` | `text` NOT NULL, 64 heks znaka, SHA-256 točnih bajtova imena koje je model tražio | L1 |
| `outcome` | `text`, `allowed`, `denied_not_in_set`, `denied_schema`, `denied_revoked`, `failed`, `done` | L1 |
| `args_sha256`, `result_sha256` | `text`, 64 heks znaka; argumenti i rezultat se ne spremaju | L1 |
| `result_bytes`, `truncated` | `integer`, `boolean` | L1 |
| `created_at`, `finished_at` | `timestamptz`, sat baze | L1 |

Redak ne nosi upit, rezultat, adresu ni odlomak ([OC-5]). Ime alata koje je model tražio je izlaz modela i može nositi dio odlomka. Zato se sprema samo ime iz zatvorenog skupa, a za svako drugo ime samo njegov sažetak.

### Izračun i provjera po koraku

- Dopušteni skup za korak je `CODE_TOOLS ∩ switch.tools ∩ assignment_tool_setting.tools ∩ ready`. `ready` za `web_search` znači neprazan popis odredišta. Uz to vrijedi i politika iz `ai-request-v1.md` („Politika”).
- Postavka zadatka čita se za verziju koja vrijedi u trenutku koraka, ne za zapamćenu na početku zahtjeva. Opoziv tako samo sužava skup.
- Ime iz zahtjeva modela uspoređuje se s imenom iz skupa točno, po bajtovima. Bez promjene veličine slova, rezanja razmaka i Unicode normalizacije (S3-D3). Ruta tako ime preslikava u člana `CODE_TOOLS` ili u NULL. NULL daje `denied_not_in_set`, osim nakon opoziva, kad je ishod `denied_revoked` (red ishoda u „RPC-ovi”).
- Argumenti se provjeravaju zatvorenom shemom prije izvršavanja (S3-D4). Odbijaju se nepoznat ključ, krivi tip, nedostajuće polje, predug niz i ugniježđen objekt. Odbijen korak se ne izvršava i nema odlazne veze. Modelu ide kao dio `tool_denied`. Ruta provjeru radi prije `begin_tool_step` i predaje mu samo zatvoren rezultat `args_valid`. Vrijednost `false` bez opoziva daje redak `denied_schema` koji troši `step_no`; argumenti se ni tada ne spremaju, samo `args_sha256`.
- Poziv pružatelja nudi točno dopušteni skup u tom trenutku. Prazan skup znači da poziv ne nudi nijedan alat (S3-D2).

## Odlazni dohvat

- Jedini put iz sloja alata prema mreži je `searchGuard.search(destinationId, query)`. Sloj alata nema funkciju koja prima adresu, a kod u `src/server/assistant/tools` ne zove globalni `fetch`. To provjerava test granice uvoza.
- `destinationId` bira poslužitelj s popisa, ne model. Popis u produkciji je prazan dok ne odluči [OC-2]. Testovi koriste izmišljena odredišta pod `.invalid` koja se ne razrješavaju.
- Čuvar provjerava i to:
  - samo `https` na unaprijed zadanu adresu odredišta, a upit ide isključivo kao kodirani parametar;
  - preusmjerenje se ne slijedi i daje `failed`;
  - razriješena adresa u privatnoj, lokalnoj ili link-local mreži daje `failed`, i za odredište s popisa;
  - veličina odgovora odredišta ima granicu prije čitanja cijelog tijela.
- Upit koji izgleda kao adresa, IP literal ili IDN nalik odredištu je samo tekst upita (S3-N2). Ne mijenja odredište i ne otvara drugu vezu.
- Poveznice iz rezultata se ne otvaraju (S3-N3). Rezultat ide modelu kao `tool_result`, a nijedan alat ne prima adresu.

## Granice izlaza

| Granica | Pravilo | Plan |
| --- | --- | --- |
| `TOOL_RESULT_MAX_BYTES` | UTF-8 bajtovi nakon NFC-a i uklanjanja znakova iz Z10. Na granici prolazi cijel. Iznad nje se reže na najdulji prefiks koji završava na granici znaka (točke koda) i postavlja se `truncated: true`. | S3-I1 |
| `TOOL_STEP_MAX` | Korak je jedan poziv alata, i kad pružatelj u jednom odgovoru traži više poziva. Zahtjev koji bi prešao granicu završava s `tool_step_limit` bez novog poziva pružatelja. | S3-I2 |
| `RESPONSE_MAX_BYTES` | Port dobiva granicu kao najveću duljinu odgovora. Odgovor iznad granice nakon NFC-a završava zahtjev s `response_too_large` i ne sprema se. Spremljena poruka nikad nije veća od granice. | S3-I3 |
| `QUERY_MAX` | Shema `web_search`; upit iznad granice je `denied_schema`. | S3-N2 |

- Iznose granica bira nositelj implementacije, oprezno, i zapisuje ih u opisu PR-a. Testovi pokrivaju granicu i granicu + 1. To nije pitanje za vlasnika (#1664).
- Odgovor nikad nije radnja (S3-I4). Zahtjev alata vrijedi samo iz polja `toolCalls` izlaza porta. Nijedan kod ne traži naredbe u tekstu odgovora. Prijenos u rad izdaje samo poslužitelj na studentovu radnju (D-46, #1659 C10).
- Prikaz (S3-I5, S3-N5): odgovor i rezultat se u sučelju prikazuju kao tekstni čvor. Nema `dangerouslySetInnerHTML`, pretvaranja Markdowna u HTML, automatskih poveznica ni učitavanja slika iz odgovora.

## Trošak petlje alata

Ovo je dopuna odjeljka „RPC-ovi” iz `ai-request-v1.md`. Tablice iz S2 se ne mijenjaju. Zahtjev s nepraznim dopuštenim skupom u `begin_request` rezervira `reserve_micro × (1 + TOOL_STEP_MAX)` u istom retku knjige i istim uvjetnim `UPDATE` naredbama. Svaki poziv pružatelja u petlji je tako pod rezervacijom (S3-I2, #1662 T7). Svođenje (`complete_request`, `fail_request`) prima zbroj stvarnih troškova svih poziva tog zahtjeva. Zahtjev s praznim skupom rezervira kao u S2.

Rezervaciju petlje bilježi nova tablica `assistant.tool_loop_reservation`:

| Stupac | Oblik | Klasa |
| --- | --- | --- |
| `request_id` | `uuid` PK, FK na `assistant.request` | L1 |
| `steps_reserved` | `integer` NOT NULL, `TOOL_STEP_MAX` u trenutku rezervacije | L1 |
| `tools_reserved` | `text[]` NOT NULL, neprazan, ⊆ `CODE_TOOLS`; dopušteni skup u trenutku rezervacije | L1 |
| `reserved_at` | `timestamptz`, sat baze | L1 |

- Redak upisuje samo `begin_request`, u istoj transakciji kao rezervaciju, i samo kad je dopušteni skup neprazan. Tablica ima `ENABLE` i `FORCE ROW LEVEL SECURITY`, retke u pgTAP matrici i okidač koji odbija `UPDATE`, `DELETE` i `TRUNCATE`.
- `begin_tool_step` traži taj redak i `step_no ≤ steps_reserved`. I odbijen korak troši `step_no`, pa je petlja omeđena i kad model traži samo alate izvan skupa.
- Zahtjev bez retka nema petlju: dopušteni skup mu je prazan cijelo vrijeme, a alat uključen usred zahtjeva vrijedi od idućeg zahtjeva. Izlaz s `tool_calls` takav zahtjev završava s `fail_request` i razlogom `tool_step_limit`, bez novog poziva pružatelja.

## RPC-ovi

Svi su `SECURITY DEFINER` sa `search_path = ''`, a akter dolazi iz `require_actor()`. Tuđi i nepostojeći ID daju isti ishod `forbidden`.

| RPC | Pozivatelj | Učinak |
| --- | --- | --- |
| `assistant.set_assignment_tools(assignment_id, expected_version, tools)` | nastavnik kolegija tog zadatka | Nova verzija postavke i redak revizijskog traga u istoj naredbi (#1662 M6). Drugačiji `expected_version` daje `version_conflict`. Alat izvan zatvorenog skupa daje `invalid_request`. |
| `assistant.read_assignment_tools(assignment_id)` | nastavnik kolegija, student upisan na zadatak | Važeća verzija postavke. Student vidi koje je alate nastavnik uključio (PRODUCT §8). |
| `assistant.begin_tool_step(request_id, step_no, tool_name, requested_name_sha256, args_sha256, args_valid)` | ruta AI-ja | `tool_name` je član `CODE_TOOLS` ili NULL; `args_valid` je `boolean` NOT NULL, rezultat provjere zatvorenom shemom u ruti. Pod bravom zahtjeva provjerava stanje `sent`, redak rezervacije petlje, `step_no` = zadnji + 1 ≤ `steps_reserved`, politiku i dopušteni skup u trenutku poziva. Ishod bira ovim redom, a odlučuje prvi uvjet koji vrijedi: (1) opoziv, neovisno o `tool_name` i `args_valid`: ako politika više ne dopušta zahtjev ili ijedan član `tools_reserved` nije u dopuštenom skupu u trenutku poziva, ishod je `denied_revoked`; (2) `tool_name` NULL ili član `CODE_TOOLS` izvan dopuštenog skupa daje `denied_not_in_set`; (3) `args_valid = false` daje `denied_schema`; (4) inače `allowed`. Upisuje taj redak. Uz `denied_revoked` ruta prekida zahtjev (ispod tablice), a inače vraća dopušteni skup za idući poziv pružatelja. |
| `assistant.finish_tool_step(request_id, step_no, outcome, result_sha256, result_bytes, truncated)` | ruta AI-ja | `allowed` → `done` ili `failed`. Svaki drugi prijelaz se odbija. |

Svaki opoziv, nastavnika ili politike, prekida zahtjev. Opoziv se prepoznaje usporedbom s `tools_reserved`, pa ga traženo ime ne skriva. Ako `begin_tool_step` vrati `denied_revoked` ili ponovna provjera politike ne prođe, ruta više ne zove pružatelja. Zahtjev zatvara s `fail_request` i razlogom `request_revoked`, uz zbroj troška dotad poslanih poziva. Slanje pružatelju ide tek nakon commita koraka, kao `mark_sent` (#1662 I3).

## Ishodi

Ugovor dodaje tri koda zatvorenom skupu iz `ai-request-v1.md`. Svi vrijede kao razlog stanja `provider_failed` i kao ishod rute:
- `tool_step_limit`;
- `response_too_large`;
- `request_revoked`.

Za `set_assignment_tools` dodaje `version_conflict`. Korak `denied_not_in_set` ili `denied_schema` nije ishod zahtjeva, nego podatak modelu. Nakon opoziva ta dva ishoda ne nastaju, jer opoziv ima prednost. Korak `denied_revoked` zatvara zahtjev s `request_revoked`. Tekst sučelja nije dio ugovora i prolazi `ductus-ui-copy`.

## Port i sintetički adapter

Ovo je verzija 2 ulaza porta iz `ai-request-v1.md`. Polje odlomka zamjenjuje se nizom `data`, a ostala polja ostaju:
- `instructions` iz `composeInstructions`;
- `data`, niz dijelova iz „Omeđeni podaci”;
- `tools`, niz `{ name, schema }` samo iz dopuštenog skupa;
- `purposeKey`, `modelId` i `maxResponseBytes`.

Ulaz i dalje nema polje za korisnika, rad, ustanovu ni podatke o procesu pisanja (#1662 G8, G9).

Izlaz dobiva granu `tool_calls` s nizom `{ name, args }`. `name` je niz, a `args` je nepoznata vrijednost koju provjerava shema.

Sintetički adapter uz grane iz #1662 S2 deterministično vraća grane iz S3-S1:
- niz zahtjeva za alatima kroz više koraka, uključujući beskonačnu petlju;
- alat izvan skupa i ime koje se razlikuje samo veličinom slova, razmakom ili sličnim znakom;
- argument izvan sheme i adresu u argumentu;
- rezultat s lažnim omeđivačem;
- odgovor s HTML-om, slikom i poveznicom;
- odgovor iznad `RESPONSE_MAX_BYTES`.

Svaka grana ima barem jedan test koji je stvarno izvršava. Adapter snima svaki ulaz porta za usporedbu u testovima i ne otvara mrežnu vezu.

## Klase ulaza

Klase su retci S3-K1 iz #1664. Ugovor za svaku fiksira čuvar i ishod:

| Klasa (S3-K1) | Čuvar | Ishod |
| --- | --- | --- |
| podmetnuta uputa u odlomku: izravna, lažna uloga, višejezična, kodirana | `composeInstructions`, `encodeDataParts` | upute iste, jedan `paragraph`, nijedan korak alata koji model nije zatražio kroz `tool_calls` |
| lažni omeđivač u odlomku, rezultatu ili ranijem odgovoru | `encodeDataParts` | povratni put točan, broj dijelova isti |
| skriveni tekst u DOCX-u i PDF-u | uvoz (M8.2, M8.3) | marker nije ni u jednom snimljenom pozivu |
| adresa u tekstu ili argumentu: sheme, IP literal, privatne mreže, IDN, preusmjerenje, dio rada u upitu | `searchGuard` | nula veza izvan popisa; preusmjerenje `failed` |
| polje uputa, povijesti, alata ili parametra svrhe iz klijenta | parser rute | `invalid_request` |
| zahtjev modela za alatom izvan skupa, sličnim imenom ili argumentom izvan sheme | vrata alata | `denied_*`, nema izvršavanja |
| rezultat alata s podmetnutom uputom | `encodeDataParts` | jedan `tool_result`, upute iste |
| rezultat alata na granici i granici + 1 | granice izlaza | cijel; rez na znaku uz `truncated` |
| odgovor s HTML-om, slikom ili poveznicom | prikaz | tekst; nula zahtjeva preglednika prema izmišljenom poslužitelju |
| odgovor koji izgleda kao naredba | ruta | ništa se ne izvršava ni upisuje |
| nevidljivi i bidi znakovi, NFC i NFD | Z10 | odlomak odbijen; rezultat očišćen prije granice |
| petlja alata | `begin_tool_step` | `tool_step_limit` na granici |
| odgovor na granici i granici + 1 | granice izlaza | spremljen; `response_too_large` |
| prekidač ili postavka isključeni u svim kombinacijama | izračun skupa | alat ponuđen samo kad su svi uvjeti ispunjeni (S3-D1) |

Prije koda postoje tablični test nad svim redcima i fast-check svojstvo sa svih pet tvrdnji iz S3-K2. Generator slaže dijelove svih klasa, povijest, rezultate alata, kombinacije prekidača i postavke te skriptu sintetičkog adaptera. Neuspjeli primjer koji fast-check suzi ulazi kao stalni red tablice. Testovi su u commitu prije koda i u njemu padaju; opis PR-a navodi oba SHA-a (S3-K3).

## Matrica pristupa

Upis je uvijek samo kroz RPC. Svaka ćelija „ne” je pgTAP test koji odbija.

| Akter | `assignment_tool_setting` | `tool_step` | `tool_loop_reservation` |
| --- | --- | --- | --- |
| nastavnik kolegija zadatka | čita i postavlja kroz RPC | ne | ne |
| student upisan na zadatak | čita važeću verziju kroz RPC | ne (S2 `request` ostaje njegov pogled) | ne |
| drugi student, nastavnik drugog kolegija ili ustanove | ne, isti ishod kao nepostojeći zadatak | ne | ne |
| administrator ustanove | ne | ne | ne |
| ruta AI-ja (uloga weba) | čita kroz `begin_tool_step` | upisuje samo kroz RPC | upisuje samo kroz `begin_request`, čita kroz `begin_tool_step` |
| worker, operater, podrška | ne | ne | ne |

Istodobnost: dopušteni skup računa `begin_tool_step` u transakciji pod bravom retka zahtjeva, iz stanja baze u tom trenutku. Postavku štiti `expected_version` i PK bez rupa, a korake PK `(request_id, step_no)`. Negativni testovi idu kroz zasebne stvarne veze na bazu, ne serijski u jednoj transakciji:
- S3-Z1: nakon koraka 1 nastavnik na drugoj vezi isključi `web_search`. Korak 2 je `denied_revoked`, nema odlazne veze ni novog poziva pružatelja, a zahtjev završava s `request_revoked` uz trošak sveden na poslane pozive;
- kombinirani slučaj S3-Z1: nakon opoziva model u koraku 2 traži ime izvan `CODE_TOOLS` (NULL), ime koje se od `web_search` razlikuje samo veličinom slova ili argument izvan sheme. Ishod je i tada `denied_revoked`, a ne `denied_not_in_set` ili `denied_schema`, bez novog poziva pružatelja i s `request_revoked`;
- isto s pravilom kolegija promijenjenim u `prohibited` između koraka: nema novog poziva pružatelja, `request_revoked`, trošak sveden na poslane pozive (#1662 I3, D-268 O4, D-263 Q03);
- dva istodobna `set_assignment_tools` s istim `expected_version`: jedan uspije, drugi dobiva `version_conflict`, verzije su bez rupa;
- dva istodobna `begin_tool_step` za isti zahtjev i isti `step_no` (ponovljena ruta): jedan redak i najviše jedno izvršavanje;
- zahtjev započet s praznim skupom, a nastavnik na drugoj vezi uključi `web_search` prije odgovora pružatelja: nema retka rezervacije petlje, `begin_tool_step` se odbija, nema drugog poziva pružatelja, a izlaz s `tool_calls` daje `tool_step_limit`;
- isključenje zastavice `tools` između koraka testira se jedinično sa sintetičkim izvorom, jer do [OC-1] prekidač nije u bazi.

## Testovi prije koda

| Sloj | Što | Plan |
| --- | --- | --- |
| jedinica i svojstva | `composeInstructions` bajtovno stabilan; povratni put `encodeDataParts`; izračun skupa nad svim kombinacijama; točna usporedba imena; zatvorene sheme; sve četiri granice na granici i granici + 1; nejednakost konstanti; tablica S3-K1 i fast-check S3-K2 | S3-U1, S3-U3, S3-O2, S3-O5, S3-D1 do S3-D4, S3-I1 do S3-I3, S3-K |
| pgTAP | RLS i matrica za sve tri tablice; CHECK imena alata i oblik sažetka; `args_valid = false` upisuje `denied_schema` i troši `step_no`, a red ishoda vrijedi kad je više uvjeta istodobno; nema izravnog upisa; okidači nepromjenjivosti; revizijski trag uz `set_assignment_tools`; tuđi i nepostojeći zadatak isti ishod; uloga rute AI-ja ne piše pravila, postavku ni prekidač | S3-D5, S3-U5 |
| integracija s bazom | retci iz „Istodobnost:”; rezervacija petlje i svođenje zbroja | S3-Z1, S3-I2 |
| čuvar dohvata | presretanje mreže koje ruši test na svaku vezu izvan popisa; sve klase adrese iz S3-N2; preusmjerenje; razriješena privatna adresa; prazan produkcijski popis znači da alat nije ponuđen | S3-N1 do S3-N4 |
| ruta kroz sintetički adapter | stvarni pozivatelj: ruta zove `begin_tool_step`, čuvar i port; snimljeni pozivi nemaju podatak u `instructions`; svaka grana S3-S1; odgovor-naredba ništa ne izvršava; S3-O3 od uvoza kad su M8.2 i M8.3 spojeni | S3-U2, S3-U4, S3-O1, S3-O3, S3-I4, S3-S1, S3-S3 |
| e2e (Playwright) | odgovor s HTML-om, skriptom, slikom, obrascem i poveznicom prikazan kao tekst; nula zahtjeva preglednika prema izmišljenom poslužitelju | S3-I5, S3-N5 |

Svi odlomci, datoteke, upiti, odredišta, imena i ustanove u testovima su izmišljeni (S3-S2, `ductus-synthetic-data`).

## Redoslijed izvedbe

Svaki korak je zaseban critical PR s planom #1664. Svi idu nakon koraka 1 do 4 iz `ai-request-v1.md`:
1. `composeInstructions`, `encodeDataParts`, izračun skupa, sheme i granice u `src/domain/assistant`, bez baze;
2. verzija 2 porta i grane sintetičkog adaptera;
3. migracija sa sve tri tablice, dopunom `begin_request`, RPC-ovima, okidačima i pgTAP matricom;
4. čuvar dohvata s praznim produkcijskim popisom i testom zatvorene mreže;
5. petlja alata u ruti AI-ja kao stvarni pozivatelj, s testovima istodobnosti;
6. prikaz odgovora kao teksta i postavka alata za nastavnika u sučelju (frontend).

## Poznate granice

- Prekidač je do [OC-1] konstanta, pa se opoziv zastavice u bazi ne može testirati. Opoziv postavke zadatka i politike se testira u bazi.
- Do [OC-2] je dopušteni skup u produkciji uvijek prazan, pa je petlja alata u produkciji mrtav put. Pokrivaju je testovi i stvarni pozivatelj kroz testnu kompoziciju.
- Opoziv koji stigne nakon commita `begin_tool_step`, a prije izvršavanja koraka, ne zaustavlja taj jedan korak. To je isti prozor kao između `mark_sent` i poziva porta (#1662 I3).
- Rez rezultata po granici znaka može odvojiti kombinirajući znak od osnovnog. Značenje se može promijeniti, ali struktura dijelova ostaje točna.
- Rezervacija `reserve_micro × (1 + TOOL_STEP_MAX)` precjenjuje trošak kratkih petlji do svođenja. Točniji iznos traži cijene iz [OA-1].
- Ugovor tumači tri mjesta koja #1664 ostavlja nositelju; sva tri čekaju potvrdu reviewa:
  - prekidač ima dvije zastavice;
  - odgovor iznad granice se odbija, a ne reže;
  - povijest se izostavlja od najstarijeg cijelog dijela.
- Ostaje otvoreno je li promjena postavke alata nova verzija obavijesti studentu (`notice_fingerprint`). Student postavku vidi kroz `read_assignment_tools`. Pitanje ide na #1091 uz review.

## Otvoreno za vlasnika (Q-10)

Otvoreno ostaje sljedeće; ugovor ništa od toga ne gradi:
- [OC-1] do [OC-5] iz #1664;
- [O-1], [OA-1], [OA-3], [OA-7] i [OA-8] iz #1659 i #1662.

Alati iz [OC-2] i [OC-3] ostaju izvan dopuštenog i zatvorenog skupa dok vlasnik ne odluči. Uključivanje prekidača pred stvarnim studentima čeka DPIA (D-257) i pravno mišljenje (`docs/privacy/05` t. 26, M9.PRIV).
