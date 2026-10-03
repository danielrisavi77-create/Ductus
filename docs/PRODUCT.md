# Ductus: plan proizvoda

Verzija 0.1 · 3. 10. 2026. · Radno ime: Ductus (konačno ime proizvoda još nije odabrano)

Ovaj dokument opisuje kako proizvod mora izgledati i ponašati se. Arhitektura je u `ARCHITECTURE.md`, redoslijed rada u `PROGRAM.md`, a sve odluke s brojevima u `DECISIONS.md`.

Oznake statusa uz tvrdnje:

- **[ODLUČENO D-xx]**: odluka je donesena i zapisana u `DECISIONS.md`.
- **[PRIJEDLOG D-xx]**: preporuka koja čeka potvrdu; do potvrde se ne gradi ništa što bi bilo skupo promijeniti.

Nadređeni dokumenti: Product Vision v1.0 i Product Constitution v1.3 (Google Drive, mapa projekta). Ako je ovaj dokument u sukobu s Ustavom, vrijedi Ustav, a sukob se prijavljuje kao greška u ovom dokumentu.

Odgovorna osoba za proizvod i sve odluke u ovom dokumentu: Daniel Rišavi (Ustav C-52).

---

## 1. Što je Ductus

**Obećanje proizvoda [PRIJEDLOG D-01]:** Ductus pokazuje kako je rad nastao. Ne donosi presudu o autorstvu.

**Kupac i korisnik [PRIJEDLOG D-02]:** kupac je fakultet. Korisnici su student, koji u Ductusu piše, i nastavnik, koji vidi kako je predani rad nastao. Student mora imati vlastitu korist od alata: sigurno spremanje, jasna pravila zadatka i uvid u to što nastavnik vidi.

**Problem.** Nastavnik danas dobiva samo gotov dokument. U doba generativnog AI-ja gotov dokument ne govori ništa o tome kako je nastao, a detektori AI teksta daju postotke koji su nepouzdani i nepravedni prema studentima. Ductus daje činjenice o procesu pisanja unutar zadatka. Tumačenje, razgovor sa studentom i svaku odluku ostavlja nastavniku i fakultetu.

**Ductus nije:**

- detektor AI teksta ni procjena "ljudskosti";
- nadzor računala, preglednika, kamere ili mikrofona;
- alat za ocjenjivanje ili rangiranje studenata;
- sustav za stegovne postupke.

---

## 2. Uloge

Pravilo za sve uloge: uloga sama ne daje pristup sadržaju. Pristup nastaje isključivo iz odnosa (student u kolegiju, nastavnik zadatka, predaja tog zadatka). Ustav C-23.

| Uloga | Tko | Smije | Ne smije |
| --- | --- | --- | --- |
| Student | Upisan u kolegij | Pisati u svojim projektima zadataka; vidjeti vlastiti sažetak procesa i pregled prije predaje; izvesti svoj rad i svoju evidenciju; dodati napomenu uz evidenciju | Vidjeti tuđe radove ili tuđu evidenciju |
| Nastavnik zadatka | Nastavnik kolegija kojem zadatak pripada | Stvoriti kolegij i zadatak; vidjeti **predane** pakete svog zadatka u opsegu koji određuje profil zadatka; komentirati; izvesti predaju | Vidjeti nacrte prije predaje; vidjeti radove drugih kolegija; vidjeti osobni prostor studenta |
| Administrator fakulteta | Imenovan od fakulteta | Potvrditi ulogu nastavnika; postavke čuvanja podataka; uvid u revizijski trag pristupa | Čitati sadržaj radova (nema pristupa po defaultu) |
| Operater Ductusa | Pružatelj usluge | Održavanje sustava | Čitati sadržaj, osim zabilježenog pristupa podrške uz pristanak fakulteta, kako je opisano u ugovoru o obradi |
| Mentor završnog rada | Kasnije (V2) | | |

---

## 3. Prijava

**[ODLUČENO D-09]** Studenti se prijavljuju isključivo AAI@EduHr računom. Drugog načina prijave za studente nema.

**[PRIJEDLOG D-16]** Isto pravilo vrijedi za nastavnike i administratore fakulteta.

- Protokol: OpenID Connect, Authorization Code s PKCE-om, preko Supabase Autha (vlastiti OIDC pružatelj).
- Identitet korisnika je `hrEduPersonUniqueID`, nikad e-mail.
- Tražimo samo: `openid`, `hrEduPersonUniqueID`, `hrEduPersonAffiliation`, `hrEduPersonHomeOrg` i po potrebi `email`. OIB se ne traži.
- `hrEduPersonAffiliation = djelatnik` znači samo da osoba može dobiti ulogu nastavnika; ulogu potvrđuje administrator fakulteta.
- Za lokalni razvoj i CI postoji lažni OIDC pružatelj. Test mora dokazati da u produkciji ne postoji.
- Detalji i rizici: `ARCHITECTURE.md`, odjeljak Prijava.

