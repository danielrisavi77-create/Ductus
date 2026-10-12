# 02 Kostur procjene učinka na zaštitu podataka (DPIA)

> **Ovo je radni nacrt, nije pravni savjet.** Kostur nije procjena: ne sadrži zaključak o prihvatljivosti obrade i ne zamjenjuje procjenu koju provodi voditelj obrade uz službenika za zaštitu podataka.

**Samo pravnik ili ustanova odlučuje:** treba li DPIA po čl. 35. GDPR-a i popisu nadzornog tijela; tko je voditelj i tko je potpisnik; je li potrebno prethodno savjetovanje (čl. 36.); smatra li se obrada praćenjem u smislu čl. 35. st. 3.; je li ritam tipkanja biometrijski podatak (čl. 4. t. 14., D-55); je li oznaka prilagodbe (D-50) podatak o zdravlju; je li obrada razmjerna ako je korištenje obvezno (D-04, D-79). D-29 (ČEKA FPZG) predlaže: FPZG voditelj, Ductus izvršitelj, DPIA prije stvarnih podataka, privola nije osnova.

## 1. Opis obrade

| Stavka | Nacrt (izvor) |
| --- | --- |
| Svrha | Bilježiti kako rad nastaje i olakšati razgovor o radu; zaključak donosi čovjek (D-01, D-02). Ductus ne tvrdi tko je napisao rad (PRODUCT §5 pr. 1) |
| Ispitanici | Studenti; nastavnici, mentori i administratori ustanove. Maloljetnici i studenti s teškoćama nisu obrađeni u dokumentima `[ODLUKA]` |
| Voditelj / izvršitelj | Predloženo D-29: FPZG / Ductus. Ugovorna strana na strani Ductusa nije određena: vlasnik je fizička osoba (STATE, Owner queue: obrt, FINA) `[ODLUKA]` |
| Kategorije podataka | `01-tokovi-podataka.md`: identitet iz AAI, članstvo, potvrde obavijesti, tekst rada i njegove promjene, lijepljenja i uvozi, izjave, napomene, razlozi produljenja, revizijski trag; ritam samo uz D-56 |
| Primatelji | Nastavnik i mentor (prema odnosu, C-23), administrator bez sadržaja, podizvršitelji (`04`) |
| Prijenosi izvan EU | Nisu isključeni (AWS KMS, objava korijena, vremenski žig); `04` |
| Rokovi | Prijedlozi u ARCHITECTURE §3; ništa nije potvrđeno (D-30) |
| Tehnologija | Next.js i worker, upravljana PostgreSQL baza, privatni bucket, KMS za potpise, OIDC prema AAI@EduHr (ARCHITECTURE §1, BACKEND §3). Izvedeno je samo prijava, sesije i nastava; evidencija ne postoji `izgrađeno / planirano` |
| Opseg pilota | Samo FPZG (D-15), ljetni semestar 2026./2027. (D-26); grupni radovi i ugrađeni AI izvan pilota (D-78, D-77) |

## 2. Nužnost i razmjernost

| Pitanje | Što dokumenti kažu | Što nedostaje |
| --- | --- | --- |
| Pravna osnova | D-29: privola nije osnova; obavijest nije privola i ne smije se tako prikazivati (PRODUCT §6, student 3) | Koju osnovu navodi ustanova `[ODLUKA]` |
| Obveznost | FPZG odlučuje je li korištenje obvezno; D-79: rad se piše u Ductusu kao obveza fakulteta. Ako je dobrovoljno, ravnopravna alternativa (PRODUCT §12) | Odluka D-04 i zamjenski postupak za studenta koji odbije ili kad Ductus ne radi `[ODLUKA]` |
| Ograničenje svrhe | Nema AI analize procesa (pr. 13), nema ocjena, postotaka, rangiranja (pr. 2, §7 "Zabranjeno u sažetku") | Pravilo ustanove da se podaci ne koriste za stegovne postupke ili ocjenjivanje bez razgovora `[ODLUKA]` |
| Smanjenje podataka | Vrijeme na minutu, odsječci do 30 s (D-24); bez tipki, bez drugih aplikacija, bez kamere (§9); OIB se ne traži | Opseg `profile` pri prijavi i mogući izvor imena (`04`); je li "razlog produljenja" potreban kao slobodan tekst `[ODLUKA]` |
| Točnost | Praznina se prikazuje kao praznina (pr. 3); oznake opaženo, uvezeno, izjavljeno (D-44) | Postupak ispravka studentovih podataka nije opisan `[IZVEDBA]` |
| Ograničenje čuvanja | Klase podataka (ARCHITECTURE §3); retention uloga u bazi postoji (`20261003210000_roles.sql`) | Rokovi D-30; posao brisanja i brisanje kopija nisu izgrađeni `[IZVEDBA]` |
| Transparentnost | Obavijest je prvi ekran svakog zadatka (pr. 6); student vidi tko je otvorio rad (pr. 17) i isto što vidi nastavnik (pr. 5) | Obavijest o privatnosti nije napisana (nacrt `03`); `access_log` nije izgrađen |
| Prava ispitanika | Izvoz rada i evidencije u svakom trenutku (PRODUCT §6); povlačenje D-12 | Pristup, ispravak, brisanje, prigovor: nema postupka ni izgradnje `[IZVEDBA]`; tko prima zahtjeve `[ODLUKA]` |

## 3. Rizici za studente

Stupci: izgrađeno / planirano / što nedostaje. Težina i vjerojatnost ocjenjuje voditelj uz DPO; ovdje se ne ocjenjuju.

