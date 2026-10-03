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

**Problem.** U doba generativnog AI-ja gotov dokument ne govori ništa o tome kako je nastao, a detektori AI teksta daju postotke koji su nepouzdani i nepravedni. Fakultet treba pouzdan način da prati kako radovi nastaju i da razlikuje dopuštenu od nedopuštene uporabe AI-ja.

**Interno pozicioniranje** je "anti-AI" alat za fakultete. **Javno i prema fakultetu** proizvod se predstavlja kao transparentnost nastanka rada.

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

Pisanje na nastavi i zadaci nalik ispitu pod nadzorom nisu podržani, jer su najbliži nadzoru tijekom ispita iz Priloga III. Akta o umjetnoj inteligenciji.

---

## 3. Uloge

Pravilo za sve uloge: uloga sama ne daje pristup sadržaju. Pristup nastaje isključivo iz odnosa (student u kolegiju, nastavnik zadatka, mentor rada). Ustav C-23.

| Uloga | Tko | Smije | Ne smije |
| --- | --- | --- | --- |
| Student | Upisan u kolegij ili dodijeljen mentoru | Pisati u svojim radovima; koristiti AI ako ga zadatak dopušta; vidjeti sve što nastavnik ili mentor vidi; prihvatiti ili odbiti prijedloge; izvesti svoj rad i evidenciju; dodati napomenu | Vidjeti tuđe radove ili tuđu evidenciju |
| Nastavnik zadatka | Nastavnik kolegija kojem zadatak pripada | Stvoriti kolegij i zadatak; od prvog dana vidjeti spremljeno stanje radova svog zadatka i evidenciju u opsegu profila; komentirati; predlagati izmjene ili uređivati izravno (§6) | Vidjeti radove drugih kolegija |
| Mentor | Mentor završnog, diplomskog, specijalističkog ili doktorskog rada | Isto što i nastavnik, za radove kojima je mentor | Vidjeti radove kojima nije mentor |
| Administrator fakulteta | Imenovan od fakulteta | Potvrditi ulogu nastavnika i mentora; postavke fakulteta (dopušteni AI pružatelji, pragovi, rokovi čuvanja); revizijski trag pristupa | Čitati sadržaj radova (nema pristupa po defaultu) |
| Operater Ductusa | Pružatelj usluge | Održavanje sustava | Čitati sadržaj, osim zabilježenog pristupa podrške uz pristanak fakulteta, kako je opisano u ugovoru o obradi |

---

## 4. Prijava

**[ODLUČENO D-09]** Studenti se prijavljuju isključivo AAI@EduHr računom. Drugog načina prijave za studente nema.

**[PRIJEDLOG D-16]** Isto pravilo vrijedi za nastavnike, mentore i administratore fakulteta.

- Protokol: OpenID Connect, Authorization Code s PKCE-om, preko Supabase Autha (vlastiti OIDC pružatelj).
- Identitet korisnika je `hrEduPersonUniqueID`, nikad e-mail.
- Tražimo samo: `openid`, `hrEduPersonUniqueID`, `hrEduPersonAffiliation`, `hrEduPersonHomeOrg` i po potrebi `email`. OIB se ne traži.
- `hrEduPersonAffiliation = djelatnik` znači samo da osoba može dobiti ulogu nastavnika ili mentora; ulogu potvrđuje administrator fakulteta.
- Za lokalni razvoj i CI postoji lažni OIDC pružatelj. Test mora dokazati da u produkciji ne postoji.

---

## 5. Pravila koja proizvod nikad ne krši

Izvedeno iz Ustava; svako pravilo ima test ili provjeru u PR-u.

