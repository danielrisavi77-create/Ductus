# 07 Prijedlog rokova čuvanja (prilog zahtjevu FPZG-u i DPO-u)

> **Ovo je radni nacrt, nije pravni savjet i nije odobren rok.** Rokovi čuvanja nisu odlučeni: D-30 je PRIJEDLOG, a potvrdu daju FPZG i službenik za zaštitu podataka (DPO) (Owner queue Q-16, Q-3; D-264 Q09, Q11). Nijedan „prijedlog” u ovom prilogu ne smije se čitati kao odobren ni primijeniti u kodu.

Zadatak: DAN-297, M10.1-P02. Prilog ide uz jedan zahtjev FPZG-u (D-264 Q09, paket Q-3 do 13. 11. 2026.). Osnova su klase iz `06-klase-podataka.md` (30 klasa, 8 kategorija, `main` na `d791364e`); ovaj prilog ne mijenja njihov popis ni brojeve.

## 1. Kako čitati

- **Određeno:** rok koji je vlasnik već odlučio i zapisao (D-273 MQ08: sesije 30 dana, izvozni paket 24 sata, odbačeni privremeni objekti prije D-30). Ništa drugo nije određeno.
- **Prijedlog:** rok koji Ductus predlaže FPZG-u i DPO-u na potvrdu. Navedeni su samo prijedlozi koji već postoje u `docs/ARCHITECTURE.md` §3, D-272 MQ06 ili `06`; nijedan nije izmišljen za ovaj prilog.
- **Nepoznato:** za klasu nema ni odluke ni prijedloga. FPZG i DPO predlažu ili biraju; Ductus ne pogađa.
- **Gdje živi:** baza (`db`), S3 (spremnik evidencije), kopije (PITR, dnevni dump, replika, verzije spremnika, `06` klasa 29), preglednik (Dexie).
- Brisanje u kopijama traži vlastiti rok po vrsti kopije (D-12); PITR od 3 dana je tehnička postavka, ne rok.

## 2. Pitanja za FPZG i DPO

1. Potvrđuje li se rok za svaku klasu iz odjeljka 3 (D-30)?
2. Jesu li hashevi i potvrde (klasa 27) osobni podatak (odjeljak 5)?
3. Koliki je rok za prigovor na predaju, od kojeg ovisi klasa 27 (odjeljak 5)?
4. Koliki je rok čuvanja dokaza prvog administratora (odjeljak 4)?
5. Kojih rokova nema (stupac „Nepoznato”): tko ih predlaže?

## 3. Klase

| Klasa | Naziv | Određeno | Prijedlog | Nepoznato | Gdje živi |
| --- | --- | --- | --- | --- | --- |
| 1 | Identitet računa | | | rok; okidač je „zadnji ovisni zapis istekao” (D-272 MQ05) | db, kopije |
| 2 | Ime i prezime | | | rok; briše se samo uskom funkcijom (D-272 MQ04) | db, kopije |
| 3 | Sesije prijave i odjave | 30 dana nakon kraja (D-273 MQ08) | | raspored brisanja nije izgrađen (M10.0-S2) | db, kopije |
| 4 | Nastava i članstvo | | | rok | db, kopije |
| 5 | Uloge i dodijeljeni pristup | | | rok (dokaz prvog administratora: odjeljak 4) | db, kopije |
| 6 | Obavijesti u aplikaciji | | | rok | db, kopije |
| 7 | Potvrda obavijesti uz zadatak | | | rok | db, kopije |
| 8 | Evaluacija pilota | | do kraja evaluacije | je li to dovoljno za DPO | db (planirano) |
| 9 | Zadatak i verzije zadatka | | | rok | db, kopije |
| 10 | Pravila fakulteta i jezik rada | | | rok | db, kopije |
| 11 | Projekt i dokument | | | rok | db, kopije |
| 12 | Privatna povijest rada | | | rezervirana klasa; ne gradi se do D-55 i C-19 (D-274 MQ09) | nema |
| 13 | Revizije dokumenta | | do kraja akademske godine | potvrda | db, kopije |
| 14 | Kontrolne točke s punim tekstom | | | rok; `body` se briše uskom funkcijom | db, kopije |
| 15 | Stanje prikaza uživo | | | rok (briše se pri kraju rada ili povlačenju, D-12); rok za kopije zasebno nepoznat | db, kopije |
| 16 | Predani rad | | prema pravilniku fakulteta | koji pravilnik i koji rok | db, kopije |
| 17 | Izjava o pomoći AI-ja i ispisi razgovora | | | rok (Q-10) | db (planirano) |
| 18 | Komentari | | kao predaja (klasa 16) | `body` uskom funkcijom | db, kopije |
| 19 | Zahtjevi za doradu | | kao predaja (klasa 16) | | db, kopije |
| 20 | Izvozni paket | 24 sata, koliko i poveznica (D-173, D-273 MQ08) | | | S3 (planirano) |
| 21 | Odsječci i paketi evidencije | | kao predaja (klasa 16) | sadržaj u S3 briše adapter (D-272 MQ04) | db, S3, kopije |
| 22 | Vrijeme po promjeni | | | rok; D-143 traži kraći rok od ostale evidencije | db (planirano kao zasebna klasa) |
| 23 | Odbačeni privremeni objekti | briše se prije D-30 (D-273 MQ08) | | trajanje nije zapisano | S3 |
| 24 | Zapis AI pomoćnika | | | rok (Q-10) | db (planirano) |
| 25 | Zapis pristupa radu | | dulje od predaje | koliko dulje | db, kopije |
| 26 | Događaji promjena ovlasti | | | rok (odjeljak 4) | db, kopije |
| 27 | Hashevi i potvrde | | rok klase 16 uz rok za prigovor | rok za prigovor; je li osobni podatak (odjeljak 5) | db, kopije |
| 28 | Evidencija brisanja | | | rok | db (planirano, M10.0-S1) |
| 29 | Kopije baze i bucketa | | | rok po vrsti kopije (D-12) | kopije |
| 30 | Lokalni dnevnik na uređaju | | | rok trajanja prije pilota (D-118, D-122) | preglednik |

