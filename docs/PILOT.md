# Pilot na FPZG-u: protokol i pokazatelji

Stanje: 9. 11. 2026., na `main` od spajanja PR-a za DAN-531 (M12.1a). Dokument opisuje kako se pilot provodi po fazama, što se mjeri i koja pravila vrijede u fazama B i C. Operativa (uloge, dnevni zapis, STOP, zamrznuto izdanje) je u `docs/OPERATIONS.md`, poglavlje „Pilot (M12)” (DAN-588, M12.1b). Protokol mjerenja razumijevanja je u `docs/UX-EVAL.md`. Ovdje se ti dokumenti ne prepisuju, nego se na njih upućuje.

Ovaj dokument ne postavlja pragove uspjeha. Pragove korisnosti i razumijevanja postavljaju FPZG i evaluator i upisuju ih u `docs/DECISIONS.md` prije faze A (Q-12 u Owner queueu, `docs/PROGRAM.md` O04). Gdje prag nije zapisan, piše **OTVORENO**.

Oznake su iste kao u `docs/OPERATIONS.md` i `docs/privacy/README.md`:

- `[PRAVILO]`: potvrđeno pravilo, izvor je naveden.
- `[ODLUKA]`: odluka vlasnika, FPZG-a, evaluatora ili DPO-a koja još nije donesena.
- `[DOKAZ]`: dokaz koji još ne postoji.
- `izgrađeno` ili `planirano`: postoji li izvor podatka na `main`.
- `[PRIJEDLOG, nije odluka]`: postupak koji predlaže ovaj dokument ili `docs/PROGRAM.md` („Pilot M12: prijedlozi odgovora”). Vrijedi tek kad ga odobri osoba navedena uz stavku.

Imena i kontakti osoba ne upisuju se dok se ne odluči o vidljivosti repoa (`STATE.md` Owner queue). Mjesta za uloge su u uglatim zagradama, kao u `docs/OPERATIONS.md`.

## 1. Okvir

- M12 je faza provedbe pilota, ne faza razvoja (D-266 t. 5, D-191). `[PRAVILO]`
- Pilot je samo na FPZG-u (D-15) i besplatan je (D-13). `[PRAVILO]`
- Faze (D-203 E3, `docs/PRODUCT.md` §12): **A** tehnička proba sa sintetičkim radovima od 22. 2. 2027., 4 puna tjedna, ne skraćuje se; **B** nastava oko 22. 3. 2027. ili kasnije, nakon izlaza A i suglasnosti FPZG-a; **C** evaluacija nakon 4. 6. 2027., točan datum potvrđuje FPZG. `[PRAVILO]`
- Studenti se prijavljuju isključivo putem AAI@EduHr (D-09). `[PRAVILO]`
- Nijedan tehnički pokazatelj sam ne dovodi do ocjene ni posljedice za studenta (`docs/PRODUCT.md` §12). `[PRAVILO]`
- Prije pilota sa stvarnim studentima potrebni su pravno mišljenje (D-55) i DPIA (D-143). `[PRAVILO]`

## 2. Protokol po fazama

| Faza | Razdoblje | Radovi | Sudionici | Ulaz | Izlaz |
| --- | --- | --- | --- | --- | --- |
| A | od 22. 2. 2027., 4 puna tjedna | samo sintetički | operater; sudionici kruga iz `docs/UX-EVAL.md` | §2.1 | §2.2 |
| B | oko 22. 3. 2027. ili kasnije, do 4. 6. 2027. | stvarni radovi iz odabranih zadataka | studenti i nastavnici ili mentori odabranih kolegija | §2.3 | kraj nastave i rokova zadataka u pilotu |
| C | nakon 4. 6. 2027. | nema novih predaja (O01) `[PRIJEDLOG, nije odluka]` | sudionici evaluacije | kraj faze B | završno izvješće (§6) |

### 2.1 Ulaz u fazu A