---

## 4. Pravila koja proizvod nikad ne krši

Izvedeno iz Ustava; svako pravilo ima test ili provjeru u PR-u.

1. Nema postotka AI-ja, postotka ljudskosti, ocjene rizika, sumnje ni integriteta. (C-6)
2. Nepoznato nije krivnja. Praznina u zapisu prikazuje se kao praznina, nikad kao znak nečega. (C-8)
3. Nema bilježenja tipki ni ritma tipkanja. Bilježe se promjene dokumenta, sažete u odsječke s grubim vremenom (§8), tako da se iz evidencije ne može očitati tempo pisanja. (C-14)
4. Student prije predaje vidi točno ono što će nastavnik vidjeti, generirano istom funkcijom. (C-4)
5. Ništa iz osobnog prostora ne postaje evidencija zadatka, ni naknadno. Projekt zadatka počinje prazan ili s označenim uvozom. (C-18)
6. Obrisani nacrti i povijest oporavka nikad nisu vidljivi nastavniku. Nastavnik može usporediti samo verzije na kraju sesija i predane verzije; što je student napisao i obrisao unutar sesije ne vidi. (C-19)
7. Integritet zapisa nije dokaz autorstva. Hash i potpis govore samo da zapis nije mijenjan od primitka. (C-13)
8. Offline zapis ostaje označen kao offline i nakon sinkronizacije. (C-15)
9. Predaja je moguća samo ako se predani dokument može točno rekonstruirati iz zapisa. (C-42)
10. Pravila FPZG-a su konfiguracija, ne kod. To uključuje i pragove u sažetku procesa. (C-55, C-7)
11. U pilotu nema AI analize procesa pisanja. (Akt o UI, Prilog III., točka 3(d); D-12)
12. Pravila zadatka koja je student potvrdio ne smiju se naknadno proširiti. Profil evidencije može se samo suziti. (C-3, C-18)

### Rječnik sučelja

| Ne koristiti nikad | Koristiti umjesto toga |
| --- | --- |
| sumnjivo, rizik, anomalija, upozorenje o studentu | (ništa; činjenice se prikazuju bez oznake) |
| AI postotak, vjerojatnost, autentičnost | (ništa) |
| verificirano autorstvo, dokaz autorstva | zapis je cjelovit i neizmijenjen od primitka |
| kopirano, prepisano | zalijepljeno (izvor nije opažen) |
| nestali podaci, skriveno | praznina u zapisu |
| spremljeno (bez pojašnjenja) | spremljeno na uređaju / spremljeno na poslužitelju / predano |

---

## 5. Tokovi

### Student

1. **Prijava** AAI@EduHr računom.
2. **Ulaz u kolegij** kodom kolegija koji dobije od nastavnika.
3. **Otvara zadatak.** Prvi ekran je obavijest o zadatku: upute, rok, dopušteni oblici pomoći (uključujući pravila o AI-ju), što se bilježi, što se ne bilježi, što nastavnik vidi i kada, koliko se dugo čuva i kako se dodaje napomena. Student potvrđuje da je pročitao. To nije privola i ne smije se tako prikazivati. (C-3)
4. **Piše** u editoru. Stanje spremanja je uvijek vidljivo: spremljeno na uređaju, spremljeno na poslužitelju, ili problem sa spremanjem uz jasnu poruku.
5. **Uvozi postojeći tekst** ako zadatak to dopušta. Uvoz je jedan označen događaj s nazivom i veličinom datoteke. Ductus ne izmišlja povijest uvezenog teksta. Ako student rad uredi izvan Ductusa (npr. u Wordu) i ponovno ga uveze, to je novi uvoz s veličinom promjene, nikad prikazan kao pisanje u Ductusu. (C-45)
6. **Pregled prije predaje.** Student vidi točno što će vidjeti nastavnik: sažetak procesa, vremensku crtu i, ako profil to uključuje, usporedbu verzija. Može dodati napomenu (npr. "prvi nacrt pisao sam rukom" ili "koristio sam diktiranje"). Napomene se samo dodaju; ispravak je nova napomena koja upućuje na staru. (C-16)
7. **Predaja.** Revizija se zamrzava. Student dobiva potvrdu s vremenom poslužitelja i oznakom predane verzije.
8. **Nakon povratne informacije** nastaje nova revizija. Ponovna predaja moguća je ako je zadatak dopušta; stara predaja ostaje nepromijenjena.
9. **Izvoz.** Student u svakom trenutku može izvesti svoj rad i svoju evidenciju.

