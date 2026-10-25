# 01 Tokovi osobnih podataka

> **Ovo je radni nacrt, nije pravni savjet.** Pravni zaključci ostaju pravniku i službeniku za zaštitu podataka ustanove.

**Samo pravnik ili ustanova odlučuje:** (1) tko je voditelj, a tko izvršitelj obrade; (2) pravna osnova iz čl. 6. GDPR-a; (3) jesu li neke stavke niže posebna kategorija podataka; (4) jesu li hashevi i potvrde koji ostaju nakon brisanja još osobni podaci; (5) rokovi čuvanja po klasi (D-30, ČEKA FPZG); (6) je li vrijeme po promjeni (odjeljak C, D-143) biometrijski podatak po čl. 4. t. 14. GDPR-a, je li obrada razmjerna i vrijedi li Prilog III. točka 3(d) Akta o UI (D-55). To pokriva pravno mišljenje, a uz njega je prije pilota sa stvarnim studentima potrebna i DPIA.

Stanje koda: `main` na `bfa2e73`. Na `main` postoje samo tablice identiteta i nastave (`db/migrations/`). Tablice rada i evidencije, pohrana objekata, KMS, e-pošta, praćenje grešaka, izvoz i brisanje po roku **ne postoje**; evidencija ima samo adaptere u memoriji (`src/adapters/evidence/in-memory-*.ts`). Svi rokovi niže su prijedlozi iz `docs/ARCHITECTURE.md` §3 "Klase podataka", osim ako piše drukčije; nijedan nije potvrđen (D-30).

## A. Prijava i identitet

