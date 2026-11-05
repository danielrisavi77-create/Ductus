# Mapa ekrana Ducture i plan referentnih slika

Zapis: 5. 11. 2026., Linear DAN-563 (paket 0). Izvor stanja: origin/main na dan zapisa. Mapa dopunjuje [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) i docs/SESSIONS.md §6: ondje je pravilo kako referenca izgleda i kako se dokazuje, ovdje je popis što treba nacrtati i kojim redom. Smjer je „papir i grafit” (D-188); ova mapa ga ne mijenja.

Vlasnik, 5. 11. 2026. ([#87, komentar 6645197873](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6645197873), odluke EQ2–EQ10): „Ovo ostalo sve napravi ti po tome što misliš da je najbolje i najlogičnije za aplikaciju”. O starim .dc.html prototipovima ([#87, komentar 6645288294](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6645288294)): „Ok, solidni su, ali treba prilagoditi našoj boji”.

## 1. Oznake

- Oznaka ekrana uvijek ide uz puni naziv („S-11 Panel Upute i provjera oblika”). Oznaka sama nije jednoznačna jer se u dokumentima sudara (S-01, S-11, A-03).
- Sudar A-10: u docs/FEATURES.md A-10 je „Moj rad u brojkama”, a u mapi A-10 su „Slučajevi i paket dokaza”. Studentski ekran dobiva oznaku **S-47 Moj rad u brojkama**; A-10 ostaje „Slučajevi i paket dokaza”. FEATURES se ovim PR-om ne mijenja.
- Faze su iz docs/PROGRAM-RAZRADA.md. Ekrani koji ondje nemaju fazu vode se kao „bez faze”.

## 2. Status reference

- **ODOBRENO**: slika je spojena u main (spajanje „Spoji n” je odobrenje, D-183) i nema poznatih nedostajućih stanja.
- **U PR-u**: slika je u otvorenom PR-u.
- **DJELOMIČNO**: ili slika postoji bez svih stanja, ili postoji samo stari .dc.html prototip ili snimka aplikacije u staroj paleti. Prototip nije odobrena referenca (DESIGN-SYSTEM §1 t. 4).
- **NEMA**: ništa.

Zahtijevana stanja svakog ekrana: popunjeno, prazno, učitavanje, greška, mobitel (400 px), uz posebna stanja ekrana. Stupac „Nedostaje” navodi što još nije prikazano; to je procjena iz opisa ekrana, osim stanja doslovno navedenih u README-ima referenci. Stupac „Paket” upućuje na odjeljak 4 (— znači da ekran nema paket: gotov je ili izvan plana).

## 3. Odluke EQ1–EQ10

EQ1 čeka vlasnika. EQ2–EQ10 odlučio je orkestrator po vlasnikovoj ovlasti iz [#87 c.6645197873](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6645197873); smjer D-188 ne mijenja nijedna.

| # | Pitanje | Odluka |
|---|---|---|
| EQ1 | Jesu li stari .dc.html prototipi odobrena referenca? | Otvoreno. Vlasnik ([#87 c.6645288294](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6645288294)): prototipi su solidni, ali se prilagođavaju našoj boji. Kompozicija se smije preuzeti, boje prototipa ne (DESIGN-SYSTEM §1 t. 4). S-40 i P-01 se ne crtaju iznova (#1091). |
| EQ2 | Cjelovita referenca radnog prostora? | Da: jedna slika /rad (Z-01 Ljuska i navigacija + S-10 Editor) složena iz odobrenih komponenti M3–M5, bez novih komponenti (paket 2). Snimka ljuske iz M0.5c nije odobrenje (§6.6). |
| EQ3 | Redovi bez stanja učitavanja ili oporavka (A-02, A-03, A-04, Z-11, N-08, S-13)? | Dopunjuju se bez novih slika po ekranu: učitavanje i greška iz zajedničkog lista (paket 1), Z-11 u paketu 2, S-13 u paketu 5, N-08 u paketu 9. |
| EQ4 | K-01, K-02, A-10, J-04? | Ne crtaju se i ne grade; ostaju u mapi „izvan faza, čeka vlasnika”. Uklanjanje je produktna odluka. |
| EQ5 | Uvjetni ekrani (P-01, N-14, N-15, S-46, S-18)? | Crtaju se tek kad je uvjet ispunjen (U-1, U-3, U-2, U-5); plan čuva mjesto (paket U). |
| EQ6 | Fokus tipkovnicom? | Da, kao jedan list „fokus i tipkovnica” u paketu 1 plus numerirani tipkovnički redoslijed kao bilješka na svakoj novoj referenci. WCAG 2.1 AA (D-115), novi ekrani 2.2 AA (D-248). |
| EQ7 | S-06 Planer rada iz roka i opsega? | Crtati (paket 5): samo studentov prikaz, bez mjere iz vremena, ne ulazi u sažetak ni nastavnički prikaz (PRODUCT §5 pravilo 4, iznimka D-63). Prije PR-a provjeriti da je #1030 spojen. |
| EQ8 | Zajednička stanja? | Jedan zajednički list za Z-03, Z-04, Z-05, Z-06, Z-08 (paket 1). |
| EQ9 | Mapa ekrana u repo? | Da: ova datoteka; sudar A-10 rješava S-47 (odjeljak 1). |
| EQ10 | Svijetla naslovnica i prijava? | Svijetla varijanta preko postojećih tokena svijetle ljuske (data-theme="light"), bez nove boje; zadano ostaje tamno. DESIGN-SYSTEM §3 mijenja se tek kad se izvede (#1024, J-01). |

## 4. Redoslijed paketa

Jedan paket je jedan docs PR u docs/design/ductura/<mapa>/ (HTML, PNG snimke, README sa stanjima, SHA256SUMS), oko 400 redaka. Svaka slika: 1440 i 400 px, tamna i svijetla ljuska, bijeli i tamni list gdje ima lista, samo hrvatski do M11 (D-247), sintetički podaci, samo tokeni iz DESIGN-SYSTEM §3. „Ovisi” znači da je jedini izvor stari prototip, pa paket čeka EQ1; ostali mogu odmah.

| # | Paket (mapa) | Ekrani | Posebna stanja | Faza | EQ1 |
|---|---|---|---|---|---|
| 0 | Mapa ekrana (ovaj dokument) | svi | — | M0 | ne ovisi |
| 1 | Zajednička stanja (z-stanja-reference) | Z-03, Z-04, Z-05, Z-06, Z-08, list „fokus i tipkovnica” | istekla sesija, odjava u drugoj kartici, bez mreže; 404, greška poslužitelja; nema ovlasti; kostur, dugo učitavanje, smanjeno kretanje; potvrda, opasna radnja, fokus u dijalogu | M0–M1 | ne ovisi |
| 2 | Radni prostor (m0-rad-reference) | Z-01, S-10, Z-13, Z-11, Z-02 | prazan rad, spremanje, bez mreže, sukob, predano, oporavak, odjava s nesinkroniziranim, prekidač teme | M0.5c, M3, M5 | ovisi |
| 3 | Početak toka, student (m2-student-reference) | S-01, S-02, S-03, S-04, S-05 | AAI nedostupan, odbijena prijava, svijetla prijava (EQ10); nema kolegija, rok blizu; neispravan ili istekao kod | M1–M2 | ovisi |
| 4 | Početak toka, nastavnik (m2-nastavnik-reference) | N-01, N-02, N-03, N-04, N-16 | valjanost obrasca, koraci čarobnjaka, dopuštena uporaba alata | M2 | djelomično |
| 5 | M5 dopuna (m5-reference-c) | S-06, S-07, S-13 | planer bez cilja ili s prošlim rokom; pravopis uključen, isključen; uvoz BibTeX/RIS djelomičan | M5 | ne ovisi |
| 6 | Predaja, student (m7-reference, A) | S-15, S-30, S-31, S-32, S-33 | bez mreže pri pregledu, potvrda čeka potpis, predano | M7 | ovisi |
| 7 | Sažetak i pregled, nastavnik (m7-reference, B) | N-05, N-10, N-11, N-13 | brz put, karta podrijetla, usporedba verzija, sukob produljenja s rokom | M7 | ovisi |
| 8 | Predaja, ostalo (m7-reference, C) | S-43, J-03, S-47 | potvrda se ne podudara; osporavanje poslano; S-47 samo student | M7 | ne ovisi |
| 9 | M6 pregled i komentari (m6-reference-c, nakon #1454) | N-06, N-07, N-17, S-12, S-17, S-40, N-08 | istodobno pisanje, diff verzija, otvoreni i riješeni komentari, zastarjela baza | M6 | ovisi |
| 10 | M6 obavijesti (m6-reference-c) | S-41, Z-07 | nepročitano, bez obavijesti, postavke po vrsti | M6 | djelomično |
| 11 | Administrator, M2 (m2-admin-reference) | A-02, A-03, A-04 (učitavanje i greška preko paketa 1) | učitavanje, greška | M2 | ne ovisi |
| 12 | Uvoz i izvoz (m8-reference) | S-19, S-20, N-18, S-09 | djelomičan uvoz, nepodržan format, A4 pregled, paket za Merlin, citat nije pronađen | M8 | ovisi |
| 13 | Asistent (m9-reference-a) | S-16 | 12 stanja, bez mreže, proračun | M9 | ne ovisi |
| 14 | AI u predaji (m9-reference-b) | S31-AI, N-AI-ATT | nema uporabe, izjavljeno, priloženi razgovori | M9 | ne ovisi |
| 15 | Vlastiti podaci (m10-student-reference) | S-42, S-44 | opoziv; zahtjev, posao u tijeku, preuzimanje, istek | M10 | ne ovisi |
| 16 | Čuvanje i trag (m10-admin-reference) | A-05, A-06, A-08 | pravno zadržavanje, potvrda izlaza | M10 | ne ovisi |
| 17 | Javne stranice (m11-javno-reference) | J-01, J-02, J-05 | svijetla tema, prijavljen i odjavljen, incident | M11 | ovisi |
| 18 | Postavke i podrška (m11-reference) | A-07, A-09, Z-09, Z-10, Z-12 | AAI nedostupan, tema, obavijesti, poslano; dodir od 44 px na 400 px | M11 | djelomično |
| 19 | Operater (m12-reference) | A-01 | status pilota, STOP poruka | M12 | ne ovisi |
| U | Uvjetni (EQ5) | P-01, N-14, N-15, S-46, S-18 | po ekranu | M6, M7, M10 | P-01, N-15 ovise |
| — | Izvan faza (EQ4) | K-01, K-02, A-10, J-04 | ne crta se | — | — |

N-19 AI pomoć nastavniku nema korak u fazi i ne crta se dok ga plan M9 ne dobije. Paketi 6–8 moraju biti spojeni prije UI PR-ova M7. Prije paketa 3 provjeriti #1024, prije paketa 5 #1030.

## 5. Popis ekrana

Postojeće reference na main: docs/design/ductura/m2-reference do m5-reference, m6-reference-b i screenshots-v3 (stara paleta). docs/design/m0-ljuska sadrži snimke aplikacije, ne odobrenu referencu.

| Oznaka | Naziv | Faza | Status | Paket | Nedostaje |
|---|---|---|---|---|---|
| Z-01 | Ljuska i navigacija | M0 | DJELOMIČNO | 2 | prazno, učitavanje, greška, fokus tipkovnica |
| Z-04 | Greška i 404 | M0 | NEMA | 1 | 404, greška poslužitelja, mobitel |
| Z-06 | Stanje učitavanja (uzorak) | M0 | NEMA | 1 | kostur, dugo učitavanje, smanjeno kretanje |
| Z-08 | Dijalozi | M0 | NEMA | 1 | potvrda, opasna radnja, fokus u dijalogu, mobitel |
| Z-13 | Tema (svijetla/tamna, bijeli/tamni list) | M0 | DJELOMIČNO | 2 | list bijeli/tamni, prekidač |
| S-01 | Prijava (AAI@EduHr) | M1 | DJELOMIČNO | 3 | prazno, učitavanje, greška, AAI nedostupan, odbijena prijava, nova osoba bez uloge |
| Z-03 | Sesija istekla | M1 | NEMA | 1 | istekla, odjavljen u drugoj kartici, bez mreže, mobitel |
| Z-05 | Nema ovlasti | M1 | NEMA | 1 | nema ovlasti, mobitel |
| S-02 | Studentska početna | M2 | DJELOMIČNO | 3 | prazno, učitavanje, greška, mobitel, nema kolegija, rok blizu |
| S-03 | Moji kolegiji (student) | M2 | DJELOMIČNO | 3 | popunjeno, prazno, učitavanje, greška, mobitel, jedan kolegij, više grupa |
| S-04 | Upis kodom | M2 | DJELOMIČNO | 3 | neispravan kod, istekao kod, već upisan, mobitel, greška |
| S-05 | Obavijest o zadatku (S3); dio M7 | M2 | DJELOMIČNO | 3 | prazno, učitavanje, greška, mobitel, potvrda obavijesti, promijenjen tekst obavijesti |
| N-01 | Moji kolegiji (nastavnik) | M2 | NEMA | 4 | popunjeno, prazno, učitavanje, greška, mobitel |
| N-02 | Novi kolegij i zadatak | M2 | DJELOMIČNO | 4 | prazno, učitavanje, greška, mobitel, valjanost obrasca |
| N-03 | Čarobnjak zadatka | M2 | DJELOMIČNO | 4 | prazno, učitavanje, greška, mobitel, koraci, dopuštena uporaba alata |
| N-04 | Popis studenata | M2 | NEMA | 4 | popunjeno, prazno, učitavanje, greška, mobitel, seminarska grupa |
| N-16 | Radovi uz mentora (podaci) | M2 | NEMA | 4 | popunjeno, prazno, učitavanje, greška, mobitel |
| A-01 | Pregled ustanove / operaterski status pilota | M2 | NEMA | 19 | popunjeno, prazno, učitavanje, greška, mobitel, STOP stanje |
| A-02 | Korisnici i uloge | M2 | DJELOMIČNO | 11 | učitavanje |
| A-03 | Kolegiji i akademske godine | M2 | DJELOMIČNO | 11 | učitavanje |
| A-04 | Pravila fakulteta (samo čitanje) | M2 | DJELOMIČNO | 11 | učitavanje, greška |
| S-10 | Editor (cijeli ekran) | M3 | DJELOMIČNO | 2 | popunjeno, prazno, učitavanje, greška, bez mreže, sukob, spremanje, predano (samo čitanje), fokus tipkovnica |
| S-10.1 | Editor: stanja spremanja | M3 | ODOBRENO | — | — |
| Z-11 | Druga kartica, bez mreže i oporavak | M3 | DJELOMIČNO | 2 | oporavak (zaseban tok) |
| Z-02 | Odjava i dijalog (nesinkronizirane izmjene) | M3 | DJELOMIČNO | 2 | odjava, odjava s nesinkroniziranim, odjava bez mreže, mobitel |
| S-11 | Panel Upute i provjera oblika | M4 | ODOBRENO | — | — |
| S-10.2 | Traži i zamijeni | M5 | ODOBRENO | — | — |
| S-10.3 | Način fokusa | M5 | ODOBRENO | — | — |
| S-10.4 | Opseg poglavlja | M5 | ODOBRENO | — | — |
| S-10.5 | Fusnote | M5 | ODOBRENO | — | — |
| S-10.6 | Tablice i slike | M5 | ODOBRENO | — | — |
| S-10.7 | Navodi u tekstu i bibliografija | M5 | ODOBRENO | — | — |
| S-13 | Literatura i bilježnica izvora | M5 | DJELOMIČNO | 5 | uvoz BibTeX/RIS |
| S-14 | Struktura (kartica Nacrt) | M5 | ODOBRENO | — | — |
| S-45 | Prvi ulazak i vodič (dvije minute) | M5 | ODOBRENO | — | — |
| S-06 | Planer rada iz roka i opsega | M5 | NEMA | 5 | popunjeno, prazno, učitavanje, greška, mobitel |
| S-07 | Pravopis prema jeziku rada | M5 | NEMA | 5 | uključeno, isključeno, jezik nepoznat, mobitel |
| S-08 | DOI i ISBN u bibliografskom zapisu | M5 | ODOBRENO | — | — |
| S-34 | Reprodukcija vlastitog rada | M6 | U PR-u | — | — |
| N-09 | Reprodukcija (nastavnik) | M6 | U PR-u | — | — |
| N-08 | Komentari, prijedlozi i zahtjevi za doradu | M6 | DJELOMIČNO | 9 | sukob (zastarjela baza) |
| N-12 | Konzultacije | M6 | ODOBRENO | — | — |
| S-12 | Komentari studenta | M6 | DJELOMIČNO | 9 | popunjeno, prazno, učitavanje, greška, otvoreni/riješeni |
| S-17 | Kako vidi nastavnik | M6 | DJELOMIČNO | 9 | popunjeno, prazno, učitavanje, greška, mobitel |
| S-40 | Komentari na mobitelu | M6 | DJELOMIČNO | 9 | — |
| S-41 | Obavijesti (student) | M6 | DJELOMIČNO | 10 | popunjeno, prazno, učitavanje, greška, mobitel, postavke po vrsti, bez obavijesti |
| Z-07 | Obavijesti (zajednički popis) | M6 | NEMA | 10 | popunjeno, prazno, učitavanje, greška, mobitel, nepročitano, postavke |
| N-06 | Rad uživo (pregled studentova rada) | M6 | NEMA | 9 | popunjeno, prazno, učitavanje, greška, mobitel, bez mreže studenta, istodobno pisanje |
| N-07 | Pregled rada | M6 | DJELOMIČNO | 9 | prazno, učitavanje, greška, mobitel, diff verzija |
| N-17 | Zbirni pregled | M6 | NEMA | 9 | popunjeno, prazno, učitavanje, greška, mobitel |
| P-01 | Povjerenstvo (zaključan rad, rubrika) | M6 | DJELOMIČNO | U | prazno, učitavanje, greška, mobitel, bez pristupa, ocjene ostalih skrivene |
| N-15 | Etape, rubrika, izvješće, ocjena | M6 | DJELOMIČNO | U | prazno, učitavanje, greška, mobitel |
| S-15 | Panel Rad | M7 | NEMA | 6 | popunjeno, prazno, učitavanje, greška, mobitel |
| S-30 | Pregled prije predaje | M7 | DJELOMIČNO | 6 | prazno, učitavanje, greška, mobitel, bez mreže |
| S-31 | Izjava | M7 | DJELOMIČNO | 6 | prazno, učitavanje, greška, mobitel |
| S-32 | Potvrda predaje | M7 | DJELOMIČNO | 6 | prazno, učitavanje, greška, mobitel, potvrda čeka potpis |
| S-33 | Sažetak procesa | M7 | DJELOMIČNO | 6 | prazno, učitavanje, greška, mobitel |
| S-43 | Napomene i osporavanje | M7 | NEMA | 8 | popunjeno, prazno, učitavanje, greška, mobitel |
| N-05 | Brz put | M7 | DJELOMIČNO | 7 | prazno, učitavanje, greška, mobitel |
| N-10 | Sažetak i karta podrijetla | M7 | DJELOMIČNO | 7 | prazno, učitavanje, greška, mobitel |
| N-11 | Usporedba verzija | M7 | DJELOMIČNO | 7 | prazno, učitavanje, greška, mobitel |
| N-13 | Produljenje roka | M7 | NEMA | 7 | popunjeno, prazno, učitavanje, greška, mobitel, sukob s rokom |
| J-03 | Provjera potvrde (putovnica) | M7 | NEMA | 8 | popunjeno, prazno, učitavanje, greška, mobitel, ne podudara se |
| N-14 | Priprema za razgovor i obranu | M7 | NEMA | U | popunjeno, prazno, učitavanje, greška, mobitel |
| S-47 | Moj rad u brojkama | M7 | NEMA | 8 | popunjeno, prazno, učitavanje, greška, mobitel |
| S-19 | Uvoz teksta (pregled gubitaka) | M8 | DJELOMIČNO | 12 | popunjeno, prazno, učitavanje, greška, mobitel, djelomičan uvoz, nepodržan format |
| S-20 | Izvoz (A4 pregled) | M8 | DJELOMIČNO | 12 | popunjeno, prazno, učitavanje, greška, mobitel, izvoz .docx/PDF |
| N-18 | Izvoz predanog rada i paket za Merlin | M8 | NEMA | 12 | popunjeno, prazno, učitavanje, greška, mobitel |
| S-09 | PDF izvori u bilježnici (isticanje, citat) | M8 | NEMA | 12 | popunjeno, prazno, učitavanje, greška, mobitel, citat nije pronađen |
| S-16 | Panel Asistent (12 stanja) | M9 | NEMA | 13 | 12 stanja, bez mreže, proračun (S16-BUD), mobitel |
| S31-AI | Izjava o uporabi AI u predaji | M9 | NEMA | 14 | popunjeno, prazno, učitavanje, greška, mobitel |
| N-AI-ATT | Nastavnik: pregled AI-atribucije | M9 | NEMA | 14 | popunjeno, prazno, učitavanje, greška, mobitel |
| N-19 | AI pomoć nastavniku | M9 | NEMA | — | — |
| S-18 | Vlastita povijest rada | M10 | NEMA | U | popunjeno, prazno, učitavanje, greška, mobitel |
| S-42 | Dnevnik pristupa (vlastiti) | M10 | NEMA | 15 | popunjeno, prazno, učitavanje, greška, mobitel, opoziv |
| S-44 | Izvoz vlastitih podataka | M10 | NEMA | 15 | zahtjev, stanje posla, preuzimanje, istek, greška, mobitel |
| A-05 | Čuvanje i pravno zadržavanje | M10 | NEMA | 16 | popunjeno, prazno, učitavanje, greška, mobitel |
| A-06 | Revizijski trag pristupa | M10 | NEMA | 16 | popunjeno, prazno, učitavanje, greška, mobitel |
| A-08 | Izlaz iz usluge | M10 | NEMA | 16 | popunjeno, prazno, učitavanje, greška, mobitel, potvrda |
| S-46 | Paket zaštite studenta | M10 | NEMA | U | popunjeno, prazno, učitavanje, greška, mobitel |
| A-07 | Integracije i status AAI@EduHr | M11 | NEMA | 18 | popunjeno, prazno, učitavanje, greška, mobitel, AAI nedostupan |
| A-09 | Zdravlje sustava i kopije | M11 | NEMA | 18 | popunjeno, prazno, učitavanje, greška, mobitel |
| J-01 | Javna naslovnica | M11 | DJELOMIČNO | 17 | prazno, učitavanje, greška, svijetla tema, prijavljen/odjavljen |
| J-02 | Kako Ductura radi | M11 | DJELOMIČNO | 17 | prazno, učitavanje, greška, mobitel |
| J-05 | Statusna stranica i izjava o pristupačnosti | M11 | NEMA | 17 | popunjeno, prazno, učitavanje, greška, mobitel, incident |
| Z-09 | Postavke | M11 | DJELOMIČNO | 18 | popunjeno, prazno, učitavanje, greška, mobitel, tema, obavijesti |
| Z-10 | Prijavi problem | M11 | NEMA | 18 | popunjeno, prazno, učitavanje, greška, mobitel, poslano |
| Z-12 | Mobilni prikaz (sustavno) | M11 | DJELOMIČNO | 18 | uska širina svih ekrana, dodir ≥ 44 px |
| K-01 | Koordinator (zbrojevi po kolegiju) | bez faze | DJELOMIČNO | — | prazno, učitavanje, greška, mobitel |
| K-02 | Odobrenje istrage | bez faze | DJELOMIČNO | — | prazno, učitavanje, greška, mobitel |
| A-10 | Slučajevi i paket dokaza | bez faze | NEMA | — | popunjeno, prazno, učitavanje, greška, mobitel |
| J-04 | Stranice za fakultete i nabavu | bez faze | NEMA | — | popunjeno, prazno, učitavanje, greška, mobitel |

