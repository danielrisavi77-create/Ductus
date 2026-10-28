# 05 Otvorena pitanja i dokazi prije pilota

> **Ovo je radni nacrt, nije pravni savjet.** Pitanja su napisana da ih vlasnik može izravno postaviti; odgovori nisu pretpostavljeni.

**Samo pravnik ili ustanova odlučuje:** sve stavke označene `[Ustanova]` i `[Pravnik]`. Vlasnik projekta odlučuje stavke `[Vlasnik]`, ali bez ustanove ne može zatvoriti nijednu koja ima pravnu posljedicu za studente.

## A. Blokira prve stvarne studente (redom)

1. `[Vlasnik, Pravnik]` Tko je ugovorna strana i izvršitelj obrade, kad je vlasnik fizička osoba (obrt, trgovačko društvo ili ustanova kao ugovorna strana), i tko potpisuje ugovor iz čl. 28. GDPR-a? `[ODLUKA]`
2. `[Ustanova]` Je li ustanova voditelj obrade (D-29) i koju pravnu osnovu navodi, uz uvjet da privola nije osnova? `[ODLUKA]`
3. `[Ustanova]` Tko je službenik za zaštitu podataka, tko provodi i potpisuje procjenu učinka i je li potrebno prethodno savjetovanje s nadzornim tijelom? `[ODLUKA]`
4. `[Ustanova]` Je li korištenje obvezno (D-04, D-79) i koji je zamjenski postupak za studenta koji odbije ili kad Ductus ne radi? `[ODLUKA]`
5. `[Ustanova, Pravnik]` Koje podizvršitelje ustanova prihvaća, treba li za svakog pisano odobrenje i koji mehanizam vrijedi za one povezane s grupom izvan EU-a (KMS, vremenski žig, javna objava)? `[ODLUKA]`
6. `[Ustanova]` Koji su rokovi čuvanja po klasi podataka, uključujući sigurnosne kopije i revizijski trag (D-30)? `[ODLUKA]`
7. `[Ustanova]` Tko prima zahtjeve ispitanika (pristup, ispravak, brisanje, izvoz, prigovor) i u kojem roku odgovara, kad Ductus za to nema ni postupak ni izgradnju? `[IZVEDBA]`
8. `[Ustanova]` Smije li se zapis o nastanku rada koristiti u stegovnom postupku ili pri ocjenjivanju i što prethodi tome (D-01, razgovor)? `[ODLUKA]`
9. `[Ustanova]` Studiraju li u pilotu osobe mlađe od 18 godina? `[ODLUKA]`
10. `[Ustanova, Pravnik]` Smije li se oznaka odobrene prilagodbe (D-50) i slobodan razlog produljenja roka čuvati, ili se oni smatraju podatkom o zdravlju? `[ODLUKA]`
11. `[Ustanova]` Treba li prije pilota prikupiti stavove studenata i obavijestiti ili uključiti zaposlenike čiji se pristupi bilježe? `[ODLUKA]`
12. `[Ustanova]` Tko u ustanovi prima obavijest o povredi podataka, tko je prijavljuje nadzornom tijelu u roku od 72 sata i tko smije zaustaviti pilot (PROGRAM, GO uvjeti)? `[DOKAZ]`
13. `[Ustanova, Srce]` Je li registracija usluge u AAI@EduHr podnesena, koje atribute Srce pušta za opseg `profile` i je li `hrEduPersonUniqueID` trajan i nikad ponovno dodijeljen? `[DOKAZ]`
14. `[Vlasnik]` Ostaje li repozitorij javan prije prvih stvarnih podataka (STATE, Owner queue)? `[ODLUKA]`

## B. Blokira određene dijelove pilota

