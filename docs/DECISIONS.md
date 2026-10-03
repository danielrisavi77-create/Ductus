# Ductus: registar odluka

Verzija 0.2 · 3. 10. 2026. · Odgovorna osoba za sve odluke: Daniel Rišavi (Ustav C-52)

Svaka odluka ima broj, status, sadržaj i razlog. Status je jedan od: **ODLUČENO**, **PRIJEDLOG** (čeka potvrdu), **ČEKA FPZG** (traži vanjsku potvrdu), **ODGOĐENO**. Odluka se mijenja samo novim unosom koji navodi koju odluku zamjenjuje; stari unos ostaje.

Napomena: ova numeracija vrijedi od verzije 0.2 i ne odgovara brojevima iz ranijeg dokumenta "Pisač: smjer, arhitektura i timske prezentacije".

## Odlučeno (3. 10. 2026.)

| Broj | Odluka | Razlog |
| --- | --- | --- |
| D-01 | Obećanje: "Ductus pokazuje kako je rad nastao. Zaključak donosi čovjek." Ductus nikad ne tvrdi tko je napisao rad ni je li AI korišten nedopušteno | Tvrdnja o autorstvu nije tehnički pouzdana (prepisivanje s drugog uređaja) i mogla bi optužiti nevinog studenta; Ustav C-9, C-10 |
| D-02 | Kupac je fakultet; korisnici su student, nastavnik i mentor; student ima vlastitu korist. Interno pozicioniranje "anti-AI", javno "transparentnost nastanka rada" | Fakultet plaća i propisuje; bez studentske koristi studenti pišu drugdje |
| D-03 | Podržane su sve vrste pisanih radova: podnesak (300 do 1.500 riječi), esej, seminarski, završni, diplomski, specijalistički, doktorski. Ne pisanje nalik ispitu pod nadzorom | Cilj je jedno okruženje za sve radove; ispitni nadzor je visokorizičan po Aktu o UI |
| D-04 | Fakultet odobrava i može propisati obvezno korištenje; u pilotu to odlučuje FPZG | |
| D-05 | Nastavnik bira profil evidencije (Osnovni ili Prošireni); ~~reprodukcija pisanja ne postoji~~ **reprodukcija: vidi D-56** | C-14, C-19 |
| D-06 | Nastavnik i mentor vide spremljeno stanje rada od prvog dana, osvježeno svakih nekoliko minuta; ne vide tipkanje uživo | Praćenje nastanka rada; tipkanje uživo bi djelovalo kao nadzor |
| D-09 | Studenti se prijavljuju isključivo AAI@EduHr računom | Kompatibilnost sa Srceovim sustavom; jedan pouzdan identitet |
| D-12 | Povlačenje studenta: predani radovi ostaju po pravilima fakulteta, sve ostalo se briše | |
| D-13 | Pilot je besplatan; kupac nakon pilota je fakultet | |
| D-14 | Kontakt na FPZG-u: prodekan Višeslav Raos | |
| D-15 | Pilot samo na FPZG-u | |
| D-17 | Novi privatni repo `Ductus`; iz `pisac-editor` prenosi se dokazana jezgra s testovima | Čuva oko 450 testova sinkronizacije i spremanja |
| D-18 | `Ductus` je ime repoa i radno ime; konačno ime proizvoda bira se posebno (slobodne domene, čist žig) | `ductus.com` i `ductus.app` zauzeti; postoji švedska IT tvrtka Ductus |
| D-19 | Nema osobnog prostora: student piše samo u radovima zadataka | Uklanja rizik da privatno pisanje postane evidencija (C-17, C-18) |
| D-21 | Nastavnik i mentor mijenjaju tekst kao prijedloge ili izravno; način dogovaraju nastavnik i student, postavka je vidljiva na radu; svaka izmjena pripisana je autoru | Suradnja bez gubitka razlike tko je što napisao |
| D-22 | ~~Za AI nastavnik vidi vrijeme, pružatelja, model i tekst prenesen u rad (s mjestom u radu); upite i razgovore samo ako je najavljeno u zadatku~~ **Zamijenjeno s D-41** | Privatnost studentovih upita (Vision §18) |
| D-23 | Dopuštene AI pružatelje i modele određuje fakultet | Prijenos podataka izvan EU-a i pravila fakulteta |
| D-25 | Pravila fakulteta, oblik rada, citiranje, bibliografija i naslovna stranica dolaze iz zajedničkog paketa s Lektom | Jedan izvor pravila za oba proizvoda |
| D-26 | U pilot ulazi sve iz `PRODUCT.md`; pilot počinje u ljetnom semestru 2026./2027. | |
| D-27 | Sučelje na hrvatskom u pilotu, engleski kasnije; tekstovi odvojeni od koda od prvog dana | |
| D-28 | Zadatak može imati cikluse: nacrt, komentar, nova verzija, konačna predaja | |
| D-32 | Student dobiva sve funkcije pisanja iz `PRODUCT.md` §10, uključujući citiranje i bibliografiju | Bez toga studenti pišu u Wordu i lijepe tekst |
| D-33 | Mentorstvo završnih i viših radova je u prvoj verziji | |