| # | Rizik za studenta | Izgrađeno | Planirano | Nedostaje |
| --- | --- | --- | --- | --- |
| R1 | Osjećaj nadzora zbog uvida nastavnika u stanje rada, uključujući tekst koji će možda obrisati | Nijedan prikaz nastavniku još ne postoji | Pr. 7, D-06 (svakih najviše 5 min), obavijest o tome | Odluka D-06 ili D-39 (STATE, Owner queue) `[ODLUKA]` |
| R2 | Podaci se tumače kao dokaz krivnje ili autorstva, izvan konteksta | Rječnik zabranjenih izraza i provjera (`scripts/forbidden-terms/`, testovi u `tests/`) | Pr. 1 do 3, stalni tekst uz brojke | Postupak ustanove za uporabu zapisa pri prigovoru studenta `[ODLUKA]` |
| R3 | Ritam tipkanja kao mogući biometrijski podatak | Ne bilježi se; nije izgrađeno | D-56 uz uvjete (zasebna klasa, kraći rok, bez izvedenih mjera) | Pravno mišljenje i izmjena Ustava C-14, C-19 prije bilo kakvog bilježenja `[ODLUKA]` |
| R4 | Prisila: korištenje obvezno, student nema stvarnog izbora | Ništa | D-04, D-79, PRODUCT §12 | Odluka FPZG-a i zamjenski postupak `[ODLUKA]` |
| R5 | Neovlašten pristup tuđem radu (drugi kolegij, druga ustanova) | RLS i pgTAP matrica za identitet i nastavu (`db/tests/030..032`), pristup samo iz odnosa (C-23) | Isto za evidenciju; "RLS je obrana u dubinu" (BACKEND §4.3) | Dokaz za tablice rada i evidencije `[DOKAZ]` |
| R6 | Pristup operatera (fizička osoba) sadržaju | Web proces bez ključeva; `withActor` | Zabilježen pristup podrške uz pristanak fakulteta; revizijski trag operatera (plan 2.5 u #239) | `access_log`, razdvajanje ovlasti, ugovor o obradi `[IZVEDBA]` |
| R7 | Prijenos izvan EU i neodređeni podizvršitelji | Ništa | Sadržaj radova ostaje u EU (ODLUČENO, D-08 dio o aplikaciji, 11. 10. 2026.; dobavljači i ugovori ostaju otvoreni); u KMS idu samo digesti (D-92) | Potvrđen popis dobavljača i DPA-i; mehanizam prijenosa `[ODLUKA]` |
| R8 | Predugo čuvanje; brisanje koje ne stigne do kopija | Ništa spojeno: brisanje dnevnika pri odjavi postoji samo kao ugovor klase, nije u toku odjave | Brisanje po roku i verzije objekata, kopije s rokom (BACKEND §4.7) | Rokovi, posao brisanja, test brisanja na svim kopijama `[DOKAZ]` |
| R9 | Posebne kategorije i podaci trećih osoba u tekstu rada, ispisima razgovora, razlozima produljenja i oznaci prilagodbe | Oznaka prilagodbe bez razloga (D-50) | Razlog vidljiv samo nastavniku i studentu | Pravilo ustanove o unosu takvih podataka; ocjena posebnih kategorija `[ODLUKA]` |
| R10 | Gubitak ili nedostupnost rada, lažan status "spremljeno" | Klijentski dnevnik (Dexie) postoji; trajna poslužiteljska pohrana evidencije ne | Kopije, mjesečna proba povrata, uvjeti zaustavljanja pilota (PROGRAM) | Proba povrata baze i bucketa `[DOKAZ]` |
| R11 | Rad ostaje na zajedničkom računalu | Klasa dnevnika ima ugovor brisanja i blokade odjave, ali nije spojena u korisnički tok odjave | Brisanje pri odjavi, back-channel logout | Spajanje u tok odjave; istek sesije bez odjave ostavlja dnevnik do ponovne prijave `[IZVEDBA]` |
| R12 | Pogrešno povezan ili ponovno dodijeljen identitet | Nema spajanja po e-pošti; promijenjen `sub` ili ustanova se odbija (`open_session`) | Spajanje samo administrator | Srce nije potvrdio je li `hrEduPersonUniqueID` trajan `[DOKAZ]` |
| R13 | Student ne može dokazati što mu je bilo prikazano; ustanova ne može dokazati što je student potvrdio | Potvrda veže verziju zadatka koja je nepromjenjiva | Plan 2.6 u #239 | Potvrda ne veže tekst ni otisak obavijesti o privatnosti `[IZVEDBA]` |
| R14 | Javno vidljivi trajni tragovi (dnevni korijen, broj potvrda) | Ništa | Samo hash i ukupni broj, bez sadržaja (D-93; zapisati u DPIA) | Ocjena je li to osobni podatak `[ODLUKA]` |
| R15 | Podaci nastavnika i mentora (revizijski trag, komentari) | Uloge i autori zadataka | `access_log` | Obavijest za zaposlenike i njihovo zastupanje `[ODLUKA]` |

## 4. Savjetovanje i potpisi (prazno)

Mišljenje službenika za zaštitu podataka: `[ ]`. Prikupljeni stavovi studenata (čl. 35. st. 9.), ako ih ustanova traži: `[ ]`. Odluka voditelja o preostalim rizicima: `[ ]`. Datum sljedećeg pregleda: `[ ]`. Pregled mora uslijediti i prije svake promjene obuhvata, osobito prije D-56.