- Ugovor o obradi s FPZG-om potpisan. Do tada pristup operatera ima samo vlasnikov račun (D-266 t. 2, D-264 Q13). `[PRAVILO]`
- Pragovi za KPI-05 i KPI-06 upisani u `docs/DECISIONS.md` (GO redak „Nastavni”, D-266 t. 5, Q-12). Vrijednosti `[ODLUKA]`; obveza upisa prije A je `[PRAVILO]`.
- Izdanje zamrznuto i upisano u dnevni zapis (`docs/OPERATIONS.md`, „Zamrznuto izdanje”). `[PRIJEDLOG, nije odluka]`
- A počinje kad je M11.Z1 zelen i ugovor potpisan; cilj je 22. 2. 2027. (O02). `[PRIJEDLOG, nije odluka]`; odlučuju vlasnik i FPZG.

### 2.2 Izlaz iz faze A

Izlaz A predlaže ovaj dokument. `[PRIJEDLOG, nije odluka]`; odobravaju vlasnik i FPZG.

1. Prošla su 4 puna tjedna probe. Proba se ne skraćuje (D-203 E3). `[PRAVILO]`
2. Na zamrznutom izdanju KPI-01 je 100 %, a KPI-02, KPI-03 i KPI-04 su 0, svi na sintetičkim radovima iz faze A.
3. Krug iz `docs/UX-EVAL.md` proveden je na buildu koji se pilotira, prije odluke o prelasku u B (UX-EVAL §2). KPI-06 i KPI-07 izvještavaju se iz tog kruga, a KPI-06 se uspoređuje s pragom ako je upisan.
4. Nijedan STOP nije otvoren (`docs/OPERATIONS.md`, „STOP”).
5. Stanje GO uvjeta iz `docs/PROGRAM.md` zapisano je uz prijedlog izlaza, a otvoreni uvjeti navedeni su s nositeljem. Obvezna provjera da su svi zeleni je na ulazu u B (§2.3), jer `docs/PROGRAM.md` GO uvjete propisuje za stvarne studente.

Okidač STOP-a u fazi A znači da izlaz A nije postignut. Proba se nastavlja s novim izdanjem (`docs/OPERATIONS.md`, „STOP”). Ako izlaz A nije gotov do 19. 4. 2027., vlasnik i FPZG odlučuju o fazi B u zimskom semestru 2027./28. (O02). `[PRIJEDLOG, nije odluka]`

### 2.3 Ulaz u fazu B

- Izlaz A postignut i FPZG dao suglasnost (D-203 E3). `[PRAVILO]`
- Svi GO uvjeti za stvarne studente zeleni, uključujući DPIA, ugovor o obradi, obavijest o privatnosti, koordinatora i odluku o obveznosti (`docs/PROGRAM.md`). Jedan crveni uvjet znači da val ne kreće. `[PRAVILO]`
- Popis kolegija i zadataka dao je FPZG (O01). `[ODLUKA]`
- Uloge za zaustavljanje pilota imenovane (Q-13, `docs/OPERATIONS.md` „Uloge”). `[ODLUKA]`

## 3. Pravila za pokazatelje

Vrijede za KPI-01 do KPI-10 u svim fazama.