## Odlučeno (3. 10. 2026.): dodaci iz analize konkurencije

Izvor: dokument "Ductus: konkurencija i poboljšanja proizvoda" i FPZG Smjernice za uporabu GenUI od 21. 5. 2026. (KLASA 007-04/26-02/03).

| Broj | Odluka | Razlog | Val |
| --- | --- | --- | --- |
| D-40 | Pri slanju verzije i predaji Ductus slaže izjavu o GenUI po FPZG čl. 9 i 15: alat, pružatelj i model, svrha, faza rada, ispis razgovora; oba obrasca (koristio, nisam koristio). Student je pregleda, dopuni i potvrdi; nastavnik može uključiti pitanje za refleksiju | Obveza na FPZG-u; student ne prepisuje ručno ono što sustav već zna | 1 bez AI dijela, 2 s AI dijelom |
| D-41 | Zamjenjuje D-22. Za AI nastavnik vidi vrijeme, pružatelja, model, svrhu i tekst prenesen u rad (s mjestom u radu). Tijekom pisanja razgovori su samo studentovi. Uz izjavu (D-40) automatski idu razgovori iz kojih je tekst prenesen u rad; student vidi točno što se prilaže i može dodati ostale razgovore te vanjske razgovore, označene kao izjavljeno | FPZG čl. 9 traži ispis razgovora; privatnost tijekom pisanja ostaje | 2 |
| D-42 | Akcije AI pomoćnika grupirane su po svrsi iz FPZG čl. 8: lektura, prijevod, traženje literature, formatiranje, objašnjenje pojma. Nastavnik uključuje svrhe po zadatku; svrha i faza rada bilježe se uz svaki prijenos | Svrha i faza za izjavu nastaju same, bez pitanja studentu | 2 |
| D-43 | Za lijepljenje iznad P-02 student može odabrati oznaku: vlastite bilješke, citat iz izvora, prijašnja verzija, vanjski AI, drugo. Neobavezno, nikad ne blokira pisanje; prikazuje se kao izjavljeno | Kontekst nastaje u trenutku, ne naknadno (Rumi, Kritik, Signet) | 1 |
| D-44 | Svaka stavka sažetka procesa označena je vrstom dokaza: opaženo (u Ductusu), uvezeno (iz datoteke) ili izjavljeno (student) | Izjava se ne smije čitati kao opažanje ni obrnuto (Signet) | 1 |
| D-45 | Komentar može biti zahtjev za doradu sa stanjem: otvoren, student navodi da je proveden, nastavnik prihvatio, ponovno otvoren. Izmjena povezanog odlomka nakon prihvaćanja označava se "promijenjeno nakon prihvaćanja". Student smije obrazloženo ne pristati | Nastavnik vidi što je točno promijenjeno; kasnija izmjena ne ostaje skrivena iza kvačice | 2 |
| D-46 | Prije primjene AI lekture ili prijevoda Ductus uspoređuje brojke, doslovne citate i oznake izvora te prikazuje razlike; student potvrđuje primjenu | Lektura je dopuštena (čl. 8), ali ne smije neprimjetno promijeniti sadržaj | 2 |
| D-47 | Mentor bilježi konzultaciju (datum, tema, dogovoreno) vezanu uz verziju rada; student vidi isti zapis | FPZG čl. 10: sustavno mentoriranje i dokumentiranje | 2 |
| D-48 | Za stavke bibliografije s DOI-jem ili URL-om Ductus javlja "pronađeno" ili "nije pronađeno" (Crossref, dohvat URL-a). Bez suda o studentu i bez provjere sadržaja izvora | FPZG čl. 8 zabranjuje izmišljene izvore; student dobiva rano upozorenje | 2 |
| D-49 | Student može izvesti prenosiv zapis: PDF sa sažetkom procesa, izjavom i QR kodom; potpis se provjerava u pregledniku bez računa | Dokaz koji student nosi izvan sustava (Signet) | 2 |
| D-50 | Student može na radu označiti odobrenu prilagodbu (FPZG čl. 1), npr. diktiranje ili asistivni alat; nastavnik vidi oznaku, ne razlog | Legitiman način rada ne smije izgledati neobično | 1 |
| D-51 | Nastavnik ili mentor može komentare objaviti zajedno umjesto svakog odmah | Mentor piše više komentara pa ih objavi kao cjelinu (Rumi) | 2 |
| D-53 | Priprema za razgovor: Ductus deterministički izlistava mjesta u tekstu povezana s lijepljenjima, uvozima, AI prijenosima i izmjenama nakon prihvaćene dorade, uz studentove izjave i poveznicu na mjesto u radu. Nakon razgovora samo zapis "razgovor održan", bez polja za ocjenu. Student vidi isti popis | Razgovor o radu jedini se ne može krivotvoriti (FPZG čl. 10 i 11); Ductus ga čini kratkim i ciljanim, bez AI analize (pravilo 13) | 2 |
| D-54 | Spike u M3: unos koji ne dolazi od stvarnog korisničkog događaja (programski umetnut tekst, npr. proširenja koja "tipkaju") bilježi se kao zaseban događaj "unos nije s tipkovnice ni lijepljenjem". Označava se, ne blokira (asistivni alati, D-50). Konačno ponašanje nakon testa na stvarnim alatima | Zatvara najjeftiniji put krivotvorenja | 1 (spike) |
| D-56 | Reprodukcija pisanja s ritmom u mentorskim radovima (završni, diplomski, specijalistički, doktorski). Mentor i student vide istu reprodukciju, uključujući sadržaj obrisanog teksta. Najavljena u obavijesti prije pisanja, nikad unatrag (pravilo 14), nikad za kratke zadatke (D-37). Uvjeti: (1) bilježi se samo vrijeme promjene dokumenta u koracima od 100 ms; ne bilježi se koja je tipka pritisnuta ni koliko je držana; (2) iz vremena se nikad ne računa brzina, pauze, obrasci ni bilo kakva mjera; ritam postoji samo kao brzina reprodukcije; (3) vrijeme je u zasebnoj klasi podataka s kraćim rokom čuvanja, vezano uz odsječak hashom, pa se briše po roku bez rušenja lanca; (4) student vidi kad je mentor gledao reprodukciju i može dodati napomenu uz trenutak reprodukcije; (5) uz oznaku prilagodbe (D-50) reprodukcija prikazuje tu oznaku; (6) uz reprodukciju postoji povijest odlomka: prethodne verzije odlomka, čime su zamijenjene i podrijetlo. **Traži izmjenu Ustava C-14 i C-19 (Constitution Gate) prije gradnje** | Mentorski alat za razumijevanje nastanka rada i pripremu razgovora; ne dokazuje autorstvo (D-01) | 3 |
| D-57 | Karta podrijetla u tekstu: mentor, nastavnik i student mogu uključiti oznake na mjestima lijepljenja, uvoza, AI prijenosa i izmjena nastavnika. Tekst napisan u Ductusu ostaje neoznačen. Nema zbroja, udjela ni postotka | Mentor zna gdje pitati (D-53); lokacija umjesto udjela (pravilo 2) | 2 |
| D-58 | Poznato podrijetlo: tekst kopiran iz AI odgovora ili bilježnice izvora unutar Ductusa nosi podrijetlo pri lijepljenju ("iz AI pomoćnika", "iz izvora X"). Tekst koji se u 8 ili više uzastopnih riječi podudara s odgovorom AI pomoćnika bilježi se kao "podudara se s odgovorom AI pomoćnika", a razgovor ide uz izjavu (D-41). Citati i navodi su izuzeti. Ne odnosi se na vanjski AI i to piše uz oznaku | Zatvara prepisivanje vlastitog AI odgovora; deterministička usporedba s poznatim tekstom, ne AI analiza (pravilo 13) | 2 |
| D-59 | Bilježnica izvora: izvori s bilješkama, "Citiraj" sa stranicom, "Kopiraj navod" s poznatim podrijetlom; uvoz iz Zotera (BibTeX, RIS, CSL-JSON) umjesto vlastitog upravitelja literaturom | Bez nje student drži izvore u Wordu i lijepi | 1 osnovno, 2 uvoz |
| D-60 | Struktura s opsegom po poglavlju iz Lekta profila ili od mentora, s trakom napretka po poglavlju | Planiranje rada; malo posla | 1 |
| D-52 | Nastavnik upisuje pravilo AI-ja iz izvedbenog plana na razinu kolegija (zabrana, djelomično dopušteno, poticanje; FPZG čl. 12); zadatak ga nasljeđuje i smije ga samo suziti | Pravilo se piše jednom i odgovara izvedbenom planu | 1 |