1. Ductus nikad ne tvrdi tko je napisao rad, niti je li AI korišten nedopušteno. (C-9, C-10, D-01)
2. Nema postotka AI-ja, postotka ljudskosti, ocjene rizika, sumnje ni integriteta. (C-6)
3. Nepoznato nije krivnja. Praznina u zapisu prikazuje se kao praznina, nikad kao znak nečega. (C-8)
4. Ne bilježi se koja je tipka pritisnuta ni koliko je držana. Bilježe se promjene dokumenta, sažete u odsječke s grubim vremenom (§9). Samo u mentorskim radovima uz to se bilježi vrijeme promjena u koracima od 100 ms, isključivo za reprodukciju; iz njega se nikad ne računa brzina, pauze ni bilo kakva mjera (D-56). (C-14, traži izmjenu)
5. Student uvijek vidi točno ono što vidi nastavnik ili mentor, generirano istom funkcijom. (C-4)
6. Student prije početka rada zna što nastavnik vidi i od kada: obavijest o praćenju je prvi ekran svakog zadatka. (C-3)
7. Nastavnik vidi trenutno spremljeno stanje rada, osvježeno najviše svakih 5 minuta (P-03), ne tipkanje uživo. Povijest međustanja unutar sesije nije dostupna ni u jednom pregledu, sažetku ni usporedbi, osim u reprodukciji mentorskih radova najavljenoj prije pisanja (D-56). Student u obavijesti zna da nastavnik vidi trenutno stanje, pa i tekst koji će možda kasnije obrisati. (C-3, C-14, C-19)
8. Svaka promjena teksta pripisana je autoru: student, nastavnik ili mentor, prihvaćeni prijedlog, AI unutar Ductusa, uvoz, lijepljenje. (C-11)
9. Integritet zapisa nije dokaz autorstva. Hash i potpis govore samo da zapis nije mijenjan od primitka. (C-13)
10. Offline zapis ostaje označen kao offline i nakon sinkronizacije. (C-15)
11. Predaja je moguća samo ako se predani dokument može točno rekonstruirati iz zapisa. (C-42)
12. Pravila FPZG-a su konfiguracija, ne kod. To uključuje pravila oblika (iz Lekte), dopuštene AI pružatelje i pragove u sažetku procesa. (C-55, C-7)
13. Nema AI analize procesa pisanja. AI postoji samo kao pomoćnik studentu, ako ga zadatak dopušta. (Akt o UI, Prilog III.)
14. Pravila zadatka koja je student potvrdio ne smiju se naknadno proširiti. Profil evidencije može se samo suziti. (C-3, C-18)
15. Student nikad ne mora platiti da bi izvršio obvezu. U pilotu zadatak ne smije zahtijevati AI. (C-2)
16. Sadržaj radova i uvezenih datoteka nikad ne mijenja pravila zadatka ni upute AI pomoćniku. (C-37)
17. Student vidi tko je i kada otvorio njegov rad. (C-4)

### Rječnik sučelja

| Ne koristiti nikad | Koristiti umjesto toga |
| --- | --- |
| sumnjivo, rizik, anomalija, upozorenje o studentu | (ništa; činjenice se prikazuju bez oznake) |
| AI postotak, vjerojatnost, autentičnost, napisao AI | iz AI pomoćnika (model, vrijeme) |
| verificirano autorstvo, dokaz autorstva | zapis je cjelovit i neizmijenjen od primitka |
| kopirano, prepisano | zalijepljeno (izvor nije opažen) |
| nestali podaci, skriveno | praznina u zapisu |
| spremljeno (bez pojašnjenja) | spremljeno na uređaju / spremljeno na poslužitelju / predano |

---

## 6. Tokovi

### Student

1. **Prijava** AAI@EduHr računom.
2. **Ulaz u kolegij** kodom kolegija, ili dodjelom mentoru za završne i više radove.
3. **Otvara zadatak (ekran S3).** Prvi ekran je obavijest: upute, rok, vrsta rada, pravila oblika (iz Lekte), dopušteni oblici pomoći i AI, što se bilježi, što se ne bilježi, da nastavnik vidi spremljeno stanje od prvog dana, koliko se dugo čuva i kako se dodaje napomena. Student potvrđuje da je pročitao. To nije privola i ne smije se tako prikazivati. Prije potvrde poslužitelj ne prima nikakvu evidenciju za taj rad. (C-3)
4. **Piše** u editoru koji zna pravila fakulteta: struktura, oblik, citiranje, bibliografija, naslovna stranica, opseg. Stanje spremanja je uvijek vidljivo. Vidi svoj napredak: riječi po danu prema cilju, napredak po poglavlju, dane do roka (D-63).
5. **Koristi AI** ako zadatak dopušta: prijavi se svojim računom kod pružatelja kojeg fakultet dopušta (§8) i bira svrhu (lektura, prijevod, literatura...). Tekst koji iz AI-ja prenese u rad bilježi se kao "iz AI pomoćnika" sa svrhom.
5a. **Lijepi tekst:** za veće lijepljenje može odabrati oznaku izvora (vlastite bilješke, citat, prijašnja verzija, vanjski AI, drugo); neobavezno (D-43). Ako ima odobrenu prilagodbu (npr. diktiranje), može je označiti na radu (D-50).
6. **Uvozi postojeći tekst** (DOCX, PDF i drugi formati) ako zadatak to dopušta. Uvoz je označen događaj s nazivom, vrstom i veličinom datoteke. Ductus ne izmišlja povijest uvezenog teksta. Ponovni uvoz nakon uređivanja izvan Ductusa je novi uvoz, nikad prikazan kao pisanje u Ductusu. (C-45)
7. **Vidi komentare i prijedloge** nastavnika ili mentora u stvarnom vremenu, jasno odvojene od svog teksta. Prijedlog prihvaća ili odbija; izravne izmjene nastavnika vidi označene. Način izmjena (prijedlozi ili izravno) student može u svakom trenutku vratiti na prijedloge.
8. **Šalje verziju na pregled** kad zadatak ima cikluse: nacrt, komentar, nova verzija, konačna predaja. [ODLUČENO D-28]
9. **Pregled prije konačne predaje (ekran S5).** Vidi isti prikaz kao nastavnik, otvorena mjesta (lijepljenja bez poznatog podrijetla) uz ponudu da doda oznaku (D-61) i kontrolni popis potpunosti (D-62); ništa od toga ne blokira predaju. Može dodati napomenu (npr. "prvi nacrt pisao sam rukom" ili "koristio sam diktiranje"). Napomene se samo dodaju; ispravak je nova napomena koja upućuje na staru. (C-16)
10. **Konačna predaja.** Ductus složi izjavu o GenUI po FPZG čl. 9 i 15 iz zapisa (D-40); student je pregleda, dopuni vanjskim alatima i potvrdi, uz eventualno pitanje za refleksiju. Revizija se zamrzava. Student dobiva potvrdu s vremenom poslužitelja, izvoz rada u obliku koji traži fakultet, izjavu i prenosiv zapis s QR provjerom (D-49).
11. **Izvoz.** Student u svakom trenutku može izvesti svoj rad i svoju evidenciju.

