# AI zahtjev, privatni razgovor, budžet i politika v1

DAN-401, plan rb53 M9.0-S2. Ovo je ugovor bez koda: određuje tablice, matricu pristupa, RPC-ove, stanja zahtjeva, idempotenciju, granice troška i politiku te popis testova koje implementacija mora imati prije prvog retka koda.
Izvori:
- D-194 t. 2, 4, 8 i 9; D-199 t. 1 do 3; D-267 O1, O5, O9 i O10; D-268 O2 do O4; D-270 O11 i O12.
- D-41, D-42, D-64 (C-37), D-263 Q22; `docs/PRODUCT.md` §5 pravila 13 do 16.
- `docs/backend/poslovi-i-predaja.md` §4.5 (AI proxy, ograničenje troška, alati); `docs/backend/kontrolna-lista.md` §6.
- Katalog svrha `src/domain/assistant/purpose-catalog.ts` (DAN-402).
- Postojeći uzorci: `create_assignment` s ključem idempotencije (`db/migrations/20261014110000_assignment_request_idempotency.sql`, `src/server/institution/create-assignment.ts`), `outcome_unknown` u `src/server/evidence/evidence-commit.ts` i `src/server/evidence/submission.ts`, `publish_faculty_rule_version` s revizijskim tragom u istoj naredbi.

