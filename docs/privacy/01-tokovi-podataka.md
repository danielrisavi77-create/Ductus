# 01 Tokovi osobnih podataka

> **Ovo je radni nacrt, nije pravni savjet.** Pravni zaključci ostaju pravniku i službeniku za zaštitu podataka ustanove.

**Samo pravnik ili ustanova odlučuje:** (1) tko je voditelj, a tko izvršitelj obrade; (2) pravna osnova iz čl. 6. GDPR-a; (3) jesu li neke stavke niže posebna kategorija podataka; (4) jesu li hashevi i potvrde koji ostaju nakon brisanja još osobni podaci; (5) rokovi čuvanja po klasi (D-30, ČEKA FPZG).

Stanje koda: `main` na `bfa2e73`. Na `main` postoje samo tablice identiteta i nastave (`db/migrations/`). Tablice rada i evidencije, pohrana objekata, KMS, e-pošta, praćenje grešaka, izvoz i brisanje po roku **ne postoje**; evidencija ima samo adaptere u memoriji (`src/adapters/evidence/in-memory-*.ts`). Svi rokovi niže su prijedlozi iz `docs/ARCHITECTURE.md` §3 "Klase podataka", osim ako piše drukčije; nijedan nije potvrđen (D-30).

## A. Prijava i identitet

| Podatak | Izvor | Gdje | Tko čita | Rok čuvanja |
| --- | --- | --- | --- | --- |
| Izdavatelj, `sub`, `hrEduPersonUniqueID`, ustanova korisnika | AAI@EduHr, pri prvoj prijavi | `identity.user_account`; izgrađeno (`20261003210100_identity_session.sql`, `20261010210000_open_session.sql`) | Nijedna aplikacijska uloga izravno; samo funkcije `current_actor()` i prijava | Otvoreno. Kraj AAI računa: izvoz na zahtjev preko administratora (ARCHITECTURE §4); brisanje računa nije definirano `[IZVEDBA]` |
| `hrEduPersonHomeOrg` | AAI@EduHr, pri svakoj prijavi | Samo za odabir ustanove; ne sprema se uz korisnika; izgrađeno | Ne čita se poslije | Ne čuva se |
| Sesija: hash tokena, korisnik, ustanova, nastanak, istek (12 h), zatvaranje i razlog | Poslužitelj | `identity.session`; izgrađeno | Samo `current_actor()` | Prijedlog: do isteka ili odjave, "zatim kratko radi revizije"; posao za brisanje nije izgrađen `[IZVEDBA]` |
| Ime za prikaz, posljednja prijava, e-pošta | Predviđeno u ARCHITECTURE §3 (`app_user`) | **Nije izgrađeno**; shema nema ni ime ni e-poštu | Nastavnik bi vidio ime studenata u kolegiju (planirano) | Otvoreno; odakle dolazi ime nije odlučeno `[ODLUKA]` |

OIB se ne traži (PRODUCT §4). Kod trenutno čita samo `sub`, `hrEduPersonUniqueID` i `hrEduPersonHomeOrg` (`src/server/auth/claims.ts`); traži opseg `openid profile` (`src/server/auth/oidc.ts`), vidi `04`.

## B. Nastava (izgrađeno u `db/migrations/20261010180000..200000_*.sql`)

