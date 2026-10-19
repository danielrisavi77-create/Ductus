# Ductus: plan proizvoda

Verzija 0.2 · 3. 10. 2026. · Radno ime: Ductus (konačno ime proizvoda još nije odabrano)

Ovaj dokument opisuje kako proizvod mora izgledati i ponašati se. Arhitektura je u `ARCHITECTURE.md`, redoslijed rada u `PROGRAM.md`, a sve odluke s brojevima u `DECISIONS.md`.

Oznake statusa uz tvrdnje:

- **[ODLUČENO D-xx]**: odluka je donesena i zapisana u `DECISIONS.md`.
- **[PRIJEDLOG D-xx]**: preporuka koja čeka potvrdu; do potvrde se ne gradi ništa što bi bilo skupo promijeniti.

Nadređeni dokumenti: Product Vision v1.0 i Product Constitution v1.3 (Google Drive, mapa projekta). Ako je ovaj dokument u sukobu s Ustavom, vrijedi Ustav, a sukob se prijavljuje kao greška u ovom dokumentu.

Odgovorna osoba za proizvod i sve odluke u ovom dokumentu: Daniel Rišavi (Ustav C-52).

---

## 1. Što je Ductus

**Obećanje proizvoda [ODLUČENO D-01]:** Ductus pokazuje kako je rad nastao. Zaključak donosi čovjek.

**Što je to u jednoj rečenici.** Ductus je okruženje za pisanje koje fakultet propisuje za studentske radove: student u njemu piše svaki zadani rad, alat od prvog trenutka zna sva pravila fakulteta i tehnički oblik rada, a nastavnik od prvog dana vidi kako rad nastaje i može ga komentirati i uređivati.

**Kupac i korisnici [ODLUČENO D-02]:** kupac je fakultet. Korisnici su student, koji u Ductusu piše, te nastavnik i mentor, koji prate nastanak rada. Student mora imati vlastitu korist od alata: svoj "Word" koji zna pravila fakulteta, citiranje, bibliografiju, oblik rada i sigurno spremanje.

**Problem.** U doba generativnog AI-ja gotov dokument ne govori ništa o tome kako je nastao, a detektori AI teksta daju postotke koji su nepouzdani i nepravedni. Fakultet treba pouzdan način da prati kako radovi nastaju i da sa studentom razgovara o dopuštenoj uporabi AI-ja.

**Pozicioniranje (jedno, interno i javno) [ODLUČENO D-02]:** "Ductus bilježi kako rad nastaje i olakšava razgovor o radu." Ductus se nikad ne predstavlja kao "anti-AI" alat ni kao alat koji otkriva AI: fakultetske smjernice GenUI tretiraju kao dio profesionalnog okruženja koji se dokumentira, a interna oznaka "anti-AI" stvara kod kupca očekivanje detekcije koje proizvod ne smije ispuniti.

**Granica koja se nikad ne prelazi [ODLUČENO D-01]:** Ductus nikad ne tvrdi je li rad napisao student, niti je li AI korišten nedopušteno. Ductus daje dokaze o tome kako je rad nastao: kada je tekst nastao, što je zalijepljeno, što je uvezeno, što je došlo iz AI-ja unutar aplikacije, što je promijenio nastavnik i kako se rad mijenjao nakon komentara. Zaključak, razgovor sa studentom i svaku odluku donose nastavnik i fakultet. Razlog: student može prepisivati AI tekst s drugog uređaja i to u zapisu izgleda kao normalno pisanje, pa bi svaka tvrdnja o autorstvu mogla optužiti nevinog studenta (Ustav C-9, C-10).

**Ductus nije:**

- detektor AI teksta ni procjena "ljudskosti";
- nadzor računala, preglednika, kamere ili mikrofona;
- alat za automatsko ocjenjivanje ili rangiranje studenata;
- sustav za stegovne postupke.

---

## 2. Vrste radova [ODLUČENO D-03]

Ductus podržava sve pisane radove koje nastavnik zadaje:

| Vrsta | Tipičan opseg | Napomena |
| --- | --- | --- |
| Podnesak | 300 do 1.500 riječi | Kraći tjedni zadaci |
| Esej | Do nekoliko tisuća riječi | |
| Seminarski rad | Do oko 10.000 riječi | Može imati cikluse komentara i verzija |
| Završni rad | Prema pravilima fakulteta | Mentor |
| Diplomski rad | Prema pravilima fakulteta | Mentor |
| Specijalistički rad | Prema pravilima fakulteta | Mentor |
| Doktorski rad | Prema pravilima fakulteta | Mentor; najdulji dokumenti |

Pisanje na nastavi i zadaci nalik ispitu pod nadzorom više nisu isključeni (D-144, D-151). Najbliži su nadzoru tijekom ispita iz Priloga III. Akta o umjetnoj inteligenciji (t. 3(d)), pa ih prije pilota sa stvarnim studentima moraju pokriti pravno mišljenje (D-55) i DPIA.

---

## 3. Uloge

Pravilo za sve uloge: uloga sama ne daje pristup sadržaju. Pristup nastaje isključivo iz odnosa (student u kolegiju, nastavnik zadatka, mentor rada). Ustav C-23.

