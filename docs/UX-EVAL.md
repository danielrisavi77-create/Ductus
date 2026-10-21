# Ductus: UX evaluacija povjerenja

Verzija 1.1 · 21. 10. 2026.

Kod Ductusa pogrešno razumijevanje sučelja može biti ozbiljan bug čak i kad je kod tehnički točan. Ovaj dokument je protokol evaluacije; ne sadrži rezultate provedenog istraživanja.

## 1. Cilj i prihvaćene odluke

Prije stvarnog pilota provjeriti razumiju li student i nastavnik:

- što je Ductus stvarno opažao, a što nije;
- tko vidi rad, kada i u kojem obliku;
- da integritet zapisa nije dokaz autorstva;
- da lijepljenje bez poznatog izvora nije dokaz AI-ja;
- da praznina u zapisu ne otkriva uzrok ni namjeru;
- razliku između lokalno spremljenog rada, potvrđene pohrane na poslužitelju i osvježavanja nastavničkog prikaza.

Mjerodavne su prihvaćene odluke u [DECISIONS.md](DECISIONS.md) i granice iz [PRODUCT.md §5](PRODUCT.md):

- **D-142** zamjenjuje D-06 i D-39: nastavnik vidi promjene rada dok nastaje, student je o tome obaviješten prije pisanja i vidi isti prikaz svojeg rada. Prikaz ne obuhvaća računalo, kameru, zaslon ni rad izvan Ducture.
- **D-143** određuje reprodukciju promjena dokumenta, uključujući obrisani tekst. Vrijeme služi reprodukciji, nikad mjerama osobe, procjeni autorstva ili zaključku o AI-ju. Uvjeti prije pilota sa stvarnim studentima ostaju prema toj odluci; ovdje se za prikaz koriste unaprijed pripremljeni sintetički zapisi.
- **D-144** uključuje i kratke zadatke. Sudioniku se ne smije obećati da ih nastavnik vidi tek nakon predaje.
- **D-154** objedinjuje nastavnika i mentora u jednu ulogu; pristup i dalje proizlazi iz odnosa sa zadatkom ili mentorskim radom.

Jednakost se odnosi na zajednički prikaz rada, uključujući prikaz uživo i reprodukciju. Prema **D-130 i PRODUCT §5 pravilu 5**, mentorovi radni zapisi nisu prikaz rada: student ih ne vidi u aplikaciji, ali ih može zatražiti pravom pristupa; navedeni su u obavijesti i ne ulaze u sažetak, izvoz ni predaju. Ocjena i obrazloženje vide se tek nakon objave. Uvjetni dijelovi D-130/D-135 ne prikazuju se kao već izgrađene funkcije.

Evaluacija više ne bira između D-06 i D-39. Provjerava razumijevanje prihvaćenog ponašanja i otvara nalaze ako prikaz navodi na pogrešan zaključak.

## 2. Sudionici i priprema

Najmanje **5 studenata i 5 nastavnika/mentora koji nisu gradili proizvod**. Agentov prolaz, pregled koda ili testovi nisu zamjena za te sudionike.

Za svaki krug zabilježiti datum, puni commit SHA/build, jezik sučelja, preglednik, verziju obavijesti i postavke sintetičkog zadatka. Ista sintetička povijest koristi se u oba prikaza i u obje skupine.

Za svaki prikaz označiti je li riječ o:

- funkciji koja radi u testiranom buildu;
- posebno označenom prototipu;
- funkciji koja još nije dostupna.

Nedostupna funkcija ostaje neprovjerena. Razumijevanje prototipa ne dokazuje ispravnost stvarnog toka; nalaz se ponovno provjerava kad funkcija postoji u buildu.

Sudionicima dodijeliti šifre S01–S05 i N01–N05 (daljnjim sudionicima sljedeći broj). U zapis nalaza ne unositi imena, AAI identifikatore ni stvarne studentske radove. Upute i prikazi koriste izmišljene podatke.

Odgovori, ankete i razgovori iz evaluacije pohranjuju se odvojeno od evidencije pisanja i ne povezuju se s njom (PRODUCT §12, C-22). Šifra sudionika nije ključ za povezivanje s njegovim radom ili evidencijom.