| Podatak | Izvor | Tko čita | Rok čuvanja |
| --- | --- | --- | --- |
| Članstvo u kolegiju: korisnik, uloga, od, do; tko je studenta uklonio i kada smije natrag | Student (upis kodom), nastavnik | Nastavnik kolegija sve članove; student nastavnike i svoje članstvo | Povijest se čuva bez roka; ispis ne briše predaje (ARCHITECTURE §7). Rok otvoren |
| Pogrešni kodovi za upis: korisnik, vrijeme | Student | Nitko izravno | Retci se brišu tek pri sljedećem pokušaju istog korisnika (komentar u migraciji), pa mogu ostati bez roka `[IZVEDBA]` |
| Uloge nastavnika i administratora, tko ih je potvrdio | Administrator ustanove, operater | Administrator ustanove | Otvoreno |
| Zadatak i njegove nepromjenjive verzije (naslov, upute, rokovi, pravila AI-ja, profil evidencije), autor | Nastavnik | Članovi kolegija | Otvoreno; podaci nastavnika su također osobni podaci |
| Potvrda obavijesti: student, verzija zadatka, vrijeme | Student | Student; nastavnik zadatka | Otvoreno. Veže verziju zadatka, ne tekst obavijesti o privatnosti ni njezin otisak `[IZVEDBA]` (plan 2.6 u #239) |

## C. Rad i evidencija (sve planirano)

| Podatak | Izvor | Gdje | Tko čita | Rok čuvanja |
| --- | --- | --- | --- | --- |
| Tekst rada: odsječci promjena do 30 s, autor, vrijeme zaokruženo na minutu (D-24, PRODUCT §9); kontrolne točke s punim tekstom | Student (editor); nastavnik za svoje izmjene | Odsječci u privatnom bucketu po hashu, metapodaci i kontrolne točke u bazi (ARCHITECTURE §3, §5) | Student; nastavnik trenutno stanje (D-06) ili stanje na kraju sesije (D-39); odnos D-06 i D-39 otvoren `[ODLUKA]`; povijest unutar sesije nije dostupna (PRODUCT §5 pr. 7) | Radne verzije do kraja akademske godine zadatka (prijedlog); evidencija "kao predaja" |
| Ritam: vrijeme promjena u koracima od 100 ms, samo mentorski radovi (D-56) | Editor | Zasebna klasa, kraći rok, vezano hashom | Mentor i student kroz reprodukciju | **Ne bilježi se** dok ne postoje pravno mišljenje i izmjena Ustava C-14 i C-19; rok nije predložen `[ODLUKA]`. Granica "vrijeme po događaju finije od minute" odbija se u ingestu (DECISIONS D-24 dopuna); nije provjereno u kodu |
| Lijepljenja (veličina, vrijeme), oznake koje student odabere, uvozi (naziv, vrsta, veličina, hash datoteke) | Editor, student | Kao evidencija | Student; nastavnik kroz projekciju | Kao evidencija |
| Izjava o pomoći AI-ja i priloženi ispisi razgovora iz vanjskih alata (poveznica, izvoz ili zalijepljen tekst; D-77) | Student | `assistance_declaration` | Student; nastavnik | Prema pravilniku fakulteta. Ispisi mogu sadržavati podatke trećih osoba; poveznica upućuje na sadržaj kod vanjskog pružatelja `[ODLUKA]` |
| Komentari, prijedlozi, zahtjevi za doradu, konzultacije mentora, napomene studenta | Nastavnik, mentor, student | Odgovarajuće tablice | Kako propisuje ARCHITECTURE §3 | Kao predaja |
| Produljenje roka s razlogom; oznaka odobrene prilagodbe (D-50, bez razloga) | Nastavnik; student | `deadline_extension`; `project` | Razlog: nastavnik i student; oznaka: nastavnik i mentor | Otvoreno. Razlog i oznaka mogu otkriti zdravstveno stanje `[ODLUKA]` |
| Predaja: dokument, hash, `requested_at`, potvrda i potpis | Student, poslužitelj | `submission`, `evidence.receipt` | Student; nastavnik zadatka | Prema pravilniku fakulteta (prijedlog) |
| Revizijski trag: tko je kada pristupio kojem radu (PRAVILO 17: student vidi tko je otvorio rad) | Poslužitelj | `access_log` | Administrator ustanove; student svoje | Dulje od predaje (prijedlog); tablica nije izgrađena `[IZVEDBA]` |

Hashevi lanca i čvorovi Merkle stabla ne brišu se (ne sadrže sadržaj; ARCHITECTURE §3, BACKEND §4.7). Javno se objavljuje dnevni potpisani korijen i točan ukupni broj potvrda (D-93, val 2).

## D. Uređaj i pogon

| Podatak | Gdje | Rok čuvanja |
| --- | --- | --- |
| Lokalni dnevnik promjena (Dexie) | Preglednik studenta; izgrađeno (`src/lib/journal/atomic-dexie-journal.ts`). Briše se pri odjavi; odjava se blokira dok ima nesinkroniziranih promjena. Istek sesije nije odjava: dnevnik ostaje do ponovne prijave istog korisnika | Do odjave ili sinkronizacije |
| Sigurnosni zapisi poslužitelja (IP, podaci o uređaju) | Smiju postojati samo odvojeno od evidencije (PRODUCT §9); planirano | Rok nije predložen `[ODLUKA]` |
| Praćenje grešaka bez tijela zahtjeva; gumb "Prijavi problem" (stanje spremanja i verzija, bez sadržaja; D-69) | Planirano; GlitchTip ili Sentry EU nije odabran | Rok nije predložen |
| E-pošta obavijesti (nastavniku o novoj reviziji) | Planirano (Scaleway TEM); nije jasno odakle adresa | Rok nije predložen `[ODLUKA]` |
| Kopije: PITR 3 dana, dnevni šifrirani dump, dnevna replika bucketa kod drugog dobavljača | Planirano (BACKEND §4.7) | "Zapisan je rok po vrsti kopije"; brisanje je potpuno tek kad istekne najdulji |
| Evaluacija pilota (ankete, razgovori) | Planirano; odvojeno od evidencije | Do kraja evaluacije; svrha i osnova nisu opisane `[ODLUKA]` |

## E. Što se izričito ne bilježi (PRODUCT §9, §5 pr. 4) `[PRAVILO]`

Koja je tipka pritisnuta i koliko je držana; izvedene mjere (brzina, pauze, obrasci); druge aplikacije i kartice; međuspremnik izvan zalijepljenog sadržaja; kamera, mikrofon, zaslon; razgovori s AI-jem dok ih student ne priloži. Ništa u sustavu ne poziva AI pružatelja (ARCHITECTURE §5b).

## F. Povlačenje studenta (D-12)

Predani radovi ostaju po pravilima fakulteta, sve ostalo se briše. Mehanizam brisanja, potvrda studentu i obuhvat kopija nisu izgrađeni ni opisani `[IZVEDBA]`.