| Uloga | Tko | Smije | Ne smije |
| --- | --- | --- | --- |
| Student | Upisan u kolegij ili dodijeljen mentoru | Pisati u svojim radovima; koristiti AI ako ga zadatak dopušta; vidjeti sve što nastavnik ili mentor vidi; prihvatiti ili odbiti prijedloge; izvesti svoj rad i evidenciju; dodati napomenu | Vidjeti tuđe radove ili tuđu evidenciju |
| Nastavnik zadatka, odnosno mentor (jedna uloga, D-154) | Nastavnik kolegija kojem zadatak pripada ili mentor završnog, diplomskog, specijalističkog ili doktorskog rada | Stvoriti kolegij i zadatak; od prvog dana vidjeti spremljeno stanje radova svog zadatka ili radova kojima je mentor i evidenciju u opsegu profila; komentirati; predlagati izmjene ili uređivati izravno (§6) | Vidjeti radove drugih kolegija ni radove kojima nije mentor |
| Administrator fakulteta | Imenovan od fakulteta | Potvrditi ulogu nastavnika i mentora; postavke fakulteta (dopušteni AI pružatelji, pragovi, rokovi čuvanja); revizijski trag pristupa | Čitati sadržaj radova (nema pristupa po defaultu) |
| Operater Ductusa | Pružatelj usluge | Održavanje sustava | Čitati sadržaj, osim zabilježenog pristupa podrške uz pristanak fakulteta, kako je opisano u ugovoru o obradi |

---

## 4. Prijava

**[ODLUČENO D-09]** Studenti se prijavljuju isključivo AAI@EduHr računom. Drugog načina prijave za studente nema.

**[PRIJEDLOG D-16]** Isto pravilo vrijedi za nastavnike, mentore i administratore fakulteta.

- Protokol: OpenID Connect Authorization Code s PKCE-om prema AAI@EduHr. Prijava i sesije provode se vlastitim server-side OIDC tokom; Supabase Auth nije odabran. Biblioteka/adapter ostaju otvoreni do M1 spikea (D-73 i `BACKEND.md` §4.3). Lažni OIDC pružatelj služi samo lokalno i u CI-ju.
- Identitet korisnika je `hrEduPersonUniqueID`, nikad e-mail.
- Tražimo samo: `openid`, `hrEduPersonUniqueID`, `hrEduPersonAffiliation`, `hrEduPersonHomeOrg` i po potrebi `email`. OIB se ne traži.
- `hrEduPersonAffiliation = djelatnik` znači samo da osoba može dobiti ulogu nastavnika ili mentora; ulogu potvrđuje administrator fakulteta.
- Za lokalni razvoj i CI postoji lažni OIDC pružatelj. Test mora dokazati da u produkciji ne postoji.

---

## 5. Pravila koja proizvod nikad ne krši

Izvedeno iz Ustava; svako pravilo ima test ili provjeru u PR-u.

1. Ductus nikad ne tvrdi tko je napisao rad, niti je li AI korišten nedopušteno. Oznaka mjesta unosa („Napisano u Ducturi”) navodi mjesto, ne osobu, i nije tvrdnja o autoru (D-127). (C-9, C-10, D-01)
2. Nema postotka AI-ja, postotka ljudskosti, ocjene rizika, sumnje ni integriteta. (C-6)
3. Nepoznato nije krivnja. Praznina u zapisu prikazuje se kao praznina, nikad kao znak nečega. (C-8)
4. Ne bilježi se koja je tipka pritisnuta ni koliko je držana. Bilježe se promjene dokumenta, sažete u odsječke s grubim vremenom (§9). Uz to se svaka promjena dokumenta, znak po znak, sprema s redoslijedom i vremenom u zasebnoj klasi podataka, isključivo za prikaz uživo i reprodukciju; iz vremena se nikad ne računa brzina, pauze, ritam ni bilo kakva mjera (D-143, D-56). (C-14, v1.4)
5. Student uvijek vidi točno ono što o njegovu radu vidi nastavnik ili mentor, generirano istom funkcijom. Iznimka su mentorovi radni zapisi (oznaka zadnjeg pregleda, privatne bilješke, predlošci komentara, nacrt rubrike i izvješća): oni nisu prikaz rada, ne ulaze u sažetak, izvoz ni predaju, navedeni su u obavijesti i student ih može zatražiti pravom pristupa (D-130). Ocjena i obrazloženje vide se studentu tek nakon objave. (C-4)
6. Student prije početka rada zna što nastavnik vidi i od kada: obavijest o praćenju je prvi ekran svakog zadatka. (C-3)
7. Mentor i nastavnik zadatka vide rad uživo dok nastaje: promjene dokumenta pojavljuju se u njihovu prikazu u trenutku kad ih student napravi (D-142). Mentor, odnosno nastavnik zadatka (jedna uloga, D-154), može reproducirati nastanak rada znak po znak (D-143); nitko drugi. Prikaz uživo i reprodukcija služe praćenju i komentarima, nikad ocjeni, rangiranju ni oznaci sumnje. Izvan prikaza uživo i reprodukcije povijest međustanja nije dostupna ni u jednom nastavničkom pregledu, sažetku ni usporedbi. Student smije vidjeti vlastitu povijest rada; ona se ne šalje nikome drugome, ne ulazi u sažetak, izvoz ni predaju i čuva se najviše do kraja akademske godine zadatka (D-131, uvjetno: čeka pravno mišljenje D-55). Student u obavijesti zna da mentor i nastavnik vide rad uživo, pa i tekst koji će možda kasnije obrisati, i da mentor, odnosno nastavnik zadatka, može reproducirati nastanak rada. (C-3, C-14, C-19, v1.4)
8. Svaka promjena teksta pripisana je autoru: student, nastavnik ili mentor, prihvaćeni prijedlog, AI unutar Ductusa, uvoz, lijepljenje, vlastita inačica odlomka. Tekst koji nije u dokumentu, a može ući u njega (inačica odlomka), zapisuje se u evidenciju kad nastane, a njegov ulazak u dokument je zasebna promjena s izvorom; Ductus ne unosi tekst u dokument bez zapisa izvora (D-132). (C-11)
9. Integritet zapisa nije dokaz autorstva. Hash i potpis govore samo da zapis nije mijenjan od primitka. (C-13)
10. Offline zapis ostaje označen kao offline i nakon sinkronizacije. (C-15)
11. Predaja je moguća samo ako se predani dokument može točno rekonstruirati iz zapisa. Zadatak smije dodatno tražiti samo potpunost koju student sam može ispuniti u aplikaciji: popunjena mjesta za izvor i potvrdu izjave koju propisuje fakultet; uvjet je naveden u obavijesti, ne odnosi se na podrijetlo teksta, AI, lijepljenja ni praznine u zapisu, a tehnička greška ne smije spriječiti predaju (D-129, uvjetno: čeka pisanu potvrdu FPZG-a i upis C-42). (C-42)
12. Pravila FPZG-a su konfiguracija, ne kod. To uključuje pravila oblika (iz Lekte), dopuštene AI pružatelje i pragove u sažetku procesa. (C-55, C-7)
13. Nema AI analize procesa pisanja. AI postoji samo kao pomoćnik studentu, ako ga zadatak dopušta. (Akt o UI, Prilog III.)
14. Pravila zadatka koja je student potvrdio ne smiju se naknadno proširiti. Profil evidencije može se samo suziti. (C-3, C-18)
15. Student nikad ne mora platiti da bi izvršio obvezu. U pilotu zadatak ne smije zahtijevati AI. (C-2)
16. Sadržaj radova i uvezenih datoteka nikad ne mijenja pravila zadatka ni upute AI pomoćniku. (C-37)
17. Student vidi tko je i kada otvorio njegov rad (dnevnik pristupa). Mentorovi radni zapisi iz pravila 5 nisu dio dnevnika pristupa (D-130). (C-4)