Moderator najprije postavlja otvoreno pitanje i bilježi odgovor vlastitim riječima sudionika. Tek nakon toga objašnjava prikaz. Ispravljen odgovor nakon objašnjenja bilježi se odvojeno od prvog razumijevanja.

## 3. Scenariji

| Scenarij | Što pokazati i pitati | Što odgovor treba razlikovati |
| --- | --- | --- |
| Obavijest i pristup | Obavijest prije pisanja te prikaz istog rada za obje uloge. „Tko ovo može vidjeti i kada?” | Nastavnik/mentor povezan s radom vidi promjene tijekom pisanja; student vidi isti prikaz. To nije pristup svim radovima ustanove. |
| Radni zapisi mentora | Dostupan dio obavijesti ili označen prototip. „Jesu li mentorove privatne bilješke dio ovog zajedničkog prikaza? Kako možeš zatražiti pristup?” | Radni zapisi su iznimka prema D-130; pravo pristupa nije isto što i prikaz u aplikaciji. Ocjena/obrazloženje vide se nakon objave, uz uvjete D-135. |
| Prikaz uživo i kratki zadatak | Sintetički dugi i kratki zadatak s istom promjenom dokumenta. „Što se ovdje osvježava? Što se ne vidi?” | Promjene u Ducturi, i za kratki zadatak; ništa s drugog uređaja, iz drugih aplikacija, s kamere ili zaslona. |
| Reprodukcija | Dostupnu reprodukciju sintetičkog zapisa s unosom, lijepljenjem i brisanjem, ili jasno označen prototip. „Što iz ovoga možete zaključiti?” | Reprodukcija pokazuje zabilježene promjene i obrisani tekst; ne daje mjeru brzine, sposobnosti, autorstva ili korištenja vanjskog AI-ja. |
| Izvor lijepljenja | Dva opažački jednaka lijepljenja: scenarij vlastitih bilježaka i scenarij vanjskog AI teksta. Ne otkrivati pozadinsku priču prije odgovora. „Što znači izvor nije opažen?” | Prikaz ne može razlikovati te izvore kad izvor nije opažen. Broj i veličina lijepljenja nisu zaključak o AI-ju. |
| Cjelovitost i praznina | Jedan cjelovit zapis i jedan zapis s prazninom. „Što možete tvrditi o radu ili studentu?” | Cjelovitost se odnosi na zapis, ne dokazuje autorstvo. Praznina ne dokazuje skrivanje ni namjerni prekid. |
| Spremanje i osvježavanje | Lokalno spremljenu promjenu koja još čeka poslužitelj, potvrđenu pohranu te prikaz koji se još osvježava. „Gdje je ova promjena sada spremljena? Što nastavnik sada vidi?” | Lokalni save, potvrda poslužitelja i svježina nastavničkog prikaza zasebna su stanja. Nedostupan stvarni tok ostaje neprovjeren. |
| Brz put nastavnika | Tekst rada i postojeći neutralni sažetak prema D-80; više sintetičkih radova različitih brojeva događaja. „Što biste otvorili prije razgovora i zašto?” | Sadržaj i kontekst razgovora, bez procjene sumnje, autorstva ili rangiranja studenata po broju događaja. |

### Pitanja studentu

1. Što nastavnik može vidjeti tijekom pisanja i nakon njega?
2. Može li Ductus zaključiti jesi li koristio AI na drugom uređaju?
3. Što znači „lijepljenje, izvor nije opažen”?
4. Što znači praznina u zapisu?
5. Kad je rad stvarno spremljen na poslužitelju i kako to znaš?
6. Razlikuje li se očekivana vidljivost za kratki zadatak?
7. Ako postoji reprodukcija, vidiš li isti prikaz svojeg rada kao nastavnik?

### Pitanja nastavniku/mentoru

1. Što možete tvrditi na temelju ovog prikaza, a što ne možete?
2. Što znači „3 lijepljenja bez poznatog izvora”?
3. Biste li na temelju toga sami pokrenuli sankciju? Zašto?
4. Što znači „zapis je cjelovit”, a što praznina?
5. Koju biste informaciju otvorili prije razgovora sa studentom?
6. Kako biste odabrali rad koji ćete sljedeći otvoriti? Zašto?
7. Ako postoji reprodukcija, što vam pokazuje, a što ne može dokazati?

