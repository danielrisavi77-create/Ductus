# Ductura: dizajn v3 (vizualni sustav showcasea)

Datoteka: `dizajn-v3.html`. Samostalna je i otvara se izravno u pregledniku. Ekran i stanje biraju se u traci na dnu (samo za prototip).

Ovo je dizajnerska referenca, ne produkcijski kod. Svi podaci su izmišljeni.

## Izvor izgleda
Vlasnik je 21. 10. 2026. rekao: „želim da dizajn izgleda kao što sam ti uplodao … Tako želim da izgleda moja aplikacija i demo”. Izvor je `uploads/Ductura_showcase_v2.html` iz repoa `ductura-dizajn`.

Preuzeto je doslovno:
- CSS i tokeni showcasea: podloga `#091310`, površine `#0e1b17`/`#12211c`, naglasak `#8ee3be`, jantarna `#e9c58b`, plava `#a2c6e5`, radius 14, svijetla tema;
- skup ikona i logotip s tri vala;
- ljuska aplikacije: bočna navigacija, gornja traka, paneli, oznake stanja, tablice, editor u tri stupca.

## Ekrani
**Student:**
1. Pregled: „Nastavi gdje si stala”, poruka sebi, Moji radovi po skupinama, novo uz rad; varijanta za prvi ulazak.
2. Moji radovi.
3. Obavijesti: zvonce s izbornikom i stranica s postavkama po vrsti (aplikacija / e-pošta).
4. Upis kodom: odbijeno, previše pokušaja, upisana → zadaci.
5. Obavijest zadatka (S3): tekst prema ugovoru S3 / D-142, D-143, D-154.
6. Pisanje: struktura, list, komentari; stanja spremanja (na poslužitelju, na uređaju, bez mreže, druga kartica).
7. Predaja: provjera → potvrda; blokada s razlogom i kontaktom koordinatora (D-145, D-146), bez Izjave i PDF-a.

**Nastavnik:**
8. Pregled (dashboard).
9. Moji kolegiji s kodom za upis.
10. Novi kolegij i zadatak: čarobnjak u 4 koraka, s pregledom „Kako vidi student”.
11. Radovi zadatka: studenti po prezimenu, uz ime i prezime (vlasnikova odluka od 21. 10.).
12. Rad uživo: komentar uz odlomak i sažetak procesa.

**Dijalog:** Odjava (FE-D7).

## Što NIJE preuzeto iz showcasea (proturječi odlukama)
- Rečenice „ne tipkanje uživo” i „bez tipkanja uživo”: proturječe D-142, D-143 i D-154.
- Filter i poredak radova po stanju: D-80 traži popis samo po prezimenu. Ostala je samo pretraga.
- Oznaka „Interaktivni mock” zamijenjena je s „Demo”. Uklonjeni su i „Prezentacijski vodič” i „Prikaz ustanove” (faza B i C).

Tekst sučelja provjeren je skenerom zabranjenih izraza iz repoa i nema nalaza.

## Odluke vlasnika (21. 10. 2026.)
1. **Showcase zamjenjuje D-123 u izgledu:** boje, površine, radius, ljuska, oznake stanja i ikone. Treba nova D-linija i PR s tokenima (`app/globals.css`, `src/components/shell/tokens.test.ts`, README §8).
2. **Fontovi ostaju iz repoa:** Newsreader za naslove i tekst rada, Instrument Sans za sučelje (`app/fonts`). Georgia i Inter iz showcasea se ne uvode. Ova referenca to već slijedi.
3. **Za demo cijela nova ljuska s bočnom navigacijom**, ne samo tokeni. To zahvaća `WorkspaceShell.tsx` i `app/rad/page.tsx`, pa se izmjena najavljuje na #476 prije PR-a.

## Što ostaje za plan (orkestrator)
- Redoslijed: najprije PR s tokenima (svijetla i tamna tema), zatim ljuska (bočna navigacija, gornja traka), zatim ekrani jedan po jedan. Poredak ovisi o lancu koji je u tijeku (FE-D7, F-10, Z3).
- Zamrzavanje opsega 28. 10. vrijedi i dalje. Ono što do tada nije spojeno pada iz demoa.
- Editor zadržava pravila iz editor-v11 (8 stanja spremanja, prečaci, F-8). Mijenja se samo izgled.
