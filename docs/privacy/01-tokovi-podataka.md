# 01 Tokovi osobnih podataka

> **Ovo je radni nacrt, nije pravni savjet.** Pravni zaključci ostaju pravniku i službeniku za zaštitu podataka ustanove.

**Samo pravnik ili ustanova odlučuje:** (1) tko je voditelj, a tko izvršitelj obrade; (2) pravna osnova iz čl. 6. GDPR-a; (3) jesu li neke stavke niže posebna kategorija podataka; (4) jesu li hashevi i potvrde koji ostaju nakon brisanja još osobni podaci; (5) rokovi čuvanja po klasi (D-30, ČEKA FPZG); (6) je li vrijeme po promjeni (odjeljak C, D-143) biometrijski podatak po čl. 4. t. 14. GDPR-a, je li obrada razmjerna i vrijedi li Prilog III. točka 3(d) Akta o UI (D-55). To pokriva pravno mišljenje, a uz njega je prije pilota sa stvarnim studentima potrebna i DPIA.

Stanje koda: `main` na `dd98206` (2. 11. 2026.). U `db/migrations/` postoje sheme `identity`, `institution`, `evidence`, `collaboration` i `audit`, među ostalim tablice rada i evidencije (`evidence.document`, `evidence.document_revision`, `evidence.segment`, `evidence.receipt`, `evidence.submission`), komentari i stanje prikaza uživo (`collaboration.*`) te zapis pristupa (`audit.access_log`). Postoje adapteri za pohranu objekata kompatibilnu sa S3 (`src/adapters/evidence/s3-evidence-payload-store.ts`) i za potpis preko AWS KMS-a (`src/adapters/crypto/aws-kms-*.ts`), ali dobavljači nisu ugovoreni ni uključeni (B0.1, D-08). Izvoz postoji samo na uređaju: urednik može preuzeti trenutni tekst kao TXT (`exportText` u `src/components/editor/LocalDocument.tsx`, uz obavijest o pogrešci ili oporavku i u dijalogu odjave; isto za raniji tekst u `EarlierDraft.tsx`); preuzimanje se događa u pregledniku. E-pošta (osim lokalnog Mailpita), praćenje grešaka, izvoz rada i evidencije s poslužitelja (DOCX, PDF, paket evidencije, izvoz na zahtjev) i opće brisanje po roku **ne postoje**; postoji samo funkcija brisanja završenih sesija (`identity.purge_ended_sessions`, D-200), koju zasad ništa ne pokreće. Tablice niže nastale su na `bfa2e73`, a pojedini redci osvježavani su zasebno; ovim presjekom nisu ponovno provjerene u cjelini. Svi rokovi niže su prijedlozi iz `docs/ARCHITECTURE.md` §3 "Klase podataka", osim ako piše drukčije; nijedan nije potvrđen (D-30).

## A. Prijava i identitet