### Nastavnik

1. **Prijava** AAI@EduHr računom.
2. **Kolegij:** naziv, akademska godina, kod za upis.
3. **Novi zadatak:** naslov, upute, vrsta (esej ili seminarski rad), otvaranje i rok, dopušteni oblici pomoći (tekst pravila), dopušten uvoz (da/ne), ponovna predaja (da/ne), profil evidencije (vidi tablicu niže). Kad prvi student potvrdi obavijest, verzija zadatka se zaključava: kasnije izmjene stvaraju novu verziju koju studenti moraju ponovno potvrditi, a profil se može samo suziti. Pisanje na nastavi i zadaci nalik ispitu nisu dio pilota, jer su najbliži nadzoru tijekom ispita iz Priloga III. Akta o UI-ju.
4. **Predaje zadatka:** popis studenata s vremenom predaje. Bez ikakvih oznaka, boja upozorenja ili sortiranja po "sumnjivosti". Sortira se abecedno ili po vremenu predaje. Filtar "nakon roka" uzima u obzir produljenje roka koje je nastavnik odobrio pojedinom studentu.
5. **Sažetak procesa** jedne predaje (odjeljak 7).
6. **Usporedba verzija**, samo ako je profil zadatka uključuje.
7. **Komentar studentu**, vezan uz predanu reviziju.
8. **Izvoz predaje:** DOCX predane verzije i potvrda predaje (PDF kasnije).
9. **Produljenje roka** pojedinom studentu, sa zapisanim razlogom vidljivim samo nastavniku i tom studentu.

### Profili evidencije zadatka [PRIJEDLOG D-05]

| Profil | Nastavnik vidi | Za koje zadatke |
| --- | --- | --- |
| Osnovni | Sažetak procesa i vremensku crtu | Zadana vrijednost za sve zadatke |
| Prošireni | Osnovni + usporedbu verzija na kraju sesija i predanih verzija | Seminarski radovi s više revizija |

Reprodukcija pisanja nije dio pilota. I bez stvarnog tempa pokazala bi tekst koji je student napisao i obrisao unutar sesije (C-19), a s tempom bi otkrila ritam pisanja (C-14). Vraća se tek uz zasebnu odluku i Constitution Gate.

### Administrator fakulteta

1. Potvrđuje ulogu nastavnika osobama s AAI pripadnošću "djelatnik". Prvog administratora ustanove postavlja operater Ductusa, isključivo na temelju pisanog zahtjeva fakulteta; to se bilježi u revizijski trag.
2. Postavlja rokove čuvanja po klasi podataka (prijedlog dolazi od Ductusa, potvrda od fakulteta).
3. Vidi revizijski trag: tko je kada pristupio kojoj predaji. Bez pristupa sadržaju.

---

## 6. Ekrani prve verzije

Vizualno polazište za editor je prototip na `prototipeditor.netlify.app`.

| ID | Ekran | Sadržaj |
| --- | --- | --- |
| S1 | Prijava | Jedan gumb: Prijava AAI@EduHr računom |
| S2 | Moji kolegiji | Kolegiji i zadaci s rokovima i stanjem (nije započeto, u tijeku, predano) |
| S3 | Obavijest o zadatku | Upute, pravila pomoći, što se bilježi i tko vidi; potvrda čitanja |
| S4 | Editor | Tekst, naslovi, popisi, citat kao blok; stanje spremanja; brojač riječi u odnosu na traženi opseg; izjava o korištenju AI-ja |
| S5 | Pregled prije predaje | Isti prikaz koji dobiva nastavnik; polje za napomenu |
| S6 | Potvrda predaje | Vrijeme poslužitelja (zona Europe/Zagreb), oznaka verzije, poveznica za izvoz |
| S7 | Moji podaci | Izvoz rada i evidencije; popis zadataka i rokova čuvanja |
| N1 | Moji kolegiji (nastavnik) | Kolegiji, kodovi za upis, zadaci |
| N2 | Uredi zadatak | Sva polja iz toka nastavnika, profil evidencije, verzije zadatka |
| N3 | Predaje zadatka | Popis bez oznaka; filtri: predano, nije predano, nakon roka (uz produljenja) |
| N4 | Sažetak procesa | Odjeljak 7 |
| N5 | Usporedba verzija | Samo u Proširenom profilu |
| A1 | Fakultet | Nastavnici, rokovi čuvanja, revizijski trag |