## Prijedlozi koji čekaju potvrdu

| Broj | Odluka | Prijedlog |
| --- | --- | --- |
| D-07 | Ovlasti | Članstvo i RLS u Postgresu, pgTAP matrica pristupa; bez OpenFGA servisa |
| D-08 | Stack | Next.js, Tiptap, Dexie, Supabase, Netlify (sadržaj se ne obrađuje izvan EU-a) |
| D-10 | Integritet zapisa | JCS odsječci adresirani hashom, hash lanac, Ed25519 potvrde s rotacijom ključeva; dnevni korijen s RFC 3161 žigom nakon pilota |
| D-11 | Predaja i praznine | Nepodudarna rekonstrukcija blokira predaju; praznina ne blokira, ali je vidljiva |
| D-16 | Prijava nastavnika, mentora i administratora | Također isključivo AAI@EduHr |
| D-20 | Prijava u AI | OpenRouter (OAuth s PKCE-om), student plaća svoj račun; kasnije "Sign in with ChatGPT" ako Ductus postane partner. Pretplate na Claude ne mogu se koristiti u aplikacijama trećih strana |
| D-24 | Granularnost evidencije | Odsječci od najviše 30 s, vrijeme zaokruženo na minutu |
| D-34 | Tehnička izvedba izravnih izmjena | Izravna izmjena je prijedlog koji studentov klijent automatski primjenjuje; dokument uvijek ima jednog pisača; student može vratiti način na prijedloge |
| D-37 | Kratki zadaci | Za zadatke kraće od praga P-04 nastavnik vidi stanje tek nakon predaje, ne tijekom pisanja |
| D-38 | Obvezni AI u pilotu | Zadatak u pilotu ne smije zahtijevati korištenje AI-a (student bi morao plaćati vanjski račun) |
| D-39 | Stroža varijanta D-06 (za tvoju odluku) | Nastavnik vidi samo stanje na kraju svake sesije, ne osvježavanje svakih nekoliko minuta; manje osjećaja nadzora, manje uvida |
| D-36 | Valovi puštanja unutar pilota | Val 1 podnesci i eseji na početku semestra; val 2 seminarski radovi oko 4 tjedna kasnije; val 3 završni i viši radovi u drugoj polovini semestra (`PROGRAM.md`) |