1. **Samo zbirno.** Pokazatelj se izvještava za fazu kao cjelinu. Nikad po studentu, bez usporedbe studenata i bez rangiranja. Izvedeno iz `docs/PRODUCT.md` §12 i „Zabranjeno u sažetku” (§7), koji to propisuju za proizvod; za izvješće pilota `[PRIJEDLOG, nije odluka]`.
2. **Bez posljedice.** Nijedan pokazatelj ne ulazi u ocjenu i ne pokreće postupak prema studentu (`docs/PRODUCT.md` §12). `[PRAVILO]`
3. **Bez podjele teksta po podrijetlu.** Nijedan pokazatelj ne dijeli tekst rada po podrijetlu uz zajednički nazivnik. Za prikaze u proizvodu to je `[PRAVILO]` (`docs/PRODUCT.md` „Zabranjeno u sažetku”, C-6); primjena na izvješće pilota je `[PRIJEDLOG, nije odluka]`. Zato pilot ne mjeri udio AI pomoći, lijepljenja ni diktiranja u radovima.
4. **Broj i nazivnik.** Svaki rezultat navodi brojnik i nazivnik. Postotak se smije dodati samo uz njih.
5. **Prag samo iz izvora.** Dok prag nije upisan, rezultat se izvještava brojem i nazivnikom, bez ocjene „prošlo” ili „nije prošlo”. Za korisnost i razumijevanje to je `[PRAVILO]` (`docs/UX-EVAL.md` §2); za ostale pokazatelje bez praga `[PRIJEDLOG, nije odluka]`.
6. **Neprovjereno odvojeno.** Što nije provjereno ili nije dostupno u buildu ne zbraja se s uspjehom i navodi se zasebno. Za KPI-06 i KPI-07 to je `[PRAVILO]` (`docs/UX-EVAL.md` §6); za ostale pokazatelje `[PRIJEDLOG, nije odluka]`.
7. **Faze se ne zbrajaju.** Sintetički radovi iz faze A i stvarni radovi iz faze B izvještavaju se odvojeno.
8. **Evaluacija odvojeno od evidencije.** Ankete i razgovori (KPI-05, KPI-06, KPI-07 u fazi C) pohranjuju se odvojeno od evidencije pisanja i ne povezuju se s njom (C-22). `[PRAVILO]`
9. **Izdanje.** KPI-01 do KPI-04 vežu se uz identifikator izdanja iz dnevnog zapisa (`docs/OPERATIONS.md`, „Zamrznuto izdanje”).
10. **Mala skupina.** Najmanja veličina skupine ispod koje se rezultat ne objavljuje u raščlambi (npr. po kolegiju) nije određena. `[ODLUKA]`; odlučuju FPZG i DPO. Do odluke se izvještava samo za fazu kao cjelinu.

Pravila 4, 7 i 9 i dijelovi pravila 1, 3, 5 i 6 označeni kao prijedlog su `[PRIJEDLOG, nije odluka]`; odobravaju vlasnik i FPZG.

## 4. Pokazatelji KPI-01 do KPI-10

Za svaki pokazatelj: što se broji (brojnik), nazivnik, faze, izvor podatka i prag. Izvori označeni `planirano` ili `[DOKAZ]` još ne postoje na `main`; dok ne postoje, pokazatelj je neprovjeren.

### KPI-01 Rekonstrukcija predanih radova

- **Brojnik:** predani radovi čija se rekonstrukcija iz evidencije podudara s predanom verzijom.
- **Nazivnik:** svi predani radovi u fazi, na danom izdanju.
- **Faze:** A (sintetički), B; ponovno na svakom novom izdanju (`docs/OPERATIONS.md`, „Zamrznuto izdanje”, korak 4).
- **Izvor:** provjera rekonstrukcije po izdanju. `[DOKAZ]`
- **Prag:** 100 %; svako odstupanje blokira izdanje (`docs/PRODUCT.md` §12). `[PRAVILO]`

### KPI-02 Izgubljen rad

- **Brojnik:** slučajevi u kojima je dio rada koji je student napisao izgubljen i ne može se vratiti ni s uređaja ni iz evidencije.
- **Nazivnik:** radovi koji su u fazi barem jednom otvoreni za pisanje.
- **Faze:** A, B.
- **Izvor:** dnevni zapis, polje „Izgubljen rad”. `[DOKAZ]`
- **Prag:** 0 slučajeva (`docs/PRODUCT.md` §12). `[PRAVILO]` Gubitak rada je okidač STOP-a (`docs/PROGRAM.md`). `[PRAVILO]`

### KPI-03 Neovlašten pristup