### Nastavnik i mentor

1. **Prijava** AAI@EduHr računom.
2. **Kolegij:** naziv, akademska godina, kod za upis, pravilo AI-ja iz izvedbenog plana (D-52). Mentor dobiva studente dodjelom.
3. **Novi zadatak:** naslov, upute, vrsta rada (§2), profil fakulteta iz Lekte, otvaranje i rok, dopušteni oblici pomoći, dopušteni AI (unutar popisa koji dopušta fakultet), dopušten uvoz, ciklusi verzija, profil evidencije. Kad prvi student potvrdi obavijest, verzija zadatka se zaključava: izmjene stvaraju novu verziju koju studenti ponovno potvrđuju, a profil se može samo suziti.
4. **Pregled radova:** popis studenata sa stanjem rada (nije započeto, u tijeku, poslano na pregled, predano) i vremenom zadnje izmjene. Bez oznaka, boja upozorenja ili sortiranja po "sumnjivosti". Filtar "nakon roka" uzima u obzir odobrena produljenja.
5. **Rad u nastajanju:** trenutno spremljeno stanje rada, osvježeno najviše svakih 5 minuta, od prvog dana. [ODLUČENO D-06] Za zadatke s kratkim vremenskim prozorom pogled na rad u nastajanju nije dostupan, nego samo predaja (D-37), jer bi inače bio blizu nadzora ispita.
6. **Komentari** vezani uz odlomak, vidljivi studentu odmah ili objavljeni zajedno (D-51). Komentar može biti **zahtjev za doradu** sa stanjem (D-45).
6a. **Konzultacije (mentor):** zapis konzultacije vezan uz verziju rada (D-47).
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

**Reprodukcija (D-56):** samo u mentorskim radovima, najavljena u obavijesti prije pisanja. Pokazuje kako je rad rastao, uključujući obrisani tekst, brzinom kojom je pisan, s oznakama lijepljenja, uvoza, AI prijenosa, izmjena nastavnika, dorada i konzultacija. Može se pokrenuti za cijeli rad ili za jedan odlomak. Uz reprodukciju stoji stalni tekst: "Ritam pisanja ne govori ništa o autorstvu ni o trudu." Nema brzine tipkanja, statistike pauza ni isticanja "brzih" ili "sporih" dijelova. Student vidi istu reprodukciju i kad ju je mentor gledao.

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

**Karta podrijetla [ODLUČENO D-57]:** isti događaji mogu se uključiti kao oznake u tekstu rada, na mjestu gdje su nastali; tekst napisan u Ductusu ostaje neoznačen, bez zbroja i udjela. Lijepljenje teksta kopiranog unutar Ductusa i podudaranje s odgovorom AI pomoćnika označavaju se poznatim podrijetlom (D-58).