## 4. UX bug kriterij

UX bug postoji ako korisnik iz prikaza redovito zaključuje nešto što Ductus ne zna. Svaki opaženi nesporazum treba zabilježiti; ponavljanje se prikazuje brojem sudionika i nazivnikom u svakoj skupini, bez izmišljanja praga prihvatljivosti.

Posebno bilježiti zaključke:

- „lijepljenje bez izvora = AI”;
- „cjelovit zapis = student je autor”;
- „praznina = skrivanje”;
- „broj događaja = procjena rizika”;
- „prikaz uživo = nastavnik vidi cijelo računalo ili druge aplikacije”;
- „kratki zadatak nastavnik ne vidi do predaje”;
- „reprodukcija dokazuje autorstvo ili mjeri osobu”;
- „lokalno spremljeno = potvrđeno na poslužitelju”;
- „nastavnik u zajedničkom prikazu rada, uživo ili reprodukciji vidi više od mene”. To ne obuhvaća mentorove radne zapise ni ocjenu/obrazloženje prije objave, koji su iznimke iz pravila 5.

Stvarni prikaz uživo prema D-142 sam po sebi nije pogrešno razumijevanje. Odvojeno zabilježiti osjećaj nadzora, korisnost i potrebu za pedagoškom intervencijom; nelagodu sudionika ne prepisivati kao tehničku netočnost njegova odgovora.

Takav nalaz ide Product/UX issueu prije pilotiranja, čak i ako nema tehničke greške. Ako brzi put potiče implicitno rangiranje po broju događaja, prikaz se mora promijeniti čak i bez formalne ocjene, boje ili upozorenja.

## 5. Zapis rezultata i ponovna provjera

Ovo je prazan predložak, **nije rezultat evaluacije**:

| Polje | Upis nakon stvarne sesije |
| --- | --- |
| Krug, datum i moderator | |
| Puni commit SHA/build, jezik i preglednik | |
| Obavijest/postavke zadatka i sintetički fixture | |
| Šifra sudionika i uloga | |
| Scenarij; stvarna funkcija / prototip / nedostupno | |
| Postavljeno pitanje | |
| Prvi odgovor sudionika, prije objašnjenja | |
| Očekivano značenje prema prihvaćenoj odluci | |
| Nesporazum i posljedica za korisnika | |
| Odgovor nakon objašnjenja (odvojen od prvog) | |
| Ozbiljnost nalaza i obrazloženje | |
| Poveznica na Product/UX issue i predložena izmjena | |
| Acceptance criterion za ponovni test | |
| Novi build, stvarni odgovor na retestu i status nalaza | |

Sažetak po skupini navodi broj provedenih sesija, broj sudionika koji su stvarno vidjeli svaki scenarij, opažene nesporazume i neprovjerene dijelove. Ne zbraja neprovjereno s uspjehom. Objavljuje se razumijevanje obiju skupina i status svakog nalaza.

## 6. Izlazni kriterij

GitHub #56 i #339 nisu dovršeni samom izmjenom ovog dokumenta. Za zatvaranje trebaju:

- zapisani stvarni rezultati najmanje 5 studenata i 5 nastavnika/mentora;
- zabilježeni pogrešni zaključci, kontekst i ozbiljnost;
- dokaz razumijevanja prihvaćenog live/replay ponašanja za dostupne funkcije, uz izričito otvorene neprovjerene dijelove;
- provjera da brzi put ne potiče implicitno rangiranje;
- povezani nalazi i rezultati ponovne provjere nakon potrebnih izmjena.

D-06/D-39 više nije otvoren izbor: zamijenjen je D-142. Povijesni kriterij iz #56 treba čitati uz tu prihvaćenu odluku, bez ponovnog izmišljanja odluke.

Product/UX zapisuje nalaze i predaje ih Orkestratoru. Nema implementacije nalaza iz iste Product/UX sesije.