- **Brojnik:** radovi kojima je barem jednom pristupila osoba koja za to nije imala ovlast.
- **Nazivnik:** radovi u fazi.
- **Faze:** A, B.
- **Izvor:** dnevni zapis, polje „Neovlašten pristup”; zapis incidenta, u javnom repou samo ID. `[DOKAZ]`
- **Prag:** 0 slučajeva (`docs/PRODUCT.md` §12). `[PRAVILO]` Kritičan neovlašten pristup je okidač STOP-a (`docs/PROGRAM.md`). `[PRAVILO]`

### KPI-04 Lažan status

- **Brojnik:** slučajevi u kojima je sučelje pokazalo da je rad pohranjen, a poslužitelj ga nije potvrdio.
- **Nazivnik:** radovi koji su u fazi barem jednom otvoreni za pisanje.
- **Faze:** A, B.
- **Izvor:** dnevni zapis, polje „Lažan status”. `[DOKAZ]`
- **Prag:** `docs/PRODUCT.md` §12 nema broj za ovu mjeru. Svaki slučaj je okidač STOP-a (`docs/PROGRAM.md`). `[PRAVILO]`

### KPI-05 Korisnost za nastavnike i mentore

- **Što se mjeri:** vrijeme nastavnika ili mentora potrebno za razumijevanje nastanka rada s Ductusom, u odnosu na sadašnji postupak (`docs/PRODUCT.md` §12). Izvještava se medijan za oba postupka.
- **Nazivnik:** nastavnici i mentori koji su dali vrijeme za oba postupka.
- **Faze:** C (procjena se odnosi na rad u fazi B).
- **Izvor:** evaluacija u fazi C (O06). `planirano`
- **Metoda mjerenja** (samoprocjena u anketi ili mjerenje u razgovoru): `[ODLUKA]`; odlučuju FPZG i evaluator.
- **Prag:** **OTVORENO** (Q-12, O04). Definira se s FPZG-om prije pilota (GO uvjet).

### KPI-06 Razumijevanje: studenti

- **Brojnik:** studenti koji su u prvom odgovoru točno rekli tko što vidi (studentska pitanja 1 i 8, `docs/UX-EVAL.md` §4).
- **Nazivnik:** studenti koji su stvarno vidjeli scenarij i odgovorili na oba pitanja.
- **Faze:** krug na pilotnom buildu prije odluke o prelasku u B (UX-EVAL §2); u fazi C prema §6. `[PRIJEDLOG, nije odluka]` za fazu C.
- **Izvor:** zapis kruga po `docs/UX-EVAL.md` §6, sudionici pod šiframa. `planirano`
- **Prag:** **OTVORENO** (Q-12, O04). Dok prag nije upisan, GO redak „Razumijevanje” ostaje otvoren (UX-EVAL §7).

### KPI-07 Razumijevanje: nastavnici i mentori

- **Brojnik:** nastavnici i mentori koji su u prvom odgovoru točno razlikovali što prikaz pokazuje, a što ne (pitanja nastavniku 1 i 8, `docs/UX-EVAL.md` §4).
- **Nazivnik:** nastavnici i mentori koji su stvarno vidjeli scenarij i odgovorili na oba pitanja.
- **Faze:** kao KPI-06.
- **Izvor:** kao KPI-06. `planirano`
- **Prag:** `docs/PRODUCT.md` §12 ga ne traži; UX-EVAL §6 traži da se objavi razumijevanje obiju skupina. Izvještava se bez praga dok ga FPZG i evaluator ne odrede. `[ODLUKA]`

### KPI-08 Pravednost