Zbroj: određeno 3 klase (3, 20, 23), prijedlog 8 klasa (8, 13, 16, 18, 19, 21, 25, 27), za preostalih 19 klasa rok je nepoznat (među njima rezervirana klasa 12). Nijedan rok nije odobren.

## 4. Dokaz prvog administratora (D-262 Q04, D-264 Q11)

Administratora ustanove imenuje samo operater, na pisani zahtjev fakulteta. Dokaz je referenca na taj zahtjev (broj iz urudžbenog zapisnika, ne ime) u stupcu `request_ref` tablice `audit.teacher_role_event` (klasa 26). Nova tablica ne nastaje.

| Stavka | Stanje |
| --- | --- |
| Što se čuva | Referenca na pisani zahtjev, uloga, vrijeme; ne ime administratora u referenci |
| Je li osobni podatak | Povezan je s osobom preko retka događaja; tretira se kao osobni podatak do odluke DPO-a |
| Rok | Nepoznato. Odluka D-264 Q11 traži da ga prijedlog obuhvati, ali nijedan rok nije zapisan |
| Veza s drugim rokovima | Samo pitanje: smije li dokaz živjeti dulje od uloge i od klase 5? FPZG i DPO odlučuju |
| Zadnji administrator | Opoziv samo operaterovim postupkom s tragom (D-262 Q04) |

## 5. Hash kao osobni podatak i klasa 27 (D-264 Q11, D-272 MQ06)

**Svrha klase 27 (obrazloženje).** Nakon što se sadržaj predanog rada obriše, potvrda i hash dokazuju da je rad predan u tom obliku i u to vrijeme. Provjera tada kaže „potvrda vrijedi, sadržaj nije dostupan”. Bez te klase student i fakultet ne bi mogli dokazati predaju nakon brisanja, što je jedina svrha klase.

- Do potvrde FPZG-a i DPO-a hash teksta tretira se kao osobni podatak (D-264 Q11), pa se čuva samo za tu svrhu i ne koristi za drugu.
- Dok se ne potvrdi da klasa nije izvršna za brisanje, hash se čuva (D-272 MQ06). To ne znači da je rok odobren.
- Prijedlog trajanja je razdoblje predanog rada (klasa 16) uz rok za prigovor. Rok za prigovor nije zapisan (nepoznato).
- Samo tretman kao osobni podatak vrijedi i za hash vezan uz obavijest (klasa 7, D-264 Q17) i hash `jti` odjave (klasa 3). Svrha i trajanje klase 27 se na njih ne prenose: klasa 7 slijedi svoj redak (rok nepoznat), a rok za `jti` zapis nije zasebno odlučen (nepoznato): 30 dana iz D-273 MQ08 određuje sesije, dok se istekli `jti` zapisi trenutno brišu tek pri sljedećem upisu, pa mogu ostati dulje. `jti` se ne čuva kao dokaz predaje.

## 6. Što ovaj prilog ne radi

- Ne odlučuje rok, ne gradi tablicu `data_class` ni poslove brisanja (M10.0-S1, M10.2 čekaju potvrdu).
- Ne dodaje tok podataka ni kod; ustanova rokove u sučelju ne uređuje prije B0.1 i potvrde (D-275 MQ13).
- Ne sadrži imena, kontakte ni stvarne podatke; mjesto za osobu je `[imenovati]`.