| Podatak | Izvor | Gdje | Tko čita | Rok čuvanja |
| --- | --- | --- | --- | --- |
| Izdavatelj, `sub`, `hrEduPersonUniqueID`, ustanova korisnika | AAI@EduHr, pri prvoj prijavi | `identity.user_account`; izgrađeno (`20261003210100_identity_session.sql`, `20261010210000_open_session.sql`) | Nijedna aplikacijska uloga izravno; samo funkcije `current_actor()` i prijava | Otvoreno. Kraj AAI računa: izvoz na zahtjev preko administratora (ARCHITECTURE §4); brisanje računa nije definirano `[IZVEDBA]` |
| `hrEduPersonHomeOrg` | AAI@EduHr, pri svakoj prijavi | Služi za određivanje ustanove. Sirova vrijednost atributa se ne sprema, ali se iz nje određena ustanova trajno veže uz račun (`user_account.institution_id`, obavezno); izgrađeno | Ne čita se poslije | Sirova vrijednost se ne čuva; pripadnost ustanovi traje koliko i račun |
| Sesija: hash tokena, korisnik, ustanova, nastanak, istek (12 h), zatvaranje i razlog | Poslužitelj | `identity.session`; izgrađeno | Samo `current_actor()` | Prijedlog: do isteka ili odjave, "zatim kratko radi revizije"; posao za brisanje nije izgrađen `[IZVEDBA]` |
| Ime i prezime studenta (`given_name` i `family_name`, inače `givenName` i `sn`) | AAI@EduHr, pri svakoj prijavi; dva zasebna atributa, nikad razdvojena iz jednog polja `name` ni iz imena za prikaz (D-170 O1; ugovor #757, DAN-308) | `identity.person_name`, uz RLS (B-11a, `20261027130000_person_name.sql`); upisuje ih samo `identity.open_session` sa sedam argumenata | Nijedna aplikacijska uloga izravno; samo nastavnik zajedničkog kolegija, kroz RPC brzog puta (`app.fast_path_works`, B-11b). Svako čitanje ostavlja zapis u `audit.access_log` (PRODUCT §5 pravilo 17). Ime se ne pojavljuje u zapisima poslužitelja ni u porukama greške | Zamjenjuje se pri svakoj prijavi; briše se kad AAI ne pošalje oba ili kad je neki neispravan. Briše se s računom, prije njega (strani ključ bez kaskade); postupak brisanja računa nije izgrađen `[IZVEDBA]` |
| Posljednja prijava, e-pošta | Predviđeno u ARCHITECTURE §3 (`app_user`) | **Nije izgrađeno**; shema nema e-poštu | Nije određeno | Otvoreno; treba li e-pošta, nije odlučeno `[ODLUKA]` |

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
| Tekst rada: odsječci promjena do 30 s, autor, vrijeme zaokruženo na minutu (D-24, PRODUCT §9); kontrolne točke s punim tekstom | Student (editor); nastavnik za svoje izmjene | Odsječci u privatnom bucketu po hashu, metapodaci i kontrolne točke u bazi (ARCHITECTURE §3, §5) | Student; mentor i nastavnik zadatka vide rad uživo, od prvog dana (D-142, zamjenjuje D-06 i D-39); povijest međustanja izvan prikaza uživo i reprodukcije nije dostupna (PRODUCT §5 pr. 7) | Radne verzije do kraja akademske godine zadatka (prijedlog); evidencija "kao predaja" |
| Vrijeme po promjeni (D-143, mijenja D-56): svaka promjena dokumenta (unos ili brisanje znaka, lijepljenje, uvoz, AI prijenos, izmjena nastavnika) sprema se znak po znak s redoslijedom i vremenom; bez ograničenja na mentorske radove i bez koraka od 100 ms | Editor | Zasebna klasa podataka, kraći rok, vezano uz odsječak hashom (D-56 uvjet 3) | Prikaz uživo (D-142) i reprodukcija za mentora, uz isti prikaz za studenta. Ima li reprodukciju i nastavnik kolegija ili samo mentor: otvoreno u D-143 (D-154 u PR-u #480 predlaže samo mentora, koji je nastavnik zadatka) | Rok nije predložen `[ODLUKA]`. **Do pilota se bilježi samo u demou i testovima s izmišljenim podacima**; prije pilota sa stvarnim studentima trebaju pravno mišljenje (D-55) i DPIA. Iz vremena se ne računa brzina, pauze ni ritam. Odsječak sam ne nosi vrijeme finije od minute, a ingest takav odsječak odbija (DECISIONS D-24 dopuna); nije provjereno u kodu |
| Lijepljenja (veličina, vrijeme), oznake koje student odabere, uvozi (naziv, vrsta, veličina, hash datoteke) | Editor, student | Kao evidencija | Student; nastavnik kroz projekciju | Kao evidencija |
| Izjava o pomoći AI-ja i priloženi ispisi razgovora iz vanjskih alata (poveznica, izvoz ili zalijepljen tekst; D-77) | Student | `assistance_declaration` | Student; nastavnik | Prema pravilniku fakulteta. Ispisi mogu sadržavati podatke trećih osoba; poveznica upućuje na sadržaj kod vanjskog pružatelja `[ODLUKA]` |
| Komentari, prijedlozi, zahtjevi za doradu, konzultacije mentora, napomene studenta | Nastavnik, mentor, student | Odgovarajuće tablice | Kako propisuje ARCHITECTURE §3 | Kao predaja |
| Produljenje roka s razlogom; oznaka odobrene prilagodbe (D-50, bez razloga) | Nastavnik; student | `deadline_extension`; `project` | Razlog: nastavnik i student; oznaka: nastavnik i mentor | Otvoreno. Razlog i oznaka mogu otkriti zdravstveno stanje `[ODLUKA]` |
| Predaja: dokument, hash, `requested_at`, potvrda i potpis | Student, poslužitelj | `submission`, `evidence.receipt` | Student; nastavnik zadatka | Prema pravilniku fakulteta (prijedlog) |
| Revizijski trag: tko je kada pristupio kojem radu (PRAVILO 17: student vidi tko je otvorio rad) | Poslužitelj | `access_log` | Administrator ustanove; student svoje | Dulje od predaje (prijedlog); tablica `audit.access_log` je izgrađena, upis ide kroz `audit.record_work_opening` (`db/migrations/20261021120000_audit_access_log.sql`, `20261021130000_audit_access_log_write.sql`), ali čitanje za studenta nije izgrađeno, pa obećanje "student svoje" još nije izvedeno `[IZVEDBA]` |

Hashevi lanca i čvorovi Merkle stabla ne brišu se (ne sadrže sadržaj; ARCHITECTURE §3, BACKEND §4.7). Javno se objavljuje dnevni potpisani korijen i točan ukupni broj potvrda (D-93, val 2).

## D. Uređaj i pogon

| Podatak | Gdje | Rok čuvanja |
| --- | --- | --- |
| Lokalni dnevnik promjena (Dexie) | Preglednik studenta. Klasa `src/lib/journal/atomic-dexie-journal.ts` ima ugovor: briše se pri odjavi, odjava se blokira dok ima nesinkroniziranih promjena. Ugovor je spojen u uređivač: `destroyForLogout()` poziva `src/components/editor/LocalDocument.tsx`; ruta `app/api/auth/logout/route.ts` sama zatvara samo poslužiteljsku sesiju, pa brisanje vrijedi samo kad odjava prolazi kroz uređivač `[IZVEDBA]`. Istek sesije nije odjava: dnevnik ostaje do ponovne prijave istog korisnika (planirano) | Do odjave ili sinkronizacije |
| Sigurnosni zapisi poslužitelja (IP, podaci o uređaju) | Smiju postojati samo odvojeno od evidencije (PRODUCT §9); planirano | Rok nije predložen `[ODLUKA]` |
| Praćenje grešaka bez tijela zahtjeva; gumb "Prijavi problem" (stanje spremanja i verzija, bez sadržaja; D-69) | Planirano; GlitchTip ili Sentry EU nije odabran | Rok nije predložen |
| E-pošta obavijesti (nastavniku o novoj reviziji) | Planirano (Scaleway TEM); nije jasno odakle adresa | Rok nije predložen `[ODLUKA]` |
| Kopije: PITR 3 dana, dnevni šifrirani dump, dnevna replika bucketa kod drugog dobavljača | Planirano (BACKEND §4.7) | "Zapisan je rok po vrsti kopije"; brisanje je potpuno tek kad istekne najdulji |
| Evaluacija pilota (ankete, razgovori) | Planirano; odvojeno od evidencije | Do kraja evaluacije; svrha i osnova nisu opisane `[ODLUKA]` |

## E. Što se izričito ne bilježi (PRODUCT §9, §5 pr. 4) `[PRAVILO]`

Koja je tipka pritisnuta i koliko je držana; izvedene mjere (brzina, pauze, obrasci); druge aplikacije i kartice; međuspremnik izvan zalijepljenog sadržaja; kamera, mikrofon, zaslon; razgovori s AI-jem dok ih student ne priloži. Ništa u sustavu ne poziva AI pružatelja (ARCHITECTURE §5b).

## F. Povlačenje studenta (D-12)

Predani radovi ostaju po pravilima fakulteta, sve ostalo se briše (D-12); hashevi lanca i čvorovi Merkle stabla ostaju (odjeljak C), pa "sve" treba precizirati `[ODLUKA]`. Mehanizam brisanja, potvrda studentu i obuhvat kopija nisu izgrađeni ni opisani `[IZVEDBA]`.