- **Brojnik:** slučajevi u kojima je legitiman način rada (lijepljenje vlastitog teksta, diktiranje, rad bez veze) izazvao neopravdanu sumnju (`docs/PRODUCT.md` §12).
- **Nazivnik:** predani radovi u fazi B.
- **Faze:** B; analiza se zaključuje u C.
- **Izvor:** dnevni zapis, polje „Pravednost”; slučaj prijavljuje nastavnik, student ili koordinator. `[DOKAZ]`
- **Prag:** svaki slučaj se analizira (`docs/PRODUCT.md` §12). `[PRAVILO]` Ishod analize nije posljedica za studenta (`docs/PRODUCT.md` §12). `[PRAVILO]` U izvješću analiza ne navodi studenta. `[PRIJEDLOG, nije odluka]`

### KPI-09 Zamjenski postupak predaje

- **Brojnik:** predaje zamjenskim postupkom, odvojeno po razlogu: (a) Ductus nije radio, (b) student ne sudjeluje ili se povukao (D-04, D-12).
- **Nazivnik:** sve predaje zadataka uključenih u pilot.
- **Faze:** B.
- **Izvor:** FPZG, samo brojevi bez imena. `[ODLUKA]` kako FPZG broji predaje.
- **Prag:** nema. Pokazuje koliko je pilot ovisio o zamjenskom postupku; razlog (a) vezuje se uz zapis incidenta.

### KPI-10 Prijave problema

- **Brojnik:** prijave problema po kategoriji, bez sadržaja rada (D-69).
- **Nazivnik:** sudionici koji su se u fazi barem jednom prijavili u Ductus.
- **Faze:** A, B.
- **Izvor:** gumb „Prijavi problem” (D-69), dnevni zapis, polje „Prijave problema”. `planirano`
- **Prag:** nema.

Pragovi za KPI-07 do KPI-10 i način brojanja iz KPI-02, KPI-03, KPI-04 i KPI-09 su `[PRIJEDLOG, nije odluka]`; odobravaju vlasnik i FPZG.

## 5. Pravila faze B (nastava)

1. **Zadaci.** U B ulaze samo pisani zadaci zadani nakon izlaza A, s rokom prije 4. 6. 2027.; bez završnih i diplomskih radova (O01, D-265 Q21). Popis daje FPZG. `[PRIJEDLOG, nije odluka]`; odlučuje FPZG.
2. **AI nije uvjet.** Zadatak u pilotu ne smije zahtijevati AI, a student nikad ne mora platiti da bi izvršio obvezu (`docs/PRODUCT.md` §5, pravilo 15). `[PRAVILO]`
3. **Obveznost.** FPZG odlučuje je li korištenje obvezno ili dobrovoljno (D-04). Ako je dobrovoljno, studenti koji ne sudjeluju imaju ravnopravnu alternativu (`docs/PRODUCT.md` §12). `[PRAVILO]` Preporuka je dobrovoljno sudjelovanje (O03). `[PRIJEDLOG, nije odluka]`
4. **Povlačenje.** Student se može povući; već predani radovi ostaju po pravilima fakulteta, a sve ostalo se briše (D-12). `[PRAVILO]` Povlačenje nema posljedica za studenta (O03). `[PRIJEDLOG, nije odluka]`
5. **Rokovi i podrška.** Rokovi su radnim danom u podne; podrška ide po modelu iz D-69: netehnička pitanja koordinator FPZG-a, tehnički kvarovi vlasnik, AAI račun AAI administrator FPZG-a. `[PRAVILO]` Uloge su u `docs/OPERATIONS.md`, „Uloge”.
6. **Zamjenski postupak.** FPZG unaprijed propisuje zamjenski postupak ako Ductus ne radi u zadnja 24 sata prije roka (D-69). `[PRAVILO]` Sadržaj postupka propisuje FPZG. `[ODLUKA]`
7. **Obavijest.** Obavijest o privatnosti je objavljena i ugrađena u obavijest o zadatku (`docs/PROGRAM.md`, GO). `[PRAVILO]`
8. **Zamrznuto izdanje i dnevni zapis.** Vode se po `docs/OPERATIONS.md`. U zadnja 24 sata prije roka ne uvodi se promjena izdanja, osim ispravka okidača STOP-a. `[PRIJEDLOG, nije odluka]`
9. **STOP.** Okidači su u `docs/PROGRAM.md` (rečenica ispod tablice GO uvjeta) `[PRAVILO]`, a postupak u `docs/OPERATIONS.md`, „STOP”.
10. **Podaci izvan repoa.** U javni repo ne ide nijedan stvarni osobni ni studentski podatak, a od sigurnosnog nalaza samo ID i status (`CLAUDE.md`). `[PRAVILO]` Gdje se drže zbirni rezultati KPI-ja iz faze B dok je repo javan: `[ODLUKA]` vlasnika.