Plan napada je #1662 (R1 do R9, P1 do P10, T1 do T8, G1 do G9, M1 do M10, klase L1 do L5, klase ulaza Z1 do Z13, istodobnost I1 do I6, S1 do S5, otvorena pitanja OA-1 do OA-8). Ovaj ugovor ga ne ponavlja, nego se poziva na njegove oznake.
Format zapisa prijenosa (`ductus-ai-transfer-v1`) je u `docs/contracts/evidence-segment-v4.md` (#1659, #1677); ovaj ugovor ga ne mijenja. Prekidač ustanove za transkripciju i alate je M9.0-S3 (#1664).

## Što ugovor ne odlučuje

Model računa (D-194 t. 6, D-267 O1) i pružatelj (D-194 t. 7) su PRIJEDLOG, a iznosi granica i proračun (D-199 t. 2, DAN-445) nisu određeni. Sve to ostaje otvoreno za vlasnika pod Q-10 u `STATE.md` (OA-1, OA-2). Zato ugovor:
- ne gradi tablicu ključa pružatelja ni stvarni adapter (OA-1, M8 iz #1662);
- ne nosi nijedan iznos u kodu ni u testovima osim izmišljenih vrijednosti testa (T8);
- pružatelja i model zna samo kao oblik i pripadnost verzioniranoj konfiguraciji; testovi koriste `provider-test-a` i `model-test-1`.

Rokovi čuvanja po klasi podataka nisu dio ugovora (D-30 PRIJEDLOG, Q-16, OA-3). Kod čuvanja i brisanja se ne gradi.

## Načela

| Pravilo | Ugovor | Plan |
| --- | --- | --- |
| Prazna konfiguracija troška znači isključeno | Bez objavljene verzije konfiguracije za uslugu i ustanovu, ili s ijednom granicom bez vrijednosti, svaki zahtjev se odbija s `ai_disabled` prije rezervacije. | P1, Z13 |
| Odbijen zahtjev ne doseže port | Port se zove samo za redak u stanju `sent`, nakon commita. | R2 |
| Pravila samo sužavaju | Učinkovita politika je pravilo kolegija (zadano iz pravila fakulteta, nastavnik ga smije ublažiti, D-175) suženo zadatkom; zahtjev je nikad ne proširuje. | P2, P3 |
| Brojanje po računu iz sesije | Akter dolazi iz `require_actor()`; ID studenta, iznos, granica, pružatelj, model ni alat ne dolaze iz zahtjeva. | T3, M5, Z4 |
| Pružatelju ide samo odlomak i upute | Ulaz porta nema polje za korisnika, rad ni ustanovu. | G8, S3, C-37 |
| Za vrijeme pisanja čita samo student | Nastavnik čita samo razgovor pridružen izjavi, nakon predaje, u zamrznutoj verziji. | G1, G2, G4 |
| Vrijeme iz sata baze | `now()` u transakciji; dan je kalendarski dan u Europe/Zagreb. | R8, T6 |

## Shema i tablice

Nova shema `assistant`. Svaka tablica ima `ENABLE` i `FORCE ROW LEVEL SECURITY`, retke u pgTAP matrici pristupa, a uloga web procesa nema `INSERT`, `UPDATE`, `DELETE` ni `TRUNCATE` ni na jednoj (M1, M2). Klase L1 do L5 su iz #1662: L1 metapodaci, L2 sadržaj razgovora, L3 knjiga troška, L4 konfiguracija, L5 tajna pružatelja. L5 se u ovoj verziji ne pojavljuje.
Iznosi su cijeli brojevi u mikroeurima (`bigint`, 1 EUR = 1 000 000), nikad broj s pomičnim zarezom.

### `assistant.conversation`

| Stupac | Oblik | Klasa |
| --- | --- | --- |
| `id` | `uuid` PK, v4, stvara poslužitelj | L1 |
| `institution_id` | `uuid` NOT NULL, iz aktera | L1 |
| `student_id` | `uuid` NOT NULL, iz aktera | L1 |
| `assignment_id` | `uuid` NOT NULL, zadatak na koji je student upisan | L1 |
| `created_at` | `timestamptz` NOT NULL, sat baze | L1 |

Razgovor pripada točno jednom studentu i jednom zadatku. Nema stupca naslova ni sažetka. Brisanja nema (G7, OA-4): nijedan RPC ne briše razgovor, a `DELETE` odbija okidač.

### `assistant.message`

| Stupac | Oblik | Klasa |
| --- | --- | --- |
| `id` | `uuid` PK, v4; za odgovor pružatelja to je `responseId` iz `ductus-ai-transfer-v1` | L1 |
| `conversation_id` | `uuid` NOT NULL FK | L1 |
| `seq` | `integer` NOT NULL, dodjeljuje baza pod bravom razgovora; `UNIQUE (conversation_id, seq)` | L1 |
| `request_id` | `uuid` NOT NULL FK na `assistant.request` | L1 |
| `role` | `text`, zatvoren skup `student_paragraph`, `provider_response` | L1 |
| `content` | `text` NOT NULL, NFC, unutar granice veličine | L2 |
| `content_sha256` | `text`, 64 mala heks znaka, SHA-256 UTF-8 bajtova `content` | L1 |
| `created_at` | `timestamptz` NOT NULL, sat baze | L1 |

Poruke se samo dodaju (M7, G4). Odbijen zahtjev (`rejected` iz `begin_request`) ne sprema odlomak ni novi razgovor. Poruka `student_paragraph` ostaje i kad zahtjev kasnije završi bez odgovora; čitanje je vraća zajedno sa stanjem zahtjeva. Uređivanja nema; okidač odbija `UPDATE`, `DELETE` i `TRUNCATE`. Upute poslužitelja za svrhu se ne spremaju kao poruka: sastavlja ih kod iz verzije svrhe pa se ne čuvaju dvaput.

### `assistant.request`

| Stupac | Oblik | Klasa |
| --- | --- | --- |
| `id` | `uuid` PK, v4 | L1 |
| `institution_id`, `student_id` | `uuid` NOT NULL, iz aktera | L1 |
| `assignment_id`, `assignment_version_id` | `uuid` NOT NULL; verzija zadatka koja vrijedi u trenutku zahtjeva | L1 |
| `conversation_id` | `uuid` FK; NULL samo u stanju `rejected` kad razgovor još nije postojao | L1 |
| `idempotency_key` | `uuid` NOT NULL; `UNIQUE (student_id, idempotency_key)` | L1 |
| `request_sha256` | `text`, 64 heks znaka: SHA-256 JCS objekta `{assignmentId, conversationId, purposeCatalogVersion, purposeKey, paragraphSha256}` | L1 |
| `purpose_catalog_version` | `integer` NOT NULL, verzija kataloga zadatka | L1 |
| `purpose_key` | `text` NOT NULL, ključ iz te verzije kataloga | L1 |
| `provider_id`, `model_id` | `text`, oblik iz `ductus-ai-transfer-v1`; NULL samo u stanju `rejected` | L1 |
| `config_version` | `text`, verzija konfiguracije u `config/faculties` iz koje su pružatelj i model | L1 |
| `state` | `text`, zatvoren skup iz odjeljka „Stanja” | L1 |
| `reason` | `text`, zatvoren skup kodova iz odjeljka „Ishodi”; NULL osim u `rejected` i `provider_failed` | L1 |
| `requested_at`, `sent_at`, `finished_at` | `timestamptz`, sat baze | L1 |

Redak ne nosi odlomak, odgovor ni iznos (L1 nikad ne nosi L2 ni L3).

### `assistant.cost_ledger`

| Stupac | Oblik | Klasa |
| --- | --- | --- |
| `request_id` | `uuid` PK i FK: najviše jedan redak troška po zahtjevu | L3 |
| `institution_id`, `student_id`, `assignment_id` | `uuid` NOT NULL, prepisano iz zahtjeva | L3 |
| `budget_day` | `date` NOT NULL, dan rezervacije u Europe/Zagreb | L3 |
| `institution_cap_period_start`, `service_cap_period_start` | `date` NOT NULL, početak razdoblja stropa ustanove i stropa usluge u kojem je rezervacija, svaki prema svom `cap_period` u trenutku rezervacije | L3 |
| `reserved_micro` | `bigint` NOT NULL, > 0 | L3 |
| `actual_micro` | `bigint` NULL, ≥ 0; NULL dok nije svedeno | L3 |
| `state` | `text`, `reserved`, `settled` ili `released` | L3 |
| `reserved_at`, `settled_at` | `timestamptz`, sat baze | L3 |

Svedeni i oslobođeni redak se ne mijenja (M7). Svođenje i oslobađanje pomiču točno one brojače čiji su ključevi zapisani u retku (`budget_day`, `institution_cap_period_start`, `service_cap_period_start`), i kad se dogode poslije ponoći ili nakon objave nove konfiguracije s drugim razdobljem (T6). Ključevi se ne računaju ponovno iz trenutačne konfiguracije.

### `assistant.budget_counter`

| Stupac | Oblik | Klasa |
| --- | --- | --- |
| `scope` | `text`, `student_assignment_day`, `student_day`, `institution_cap`, `service_cap` | L3 |
| `scope_key` | `text`, kanonski spoj ID-ova opsega; za `service_cap` prazan | L3 |
| `period_start` | `date` | L3 |
| `used_micro` | `bigint` NOT NULL, ≥ 0: zbroj rezerviranog i svedenog u opsegu | L3 |

PK je `(scope, scope_key, period_start)`. Brojač je izveden iz knjige troška. Invarijanta koju test provjerava nakon svakog scenarija: `used_micro` je jednak zbroju `coalesce(actual_micro, reserved_micro)` redaka knjige u stanju `reserved` ili `settled` za taj opseg.

### `assistant.cost_config_version`

| Stupac | Oblik | Klasa |
| --- | --- | --- |
| `id` | `uuid` PK | L4 |
| `institution_id` | `uuid` NULL; NULL znači cijela usluga | L4 |
| `version_no` | `integer`, raste po opsegu bez rupa | L4 |
| `cap_micro` | `bigint` NULL: strop operatera za opseg u razdoblju | L4 |
| `cap_period` | `text`, `day` ili `month` u Europe/Zagreb | L4 |
| `student_day_micro` | `bigint` NULL, samo za ustanovu | L4 |
| `student_assignment_day_micro` | `bigint` NULL, samo za ustanovu | L4 |
| `reserve_micro` | `bigint` NULL: iznos jedne rezervacije, samo za ustanovu | L4 |
| `published_by`, `published_at` | `uuid`, `timestamptz` iz sata baze | L4 |

Verzije se samo dodaju; vrijedi najviša `version_no` po opsegu. Strop i razdoblje stropa objavljuje operater. Studentske granice i `reserve_micro` objavljuje administrator ustanove (D-270 O11: pragovi). RPC objave odbija studentsku granicu iznad stropa ustanove (`limit_above_cap`), a provjera zahtjeva svejedno uzima manju vrijednost (T2: i odbijanje i manja vrijednost, test pokriva oboje). Objava se upisuje zajedno s retkom revizijskog traga u istoj naredbi (M6). Razdoblje stropa nije odlučeno (OA-2), pa je stupac s dvije vrijednosti, a testovi pokrivaju obje.

### Pridruživanje izjavi

Veza razgovora s izjavom gradi se u M9.5 nakon M7.5. Ovaj ugovor određuje samo što ta veza mora nositi da matrica pristupa vrijedi: `submission_id`, `conversation_id`, `through_seq` (zadnja poruka verzije prikazane studentu prije potvrde izjave), `messages_sha256` (SHA-256 JCS niza `content_sha256` do `through_seq`) i razlog (`transfer` ili `student_added`). Prilaže se točna verzija koju je student pregledao i potvrdio (D-263 Q22): potvrda nosi `through_seq` i `messages_sha256` prikazane verzije, a poslužitelj ih pri predaji uspoređuje sa spremljenim porukama. Poruka dodana nakon pregleda, iz druge kartice ili iz odgovora pružatelja, ne ulazi u prilog bez nove potvrde. Ako se ne slaže hash ili je prije predaje tekst prenesen iz poruke iza `through_seq`, predaja se odbija s `attachment_stale` i traži novu potvrdu. M9.5 to testira istodobno: potvrda izjave i nastavak istog razgovora u drugoj kartici. Obvezni su samo razgovori iz kojih je tekst prenesen, a taj se skup izvodi iz zapisa `ductus-ai-transfer-v1` u predanom lancu evidencije (D-263 Q22). Prijenos kasnije obrisanog teksta i dalje čini razgovor obveznim (D-268 O3, G6). Zahtjev s `requested_at` prije predaje sam po sebi ne čini razgovor obveznim; `requested_at` je samo granica za zahtjev koji traje u trenutku predaje (I5). Ostali razgovori prilažu se samo studentovim odabirom (`student_added`). M9.5 to testira s dva razgovora s odgovorom, od kojih je tekst prenesen samo iz jednoga: obvezan je samo taj.

## Politika

Učinkovite svrhe za zahtjev računaju se na poslužitelju u transakciji rezervacije, iz:
1. `course.ai_policy`: pravilo kolegija. Novi kolegij dobiva pravilo fakulteta kao zadanu vrijednost, a nastavnik ga smije i pooštriti i ublažiti (D-175, pravilo 12);
2. verzije zadatka koja vrijedi u trenutku zahtjeva (`ai_policy`, `ai_purposes`, verzija kataloga); zadatak pravilo kolegija smije samo suziti (D-52).

Pravilo fakulteta (`faculty_rule_version`) nije zasebna obvezna razina provjere. Ulazi kao zadana vrijednost kolegija i u obavijest studentu, ali ne odbija zahtjev koji je nastavnik izričito dopustio. Od fakulteta je obvezan samo popis dopuštenih pružatelja (D-23), kroz konfiguraciju ispod. Zahtjev prolazi samo ako je politika kolegija i zadatka različita od `prohibited` i ako je `purpose_key` u `ai_purposes` zadatka te postoji u verziji kataloga zadatka (`parsePurpose`). Svrha razine 2 prolazi samo ako ju je nastavnik izričito uključio na zadatku (D-64, D-268 O2, P5). Do M9.3 baza dopušta samo pet svrha verzije 1; verzija kataloga na zadatku i svrhe razine 2 dolaze s DAN-402. Transkripcija i alati prolaze samo uz uključen prekidač ustanove iz #1664 (P9, D-267 O10). Ovaj ugovor alate ne otvara: port u ovoj verziji nema polje za alat.
Pružatelj i model biraju se iz verzionirane konfiguracije u `config/faculties` (D-270 O11), nikad iz zahtjeva. Nema prelaska na drugog pružatelja ili model nakon greške (P7). Zabrana pružatelja i modela iz D-194 t. 2 je u kodu: konfiguracija koja je krši se ne učitava (P8; zatvoren skup vrijednosti je #1659 O-1).
Ništa u politici ne smije zahtijevati AI (pravilo 15, P6).

## Stanja

Faza „primljen” (#1662 R1) je provjera rute prije transakcije i ne stvara redak. Zahtjev koji padne na obliku, ključu ili vlasništvu (Z4 do Z8, Z12) ne ostavlja redak, pa ključ ostaje slobodan.

| Iz | U | Tko | Uvjet |
| --- | --- | --- | --- |
| (nema) | `rejected` | `begin_request` | politika, prazna konfiguracija ili granica; nema retka troška |
| (nema) | `reserved` | `begin_request` | sve provjere prošle; redak troška `reserved` i brojači u istoj transakciji |
| `reserved` | `sent` | `mark_sent` | ponovna provjera politike i prava (I3), zatim commit; tek nakon commita poziv porta |
| `reserved` | `rejected` | `mark_sent` ili posao čišćenja | opoziv između rezervacije i slanja, ili zastarjela rezervacija; trošak `released` |
| `sent` | `completed` | `complete_request` | odgovor stigao u roku; poruka odgovora i svođenje u istoj transakciji |
| `sent` | `provider_failed` | `fail_request` | pružatelj javio grešku; trošak svođen na prijavljeni iznos, a bez prijave na rezervirani |
| `sent` | `outcome_unknown` | `mark_outcome_unknown` ili posao čišćenja | istek, prekid nakon slanja ili pad procesa; trošak ostaje rezerviran |
| `outcome_unknown` | `settled` | posao svođenja (worker) | jednom; do odluke OA-1 nema upita o stvarnom trošku, pa se svodi na rezervirani iznos |

`rejected`, `completed`, `provider_failed` i `settled` su završna stanja. Svaki drugi par (iz, u) se odbija i redak ostaje isti (R1). Odgovor koji stigne nakon `outcome_unknown` se odbacuje: ne upisuje se u razgovor i ne mijenja trošak (R7). Student je već dobio ishod bez odgovora, a kasni upis bi stvorio izvor prijenosa koji nije vidio. Prijenos u rad izdaje samo `completed` zahtjev vlasnika, a `responseId` mora biti poruka `provider_response` tog zahtjeva (R9, #1659 C10).
Rokovi čišćenja (zastarjeli `reserved`, `sent` bez ishoda) su imenovane konstante u kodu. Posao nosi samo ID zahtjeva (M10).

## RPC-ovi

Svi su `SECURITY DEFINER` sa `search_path = ''`, akter iz `require_actor()` ili uloge workera, a tuđi i nepostojeći ID daju isti ishod `forbidden` (M4, M5).

| RPC | Pozivatelj | Učinak |
| --- | --- | --- |
| `assistant.begin_request(idempotency_key, assignment_id, conversation_id, purpose_catalog_version, purpose_key, paragraph, provider_id, model_id, config_version)` | ruta AI proxyja | Stvara razgovor ako je `conversation_id` NULL, poruku `student_paragraph`, zahtjev i rezervaciju, ili `rejected`, ili vraća postojeći zahtjev za isti ključ. Pružatelja i model daje ruta iz konfiguracije, ne klijent. |
| `assistant.mark_sent(request_id)` | ruta | `reserved` → `sent` ili `rejected` (opoziv). |
| `assistant.complete_request(request_id, response, actual_micro)` | ruta | `sent` → `completed`; poruka `provider_response` sa sljedećim `seq`; svođenje. |
| `assistant.fail_request(request_id, reason, actual_micro)` | ruta | `sent` → `provider_failed`; svođenje. |
| `assistant.mark_outcome_unknown(request_id)` | ruta | `sent` → `outcome_unknown`. |
| `assistant.sweep_and_settle(request_id)` | worker | čišćenje i svođenje po tablici stanja; dvostruko pokretanje svodi jednom. |
| `assistant.read_conversation(conversation_id)` | student vlasnik | poruke po `seq`. |
| `assistant.publish_cost_config(...)` | operater, administrator ustanove | nova verzija konfiguracije uz revizijski trag. |

`begin_request` u jednoj transakciji: provjeri ključ, politiku i konfiguraciju; pod `INSERT ... ON CONFLICT DO NOTHING` stvori redak zahtjeva; zatim za svaki opseg redom `service_cap`, `institution_cap`, `student_day`, `student_assignment_day` upiše brojač ako ga nema i napravi uvjetni `UPDATE ... SET used_micro = used_micro + r WHERE used_micro + r <= granica`. Ako ijedan ne uspije, transakcija upisuje `rejected` s `budget_exceeded` i nijedan brojač se ne mijenja. Stalan redoslijed opsega sprječava zastoj (deadlock).
Svođenje pomiče brojače za razliku `actual_micro − reserved_micro` bez uvjeta granice: veći stvarni trošak se broji (R6) i sljedeći zahtjev iznad granice se odbija. Prekoračenje zato nije ograničeno na jedan zahtjev. Svaki zahtjev rezerviran dok je brojač bio ispod granice može ga povećati za svoju razliku, pa najveće prekoračenje opsega iznosi zbroj razlika svih zahtjeva tog opsega koji su bili `reserved` ili `sent` kad je brojač došao do granice.

## Ishodi

Zatvoren skup kodova koje ruta vraća: `invalid_request`, `invalid_idempotency_key`, `idempotency_conflict`, `forbidden`, `ai_disabled`, `purpose_not_allowed`, `budget_exceeded`, `in_progress`, `request_outcome_unknown`, `provider_failed`, `completed`. Tekst sučelja za njih nije dio ugovora i prolazi `ductus-ui-copy`.

## Idempotencija

- Ključ je kanonski UUID iz zaglavlja zahtjeva, po računu iz sesije, kao `create_assignment` (R3).
- Isti ključ i isti `request_sha256` vraćaju postojeći zahtjev: za `completed` isti odgovor, za `sent` `in_progress`, za `outcome_unknown` `request_outcome_unknown`, za `rejected` isti razlog. Nema druge rezervacije, poruke ni poziva porta (R4).
- Isti ključ s drugim `request_sha256` daje `idempotency_conflict`.
- Isti ključ drugog studenta je drugi zahtjev i ne vidi prvi.
- Novi pokušaj nakon `outcome_unknown` ili `rejected` traži novi ključ i novu rezervaciju (R5).

## Port i sintetički adapter

`src/domain/assistant` dobiva tip porta; adapter je u `src/adapters/assistant`. Ulaz porta: upute poslužitelja za svrhu, omeđen odlomak, `purposeKey`, `modelId` i najveća duljina odgovora. Nema polja za korisnika, rad, ustanovu ni podatke o procesu pisanja (S3, G8, G9, pravilo 13). Izlaz: uspjeh s tekstom i `actualMicro`, greška pružatelja s neobveznim `actualMicro`, ili istek ili prekid.
Sintetički adapter ne otvara mrežnu vezu i ne treba tajnu (S1, M9). Deterministično vraća svaku granu iz S2: uspjeh, grešku, istek, prekid nakon slanja, zakašnjeli odgovor i trošak veći od rezervacije. Grane za alate čekaju #1664. Stvarni adapter čeka M9.1 (OA-1, OA-8).

## Klase ulaza

Parser zahtjeva rute ima zatvoren skup ključeva na svakoj razini i granicu veličine tijela provjerenu prije parsiranja cijelog tijela. Klase su Z1 do Z13 iz #1662; ovaj ugovor fiksira ishode koje #1662 ostavlja testu:
- Z9: granica odlomka je imenovana konstanta, a veličina se broji u Unicode točkama nakon NFC normalizacije. Prazan odlomak se odbija.
- Z10: tekst se normalizira u NFC. Osamljeni zamjenski par i kontrolni znakovi C0 i C1 osim tabulatora i novog retka se odbijaju. BOM na početku se odbija.
- Z11: podmetnuta uputa prolazi kao podatak, omeđena, a upute poslužitelja ostaju iste.

Prije koda postoje tablični test nad svim klasama Z1 do Z13 s očekivanim ishodom i fast-check svojstvo: zahtjev s ijednim ključem izvan zatvorenog skupa ili s poljem iz Z4 nikad ne dolazi do `begin_request`.

## Matrica pristupa

Ćelije su čitanje; upis je uvijek samo kroz RPC iz tablice iznad. Svaka ćelija „ne” je pgTAP test koji odbija.

| Akter | Svoj razgovor i poruke | Tuđi razgovor | Pridružen razgovor nakon predaje | `request` | Knjiga i brojači | Konfiguracija |
| --- | --- | --- | --- | --- | --- | --- |
| student vlasnik | da (RLS, vlastiti retci) | ne | da, zamrznuta verzija | svoji retci | svoja potrošnja, samo iznos | ne |
| drugi student | ne | ne | ne | ne | ne | ne |
| nastavnik kolegija | ne | ne | da, samo kroz RPC, do `through_seq` | ne | ne | ne |
| nastavnik drugog kolegija ili ustanove | ne | ne | ne | ne | ne | ne |
| administrator ustanove | ne | ne | ne | ne | zbroj ustanove bez identiteta (OA-5) | svoja ustanova |
| worker | ne | ne | ne | stanje i ID-ovi | svodi kroz RPC | ne |
| operater ili podrška | ne | ne | ne | ne | zbroj usluge bez identiteta | strop i razdoblje |

Operater ne čita sadržaj ni kroz postupak iznimnog pristupa dok ga ADR ne opiše (D-199 t. 3, Q-5).

Istodobnost: brojači se mijenjaju samo uvjetnim `UPDATE` u transakciji rezervacije, ključ idempotencije štiti jedinstveni indeks, a redoslijed poruka daje brava razgovora. Negativni testovi, kroz više stvarnih veza na bazu, ne serijski:
- dva i više istodobnih zahtjeva istog studenta nad istim budžetom kad je ostalo za točno k rezervacija, za svaku od četiri granice posebno: najviše k redaka `reserved`, najviše k poziva porta, ostali `budget_exceeded`, a brojači su jednaki knjizi (I1);
- dva istodobna zahtjeva s istim ključem idempotencije i istim sadržajem: jedan redak zahtjeva, jedna rezervacija, najviše jedan poziv porta, a drugi dobiva postojeći zahtjev; isti ključ s drugim sadržajem istodobno daje `idempotency_conflict` (I2);
- ponovljeni zahtjev s istim ključem nakon `completed`: isti odgovor, bez druge rezervacije i poruke (R4);
- opoziv politike između `begin_request` i `mark_sent`: poziv se ne šalje, trošak `released` (I3);
- svođenje `outcome_unknown` usporedno s novim zahtjevom na rubu: zbroj nikad ne prelazi granicu (I4);
- dvije kartice istog studenta u istom razgovoru: `seq` bez rupa i bez duplikata, bez dvostrukog troška (I6);
- k istodobnih zahtjeva rezervira točno do granice, a sintetički adapter za svaki vrati trošak veći od rezervacije: brojači su jednaki knjizi, prekoračenje je točno zbroj razlika, a sljedeći zahtjev dobiva `budget_exceeded` (R6).

## Testovi prije koda

| Sloj | Što | Plan |
| --- | --- | --- |
| jedinica i svojstva | parser zahtjeva nad Z1 do Z13; fast-check za zatvoren skup ključeva; tablica prijelaza (svaki par izvan tablice odbijen); izračun učinkovite politike, uključujući oba smjera D-175 (fakultet `prohibited` a kolegij izričito dopušta: prolazi; fakultet dopušta a kolegij `prohibited`: odbijeno); zabrana pružatelja iz D-194 t. 2 u kodu | Z1 do Z13, R1, P2 do P5, P8 |
| pgTAP | RLS i matrica pristupa za svaku tablicu i ćeliju; nema izravnog upisa uloge weba; okidači nepromjenjivosti; revizijski trag uz objavu konfiguracije; tuđi i nepostojeći ID isti ishod | M1 do M7, G1, G2 |
| integracija s bazom | sve iz retka „Istodobnost:”; tri granice i strop svaka posebno; izolacija studenata; strop odbija sve; granica dana preko ponoći; mjesečni strop usluge uz dnevni strop ustanove i svođenje nakon objave drugog razdoblja; prazna konfiguracija; veći stvarni trošak; dvostruko svođenje | T1 do T7, I1 do I6, R3 do R7 |
| ruta kroz sintetički adapter | stvarni pozivatelj: ruta zove RPC-ove i port; snimljeni ulaz porta ne nosi identitet ni ostatak rada; nema prelaska na drugog pružatelja; nema mrežne veze | S1 do S5, G8, G9, P7 |

Svi odlomci, razgovori, imena i ustanove u testovima su izmišljeni (S4).

## Redoslijed izvedbe

Svaki korak je zaseban critical PR s planom #1662:
1. port, sintetički adapter i parser zahtjeva (bez baze);
2. migracija sheme `assistant` s RLS-om, okidačima i pgTAP matricom;
3. RPC-ovi rezervacije, slanja, završetka i svođenja s integracijskim testovima istodobnosti;
4. ruta AI proxyja kao stvarni pozivatelj, kroz sintetički adapter;
5. posao čišćenja i svođenja u workeru.

Pridruživanje izjavi (M9.5), prijenos u rad (#1659) i prekidač s alatima (#1664) idu svojim koracima.

## Poznate granice

- Iznos rezervacije je fiksan po ustanovi (`reserve_micro`) i nije dokaziva gornja granica troška poziva. Ako stvarni trošak prelazi rezervaciju, granicu može prijeći svaki istodobno poslan zahtjev u opsegu, za zbroj njihovih razlika (odjeljak „RPC-ovi”). Ugovor to dopušta i broji (R6). Rezervacija na dokazivoj gornjoj granici (najveća duljina ulaza i odgovora i cijena modela) traži cijenu iz OA-1 i mjerenje u M9.1-P03b.
- Svođenje `outcome_unknown` na rezervirani iznos može precijeniti trošak. Točnije svođenje traži upit pružatelju o potrošnji i čeka OA-1.
- Brojač `service_cap` je jedno mjesto zaključavanja za sve ustanove. Za pilot je to prihvatljivo; mjerenje opterećenja nije dio ugovora.
- Zbrojevi za administratora i operatera ne pokazuju pojedinog studenta dok OA-5 nije odlučen.
- `purposeId` u `ductus-ai-transfer-v1` (#1677) ima uzorak bez podvlake, a ključevi kataloga (`literature_search`, `example_generation`, `data_coding`) je imaju. Ovaj ugovor zapisuje `purpose_key` kakav je u katalogu; usklađenje pripada #1677 ili njegovom reviewu i zabilježeno je na #1091.
- P3 iz #1662 učinkovitu politiku opisuje kao presjek pravila fakulteta, kolegija i zadatka. D-175 ima prednost: ugovor pravilo fakulteta uzima kao zadanu vrijednost kolegija, a ne kao obveznu razinu, pa OA-6 ne mijenja provjeru zahtjeva. Čeka potvrdu reviewa.
- Ugovor tumači dva retka plana koje #1662 ostavlja nositelju: R7 (zakašnjeli odgovor se odbacuje) i T2 (objava iznad stropa se odbija, a provjera svejedno uzima manju vrijednost). Oba čekaju potvrdu reviewa.

## Otvoreno za vlasnika (Q-10)

OA-1 do OA-8 iz #1662 ostaju otvoreni. Ugovor ne odlučuje model računa ni pružatelja (OA-1), iznose, razdoblje stropa ni proračun (OA-2), čuvanje (OA-3), brisanje razgovora s prijenosom (OA-4), vidljivost zbrojeva (OA-5), verziju pravila fakulteta za postojeći zadatak (OA-6), transkripciju, alate i objašnjenje pojma pred studentima (OA-7) ni AI Act i podizvršitelje (OA-8).