| Podatak | Izvor | Gdje | Tko čita | Rok čuvanja |
| --- | --- | --- | --- | --- |
| Izdavatelj, `sub`, `hrEduPersonUniqueID`, ustanova korisnika | AAI@EduHr, pri prvoj prijavi | `identity.user_account`; izgrađeno (`20261003210100_identity_session.sql`, `20261010210000_open_session.sql`) | Nijedna aplikacijska uloga izravno; samo funkcije `current_actor()` i prijava | Otvoreno. Kraj AAI računa: izvoz na zahtjev preko administratora (ARCHITECTURE §4); brisanje računa nije definirano `[IZVEDBA]` |
| `hrEduPersonHomeOrg` | AAI@EduHr, pri svakoj prijavi | Služi za određivanje ustanove. Sirova vrijednost atributa se ne sprema, ali se iz nje određena ustanova trajno veže uz račun (`user_account.institution_id`, obavezno); izgrađeno | Ne čita se poslije | Sirova vrijednost se ne čuva; pripadnost ustanovi traje koliko i račun |
| Sesija: hash tokena, korisnik, ustanova, nastanak, istek (12 h), zatvaranje i razlog | Poslužitelj | `identity.session`; izgrađeno | Samo `current_actor()` | Prijedlog: do isteka ili odjave, "zatim kratko radi revizije"; posao za brisanje nije izgrađen `[IZVEDBA]` |
| Ime i prezime studenta (`given_name` i `family_name`, inače `givenName` i `sn`) | AAI@EduHr, pri svakoj prijavi; dva zasebna atributa, nikad razdvojena iz jednog polja `name` ni iz imena za prikaz (D-170 O1; ugovor #757, DAN-308) | `identity.person_name`, uz RLS (B-11a, `20261027190000_person_name.sql`); upisuje ih samo `identity.open_session` sa sedam argumenata | Nijedna aplikacijska uloga izravno; samo nastavnik zajedničkog kolegija, kroz RPC brzog puta (`app.fast_path_works`, B-11b). Svako čitanje ostavlja zapis u `audit.access_log` (PRODUCT §5 pravilo 17). Ime se ne pojavljuje u zapisima poslužitelja ni u porukama greške | Zamjenjuje se pri svakoj prijavi; briše se kad AAI ne pošalje oba ili kad je neki neispravan. Briše se s računom, prije njega (strani ključ bez kaskade); postupak brisanja računa nije izgrađen `[IZVEDBA]` |
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
| Popis i detalj mentorskih radova (DAN-477, T07; izgrađeno): par imena studenta, naslov i vrsta rada, oznaka dokumenta i stanje (nije započet, u izradi, predan); bez vremena, aktivnosti i brojki | Poslužitelj iz postojećih tablica mentorstva, zadatka, dokumenta i predaje | `/api/teacher/mentorships` i `/api/teacher/mentorships/[mentorshipId]`; čitanje ništa ne upisuje, ni u `audit.access_log` | Samo mentor otvorenog mentorstva s potvrđenom ulogom nastavnika u istoj ustanovi; svi drugi dobivaju prazan popis i isti 404 | Kao izvorni podaci |
| Lijepljenja (veličina, vrijeme), oznake koje student odabere, uvozi (naziv, vrsta, veličina, hash datoteke) | Editor, student | Kao evidencija | Student; nastavnik kroz projekciju | Kao evidencija |
| Izjava o pomoći AI-ja i priloženi ispisi razgovora iz vanjskih alata (poveznica, izvoz ili zalijepljen tekst; D-77) | Student | `assistance_declaration` | Student; nastavnik | Prema pravilniku fakulteta. Ispisi mogu sadržavati podatke trećih osoba; poveznica upućuje na sadržaj kod vanjskog pružatelja `[ODLUKA]` |
| AI pomoćnik (D-194, mijenja D-77; **planirano, ništa nije izgrađeno**): odabrani odlomak i poslužiteljske upute odlaze AI pružatelju samo kad student sam pokrene pomoćnika, uz sve namjene iz D-64 (uključujući zvuk za transkripciju i alate pružatelja `[ODLUKA]`); razgovori; zapis prijenosa (vrijeme, pružatelj, model, svrha, preneseni tekst, D-41, D-42) | Student | Kod AI pružatelja (podizvršitelj, `04`); kod Ductusa razgovori i zapis prijenosa (`ai_conversation`, `ai_transfer` nisu izgrađeni) | Student; razgovori nastavniku tek kao prilog izjavi (D-41); zapis prijenosa kao u PRODUCT §9 | Rok i klasa podataka nisu predloženi `[ODLUKA]`. Pružatelj, regija obrade, čuvanje i treniranje kod pružatelja: tek nakon izbora i ugovora (D-194 t. 6 i 7, PRIJEDLOG). Tekst može sadržavati podatke trećih osoba i posebne kategorije (`02` R9); transkripcija obrađuje glasove trećih osoba `[ODLUKA]` |
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
| Kopije: PITR 3 dana, dnevni šifrirani dump, dnevna replika bucketa kod drugog dobavljača | Planirano (BACKEND §4.7); po vrsti kopije u tablici ispod | Vlastiti rok po vrsti kopije (D-12); brisanje je potpuno tek kad istekne najdulji. Nijedan rok nije određen |
| Evaluacija pilota (ankete, razgovori) | Planirano; odvojeno od evidencije | Do kraja evaluacije; svrha i osnova nisu opisane `[ODLUKA]` |

### Kopije po vrsti i klasi podataka (DATA-CLASS)

Brojevi klasa su iz `06-klase-podataka.md`. Svaka kopija je i sama klasa 29 (`06`); stupac „Klase u kopiji” kaže koje klase kopija nosi. Rok kopije nije odlučen: D-30 je PRIJEDLOG, a odgovor se traži od FPZG-a i DPO-a (Owner queue Q-16, paket Q-3). Ništa ovdje nije izgrađeno.

| Vrsta kopije | Gdje (BACKEND §4.7) | Klase u kopiji | Rok kopije |
| --- | --- | --- | --- |
| PITR baze | UpCloud, ista usluga kao baza | 29; sadrži klase iz baze: 1 do 11, 13 do 19, 21 (metapodaci), 22, 24 do 28 | Otvoreno (D-30 PRIJEDLOG, Q-16). PITR 3 dana je tehnička postavka, ne rok (`07` §1) |
| Dnevni šifrirani dump baze (`age`) | Drugi dobavljač | 29; iste klase kao PITR | Otvoreno (D-30 PRIJEDLOG, Q-16); vlastiti rok (D-12) |
| Dnevna replika bucketa (`rclone sync` bez brisanja, šifrirano) | Drugi dobavljač (npr. Hetzner Object Storage) | 29; sadrži 21 (sadržaj odsječaka i paketa) i 23; jer replika ne briše, objekt obrisan u izvoru ostaje u replici do njezina roka; 20 samo ako izvozni paket živi u istom bucketu, što nije određeno `[IZVEDBA]` | Otvoreno (D-30 PRIJEDLOG, Q-16); vlastiti rok (D-12) |
| Verzije objekata u bucketu | Scaleway, isti bucket | 29; prethodne verzije objekata klasa 21 i 23; 20 samo ako izvozni paket živi u istom bucketu `[IZVEDBA]` | Otvoreno (D-30 PRIJEDLOG, Q-16). Brisanje mora ukloniti i verzije (BACKEND §4.7) |
| Bucket s potpisanim kontrolnim točkama brisanja | Zaseban bucket, vjerodajnica samo za upis, verzije ili object lock (D-272 MQ07; object lock NEPROVJERENO); dobavljač nije određen `[ODLUKA]`, vidi `04` | 28 (evidencija brisanja); nije kopija rada | Otvoreno (D-30 PRIJEDLOG, Q-16) |

Klasa 12 je rezervirana i ne gradi se (D-274 MQ09), a klasa 30 živi samo u pregledniku, pa ne ulaze ni u jednu kopiju. Povrat iz kopije radi operater, koji po pravilu D-172 ne vidi sadržaj studentskog rada; povrat se ne otvara dok se evidencija brisanja (klasa 28) ne usporedi s potpisanom kontrolnom točkom (D-272 MQ07). Bez toga bi povrat vratio podatke koje je brisanje već uklonilo (D-12).

## E. Što se izričito ne bilježi (PRODUCT §9, §5 pr. 4) `[PRAVILO]`

Koja je tipka pritisnuta i koliko je držana; izvedene mjere (brzina, pauze, obrasci); druge aplikacije i kartice; međuspremnik izvan zalijepljenog sadržaja; kamera, mikrofon, zaslon; razgovori s AI-jem dok ih student ne priloži. Pružatelju AI-ja ne šalju se identitet studenta ni podaci o procesu pisanja (PRODUCT §5 pr. 13). Zasad ništa u sustavu ne poziva AI pružatelja; kad pomoćnik bude izgrađen (D-194), tok je u redu o AI pomoćniku u odjeljku C i u ARCHITECTURE §5b.

## F. Povlačenje studenta (D-12)

Predani radovi ostaju po pravilima fakulteta, sve ostalo se briše (D-12); hashevi lanca i čvorovi Merkle stabla ostaju (odjeljak C), pa "sve" treba precizirati `[ODLUKA]`. Mehanizam brisanja, potvrda studentu i obuhvat kopija nisu izgrađeni ni opisani `[IZVEDBA]`.
