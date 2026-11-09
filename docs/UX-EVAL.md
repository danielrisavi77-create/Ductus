# Ductus: UX evaluacija povjerenja

Verzija 2.0 · 9. 11. 2026. (zamjenjuje verziju 1.0 od 4. 10. 2026.; preuzima nacrt 1.1 iz zatvorenog PR-a #551)

Kod Ductusa pogrešno razumijevanje sučelja može biti ozbiljan bug čak i kad je kod tehnički točan. Ovaj dokument je protokol evaluacije. Ne sadrži rezultate provedenog istraživanja ni pragove uspjeha.

## 1. Cilj i prihvaćene odluke

Prije pilota sa stvarnim studentima provjeriti razumiju li student i nastavnik:

- što je Ductus stvarno opažao, a što nije;
- tko vidi rad, kada i u kojem obliku;
- da cjelovitost zapisa nije dokaz autorstva;
- da lijepljenje bez poznatog izvora nije dokaz AI-ja;
- da praznina u zapisu ne otkriva uzrok ni namjeru;
- razliku između rada spremljenog na uređaju, potvrđene pohrane na poslužitelju i osvježavanja nastavničkog prikaza.

Mjerodavne su prihvaćene odluke u [DECISIONS.md](DECISIONS.md) i granice iz [PRODUCT.md §5](PRODUCT.md). Ovaj dokument ih ne mijenja i ne tumači šire od njihova teksta.

**Prikaz uživo i reprodukcija:**

- **D-142** zamjenjuje D-06 i D-39. Nastavnik vidi promjene rada dok nastaje. Student je o tome obaviješten prije pisanja (obavijest S3) i vidi isti prikaz svojeg rada (pravilo 5). Prikaz ne obuhvaća računalo, kameru, zaslon ni rad izvan Ducture. Nikad ne daje ocjenu, rangiranje ni oznaku sumnje.
- **D-143** određuje reprodukciju promjena dokumenta znak po znak, uključujući obrisani tekst. Vrijeme služi reprodukciji, nikad mjeri osobe, procjeni autorstva ni zaključku o AI-ju. Prije pilota sa stvarnim studentima trebaju pravno mišljenje (D-55) i DPIA. Do tada se u evaluaciji koriste samo unaprijed pripremljeni izmišljeni zapisi.
- **D-144** uključuje i kratke zadatke. Sudioniku se ne smije obećati da ih nastavnik vidi tek nakon predaje.
- **D-63** dopušta skok po sesijama u reprodukciji. Reprodukcija ne računa, ne preskače i ne ističe stanke. Studentov napredak (D-63 (b)) vidi samo student.
- **D-154** objedinjuje nastavnika i mentora u jednu ulogu. Pristup i dalje proizlazi iz odnosa sa zadatkom ili mentorskim radom (C-23).

**Ostali prikazi koje evaluacija dotiče:**

- **Brz put (D-80 t. 2, za demo izmijenjen s D-170 O4):** u demou ima dva retka (zadnja promjena, lijepljenja bez izvora) i stanje zapisa. Ne sortira se po brojevima.
- **Usporedba poslanih verzija (D-202, pravilo 7):** pokazuje samo razliku između dviju poslanih verzija rada (poslanih na pregled ili predanih). Međustanja i tekst napisan i obrisan između njih vide se samo u prikazu uživo i reprodukciji, nikad u usporedbi. Student vidi istu usporedbu svog rada. Pitanja koja D-202 ostavlja otvorenima za vlasnika (profili, opseg zabrane ocjenjivanja) ovaj dokument ne razrješava.
- **„Napisano u Ducturi” (D-127):** oznaka mjesta unosa, ne osobe, uz stalno objašnjenje „Ductus ne zna tko je tipkao”. Student vidi isti prikaz. Nema zbroja ni udjela.
- **Dnevnik pristupa (pravilo 17, ekran S-42):** student vidi tko je i kada otvorio njegov rad. Mentorovi radni zapisi nisu dio dnevnika (D-130). Prikaz prisutnosti i dnevnika na S-17 još traži odluku (issue #1430). Evaluacija ne smije sudioniku obećati prikaz koji nije odlučen.
- **Vlastita povijest rada (D-131, ekran S-18):** uvjetna odluka, čeka D-55. Ne prikazuje se kao izgrađena funkcija.

Jednakost se odnosi na zajednički prikaz rada, uključujući prikaz uživo i reprodukciju. Prema **D-130 i pravilu 5**, mentorovi radni zapisi nisu prikaz rada: student ih ne vidi u aplikaciji, ali ih može zatražiti pravom pristupa. Navedeni su u obavijesti i ne ulaze u sažetak, izvoz ni predaju. Ocjena i obrazloženje vide se tek nakon objave. Uvjetni dijelovi D-130 i D-135 ne prikazuju se kao već izgrađene funkcije.

Evaluacija više ne bira između D-06 i D-39. Provjerava razumijevanje prihvaćenog ponašanja i otvara nalaze ako prikaz navodi na pogrešan zaključak.

## 2. Mjesto u pilotu i GO uvjet

[PRODUCT.md §12](PRODUCT.md) ima mjerilo **Razumijevanje: „Student točno odgovara tko što vidi”**, s pragom „Definirati prije pilota (GO uvjet)”. Ovaj protokol daje postupak i zapis za to mjerilo. Prag ne postavlja.

- Pragove razumijevanja i korisnosti postavljaju FPZG i evaluator i upisuju ih u [DECISIONS.md](DECISIONS.md) prije etape A ([PROGRAM.md](PROGRAM.md) O04, PRIJEDLOG). Dok prag nije upisan, rezultat se izvještava brojem sudionika i nazivnikom, bez ocjene „prošlo” ili „nije prošlo”.
- Kanal ankete i pohrane odgovora iz evaluacije u pilotu ([PROGRAM.md](PROGRAM.md) O06) nije odlučen. Ovaj dokument ga ne pretpostavlja. Vrijedi samo C-22: odgovori se čuvaju odvojeno od evidencije pisanja.
- Etape pilota prema §12: **A** tehnička proba sa sintetičkim radovima, **B** nastava, **C** evaluacija. Krug ovog protokola provodi se prije odluke o prelasku u B, na buildu koji se pilotira. Raniji krug na demo buildu dopušten je i koristan, ali ne zamjenjuje krug na pilotnom buildu.
- Evaluacija u etapi C je zasebna. Ovaj dokument ne određuje njezin sadržaj.

## 3. Sudionici i priprema

Najmanje **5 studenata i 5 nastavnika ili mentora koji nisu gradili proizvod**. Agentov prolaz, pregled koda ni testovi nisu zamjena za te sudionike.

Za svaki krug zabilježiti datum, puni commit SHA ili build, jezik sučelja, preglednik, verziju obavijesti i postavke izmišljenog zadatka. Ista izmišljena povijest koristi se u oba prikaza i u obje skupine.

Prije kruga za svaki ekran iz tablice u §4 provjeriti u testiranom buildu i upisati je li riječ o:

- funkciji koja radi u testiranom buildu;
- posebno označenom prototipu;
- funkciji koja još nije dostupna.

Stanje iz [design/EKRANI.md](design/EKRANI.md) je polazište, a ne dokaz: upisuje se ono što build stvarno prikazuje. Nedostupna funkcija ostaje neprovjerena. Razumijevanje prototipa ne dokazuje ispravnost stvarnog toka; nalaz se ponovno provjerava kad funkcija postoji u buildu.

Sudionicima dodijeliti šifre S01 do S05 i N01 do N05 (daljnjim sudionicima sljedeći broj). U zapis ne unositi imena, AAI identifikatore ni stvarne studentske radove. Upute, radovi i prikazi koriste samo izmišljene podatke (D-143).

Odgovori, ankete i razgovori iz evaluacije pohranjuju se odvojeno od evidencije pisanja i ne povezuju se s njom ([PRODUCT.md §12](PRODUCT.md), C-22). Šifra sudionika nije ključ za povezivanje s njegovim radom ili evidencijom.

Moderator najprije postavlja otvoreno pitanje i bilježi odgovor vlastitim riječima sudionika. Tek nakon toga objašnjava prikaz. Odgovor nakon objašnjenja bilježi se odvojeno od prvog razumijevanja.

## 4. Scenariji

| Scenarij | Ekrani | Što pokazati i pitati | Što odgovor treba razlikovati |
| --- | --- | --- | --- |
| Obavijest i pristup | S-05, S-17 | Obavijest prije pisanja i prikaz istog rada za obje uloge. „Tko ovo može vidjeti i kada?” | Nastavnik ili mentor povezan s radom vidi promjene tijekom pisanja; student vidi isti prikaz. To nije pristup svim radovima ustanove. |
| Dnevnik pristupa | S-42, S-17 | Ako postoji u buildu: dnevnik otvaranja izmišljenog rada. „Kako znaš tko je otvorio tvoj rad?” | Dnevnik pokazuje tko je i kada otvorio rad. Ne pokazuje mentorove radne zapise. Prisutnost uživo nije odlučena (#1430) i ne smije se obećati. |
| Radni zapisi mentora | S-05 | Dio obavijesti o radnim zapisima ili označen prototip. „Jesu li mentorove privatne bilješke dio ovog zajedničkog prikaza? Kako možeš zatražiti pristup?” | Radni zapisi su iznimka prema D-130. Pravo pristupa nije isto što i prikaz u aplikaciji. Ocjena i obrazloženje vide se nakon objave, uz uvjete D-135. |
| Prikaz uživo i kratki zadatak | N-06, S-17 | Izmišljeni dugi i kratki zadatak s istom promjenom dokumenta. „Što se ovdje osvježava? Što se ne vidi?” | Promjene u Ducturi, i za kratki zadatak; ništa s drugog uređaja, iz drugih aplikacija, s kamere ni zaslona. |
| Reprodukcija | N-09, S-34 | Reprodukcija izmišljenog zapisa s unosom, lijepljenjem i brisanjem, ili jasno označen prototip. „Što iz ovoga možete zaključiti?” | Reprodukcija pokazuje zabilježene promjene i obrisani tekst. Skok po sesijama nije oznaka stanke (D-63). Ne daje mjeru brzine, sposobnosti, autorstva ni korištenja vanjskog AI-ja. |
| Izvor lijepljenja | N-10, S-33 | Dva opažački jednaka lijepljenja: scenarij vlastitih bilježaka i scenarij teksta iz vanjskog AI alata. Pozadinsku priču ne otkrivati prije odgovora. „Što znači izvor nije opažen?” | Prikaz ne može razlikovati te izvore kad izvor nije opažen. Broj i veličina lijepljenja nisu zaključak o AI-ju. |
| Oznaka mjesta unosa | N-10 | Ako je u buildu: oznaka „Napisano u Ducturi” uz objašnjenje. „Što ova oznaka tvrdi?” | Oznaka govori gdje je tekst unesen, ne tko ga je unio (D-127). |
| Cjelovitost i praznina | N-10, S-33 | Jedan cjelovit zapis i jedan zapis s prazninom. „Što možete tvrditi o radu ili studentu?” | Cjelovitost se odnosi na zapis i ne dokazuje autorstvo. Praznina ne dokazuje namjerni prekid ni namjeru. |
| Spremanje i osvježavanje | S-17, N-06 | Promjena spremljena na uređaju koja još čeka poslužitelj, potvrđena pohrana i prikaz koji se još osvježava. „Gdje je ova promjena sada spremljena? Što nastavnik sada vidi?” | Spremljeno na uređaju, potvrda poslužitelja i svježina nastavničkog prikaza zasebna su stanja. Nedostupan stvarni tok ostaje neprovjeren. |
| Usporedba verzija | N-11 | Dvije poslane verzije izmišljenog rada, između kojih je dio teksta napisan pa obrisan. „Što ova usporedba pokazuje, a što ne?” | Usporedba pokazuje samo razliku između dviju poslanih verzija. Tekst napisan i obrisan između njih nije u usporedbi; vidi se samo uživo i u reprodukciji (pravilo 7, D-202). Student vidi istu usporedbu. |
| Brz put nastavnika | N-05 | Tekst rada i neutralni sažetak (D-80, u demou D-170 O4); više izmišljenih radova s različitim brojem događaja. „Što biste otvorili prije razgovora i zašto?” | Sadržaj i kontekst razgovora, bez procjene sumnje, autorstva ili rangiranja studenata po broju događaja. |
| Studentove brojke | S-47 | Ako postoji u buildu: studentov napredak (D-63 (b)). „Tko još vidi ove brojke?” | Vidi ih samo student. Ne ulaze u sažetak, izvoz, predaju ni nastavnički prikaz. |

Ekran označen u buildu kao nedostupan preskače se. U zapisu dobiva oznaku „nedostupno” i ne broji se kao uspjeh ni neuspjeh.

### Pitanja studentu

1. Što nastavnik može vidjeti tijekom pisanja i nakon njega?
2. Može li Ductus zaključiti jesi li koristio ili koristila AI na drugom uređaju?
3. Što znači „lijepljenje, izvor nije opažen”?
4. Što znači praznina u zapisu?
5. Kad je rad stvarno spremljen na poslužitelju i kako to znaš?
6. Razlikuje li se vidljivost kod kratkog zadatka?
7. Ako postoji reprodukcija, vidiš li isti prikaz svojeg rada kao nastavnik?
8. Kako možeš saznati tko je i kada otvorio tvoj rad?

Pitanje 1 i pitanje 8 izravno odgovaraju na mjerilo „Student točno odgovara tko što vidi” (§2).

### Pitanja nastavniku ili mentoru

1. Što možete tvrditi na temelju ovog prikaza, a što ne možete?
2. Što znači „3 lijepljenja bez poznatog izvora”?
3. Biste li na temelju toga sami pokrenuli postupak protiv studenta? Zašto?
4. Što znači „zapis je cjelovit”, a što praznina?
5. Koju biste informaciju otvorili prije razgovora sa studentom?
6. Kako biste odabrali rad koji ćete sljedeći otvoriti? Zašto?
7. Ako postoji reprodukcija, što vam pokazuje, a što ne može dokazati?
8. Što pokazuje usporedba dviju poslanih verzija, a što ne pokazuje?

## 5. UX bug kriterij

UX bug postoji ako korisnik iz prikaza redovito zaključuje nešto što Ductus ne zna. Svaki opaženi nesporazum treba zabilježiti. Ponavljanje se prikazuje brojem sudionika i nazivnikom u svakoj skupini. Prag prihvatljivosti ovaj dokument ne izmišlja (§2).

Posebno bilježiti ove pogrešne zaključke:

- „lijepljenje bez izvora znači AI”;
- „cjelovit zapis znači da je student autor”;
- „praznina znači da je student nešto prikrivao”;
- „broj događaja je procjena studenta”;
- „prikaz uživo znači da nastavnik vidi cijelo računalo ili druge aplikacije”;
- „kratki zadatak nastavnik ne vidi do predaje”;
- „reprodukcija dokazuje autorstvo ili mjeri osobu”;
- „skok po sesijama označava sumnjivu stanku”;
- „spremljeno na uređaju znači potvrđeno na poslužitelju”;
- „Napisano u Ducturi znači da je tekst napisao student”;
- „usporedba verzija pokazuje sve što je napisano i obrisano između dviju verzija”;
- „nastavnik u zajedničkom prikazu rada, uživo ili u reprodukciji vidi više od mene”. To ne obuhvaća mentorove radne zapise ni ocjenu i obrazloženje prije objave, koji su iznimke iz pravila 5;
- „nastavnik vidi moje brojke napretka”.

Ti navodi su opis pogrešnog zaključka sudionika, a ne tekst sučelja. U sučelju vrijedi Rječnik iz [PRODUCT.md §5](PRODUCT.md).

Stvarni prikaz uživo prema D-142 sam po sebi nije pogrešno razumijevanje. Odvojeno zabilježiti osjećaj nadzora, korisnost i potrebu za pedagoškom intervencijom. Nelagodu sudionika ne prepisivati kao netočnost njegova odgovora.

Takav nalaz ide u Product/UX issue prije pilota, čak i ako nema tehničke greške. Ako brz put potiče rangiranje po broju događaja, prikaz se mora promijeniti čak i bez formalne ocjene, boje ili upozorenja.

## 6. Zapis rezultata i ponovna provjera

Ovo je prazan predložak, **nije rezultat evaluacije**:

| Polje | Upis nakon stvarne sesije |
| --- | --- |
| Krug, datum i uloga moderatora (bez imena) | |
| Puni commit SHA ili build, jezik i preglednik | |
| Verzija obavijesti, postavke zadatka i izmišljeni fixture | |
| Šifra sudionika i uloga | |
| Scenarij i ekran; stvarna funkcija / prototip / nedostupno | |
| Postavljeno pitanje | |
| Prvi odgovor sudionika, prije objašnjenja | |
| Očekivano značenje prema prihvaćenoj odluci | |
| Nesporazum i posljedica za korisnika | |
| Odgovor nakon objašnjenja (odvojen od prvog) | |
| Ozbiljnost nalaza i obrazloženje | |
| Poveznica na Product/UX issue i predložena izmjena | |
| Kriterij prihvata za ponovni test | |
| Novi build, stvarni odgovor na ponovnom testu i status nalaza | |

Sažetak po skupini navodi broj provedenih sesija, broj sudionika koji su stvarno vidjeli svaki scenarij, opažene nesporazume i neprovjerene dijelove. Neprovjereno se ne zbraja s uspjehom. Za GO redak „Razumijevanje” sažetak posebno navodi koliko je studenata u prvom odgovoru točno reklo tko što vidi (studentska pitanja 1 i 8), uz nazivnik. Objavljuje se razumijevanje obiju skupina i status svakog nalaza.

## 7. Izlazni kriterij

GitHub #339 (i povijesni #56) nisu dovršeni samom izmjenom ovog dokumenta. Za zatvaranje #339 trebaju:

- zapisani stvarni rezultati najmanje 5 studenata i 5 nastavnika ili mentora;
- zabilježeni pogrešni zaključci, kontekst i ozbiljnost;
- dokaz razumijevanja prihvaćenog ponašanja prikaza uživo i reprodukcije za dostupne funkcije, uz izričito otvorene neprovjerene dijelove;
- provjera da brz put ne potiče rangiranje;
- povezani nalazi i rezultati ponovne provjere nakon potrebnih izmjena;
- za GO: prag razumijevanja upisan prema O04 i rezultat uspoređen s njim. Dok prag nije upisan, GO redak „Razumijevanje” ostaje otvoren.

D-06 i D-39 više nisu otvoren izbor: zamijenjeni su s D-142. Povijesni kriterij iz #56 čita se uz tu prihvaćenu odluku.

Product/UX zapisuje nalaze i predaje ih orkestratoru. Nalaz se ne implementira u istoj Product/UX sesiji.