## Čeka pravno mišljenje

| Broj | Odluka | Prijedlog |
| --- | --- | --- |
| D-55 | Kontrolna točka uživo | Kratko pisanje u Ductusu na fakultetu (npr. 20 minuta: plan rada ili refleksija o vlastitom radu); nastavnik ljudski uspoređuje, Ductus ništa ne analizira. Do mišljenja ostaje isključeno (D-03). Pitanje za pravnika: primjenjuje se li Prilog III. točka 3(d) Akta o UI na sustav bez AI-ja i je li obrada razmjerna po GDPR-u. Isto mišljenje pokriva bilježenje ritma iz D-56 (je li biometrijski podatak po čl. 4(14) GDPR-a i kako ga obraditi u DPIA-i) |

## Čeka FPZG

| Broj | Odluka | Prijedlog |
| --- | --- | --- |
| D-29 | Pravna osnova i uloge | FPZG voditelj obrade, Ductus izvršitelj (čl. 28 GDPR-a); DPIA prije stvarnih podataka; privola nije osnova |
| D-30 | Rokovi čuvanja | Ductus predlaže rokove po klasi podataka, FPZG potvrđuje |
| D-31 | GO uvjeti za stvarne studente | Uvjeti iz `PROGRAM.md` |
| D-35 | Dopušteni AI pružatelji za pilot | FPZG bira s popisa; uz svakog pružatelja zemlja obrade |

## Zadane vrijednosti pragova

Pragovi su postavke fakulteta (C-7, C-55); uvijek se prikazuju uz brojku na koju utječu.

| Broj | Prag | Zadana vrijednost | Gdje se koristi |
| --- | --- | --- | --- |
| P-01 | Prekid koji završava sesiju | 30 minuta bez promjene | Sažetak procesa |
| P-02 | Lijepljenje koje se prikazuje kao zaseban događaj | Više od 200 znakova | Sažetak procesa |
| P-03 | Osvježavanje nastavničkog pogleda | Najviše svakih 5 minuta | Pogled na rad u nastajanju |
| P-04 | Granica kratkog zadatka (D-37) | Rok kraći od 24 sata | Vidljivost tijekom pisanja |
| P-05 | Lijepljenje za koje se nudi oznaka (D-43) | Isto kao P-02 | Pisanje |