Sučelje je na hrvatskom. Ciljna razina pristupačnosti je WCAG 2.2 AA (C-47). Provjerava se trima mehanizmima: automatska provjera (axe) u Playwrightu je uvjet za spajanje; svi tokovi moraju se moći proći samo tipkovnicom; S4 i S5 se prije pilota ručno provjeravaju čitačem zaslona (NVDA ili VoiceOver).

---

## 7. Sažetak procesa

Ovo je srž proizvoda. Svaka brojka ima jedinicu, nazivnik i metodu (Ustav C-12). Isti sažetak student vidi prije predaje. Pragovi (prekid sesije, veličina lijepljenja koja se prikazuje zasebno) su postavke ustanove sa zadanim vrijednostima iz `DECISIONS.md` i uvijek se prikazuju uz brojku na koju utječu.

| Stavka | Definicija | Prikaz |
| --- | --- | --- |
| Razdoblje rada | Prvi i posljednji zabilježeni događaj u projektu zadatka | Datumi |
| Sesije | Niz promjena bez prekida duljeg od praga P-01 (zadano 30 minuta) | Broj sesija i popis s datumima |
| Aktivno vrijeme uređivanja | Zbroj trajanja sesija | Sati i minute, uz stalni tekst: "vrijeme uređivanja nije mjera truda ni vremena razmišljanja" |
| Revizije | Spremljene verzije na poslužitelju i predaje | Vremenska crta |
| Lijepljenja | Svako lijepljenje veće od praga P-02 (zadano 200 znakova) kao zaseban događaj; manja se samo broje | Popis događaja: vrijeme (zaokruženo na odsječak, §8) i veličina u znakovima, uz oznaku "izvor nije opažen". Bez zbroja i bez udjela u predanoj verziji |
| Uvozi | Uvoz datoteke, uključujući ponovni uvoz nakon uređivanja izvan Ductusa | Naziv, veličina, vrijeme |
| Praznine u zapisu | Rasponi između dviju verzija koje je poslužitelj primio, za koje odsječci evidencije nisu stigli (npr. trajni gubitak na uređaju) | Popis s objašnjenjem; ono što nije zabilježeno prikazuje se ovdje, nikad kao zasebna "nepoznata" skupina teksta |
| Izjava o pomoći | Studentova izjava o korištenju AI-ja i drugih oblika pomoći | Tekst izjave |
| Napomene studenta | Studentovo objašnjenje uz evidenciju | Tekst |
| Stanje zapisa | Je li zapis cjelovit i neizmijenjen od primitka | "Zapis je cjelovit" ili "Zapis ima praznine (vidi popis)" |

**Zabranjeno u sažetku:** brzina tipkanja, "neuobičajeni obrasci", usporedba s drugim studentima, rangiranje, bilo kakva ocjena ili boja koja sugerira procjenu studenta, te svaki prikaz koji dijeli predani tekst po podrijetlu uz zajednički nazivnik (to je postotak ljudskosti pod drugim imenom, C-6).

---

## 8. Što se bilježi

Jedna transakcija editora otprilike odgovara jednom pritisku tipke. Zato se transakcije ne bilježe pojedinačno s vremenom: sažimaju se u **odsječke** od najviše 30 sekundi **[PRIJEDLOG D-04]**. Odsječak sadrži sve korake promjene, potrebne za točnu rekonstrukciju, ali samo jedno vrijeme (početak odsječka, zaokruženo na minutu). Unutar odsječka sačuvan je redoslijed koraka, ali ne i vrijeme između njih.

| Bilježi se | Ne bilježi se |
| --- | --- |
| Promjene dokumenta (umetanje, brisanje, zamjena, oblikovanje, struktura), sažete u odsječke | Pritisci tipki, vrijeme pojedinih promjena, ritam i brzina tipkanja |
| Poništavanje i ponavljanje (povijest ne nestaje) | Druge aplikacije, kartice preglednika, međuspremnik izvan zalijepljenog sadržaja |
| Lijepljenje: veličina i vrijeme | Kamera, mikrofon, zaslon |
| Uvoz datoteke: naziv, veličina, hash | IP adresa i podaci o uređaju u evidenciji (smiju postojati samo u sigurnosnim logovima, odvojeno) |
| Vrijeme odsječka na uređaju i vrijeme primitka na poslužitelju, odvojeno; odstupanje sata uređaja se otkriva i prikazuje | Privatne bilješke i osobni prostor |
| Revizije, predaje, napomene, izjava o pomoći | |

---

## 9. Opseg