15. `[Pravnik]` Je li vrijeme po promjeni (znak po znak, svi zadaci, D-143; mijenja D-56) biometrijski podatak po čl. 4. t. 14. GDPR-a, je li njegovo bilježenje i reprodukcija razmjerna i uz koje uvjete se smije bilježiti u pilotu sa stvarnim studentima? `[ODLUKA]` (blokira pilot sa stvarnim studentima, ne demo; do mišljenja i DPIA-e bilježi se samo u demou i testovima s izmišljenim podacima; pitanje ostaje otvoreno) Istraživač (13. 10. 2026.) navodi AZOP-ovu kaznu zbog obrade biometrijskih podataka kao presedan; iznos i odluka nisu provjereni, pravnik ih potvrđuje prije uporabe.
16. `[Pravnik]` Primjenjuje li se Prilog III. točka 3(d) Akta o UI na kontrolnu točku uživo bez AI-ja i je li ta obrada razmjerna (D-55)? `[ODLUKA]` (do mišljenja isključeno)
17. `[Vlasnik]` Riješeno 18. 10. 2026.: D-142 zamjenjuje D-06 i D-39 (prikaz uživo od prvog dana), a D-144 zamjenjuje D-37. Tekst obavijesti prati to; preostaje samo pitanje 15 o reprodukciji. `[RIJEŠENO]`
18. `[Vlasnik]` Kako se tekst obavijesti o privatnosti verzionira i veže uz potvrdu studenta (otisak teksta), kad potvrda sada veže samo verziju zadatka? `[IZVEDBA]`
19. `[Vlasnik, Ustanova]` Treba li Ductus uopće ime i e-poštu studenta, i ako treba, iz kojeg izvora, kad kod danas traži opseg `profile` a ne sprema ništa osim identifikatora? `[ODLUKA]` **Ime i prezime: odlučeno D-170 O1** (zasebni AAI@EduHr atributi, `identity.person_name`, vidi `01` odjeljak A); e-pošta ostaje otvorena.
20. `[Pravnik]` Jesu li hashevi lanca, potvrde i javno objavljeni ukupan broj potvrda osobni podaci nakon brisanja sadržaja (D-93, ARCHITECTURE §3)? `[ODLUKA]` Test za ocjenu: izdvajanje, povezivanje i zaključivanje iz nacrta smjernica EDPB-a o anonimizaciji (javno savjetovanje do 30. 10. 2026., prema izvještaju Istraživača od 18. 10.; tekst smjernica nije provjeren u repou). Konkretan put povezivanja: `segmentHash` i `finalDocumentHash` su SHA-256 bez ključa, pa tko ima kopiju teksta (nastavnik, kolega, treća strana) može izračunati hash i usporediti ga s potvrdom koja nosi `principalId`. `removedSha256` nije dio toga jer se briše sa segmentom (BACKEND §4.1).
20a. `[Vlasnik]` Ako pravnik ocijeni da su ti hashevi osobni podaci: hash s ključem po radu (HMAC) ili brisanje ključa pri povlačenju mijenja format evidencije i neovisnu provjeru, pa se odluka donosi prije prve stvarne evidencije (pilot), ne nakon. `[ODLUKA]`
21. `[Ustanova]` Je li evaluacija pilota (ankete, razgovori) zasebna obrada i tko je provodi na kojoj osnovi? `[ODLUKA]`
22. `[Vlasnik]` Koji su konačni dobavljači nakon B0.1 i B0.2 (D-08) i koju državu i grupu svaki ima? `[ODLUKA]`

## C. Rupe u izvedbi koje ne traže odluku, za orkestratora

| Rupa | Dokaz u repou | Vrsta |
| --- | --- | --- |
| Potvrda obavijesti veže (zadatak, verzija zadatka), ne tekst ni otisak obavijesti o privatnosti | `db/migrations/20261010200000_institution_assignment.sql`, tablica `notice_acknowledgment` | `[IZVEDBA]` |
| Nema izvoza, brisanja, ispravka, `data_class` ni posla za retention; `audit.access_log` postoji, ali student ga ne može čitati | Nijedna od tih tablica ni funkcija (osim `audit.access_log` i njegova upisa) u `db/migrations/`; uloga `ductus_retention` postoji | `[IZVEDBA]` |
| Pogrešni pokušaji upisa brišu se tek pri sljedećem pokušaju istog korisnika | Komentar uz `enrollment_attempt` u `20261010180000_institution_model.sql` | `[IZVEDBA]` |
| Sesije nemaju posao čišćenja nakon isteka | `identity.session` | `[IZVEDBA]` |
| Opseg `openid profile` odstupa od popisa u PRODUCT §4 | `src/server/auth/oidc.ts` | `[IZVEDBA]` |
| Brisanje lokalnog dnevnika nije spojeno u odjavu (`destroyForLogout()` nema produkcijskog poziva); dnevnik ostaje i nakon isteka sesije bez odjave | `app/api/auth/logout/route.ts`, `src/lib/journal/atomic-dexie-journal.ts`, BACKEND §4.3 | `[IZVEDBA]` |

## D. Dokazi koji moraju postojati prije prvog stvarnog studenta

Dopuna GO uvjetima iz `docs/PROGRAM.md`; ništa ovdje ne mijenja tu tablicu.

- Potpisana procjena učinka i ugovor o obradi (PROGRAM: "Podatkovni"); mišljenje službenika za zaštitu podataka u procjeni.
- Objavljena obavijest o privatnosti čiji otisak veže potvrda studenta; provjera rječnika sučelja nad tekstom.
- Popis podizvršitelja s DPA-ima i zapisanim mehanizmom prijenosa po stavci; potvrđen popis atributa prijave i registracija usluge.
- Potvrđeni rokovi (D-30) i test brisanja koji dokazuje brisanje sadržaja i verzija objekata te istek najdulje kopije.
- Test postupka za zahtjeve ispitanika (izvoz, brisanje) na sintetičkim podacima.
- Zapisana proba povrata baze i bucketa; pgTAP matrica za sve nove tablice rada i evidencije.
- Odluka D-04 i zamjenski postupak; postupak povrede podataka i osoba koja smije zaustaviti pilot.
- Za D-142 i D-143 (prikaz uživo, vrijeme po promjeni): pravno mišljenje (D-55), koje pokriva i Prilog III. točku 3(d) Akta o UI, i DPIA prije pilota sa stvarnim studentima; do tada se vrijeme po promjeni bilježi samo u demou i testovima s izmišljenim podacima, inače izričita potvrda da je isključeno iz pilota. Tvrdnja o AZOP-ovim kriterijima za obveznu DPIA ostaje neprovjerena dok se ne provjeri na AZOP-ovu popisu (`02`).