### Rječnik sučelja

Svaki redak vrijedi za sve oblike i složenice istog korijena (npr. kopirao, prepisivanje, vjerojatno) i za drugi red riječi, osim radnji pod „Dopuštene radnje” i osim kad redak sam navodi uvjet (odluka vlasnika, 12. 10. 2026., #179; tablice A i B ondje prihvaćene su kako jesu, uključujući retke s uvjetom).

| Ne koristiti nikad | Engleski ekvivalenti (D-90 t.3) | Koristiti umjesto toga |
| --- | --- | --- |
| sumnjivo, rizik, anomalija, upozorenje o studentu | suspicious, suspected, doubt, risk (i low-risk, riskless), anomaly, warning about the student | (ništa; činjenice se prikazuju bez oznake) |
| AI postotak (i udio AI-ja, ljudski udio, postotak ljudskosti, broj ili % uz AI, ljudsko, podrijetlo ili izvor), vjerojatnost (i vjerojatno), autentičnost, autenticitet, napisao AI | AI percentage, AI share, human share, humanness, probability, probably, likelihood, authenticity, written by AI | iz AI pomoćnika (model, vrijeme) |
| verificirano autorstvo, dokaz autorstva | verified authorship, proof of authorship | zapis je cjelovit i neizmijenjen od primitka |
| kopirano, prepisano; tuđi tekst, tuđe riječi, nije vlastiti / njegov / njezin (samo kao fraza; sama riječ „tuđi” nije zabranjena) | copied, copying, copy-paste, someone else's text, not their own | zalijepljeno (izvor nije opažen) |
| nestali podaci, skriveno, sakriveno, prikriveno | vanished data, hidden, concealed | praznina u zapisu |
| nedostajući podaci, izgubljeni podaci (samo o zapisu procesa u nastavničkom prikazu i sažetku; ne u porukama o oporavku na studentovu uređaju) | missing data, lost data (isti uvjet) | praznina u zapisu |
| plagijat, plagiranje | plagiarism | (ništa; za podrijetlo „iz izvora X”) |
| izvornost, originalnost | originality, unoriginal | zapis je cjelovit i neizmijenjen od primitka |
| integritet (i u tehničkom značenju) | integrity | cjelovitost zapisa |
| neobično, neuobičajeno | unusual, atypical | (ništa; opis činjenice bez ocjene) |
| nepravilnost, nepravilno (samo o radu ili studentu, u sažetku i nastavničkom prikazu) | irregularity (isti uvjet) | (ništa; opis činjenice bez ocjene) |
| ljudski napisano, napisao čovjek | human-written, written by a human | opaženo pisanje u uređivaču |
| spremljeno (bez pojašnjenja) | saved (without saying where) | spremljeno na uređaju / spremljeno na poslužitelju / predano |

Dopuštene radnje (ne krše Rječnik):

- „Kopiraj navod”, „kopiranje navoda”, „Kopirano u međuspremnik” i „Copy citation” (D-59);
- „Sakrij …” kao radnja nad sučeljem;
- „Preuzmi / preuzeto” u značenju preuzimanja datoteke;
- „odstupanje od pravila” u provjeri oblika;
- „izvorni / originalni” kao pridjev za datoteku, oblik ili tekst navoda;
- „nepravilan format” i slične poruke provjere unosa;
- postotak napretka i učitavanja (D-63);
- negacije poput „ne procjenjuje autorstvo” i „bez presude o autorstvu”;
- „Napisano u Ducturi” samo kao oznaka mjesta unosa, uz uvjete iz D-127 (stalno objašnjenje „Ductus ne zna tko je tipkao”, bez zbroja i udjela);
- „Izjava o autorstvu” samo kao naziv obrasca koji propisuje fakultet, uz oznaku „izjavljeno” (D-129, D-44);
- „otvoreno mjesto za izvor” za oznaku u tekstu koju je student ostavio; ne miješa se s „prazninom u zapisu” (D-137).

Tekst iz `config/faculties/**` provjerava se kao i ostali tekst sučelja; doslovni citat pravilnika izuzima se samo u izričito označenom polju za citat, nikad cijela datoteka.

---

## 6. Tokovi

### Student

1. **Prijava** AAI@EduHr računom.
2. **Ulaz u kolegij** kodom kolegija, ili dodjelom mentoru za završne i više radove.
3. **Otvara zadatak (ekran S3).** Prvi ekran je obavijest: upute, rok, vrsta rada, pravila oblika (iz Lekte), dopušteni oblici pomoći i AI, što se bilježi, što se ne bilježi, da mentor i nastavnik vide rad uživo od prvog dana i da mentor može reproducirati nastanak rada (D-142, D-143), koliko se dugo čuva i kako se dodaje napomena. Student potvrđuje da je pročitao. To nije privola i ne smije se tako prikazivati. Prije potvrde poslužitelj ne prima nikakvu evidenciju za taj rad. (C-3)
4. **Piše** u editoru koji zna pravila fakulteta: struktura, oblik, citiranje, bibliografija, naslovna stranica, opseg. Stanje spremanja je uvijek vidljivo. Vidi svoj napredak: riječi po danu prema cilju, napredak po poglavlju, dane do roka (D-63). Studentovi pomoćni zapisi u radu (povijest rada, inačice odlomka, odloženo) vidljivi su samo studentu i ne ulaze u sažetak, izvoz ni predaju; inačice se ipak zapisuju u evidenciju kad nastanu (D-132). Nakon demoa (D-131, D-132).
5. **Koristi AI** ako zadatak dopušta: prijavi se svojim računom kod pružatelja kojeg fakultet dopušta (§8) i bira svrhu (lektura, prijevod, literatura...). Tekst koji iz AI-ja prenese u rad bilježi se kao "iz AI pomoćnika" sa svrhom.
5a. **Lijepi tekst:** za veće lijepljenje može odabrati oznaku izvora (vlastite bilješke, citat, prijašnja verzija, vanjski AI, drugo); neobavezno (D-43). Ako ima odobrenu prilagodbu (npr. diktiranje), može je označiti na radu (D-50).
6. **Uvozi postojeći tekst** (DOCX, PDF i drugi formati) ako zadatak to dopušta. Uvoz je označen događaj s nazivom, vrstom i veličinom datoteke. Ductus ne izmišlja povijest uvezenog teksta. Ponovni uvoz nakon uređivanja izvan Ductusa je novi uvoz, nikad prikazan kao pisanje u Ductusu. (C-45)
7. **Vidi komentare i prijedloge** nastavnika ili mentora u stvarnom vremenu, jasno odvojene od svog teksta. Prijedlog prihvaća ili odbija; izravne izmjene nastavnika vidi označene. Način izmjena (prijedlozi ili izravno) student može u svakom trenutku vratiti na prijedloge.
8. **Šalje verziju na pregled** kad zadatak ima cikluse: nacrt, komentar, nova verzija, konačna predaja. [ODLUČENO D-28]
9. **Pregled prije konačne predaje (ekran S5).** Vidi isti prikaz kao nastavnik, otvorena mjesta (lijepljenja bez poznatog podrijetla) uz ponudu da doda oznaku (D-61) i kontrolni popis potpunosti (D-62); ništa od toga ne blokira predaju. Iznimka (D-129, uvjetno, nakon demoa): predaju smiju blokirati samo otvorena mjesta za izvor i nepotvrđena izjava koju fakultet propisuje, uz poruku koja kaže koje je mjesto; žute stavke, lijepljenja, AI i praznine u zapisu ne blokiraju. Može dodati napomenu (npr. "prvi nacrt pisao sam rukom" ili "koristio sam diktiranje"). Napomene se samo dodaju; ispravak je nova napomena koja upućuje na staru. (C-16)
10. **Konačna predaja.** Ductus složi izjavu o GenUI po FPZG čl. 9 i 15 iz zapisa (D-40); student je pregleda, dopuni vanjskim alatima i potvrdi, uz eventualno pitanje za refleksiju. Revizija se zamrzava. Student dobiva potvrdu s vremenom poslužitelja, izvoz rada u obliku koji traži fakultet, izjavu i prenosiv zapis s QR provjerom (D-49).
11. **Izvoz.** Student u svakom trenutku može izvesti svoj rad i svoju evidenciju.

### Nastavnik i mentor

1. **Prijava** AAI@EduHr računom.
2. **Kolegij:** naziv, akademska godina, kod za upis, pravilo AI-ja iz izvedbenog plana (D-52). Mentor dobiva studente dodjelom.
3. **Novi zadatak:** naslov, upute, vrsta rada (§2), profil fakulteta iz Lekte, otvaranje i rok, dopušteni oblici pomoći, dopušteni AI (unutar popisa koji dopušta fakultet), dopušten uvoz, ciklusi verzija, profil evidencije. Kad prvi student potvrdi obavijest, verzija zadatka se zaključava: izmjene stvaraju novu verziju koju studenti ponovno potvrđuju, a profil se može samo suziti.
4. **Pregled radova:** popis studenata sa stanjem rada (nije započeto, u tijeku, poslano na pregled, predano) i vremenom zadnje izmjene. Bez oznaka sumnje, boja upozorenja ili sortiranja po "sumnjivosti". Popis je abecedan; stanje rada u prvoj rečenici i stanje runde koje boja kodira (D-128) su dva različita prikaza. Boja smije kodirati samo stanje tijeka koje su postavili mentor i student zahtjevima i rundama (čeka doradu, dorada stigla, prihvaćeno, nije započeto), nikad kašnjenje, aktivnost, količinu rada ni stanje zapisa; stanje je uvijek i tekst, nijedna boja nije crvena (D-128). Oznaka „Napisano u Ducturi” je izbor prikaza uz uvjete iz D-127. Filtar "nakon roka" uzima u obzir odobrena produljenja.
5. **Rad u nastajanju:** prikaz uživo od prvog dana, i za kratke zadatke. [ODLUČENO D-142, D-144]
6. **Komentari** vezani uz odlomak, vidljivi studentu odmah ili objavljeni zajedno (D-51). Komentar može biti **zahtjev za doradu** sa stanjem (D-45).
6a. **Konzultacije (mentor):** zapis konzultacije vezan uz verziju rada (D-47). Zapis ima dva dijela: „Dogovoreno” (student vidi) i „Bilješka mentora” (privatni radni zapis iz D-130). Nakon demoa; uvjetno do pravnog mišljenja D-55 (D-135).
7. **Izmjene teksta:** kao prijedlozi koje student prihvaća ili kao izravne izmjene. Način dogovaraju nastavnik i student, postavka se vidi na radu, a student je može u svakom trenutku vratiti na prijedloge. Izravna izmjena tehnički je prijedlog koji se automatski primjenjuje kod studenta (D-34). Svaka izmjena nastavnika pripisana je nastavniku. [ODLUČENO D-21]
8. **Sažetak procesa** (§7) u svakom trenutku, uključujući prije predaje, i panel **Pravila zadatka**: pravilo i opaženo stanje, bez oznaka prolaza ili pada (D-62).
9. **Usporedba verzija** u Proširenom profilu.
10. **Produljenje roka** pojedinom studentu, s razlogom vidljivim samo nastavniku i tom studentu.
11. **Izvoz** predanog rada i potvrde predaje.

### Profili evidencije [ODLUČENO D-05, nastavnik bira profil]

| Profil | Nastavnik vidi | Za koje zadatke |
| --- | --- | --- |
| Osnovni | Spremljeno stanje rada, sažetak procesa, vremensku crtu | Zadana vrijednost |
| Prošireni | Osnovni + usporedbu verzija na kraju sesija i poslanih verzija | Seminarski i završni radovi s više verzija |

**Reprodukcija (D-56, D-143):** za mentora, odnosno nastavnika zadatka (jedna uloga, D-154), znak po znak, najavljena u obavijesti prije pisanja; nitko drugi je ne vidi. Pokazuje kako je rad rastao, uključujući obrisani tekst, brzinom kojom je pisan, s oznakama lijepljenja, uvoza, AI prijenosa, izmjena nastavnika, dorada i konzultacija. Može se pokrenuti za cijeli rad ili za jedan odlomak. Uz reprodukciju stoji stalni tekst: "Ritam pisanja ne govori ništa o autorstvu ni o trudu." Nema brzine tipkanja, statistike pauza ni isticanja "brzih" ili "sporih" dijelova. Student vidi istu reprodukciju i kad ju je mentor gledao.

### Administrator fakulteta

1. Potvrđuje ulogu nastavnika i mentora osobama s AAI pripadnošću "djelatnik". Prvog administratora postavlja operater Ductusa na pisani zahtjev fakulteta, uz zapis u revizijski trag.
2. Odabire dopuštene AI pružatelje i modele za fakultet. [ODLUČENO D-23]
3. Postavlja pragove i rokove čuvanja po klasi podataka (prijedlog dolazi od Ductusa, potvrda od fakulteta).
4. Odlučuje je li Ductus obvezan za pojedine vrste radova. U pilotu to odlučuje FPZG. [ODLUČENO D-04]
5. Vidi revizijski trag: tko je kada pristupio kojem radu. Bez pristupa sadržaju.

---

## 7. Sažetak procesa

Ovo je srž onoga što fakultet kupuje. Svaka brojka ima jedinicu, nazivnik i metodu (Ustav C-12). Isti sažetak vidi student. Pragovi su postavke fakulteta sa zadanim vrijednostima iz `DECISIONS.md` i uvijek se prikazuju uz brojku na koju utječu.

| Stavka | Definicija | Prikaz |
| --- | --- | --- |
| Razdoblje rada | Prvi i posljednji zabilježeni događaj | Datumi |
| Sesije | Niz promjena bez prekida duljeg od praga P-01 (zadano 30 minuta) | Broj sesija i popis s datumima |
| Aktivno vrijeme uređivanja | Zbroj trajanja sesija | Sati i minute, uz stalni tekst: "vrijeme uređivanja nije mjera truda ni vremena razmišljanja" |
| Verzije | Verzije na kraju sesija, poslane na pregled i predane | Vremenska crta |
| Lijepljenja | Svako lijepljenje veće od praga P-02 (zadano 200 znakova) kao zaseban događaj; manja se samo broje | Popis: vrijeme (zaokruženo na odsječak) i veličina, uz oznaku "izvor nije opažen". Bez zbroja i bez udjela u radu |
| Uvozi | Uvoz datoteke, uključujući ponovni uvoz nakon uređivanja izvan Ductusa | Naziv, vrsta, veličina, vrijeme |
| AI pomoćnik | Svako prenošenje teksta iz AI pomoćnika u rad | Popis: vrijeme, pružatelj i model, svrha (D-42), veličina i preneseni tekst; u radu se može označiti mjesto na koje je tekst prenesen. Razgovori su vidljivi nastavniku tek kao prilog izjavi pri slanju verzije ili predaji [ODLUČENO D-41] |
| Zahtjevi za doradu | Zahtjevi nastavnika ili mentora i njihovo stanje | Popis sa stanjem; oznaka "promijenjeno nakon prihvaćanja" (D-45) |
| Konzultacije | Zapisi mentora o konzultacijama | Datum, tema, dogovoreno, verzija rada (D-47) |
| Prilagodba | Studentova oznaka odobrene prilagodbe | Samo oznaka, bez razloga (D-50) |
| Izmjene nastavnika | Izravne izmjene i prihvaćeni prijedlozi nastavnika ili mentora | Popis s vremenom i veličinom |
| Praznine u zapisu | Rasponi između dviju verzija koje je poslužitelj primio, za koje odsječci nisu stigli | Popis s objašnjenjem |
| Izjava o GenUI | Izjava po FPZG čl. 9 i 15, složena iz zapisa i potvrđena od studenta, s priloženim razgovorima (D-40, D-41) | Tekst izjave i prilozi |
| Napomene studenta | Studentovo objašnjenje uz evidenciju | Tekst |
| Stanje zapisa | Je li zapis cjelovit i neizmijenjen od primitka | "Zapis je cjelovit" ili "Zapis ima praznine (vidi popis)" |

**Karta podrijetla [ODLUČENO D-57]:** isti događaji mogu se uključiti kao oznake u tekstu rada, na mjestu gdje su nastali; tekst napisan u Ductusu ostaje neoznačen, bez zbroja i udjela (D-127 to mijenja: oznaka mjesta „Napisano u Ducturi” dopuštena je kao izbor prikaza mentora uz uvjete iz D-127). Lijepljenje teksta kopiranog unutar Ductusa i podudaranje s odgovorom AI pomoćnika označavaju se poznatim podrijetlom (D-58).

**Vrsta dokaza [ODLUČENO D-44]:** svaka stavka nosi oznaku *opaženo* (nastalo u Ductusu), *uvezeno* (iz datoteke) ili *izjavljeno* (navod studenta, npr. oznaka lijepljenja ili vanjski AI razgovor).

**Zabranjeno u sažetku:** brzina tipkanja, "neuobičajeni obrasci", usporedba s drugim studentima, rangiranje, bilo kakva ocjena ili boja koja sugerira procjenu studenta, te svaki prikaz koji dijeli tekst rada po podrijetlu uz zajednički nazivnik (to je postotak ljudskosti pod drugim imenom, C-6).

---

## 8. AI pomoćnik

> **Izvan pilota (D-77, 3. 10. 2026.).** U pilotu student koristi vanjske alate i prilaže ispis razgovora uz izjavu. Ovaj odjeljak opisuje ciljno stanje nakon pilota.

- **Prijava studenta svojim računom.** Prvi put: OpenRouter (OAuth s PKCE-om), koji jednom prijavom daje pristup većini modela (Claude, GPT, Gemini, Grok, kineski modeli i drugi); student plaća iz vlastitog računa. Kasnije, ako Ductus postane partner, i "Sign in with ChatGPT". Pretplate na Claude ne mogu se koristiti u aplikacijama trećih strana. [PRIJEDLOG D-20]
- **Fakultet određuje dopuštene pružatelje i modele**, a nastavnik unutar toga dopuštenu uporabu po zadatku. [ODLUČENO D-23]
- **AI je uvijek dobrovoljan za studenta.** U pilotu zadatak ne smije zahtijevati AI. Obvezni AI kasnije je moguć samo uz ključ koji osigurava fakultet. (C-2)
- **Tekst studenta šalje se pružatelju samo kad student sam pokrene AI.** Studenti u obavijesti vide da tekst tada odlazi izabranom pružatelju i u koju zemlju.
- **Zaštita od podmetnutih uputa (C-37):** upute AI-ju sastavlja poslužitelj iz pravila zadatka; tekst rada i uvezenih datoteka šalje se kao omeđeni nepouzdani podaci, a skriveni tekst (npr. bijeli ili skriveni font u DOCX-u, nevidljivi sloj PDF-a) uklanja se pri uvozu.
- **Svrhe umjesto praznog chata [ODLUČENO D-42, D-64]:** razina 1 uključena po defaultu prema FPZG čl. 8 (objašnjenje pojma, lektura s označenim izmjenama, prijevod, traženje literature, formatiranje, transkripcija); razina 2 samo ako je nastavnik izričito uključi (brainstorming, restrukturiranje, generiranje primjera, kodiranje podataka). Brainstorming po defaultu radi kao pomoćnik koji pita: postavlja studentu pitanja umjesto da daje gotove ideje. Nastavnik uključuje svrhe po zadatku unutar pravila kolegija (D-52). Svrha i faza rada bilježe se same.
- **Zaštita sadržaja [ODLUČENO D-46]:** prije primjene lekture ili prijevoda Ductus prikazuje promijenjene brojke, doslovne citate i oznake izvora; student potvrđuje.
- **Bilježi se:** vrijeme, pružatelj, model, svrha i tekst prenesen u rad. Razgovori su studentovi tijekom pisanja; uz izjavu pri slanju verzije ili predaji automatski idu razgovori iz kojih je tekst prenesen, a student vidi što se prilaže i može dodati ostale te vanjske razgovore (izjavljeno). [ODLUČENO D-41, zamjenjuje D-22]
- Ductus ne trenira modele na radovima i ne šalje radove nikamo bez studentove radnje. (C-38)

---

## 9. Što se bilježi

Jedna transakcija editora otprilike odgovara jednom pritisku tipke. U evidenciji se transakcije sažimaju u **odsječke** od najviše 30 sekundi (D-24, potvrđeno D-81). Odsječak sadrži sve korake promjene, potrebne za točnu rekonstrukciju, ali samo jedno vrijeme (početak odsječka, zaokruženo na minutu) i autora. Vrijeme po pojedinoj promjeni postoji samo u zasebnoj klasi podataka s kraćim rokom čuvanja, za prikaz uživo i reprodukciju (D-143), nikad u odsječku evidencije. I vrijeme primitka na poslužitelju zaokružuje se na minutu u svemu što vide student i nastavnik.

| Bilježi se | Ne bilježi se |
| --- | --- |
| Promjene dokumenta sažete u odsječke, s autorom (student, nastavnik, mentor) | Koja je tipka pritisnuta i koliko je držana; izvedene mjere (brzina, pauze, obrasci) |
| Svaka promjena dokumenta znak po znak, s redoslijedom i vremenom, zasebno i s kraćim rokom čuvanja, samo za prikaz uživo i reprodukciju (D-143) | Mjere izvedene iz vremena promjena |
| Poništavanje i ponavljanje | Druge aplikacije, kartice preglednika, međuspremnik izvan zalijepljenog sadržaja |
| Lijepljenje: veličina i vrijeme | Kamera, mikrofon, zaslon |
| Uvoz datoteke: naziv, vrsta, veličina, hash | IP adresa i podaci o uređaju u evidenciji (smiju postojati samo u sigurnosnim logovima, odvojeno) |
| Prenošenje teksta iz AI pomoćnika: pružatelj, model, svrha, preneseni tekst i mjesto | Razgovori s AI-jem dok ih student ne priloži izjavi (D-41) |
| Oznaka lijepljenja koju student odabere (izjavljeno) | |
| Komentari, prijedlozi i njihovo prihvaćanje ili odbijanje | Osobni prostor (ne postoji, D-19) |
| Vrijeme odsječka na uređaju i vrijeme primitka na poslužitelju, odvojeno | |
| Verzije, predaje, napomene, izjava o pomoći | |

---

## 10. Funkcije editora

Student dobiva potpuno okruženje za pisanje akademskog rada. Pravila oblika dolaze iz zajedničkog paketa s Lektom [ODLUČENO D-25].

| Područje | Sadržaj |
| --- | --- |
| Struktura | Naslovi s numeracijom, sadržaj, naslovna stranica i izjava prema predlošku fakulteta (D-32); opseg po poglavlju s trakom napretka (D-60) |
| Tekst | Oblikovanje, popisi, citat kao blok, fusnote, tablice, slike s opisima, popis tablica i slika; poziv na tablicu ili grafikon s automatskom numeracijom i upozorenjem "nije spomenut u tekstu"; automatski hrvatski navodnici; traži i zamijeni; način za fokus; prečaci |
| Izvori | Bilježnica izvora s bilješkama, citiranje sa stranicom, kopiranje navoda s poznatim podrijetlom, uvoz iz Zotera (D-59) |
| Citiranje | Citiranje u tekstu i bibliografija u stilu fakulteta, usklađivanje citata i bibliografije, provjera postojanja DOI-ja i URL-a (D-48) |
| Pravila | Provjera oblika i opsega prema profilu fakulteta tijekom pisanja (iz Lekte) |
| Opseg | Brojač riječi prema traženom rasponu vrste rada |
| Izvoz | DOCX u obliku koji traži fakultet; PDF |
| Uvoz | DOCX, PDF i drugi formati, kao označen događaj. PDF gubi oblik, a dijakritici ovise o kvaliteti PDF-a; student to vidi prije uvoza |
| Suradnja | Komentari, zahtjevi za doradu sa stanjem, prijedlozi izmjena, izravne izmjene nastavnika s pripisivanjem, konzultacije |
| AI | Pomoćnik prema §8 |

---

## 11. Opseg

**[ODLUČENO D-26]** U pilot ulazi sve što je navedeno u ovom dokumentu, uključujući mentorstvo (D-33). Redoslijed puštanja unutar pilota je u `PROGRAM.md`.

**Nikad (Ustav):** postotak AI-ja ili ljudskosti, ocjena rizika ili sumnje, tvrdnja o autorstvu, nadzor računala, kamere i zaslona, biometrija tipkanja, automatske sankcije, rangiranje studenata, treniranje modela na radovima. Prikaz uživo dokumenta u Ducturi nije nadzor zaslona: Ductura ne vidi ništa izvan svog editora (Ustav v1.4, D-142, D-144).

**Kasnije:** drugi fakulteti, Merlin (LTI), "Sign in with ChatGPT".

**Odlučeno, Ustav v1.4 dopunjen 18. 10. 2026. (C-3, C-14, C-19, popis „Nikad”; uz izmjene od 17. 10. niže):** prikaz uživo i reprodukcija znak po znak (D-142, D-143). Pilot sa stvarnim studentima čeka pravno mišljenje (D-55) i DPIA.

**Ustav v1.4 (17. 10. 2026., D-127 do D-137):** izmjene C-3, C-4, C-11, C-19 (samo studentov pogled) i C-42 posljedica su dizajna Ductura. Uvjetno: D-129 (blokada predaje) čeka pisanu potvrdu FPZG-a i upis C-42, D-131 (povijest rada) i D-135 (konzultacije) čekaju pravno mišljenje D-55. D-133 i D-134 su PRIJEDLOG (arhitektura).

---

## 12. Pilot na FPZG-u

- **Fakultet:** samo FPZG. [ODLUČENO D-15]
- **Kontakt:** prodekan Višeslav Raos. [ODLUČENO D-14]
- **Cijena:** pilot je besplatan; kupac nakon pilota je fakultet. [ODLUČENO D-13]
- **Početak:** ljetni semestar akademske godine 2026./2027. [ODLUČENO D-26]
- **Obveznost:** FPZG odlučuje je li korištenje obvezno ili dobrovoljno. Ako je dobrovoljno, studenti koji ne sudjeluju imaju ravnopravnu alternativu.
- **Jezik:** sučelje na hrvatskom i engleskom od vala 1 [ODLUČENO D-70]; jezik rada bira se po zadatku (F-06).
- **Podrška:** model iz D-69; rokovi u pilotu radnim danom u podne.
- **Povlačenje studenta:** već predani radovi ostaju po pravilima fakulteta, sve ostalo se briše. [ODLUČENO D-12]
- **Etape:** A tehnička proba sa sintetičkim radovima prije početka semestra; B nastava; C evaluacija.
- Nijedan tehnički pokazatelj sam ne dovodi do ocjene ni posljedice.

**Mjerila uspjeha:**

| Područje | Mjera | Prag |
| --- | --- | --- |
| Pouzdanost | Rekonstrukcija predanih radova | 100 %; svako odstupanje blokira izdanje |
| Pouzdanost | Izgubljen rad | 0 slučajeva |
| Sigurnost | Neovlašten pristup | 0 slučajeva |
| Korisnost | Vrijeme nastavnika i mentora za razumijevanje nastanka rada, u odnosu na sadašnji postupak | Definirati s FPZG-om prije pilota (GO uvjet) |
| Razumijevanje | Student točno odgovara tko što vidi | Definirati prije pilota (GO uvjet) |
| Pravednost | Slučajevi u kojima je legitiman način rada (lijepljenje vlastitog teksta, diktiranje, rad bez veze) izazvao neopravdanu sumnju | Svaki slučaj se analizira |

Ankete i razgovori iz evaluacije pohranjuju se odvojeno od evidencije pisanja i ne povezuju se s njom (C-22).

---

## 13. Kriterij prihvata

Demo prolazi cijeli put na sintetičkom radu s unaprijed poznatim ishodom. Za val 1 (`PROGRAM.md`) vrijede koraci bez oznake; koraci označeni [val 2] vrijede od drugog vala.

1. Student se prijavi (AAI@EduHr Lab), uđe u kolegij kodom i otvori zadatak s FPZG profilom.
2. Napiše tekst s naslovima i citatom; bibliografija se složi u FPZG stilu; provjera oblika javlja odstupanje od pravila. Fusnota i tablica [val 2].
3. Izbriše dio, zalijepi odlomak, uveze DOCX. Uvoz PDF-a [val 2].
4. [nakon pilota, D-77] Koristi AI pomoćnik i prenese dio teksta u rad; podmetnuta uputa u uvezenoj datoteci ne mijenja ponašanje pomoćnika. U pilotu: uz izjavu priloži ispis razgovora iz vanjskog alata.
5. Nastavnik u međuvremenu vidi spremljeno stanje, ostavi komentar i prijedlog; student prihvati prijedlog. Nastavnik napravi jednu izravnu izmjenu.
6. Student radi bez veze, zatim se veza vrati; ništa se ne izgubi i offline rad ostaje označen.
7. Student pošalje verziju na pregled, dobije komentar, napravi novu verziju i konačno preda rad uz izjavu o pomoći.
8. Sažetak procesa pokazuje lijepljenje, oba uvoza, AI prenošenje, izmjene nastavnika i sesije, bez ikakve ocjene; student i nastavnik vide isto.
9. Rekonstruirani dokument je identičan predanoj verziji u kanonskom obliku; izvoz DOCX-a odgovara FPZG obliku.
10. Kontrolirana praznina prikazuje se kao praznina.
11. Tekst napisan i obrisan unutar iste sesije ne pojavljuje se ni u jednom nastavničkom pregledu povijesti, sažetku ni usporedbi (studentov pogled „Povijest rada” je iznimka, uvjetno do pravnog mišljenja D-55, D-131); [val 3] u mentorskom radu pojavljuje se samo u reprodukciji, a ista reprodukcija rekonstruira predani rad bajt za bajt.
12. Drugi student i nastavnik drugog kolegija ne mogu otvoriti ni rad ni evidenciju. Test gađa poslužitelj i bazu, ne samo sučelje.
13. Odjava uvijek zatvara sesiju, i s nesinkroniziranim promjenama; nakon odjave druga osoba na istom pregledniku ne vidi studentov lokalni zapis, a nepredani zapis nastavlja se kad se isti student ponovno prijavi (D-118).