| Prva verzija (pilot) | Kasnije | Nikad (Ustav) |
| --- | --- | --- |
| AAI@EduHr prijava | Mentor za završne i diplomske radove | Postotak AI-ja ili ljudskosti |
| Kolegij, upis kodom, zadatak s profilom | FPZG pravila citiranja, fusnote, predlošci | Ocjena rizika ili sumnje |
| Editor: tekst, naslovi, popisi, citat kao blok | Merlin (LTI) integracija | Nadzor računala, kamere, zaslona |
| Spremanje na uređaju i sinkronizacija | Više fakulteta | Biometrija tipkanja |
| Uvoz DOCX-a kao označen događaj | AI pomoćnik unutar pravila zadatka (uz zaseban Gate) | Automatske sankcije |
| Evidencija, predaja, potvrda | Napredna povijest pojedinog odlomka | Rangiranje studenata |
| Sažetak procesa i usporedba verzija (prema profilu) | Reprodukcija pisanja (uz zaseban Gate) | Treniranje modela na radovima |
| Pregled prije predaje, napomene | Obavijesti e-poštom, mobilna optimizacija | Pisanje nalik ispitu pod nadzorom |
| Komentar nastavnika, produljenje roka, izvoz DOCX | Izvoz PDF-a | |
| Čuvanje po klasi podataka, revizijski trag, brisanje lokalnog zapisa pri odjavi | Dnevni korijen potvrda s RFC 3161 žigom, alat za neovisnu provjeru izvezene evidencije | |

---

## 10. Pilot na FPZG-u [PRIJEDLOG D-03]

- 20 do 40 dobrovoljnih studenata, 2 do 4 nastavnika, 1 do 2 kolegija, 2 kraća pisana zadatka, 6 do 8 tjedana promatranja.
- Studenti koji ne sudjeluju imaju ravnopravnu alternativu.
- Ne na završnim i diplomskim radovima, ne na zadacima s osjetljivim podacima ispitanika.
- Faze: A tehnička proba sa sintetičkim radovima; B nastavna proba; C evaluacija (kratki razgovori, mjerenja).
- Nijedan tehnički pokazatelj sam ne dovodi do ocjene ni posljedice.

**Mjerila uspjeha:**

| Područje | Mjera | Prag |
| --- | --- | --- |
| Pouzdanost | Rekonstrukcija predanih radova | 100 %; svako odstupanje blokira izdanje |
| Pouzdanost | Izgubljen rad | 0 slučajeva |
| Sigurnost | Neovlašten pristup | 0 slučajeva |
| Korisnost | Vrijeme nastavnika za razumijevanje nastanka rada, u odnosu na sadašnji postupak | Definirati s nastavnicima prije pilota (GO uvjet) |
| Razumijevanje | Student točno odgovara tko što vidi | Definirati prije pilota (GO uvjet) |

Ankete i razgovori iz evaluacije pohranjuju se odvojeno od evidencije pisanja i ne povezuju se s njom (C-22).
| Pravednost | Slučajevi u kojima je legitiman način rada (lijepljenje vlastitog teksta, diktiranje, rad bez veze) izazvao neopravdanu sumnju | Svaki slučaj se analizira |

---

## 11. Kriterij prihvata prve verzije

Prvi demo prolazi cijeli put na sintetičkom radu s unaprijed poznatim ishodom:

1. Student se prijavi (AAI@EduHr Lab), uđe u kolegij kodom i otvori zadatak.
2. Napiše tekst, izbriše dio, zalijepi odlomak, uveze DOCX.
3. Radi bez veze, zatim se veza vrati; ništa se ne izgubi i offline rad ostaje označen.
4. Vidi pregled prije predaje, doda napomenu i preda rad.
5. Nastavnik vidi predaju i sažetak procesa; scenarij se prolazi u oba profila (Osnovni i Prošireni). U Osnovnom profilu nastavnik ne može dohvatiti usporedbu verzija ni sirove odsječke evidencije, ni izravnim pozivom poslužitelja.
6. Rekonstruirani dokument je identičan predanoj verziji u kanonskom obliku.
7. Kontrolirana praznina prikazuje se kao praznina, a stanje zapisa to kaže.
8. Tekst napisan i obrisan unutar iste sesije ne pojavljuje se ni u jednom nastavničkom prikazu.
9. Drugi student i nastavnik drugog kolegija ne mogu otvoriti ni rad ni evidenciju. Test gađa poslužitelj i bazu, ne samo sučelje.
10. Nakon odjave na istom pregledniku nema studentovog lokalnog zapisa; odjava s nesinkroniziranim promjenama je blokirana uz jasnu poruku.
