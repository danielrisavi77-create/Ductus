# ADR: zabilježeni pristup podrške sadržaju rada (break-glass)

- **Status:** PRIJEDLOG. Čeka neovisni review i vlasnikove odgovore na otvorena pitanja iz §10 (Owner queue, Q-5, rok 30. 11. 2026.). Ovaj dokument ne donosi nove odluke: za svako pitanje navodi opcije s izvorima i ostavlja izbor vlasniku. OPS-BREAKGLASS se gradi tek ako vlasnik ADR prihvati (D-262 Q31).
- **Datum:** 6. 11. 2026.
- **Zadatak:** Linear DAN-444, M11.8-P04 (plan rb33). Samo dokument; ne mijenja kod, migracije ni druge dokumente.
- **Stanje koda:** `main` na `559ebd2`.
- **Izvori:** D-199 t. 3 i t. 5, D-172, D-262 Q04, Q06 i Q31, D-264 Q11 i Q13, D-263 Q07, D-271 MQ02 i MQ03, D-257, D-29, D-30, D-69, D-16 (`docs/DECISIONS.md`); `docs/PRODUCT.md` (uloga operatera, §5 pravilo 17, popis funkcija t. 10); `docs/ARCHITECTURE.md` §7; `docs/backend/pregled.md`; `docs/privacy/02` R6 i `docs/privacy/03`; `docs/engineering/PLAN-TOKOVI-2026-10-25.md` (ops portal); vlasnikov odabir Q-5 (#87 c.6639423372, `STATE.md`).

## 1. Što se odlučuje

D-199 t. 3 dopušta podršci operatera čitanje sadržaja rada samo u zabilježenom postupku iznimnog pristupa: pristanak fakulteta za konkretan slučaj, razlog, najuži opseg, istek i revizijski trag u `audit`, kako opisuje ugovor o obradi. Pojedinosti prepušta ADR-u: tko na fakultetu daje pristanak, način potvrde, najdulji istek i obavijest studentu. Vlasnik je uz Q-5 odabrao da se ADR napiše prije DAN-312 (M7.3, produljenje roka po studentu), uz razlog produljenja i klasu podataka (P24).

Ovaj ADR za svako od tih pet pitanja daje: što je već odlučeno, opcije s izvorima i posljedice svake opcije. Odgovor bira vlasnik; dok ga nema, vrijedi D-172 („nikad sadržaj radova”) bez iznimke u kodu, jer se ništa od postupka ne gradi prije prihvaćenog ADR-a (D-199 t. 3, D-262 Q31).

**P24.** Oznaka P24 dolazi iz karte plana od 4. 11. 2026. §7, koja nije u repou. ADR je tumači prema tekstu Q-5 u `STATE.md`: razlog produljenja i njegova klasa podataka (§8). Ako P24 znači nešto drugo, vrijedi ispravak orkestratora ili vlasnika.

## 2. Što je već odlučeno i ovdje se ne otvara

- **D-199 t. 3**, ODLUČENO 1. 11. 2026.: pet elemenata postupka (pristanak fakulteta za konkretan slučaj, razlog, najuži opseg, istek, trag u `audit`) i veza s ugovorom o obradi. Dopunjuje D-172 samo za ovaj postupak.
- **D-172**, ODLUČENO 25. 10. 2026.: zasebna prijava operatera s drugim faktorom, samo vlasnikov račun, nikad sadržaj radova na svim ostalim putovima.
- **D-262 Q06**, ODLUČENO 4. 11. 2026.: drugi faktor operatera je sigurnosni ključ; konzola je zasebna grupa ruta i vrsta sesije u istom procesu; do pravne osobe pristup ima samo vlasnikov račun.
- **D-262 Q31**, ODLUČENO 4. 11. 2026.: ADR prije pilota; gradnja samo ako ga vlasnik prihvati.
- **D-264 Q13**, ODLUČENO 4. 11. 2026.: ugovor o obradi potpisuje se prije tehničke probe; do tada pristup operatera ima samo vlasnikov račun.
- **D-29**, ODLUČENO: FPZG je voditelj obrade, Ductus izvršitelj (čl. 28 GDPR-a); privola nije osnova obrade. D-29 čeka pisanu potvrdu FPZG-a (D-199 t. 4).
- **D-257**, ODLUČENO (opseg): break-glass ulazi u jednu DPIA koju vodi FPZG s DPO-om.
- **Pravilo 17** (`docs/PRODUCT.md` §5): student vidi tko je i kada otvorio njegov rad. D-199 t. 5 izričito kaže da se pravila 1 do 17 ne mijenjaju.
- **Razlog produljenja** (`docs/PRODUCT.md`, popis funkcija t. 10): vidljiv samo nastavniku i tom studentu. **D-263 Q07**: produljenje je zasebna dopuna, a povijest produljenja dobiva novu tablicu (M7.3-P01).

Nijedna opcija niže ne gradi na odluci sa statusom PRIJEDLOG. Gdje opcija ovisi o takvoj odluci (D-30, model ugovora o obradi u `docs/privacy/05` A.1), to je navedeno uz opciju.

## 3. Stanje koda i dokumenata

- `audit.access_log` (`db/migrations/20261021120000_audit_access_log.sql`) bilježi otvaranje rada: ustanova, dokument, zadatak, vlasnik rada, čitatelj, `reader_role` (dopušteno samo `teacher`), `surface` (`live_view` ili `process_summary`) i vrijeme zaokruženo na minutu. Tablica je append-only s prisilnim RLS-om. Nema stupca za razlog ni vrijednosti za operatera, pa danas ne može zapisati pristup podrške.
- U kodu ne postoji operaterska prijava, sesija, tablica ni RPC (PLAN-TOKOVI, ops portal: ništa od toga prije prihvaćenog ADR-a).
- **Nesklad A** (ostaje otvoren, Q-19): `docs/ARCHITECTURE.md` §7 iznimni pristup veže uz break-glass općenito, a `docs/backend/pregled.md` navodi „break-glass za administratora u pojednostavljenom obliku”. D-199 t. 3 govori o podršci operatera. Nije odlučeno postoji li i break-glass administratora ustanove.
- **Nesklad B** (ostaje otvoren): tablica u `docs/ARCHITECTURE.md` kaže da `access_log` sadrži „razlog (uključujući break-glass)”, a shema na `main` taj stupac nema.

## 4. Pitanje 1: tko na fakultetu daje pristanak

**Odlučeno:** pristanak daje fakultet, za konkretan slučaj (D-199 t. 3). Prema D-29 privola nije osnova obrade, pa ovaj „pristanak” nije privola studenta. Njegovu pravnu kvalifikaciju (npr. uputa voditelja obrade izvršitelju) potvrđuje pravnik ili DPO; ADR je ne određuje.

| Opcija | Izvor | Posljedica |
| --- | --- | --- |
| A. Administrator ustanove | D-262 Q04 (imenuje ga operater na pisani zahtjev fakulteta); D-16 (prijava AAI@EduHr) | Uloga već postoji u modelu i prijavljuje se kroz AAI. Isti lanac (operater imenuje admina, admin odobrava operateru) slabi odvojenost; administrator prema `docs/PRODUCT.md` ne čita sadržaj, ali bi odobravao da ga čita treća strana. |
| B. Koordinator pilota na FPZG-u | D-69; Q-3 (paket pitanja FPZG-u) | Osoba još nije imenovana i uloga nije modelirana u aplikaciji; pristanak bi išao izvan aplikacije dok se uloga ne uvede. |
| C. Službenik za zaštitu podataka (DPO) FPZG-a | D-257, D-29 | Ima pravni kontekst; danas nema ulogu u aplikaciji, pa bi pristanak bio izvan nje ili bi tražio novu ulogu (prijava samo kroz AAI@EduHr, D-16). |
| D. Osoba koju imenuje ugovor o obradi | D-199 t. 3 („kako opisuje ugovor o obradi”); D-264 Q13 | Najbliže doslovnom tekstu D-199 t. 3; ugovor nije potpisan, a model u `docs/privacy/05` A.1 je PRIJEDLOG, pa do potpisa nema imenovane osobe. |

**Podpitanje 1a:** smije li pristanak dati jedna osoba ili traži dvije (npr. A i C). Nijedan izvor to ne određuje.

## 5. Pitanje 2: način potvrde

**Odlučeno:** operaterska strana prijavljuje se sigurnosnim ključem u zasebnoj vrsti sesije (D-262 Q06); do pravne osobe i ugovora o obradi pristup ima samo vlasnikov račun (D-172, D-264 Q13). Potvrda mora obuhvatiti konkretan slučaj, razlog, opseg i istek (D-199 t. 3) i ostaviti trag u `audit`.

| Opcija | Izvor | Posljedica |
| --- | --- | --- |
| A. Pisani zahtjev ili suglasnost fakulteta, a u audit događaju samo referenca na nju | obrazac iz D-262 Q04 i D-271 MQ02 | Ne traži novu ulogu ni sučelje za fakultet. Aplikacija ne može sama provjeriti da referenca odgovara stvarnom dokumentu. |
| B. Potvrda u aplikaciji: osoba iz pitanja 1, prijavljena kroz AAI@EduHr, potvrđuje zahtjev | D-16, D-09 | Potvrda je vezana uz prijavljeni identitet i strojno provjerljiva. Traži novu radnju i ulogu; za opcije C i D iz pitanja 1 i novu ulogu u aplikaciji, uz prijavu samo kroz AAI@EduHr (D-16). |
| C. Kanal koji propisuje ugovor o obradi | D-199 t. 3 | Ovisi o ugovoru koji još nije potpisan. |

**Podpitanje 2a:** vidi li osoba koja potvrđuje točan opseg (koji rad, koji prikaz, koje razdoblje) prije potvrde. Izvori traže najuži opseg, ali ne kažu tko ga određuje.

## 6. Pitanje 3: najdulji istek

**Odlučeno:** istek je obvezan (D-199 t. 3). Nijedan izvor ne daje vrijednost.

| Opcija | Izvor | Posljedica |
| --- | --- | --- |
| A. Fiksni gornji strop (vrijednost bira vlasnik) uz kraći istek po slučaju | D-199 t. 3 (istek) | Jednostavno za provjeru i test. Prekratak strop vodi do ponovnog traženja pristanka. |
| B. Do zatvaranja slučaja, uz fiksni strop | D-199 t. 3 („konkretan slučaj”) | Veže pristup uz slučaj; traži zapis stanja slučaja koji danas ne postoji. |
| C. Jednokratno otvaranje: istek nakon prvog čitanja ili stropa, što dođe prije | D-199 t. 3 („najuži opseg”) | Najuži pristup; složeniji kvar koji traži više čitanja traži novi pristanak. |

Za sve opcije: produljenje samo novim pristankom ili istim postupkom (nijedan izvor ne dopušta drugo). **Podpitanje 3a:** može li fakultet opozvati pristanak prije isteka. D-199 t. 3 to ne navodi.

## 7. Pitanje 4: obavijest studentu

**Odlučeno:** pravilo 17 vrijedi i za ovaj postupak (D-199 t. 5), pa pristup podrške mora biti vidljiv u studentovu dnevniku pristupa. Obavijest o privatnosti (`docs/privacy/03`) već najavljuje zabilježeni pristup podrške uz pristanak ustanove.

Otvoreno:

- **4a, kako se čitatelj prikazuje:** kao uloga („podrška operatera”) ili kao osoba. Pravilo 17 kaže „tko”, ali ne kaže u kojem obliku za operatera.
- **4b, aktivna obavijest:** samo zapis u dnevniku pristupa (minimum iz pravila 17) ili i obavijest studentu (u aplikaciji ili e-poštom).
- **4c, vrijeme:** prije pristupa, u trenutku pristupa ili nakon zatvaranja slučaja.
- **4d, razlog:** vidi li student razlog pristupa.

Opcije za 4b i 4c nemaju izvor osim pravila 17 (minimum) i `docs/privacy/03`; izbor je vlasnikov, a DPIA (D-257) ga procjenjuje.

## 8. Razlog produljenja i klasa podataka (P24)

**Odlučeno:** razlog produljenja vidljiv je samo nastavniku i tom studentu (`docs/PRODUCT.md`, funkcije t. 10). Povijest produljenja je nova tablica (D-263 Q07, M7.3-P01). Ductus u valu 1 dovršava prijedlog DATA-CLASS, a FPZG s DPO-om ga potvrđuje (D-264 Q11); DATA-CLASS ima 30 klasa u 8 kategorija, ali popis i tablica `data_class` još ne postoje (D-271 MQ03). Rokovi čuvanja (D-30) su PRIJEDLOG i čekaju FPZG; kod čuvanja se na D-30 ne gradi (Q-16).

Zašto je ovo vezano uz break-glass: razlog je slobodan tekst koji student ili nastavnik upisuje, pa može sadržavati osjetljive okolnosti. Je li to posebna kategorija podataka (čl. 9 GDPR-a) procjenjuje pravnik ili ustanova (`docs/privacy/01`), ne ovaj ADR.

Otvoreno, a mora biti odlučeno prije DAN-312:

- **8a, oblik razloga:** slobodan tekst, zatvoreni popis kategorija ili kategorija uz neobavezan tekst. Izvor za razlog kao takav je `docs/PRODUCT.md` t. 10; oblik nije određen.
- **8b, klasa podataka:** (A) DAN-312 čeka popis klasa iz M10.1-P01; (B) DAN-312 bilježi privremenu klasu označenu NEPROVJERENO, bez koda čuvanja (Q-16); (C) razlog se smatra jednakim sadržaju rada dok DATA-CLASS ne odluči drukčije.
- **8c, opseg pristupa podrške:** smije li zabilježeni pristup podrške obuhvatiti razlog produljenja ili je razlog izvan opsega kao i sve što nije potrebno za kvar.
- **8d, nesklad C:** D-69 daje koordinatoru na FPZG-u netehnička pitanja, uključujući produljenje roka, a razlog je vidljiv samo nastavniku i studentu. Ostaje otvoren (Q-19) dok vlasnik ne odluči vidi li koordinator razlog.

## 9. Što izvedba mora pokazati, ako vlasnik ADR prihvati

Ovo nisu nove odluke, nego provjere koje slijede iz odlučenog teksta (D-199 t. 3, D-172, D-262 Q06, pravilo 17). Vrijednosti u njima dolaze iz odgovora u §10.

1. Bez valjanog zapisa pristanka za točan slučaj nema čitanja sadržaja; negativni test za svaki operaterski put koji nije ovaj postupak (D-172).
2. Razlog je obvezan i ne smije biti prazan.
3. Opseg je najuži: zapis pristanka određuje točno koji rad i koji prikaz; čitanje izvan opsega se odbija.
4. Istek i opoziv vrijede i između dva čitanja: ako istek ili opoziv nastupi nakon prve provjere, drugo čitanje se odbija (negativni test na istodobnost).
5. Svaki pristup ostavlja append-only trag u `audit` i vidljiv je studentu (pravilo 17), u obliku iz pitanja 4.
6. Operater je prijavljen sigurnosnim ključem u zasebnoj vrsti sesije (D-262 Q06).

## 10. Otvorena pitanja za vlasnika (Q-5)

| Oznaka | Pitanje | Opcije |
| --- | --- | --- |
| O1 | Tko na fakultetu daje pristanak; jedna ili dvije osobe | §4: A do D, 1a |
| O2 | Način potvrde; vidi li potvrditelj opseg | §5: A do C, 2a |
| O3 | Najdulji istek; opoziv prije isteka | §6: A do C, 3a |
| O4 | Obavijest studentu: oblik čitatelja, aktivna obavijest, vrijeme, razlog | §7: 4a do 4d |
| O5 | Razlog produljenja: oblik, klasa podataka, opseg pristupa podrške | §8: 8a do 8c |
| O6 | Nesklad A: postoji li i break-glass administratora ustanove | §3 |
| O7 | Nesklad B: gdje se bilježi razlog pristupa (`access_log` ili `audit`) | §3 |
| O8 | Nesklad C: vidi li koordinator razlog produljenja | §8, 8d |

Odgovori se upisuju u `docs/DECISIONS.md` zasebnim docs PR-om. Dijelovi koji ovise o FPZG-u (O1, O2 opcija C) mogu ići u paket pitanja iz Q-3.

## 11. Što ovaj ADR ne radi

- Ne mijenja kod, migracije, `STATE.md`, `docs/DECISIONS.md` ni `docs/PRODUCT.md`.
- Ne određuje prijavu, MFA ni sesiju operatera osim onoga što su već odlučili D-172 i D-262 Q06; to je zaseban ADR ops portala (PLAN-TOKOVI, ops portal).
- Ne daje pravnu kvalifikaciju pristanka, posebne kategorije podataka ni rokove čuvanja; to su pravnik, DPO i FPZG (D-29, D-30, D-257).
- Ne sadrži pojedinosti sigurnosnih nalaza.