**Vrsta dokaza [ODLUČENO D-44]:** svaka stavka nosi oznaku *opaženo* (nastalo u Ductusu), *uvezeno* (iz datoteke) ili *izjavljeno* (navod studenta, npr. oznaka lijepljenja ili vanjski AI razgovor).

**Zabranjeno u sažetku:** brzina tipkanja, "neuobičajeni obrasci", usporedba s drugim studentima, rangiranje, bilo kakva ocjena ili boja koja sugerira procjenu studenta, te svaki prikaz koji dijeli tekst rada po podrijetlu uz zajednički nazivnik (to je postotak ljudskosti pod drugim imenom, C-6).

---

## 8. AI pomoćnik

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

Jedna transakcija editora otprilike odgovara jednom pritisku tipke. Zato se transakcije ne bilježe pojedinačno s vremenom: sažimaju se u **odsječke** od najviše 30 sekundi [PRIJEDLOG D-24]. Odsječak sadrži sve korake promjene, potrebne za točnu rekonstrukciju, ali samo jedno vrijeme (početak odsječka, zaokruženo na minutu) i autora. I vrijeme primitka na poslužitelju zaokružuje se na minutu u svemu što vide student i nastavnik.

| Bilježi se | Ne bilježi se |
| --- | --- |
| Promjene dokumenta sažete u odsječke, s autorom (student, nastavnik, mentor) | Koja je tipka pritisnuta i koliko je držana; izvedene mjere (brzina, pauze, obrasci) |
| Samo mentorski radovi: vrijeme promjena u koracima od 100 ms, zasebno i s kraćim rokom čuvanja (D-56) | Vrijeme promjena u ostalim radovima |
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

**Nikad (Ustav):** postotak AI-ja ili ljudskosti, ocjena rizika ili sumnje, tvrdnja o autorstvu, nadzor računala, kamere i zaslona, biometrija tipkanja, automatske sankcije, rangiranje studenata, treniranje modela na radovima, pisanje nalik ispitu pod nadzorom.

**Kasnije:** sučelje na engleskom [ODLUČENO D-27], drugi fakulteti, Merlin (LTI), "Sign in with ChatGPT".

**Odlučeno, čeka izmjenu Ustava C-14 i C-19:** reprodukcija s ritmom u mentorskim radovima (D-56), val 3.

---

## 12. Pilot na FPZG-u

- **Fakultet:** samo FPZG. [ODLUČENO D-15]
- **Kontakt:** prodekan Višeslav Raos. [ODLUČENO D-14]
- **Cijena:** pilot je besplatan; kupac nakon pilota je fakultet. [ODLUČENO D-13]
- **Početak:** ljetni semestar akademske godine 2026./2027. [ODLUČENO D-26]
- **Obveznost:** FPZG odlučuje je li korištenje obvezno ili dobrovoljno. Ako je dobrovoljno, studenti koji ne sudjeluju imaju ravnopravnu alternativu.
- **Jezik:** hrvatski. [ODLUČENO D-27]
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
4. [val 2] Koristi AI pomoćnik preko OpenRoutera i prenese dio teksta u rad; podmetnuta uputa u uvezenoj datoteci ne mijenja ponašanje pomoćnika.
5. Nastavnik u međuvremenu vidi spremljeno stanje, ostavi komentar i prijedlog; student prihvati prijedlog. Nastavnik napravi jednu izravnu izmjenu.
6. Student radi bez veze, zatim se veza vrati; ništa se ne izgubi i offline rad ostaje označen.
7. Student pošalje verziju na pregled, dobije komentar, napravi novu verziju i konačno preda rad uz izjavu o pomoći.
8. Sažetak procesa pokazuje lijepljenje, oba uvoza, AI prenošenje, izmjene nastavnika i sesije, bez ikakve ocjene; student i nastavnik vide isto.
9. Rekonstruirani dokument je identičan predanoj verziji u kanonskom obliku; izvoz DOCX-a odgovara FPZG obliku.
10. Kontrolirana praznina prikazuje se kao praznina.
11. Tekst napisan i obrisan unutar iste sesije ne pojavljuje se ni u jednom pregledu povijesti, sažetku ni usporedbi; [val 3] u mentorskom radu pojavljuje se samo u reprodukciji, a ista reprodukcija rekonstruira predani rad bajt za bajt.
12. Drugi student i nastavnik drugog kolegija ne mogu otvoriti ni rad ni evidenciju. Test gađa poslužitelj i bazu, ne samo sučelje.
13. Nakon odjave na istom pregledniku nema studentovog lokalnog zapisa; odjava s nesinkroniziranim promjenama je blokirana uz poruku.