## 6. Pravila faze C (evaluacija)

1. **Početak.** Nakon 4. 6. 2027.; točan datum potvrđuje FPZG (`docs/PRODUCT.md` §12). `[PRAVILO]`
2. **Odvojenost.** Ankete i razgovori pohranjuju se odvojeno od evidencije pisanja i ne povezuju se s njom (C-22). `[PRAVILO]` Preporuka je anonimna anketa u alatu FPZG-a, gdje je FPZG voditelj obrade; vlastita pohrana gradi se samo ako FPZG to odbije (O06). `[PRIJEDLOG, nije odluka]`; odlučuju FPZG i DPO.
3. **Dobrovoljnost.** Sudjelovanje u evaluaciji je dobrovoljno i odgovor ne utječe na ocjenu. `[PRIJEDLOG, nije odluka]`; odlučuje FPZG.
4. **Bez novih predaja.** Rokovi zadataka iz faze B su prije 4. 6. 2027. (O01), pa se u fazi C ne predaju novi radovi u pilotu. `[PRIJEDLOG, nije odluka]`
5. **Završno izvješće** sadrži `[PRIJEDLOG, nije odluka]`; odobrava vlasnik:
   - KPI-01 do KPI-10 s brojnikom i nazivnikom, odvojeno za fazu A i fazu B (§3);
   - usporedbu s pragom samo gdje je prag upisan u `docs/DECISIONS.md`; ostalo bez ocjene „prošlo” ili „nije prošlo”;
   - neprovjerene dijelove zasebno;
   - svaki STOP i incident samo s ID-om i statusom;
   - zaključak analize svakog slučaja iz KPI-08, bez podataka o studentu;
   - promjene izdanja tijekom faza A i B s razlozima.
6. **Nakon pilota.** O nastavku odlučuju FPZG i vlasnik nakon faze C, na temelju završnog izvješća. Nema automatskog M13 (O07). `[PRIJEDLOG, nije odluka]`
7. **Čuvanje i brisanje.** Rokovi čuvanja nakon pilota nisu odlučeni (D-30 je PRIJEDLOG, Q-16). Kod čuvanja se ne gradi na D-30. `[ODLUKA]`

## 7. Otvoreno

| Pitanje | Tko odlučuje | Izvor |
| --- | --- | --- |
| Pragovi za KPI-05 i KPI-06 | FPZG i evaluator | Q-12, O04, `docs/PRODUCT.md` §12 |
| Metoda mjerenja KPI-05 | FPZG i evaluator | §4 |
| Prag za KPI-07 | FPZG i evaluator | §4 |
| Najmanja skupina za raščlambu rezultata | FPZG i DPO | §3 t. 10 |
| Izlaz A (§2.2) i način brojanja (§4) | vlasnik i FPZG | ovaj dokument |
| Zadaci, obveznost, zamjenski postupak | FPZG | O01, O03, D-04, D-69 |
| Uloge za zaustavljanje i prijavu povrede | vlasnik, FPZG | Q-13, O05 |
| Alat i pohrana evaluacije | FPZG i DPO | O06, C-22 |
| Mjesto zbirnih rezultata dok je repo javan | vlasnik | §5 t. 10 |
| Čuvanje nakon pilota | FPZG, vlasnik | Q-16, D-30 |
