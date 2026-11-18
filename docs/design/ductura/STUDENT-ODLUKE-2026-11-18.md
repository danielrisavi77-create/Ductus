# Studentsko sučelje Ducture: odluke vlasnika po ekranima (18. 11. 2026.)

Ovaj dokument bilježi odluke koje je vlasnik donio 18. 11. 2026. za deset studentskih ekrana i prijavu. Odluke nemaju oznake `D-xxx`; upis u `docs/DECISIONS.md` i dodjelu oznaka radi orkestrator. Izvedbu planira orkestrator prema paketima A do D, koje mu vlasnik šalje zasebno; koordinacija je na issueu #2028.

- „IDE” uz naslov znači da ekran ulazi u opseg.
- Za ekran 6 vlasnik je izbor prepustio sesiji („odgovori kako je najbolje i najlogičnije”); odabrane su preporuke.
- Ništa se ne gradi na D-194 t. 6 i 7 (PRIJEDLOG): Izjava zato pokriva samo vanjske alate i ljudsku pomoć.
- Dva mjesta odstupaju od postojećih pravila i otvorena su za vlasnikovu odluku: vidi „Otvoreni neskladi” na kraju. Do te odluke vrijede `docs/PRODUCT.md` §5 pravilo 11, D-11 (potvrđeno D-81) i D-129.
- Prototip i kartice ekrana prijedlog su funkcija, ne izgleda; vizualni smjer ostaje „papir i grafit” (D-188).


## Prijava
Riješeno ranije: V1–V5 (Ductus#2031, komentar 6965273898).
- Codex P2 nalaz na ductura/web#45 (`src/client/api.ts` r. 144: returnTo s našim slovima nakon kodiranja može prijeći 512 znakova, server ga odbaci): popravlja orkestrator u svom gateu.

## 1. Početna i Moji zadaci — IDE
1. Početna nakon prijave: popis zadataka s karticom „Nastavi” na vrhu.
2. „Nastavi” kod više radova: zadnji pisani.
3. Oznaka blizine roka: 3 dana.
4. Nakon isteka roka: neutralno „Rok je prošao”, ostaje u popisu, bez crvene.
5. Predani zadaci: ostaju u popisu, s vremenom predaje, ispod otvorenih.
6. Zadatak s nepotvrđenom obavijesti: klik vodi prvo na obavijest, zatim u rad.
7. Polje za kod kolegija na početnoj: samo kad student nema kolegij; inače poveznica „Upiši kolegij”.
8. Seminarske grupe na kartici zadatka: ne.
Posljedica za server: popis zadataka mora vraćati stanje rada (nije u ugovoru) → zahtjev orkestratoru.

## 2. Moji kolegiji — IDE
1. Zaseban ekran, druga stavka navigacije.
2. Klik na kolegij otvara stranicu kolegija: nastavnik, grupa, svi zadaci kolegija (otvoreni i predani).
3. Kartica kolegija: naziv, akademska godina, nastavnik, grupa, broj otvorenih zadataka.
4. Jedan kolegij: isti popis s jednom karticom.
5. Kolegiji prošlih godina: odvojeno ispod, „Prošle godine”, sklopljeno.
6. Seminarsku grupu student vidi, ne mijenja je sam (mijenja nastavnik).
7. Student se ne može sam ispisati iz kolegija.
8. „Upiši kolegij”: gumb na vrhu ovog ekrana i poveznica na početnoj.
Posljedica za server: poziv za kolegije s godinom, nastavnikom i grupom (nije u ugovoru) → zahtjev orkestratoru.

## 3. Moji radovi — IDE
1. Zaseban ekran, arhiva svih radova svih godina.
2. U popisu samo radovi koje je student otvorio (započeti i predani).
3. Tri stanja na retku: „Započet”, „Predano <datum> u <vrijeme>”, „Rok je prošao”.
4. Redoslijed: zadnje mijenjani gore.
5. Filtar po godini ostaje; pretraživanje ne.
6. Klik na predani rad otvara potvrdu o predaji, s poveznicom na rad samo za čitanje.
7. Predani rad se s ovog ekrana ne mijenja i ne povlači.
8. Preuzimanje datoteke nije ovdje; na Potvrdi je.
Posljedica za server: poziv za radove sa stanjem i vremenom predaje kroz sve godine → zahtjev orkestratoru.

## 4. Upis u kolegij — IDE
1. Kod ima 8 do 32 znaka; ugovor (danas do 64) se usklađuje s tekstom.
2. Razmaci, crtice, velika i mala slova nisu važni; kod se može zalijepiti.
3. Poveznica s kodom otvara ekran s upisanim kodom; upis nikad bez klika.
4. Korak potvrde prije upisa: naziv kolegija i nastavnik, gumb „Upiši me”.
5. Jedna poruka za neispravan, istekao i nepostojeći kod: „Kod nije valjan. Provjerite ga kod nastavnika.”
6. Već upisan: mirna poruka „Već ste upisani” i gumb „Otvori kolegij”.
7. Previše pokušaja: čekanje, poruka kaže koliko; granicu određuje server.
8. Nakon uspjeha: jedan otvoreni zadatak → njegova obavijest; inače stranica kolegija.
9. Bez mreže: kod ostaje upisan, „Nema veze. Pokušajte ponovno.” i gumb za novi pokušaj.
Posljedica za server: nova ruta koja za kod vraća naziv kolegija i nastavnika prije upisa, s istim ograničenjem pokušaja kao upis.

## 5. Obavijest o zadatku — IDE
1. Redoslijed: zadatak (kolegij, naslov, rok, opis) → pravila za alate → što se bilježi / ne bilježi / što vidi nastavnik → potvrda.
2. Jedna kućica „Pročitao/la sam obavijest” i gumb „Potvrdi i otvori editor”, koji radi tek nakon oznake.
3. Nema prisilnog pomicanja do dna.
4. Rečenica „Ductura ne procjenjuje autorstvo ni korištenje AI-ja” stoji vidljivo u dijelu o bilježenju.
5. Pravilo fakulteta (FPZG čl. 8.): sažetak na ekranu, puni tekst na klik.
6. Promijenjen tekst nakon potvrde: student vidi što je promijenjeno i potvrđuje ponovno; do tada ne može pisati, rad ostaje netaknut.
7. Nakon potvrde ekran je dostupan iz uređivača kao „Upute”, s vremenom potvrde i gumbom „Otvori rad”.
8. Bez potvrde nema pisanja; ekran mirno kaže kome se obratiti (nastavnik); nema oznake na računu.
9. Rok prošao, obavijest nepotvrđena: potvrda je i dalje moguća; o zakašnjeloj predaji odlučuje nastavnik. (Veže se na paket D: zakašnjela predaja.)
10. Zadatak još nije otvoren: naslov i datum otvaranja, bez sadržaja i potvrde.

## 6. Uređivač — IDE (Daniel: „odgovori kako je najbolje i najlogičnije”; odabrane preporuke)
1. Gornja traka: naslov zadatka, kolegij, rok, stanje pohrane.
2. Broj riječi stalno vidljiv uz dopušteni raspon.
3. Izvan raspona: mirno upozorenje, predaja moguća, nastavnik vidi broj.
4. „Predaj” uvijek vidljiv u traci, vodi na Izjavu.
5. Prazan rad: „Predaj” isključen uz objašnjenje.
6. Bez mreže: pisanje se nastavlja; „Spremljeno na ovom uređaju, čeka vezu”; „Predaj” isključen dok se sve ne uskladi.
7. Bočni panel „Rad” (S-15): da, sklopiv; uskladiti s panelima orkestratora.
8. List je uvijek papir (D-188); prekidača svijetlo/tamno nema.
9. Nakon roka, nepredano: pisanje i predaja mogući, oznaka „Rok je prošao”, odlučuje nastavnik.
10. Nakon predaje: samo čitanje, poveznica na potvrdu predaje.
11. Isti rad na drugom uređaju ili kartici: drugi je samo za čitanje, poruka gdje je rad otvoren.
12. Izlaz: poveznica „Moji zadaci”; bez pitanja kad je sve spremljeno.

## 7. Izjava — IDE (paket D, 1/4)
1. Opseg sada: samo vanjski alati i ljudska pomoć; prikaz prijenosa iz Ducturina AI pomoćnika čeka D-194 (t. 6 i 7 PRIJEDLOG). Ne graditi na D-194.
2. Vlasnikova odluka: obvezna za svaku predaju; ispuniti ili „Nisam koristio/la vanjske alate”. Ne gradi se kao blokada predaje: D-129 dopušta da nepotvrđena izjava blokira predaju samo kao postavka zadatka, nakon pisane potvrde FPZG-a i upisa C-42. Do tada je Izjava korak koji student vidi i može ispuniti, a predaja prolazi i bez nje (otvoreni nesklad N-2).
3. Oblik: kratki izbori (alat, svrha, faza rada) uz slobodnu napomenu.
4. Ljudska pomoć (lektor, kolega, mentor) zasebno pitanje.
5. Pravila zadatka (dopušteni alati iz Obavijesti) stoje iznad forme.
6. Prilaganje razgovora: u prvoj verziji samo zalijepljeni tekst ili poveznica, po želji; bez datoteka (Q-16).
7. Ductura ne uspoređuje izjavu i zapis i ništa ne označava; nastavnik ih vidi jedno uz drugo.
8. Nacrt izjave čuva se dok se student vraća u uređivač.
9. Nakon predaje izjava je zaključana; student može samo dodati napomenu.
10. Kućica „Potvrđujem da je izjava točna” uz izjavu; dok vrijedi N-2, neoznačena kućica ne sprječava predaju.

## 8. Prije predaje — IDE (paket D, 2/4; sve po preporuci)
1. Svaki korak predaje je svoj zaslon, s oznakom „Korak n od 4”.
2. Student vidi isti sažetak procesa koji vidi nastavnik.
3. Popis provjera samo obavještava; ništa s tog popisa ne blokira.
4. Blokade predaje: (a) promjene na uređaju koje poslužitelj nema, uz gumb „Provjeri ponovno”; (b) predani dokument koji se ne može točno rekonstruirati iz zapisa (`docs/PRODUCT.md` §5 pravilo 11; D-11, potvrđeno D-81), što poslužitelj provjerava pri predaji. Praznina u zapisu nije nepodudarna rekonstrukcija i ne blokira. Vlasnikova odluka glasila je „jedina blokada” i odnosila se na (a); (b) je postojeće pravilo koje ova odluka ne mijenja (otvoreni nesklad N-1).
5. Mjesta bez izvora: klik otvara mjesto u uređivaču, povratak na isti korak.
6. Zalijepljeni tekst dulji od 200 znakova: oznaka porijekla po želji.
7. Vrijeme aktivnog uređivanja prikazano uz rečenicu da nije mjera truda.
8. Praznine u zapisu: mirno objašnjenje i mogućnost napomene; bez crvene.
9. Napomena studenta: po želji, samo dodavanje, nastavnik je vidi.
10. Karta porijekla teksta: kasnije, ne u prvoj verziji.

## 9. Predaja — IDE (paket D, 3/4; sve po preporuci)
1. Na zaslonu: rok, broj riječi, sažetak izjave.
2. Završni dijalog (Z-08) kaže da se tekst nakon predaje ne može mijenjati.
3. Vrijeme predaje je trenutak kad zahtjev stigne na poslužitelj; to piše studentu.
4. Nakon roka predaja je moguća, s oznakom „Predano nakon roka”; odlučuje nastavnik.
5. Produljen rok: student vidi svoj rok s naznakom da je produljen.
6. Bez mreže: gumb isključen; predaja se nikad ne šalje sama.
7. Ishod nepoznat: „Provjeri stanje predaje”; nova predaja nije moguća dok se ishod ne sazna.
8. Student ne može povući ni ponovno predati; rad vraća samo nastavnik.
9. Izjava i predaja zapisuju se zajedno u jednom pozivu (zahtjev za server). Vlasnikova odluka „nema predaje bez izjave” ne gradi se prije uvjeta iz D-129; do tada poziv prihvaća predaju i bez izjave (otvoreni nesklad N-2).
10. Zamjenski postupak: mirna poruka i komu se obratiti; tekst je prijedlog do odgovora FPZG-a (Q-3).

## 10. Potvrda — IDE (paket D, 4/4; sve po preporuci)
1. Zasebna stranica s vlastitom adresom, dostupna i iz „Mojih radova”.
2. Vrijeme predaje i rok po zagrebačkom vremenu, otisak teksta, „Predano nakon roka” kad vrijedi.
3. Otisak: jedna rečenica objašnjenja i „Kopiraj otisak”.
4. Svjetsko vrijeme i verzija na klik.
5. Čeka potpis: potvrda odmah, oznaka „Potvrda se potpisuje”; predaja je već valjana.
6. Praznine u zapisu: mirna napomena, bez crvene i bez ocjene.
7. Javna provjera bez prijave u prvoj verziji: samo vrijedi li potvrda i vrijeme, bez imena i teksta; sigurnosni pregled prije puštanja.
8. PDF s QR kodom kasnije.
9. Poveznice na rad samo za čitanje i na sažetak procesa.
10. Potvrda e-poštom ne u prvoj verziji.

## Otvoreni neskladi (za vlasnikovu odluku)

Nalazi neovisnog reviewa na #2035 od 18. 11. 2026. Dokument ih ne rješava; do vlasnikove odluke vrijedi postojeće pravilo.

- **N-1, ekran 8 t. 4.** Odluka „jedina blokada: promjene na uređaju koje poslužitelj nema” uža je od `docs/PRODUCT.md` §5 pravila 11 i D-11 (potvrđeno D-81), prema kojima predaju blokira i nepodudarna rekonstrukcija. Vrijedi pravilo 11: obje blokade ostaju, a praznina u zapisu ne blokira. Pitanje vlasniku: potvrđuje li da je odluka značila samo popis provjera na ekranu.
- **N-2, ekran 7 t. 2 i 10, ekran 9 t. 9.** Odluka „izjava je obvezna za svaku predaju; nema predaje bez izjave” proturječi D-129: nepotvrđena izjava smije blokirati predaju samo kao postavka zadatka navedena u obavijesti, i tek nakon pisane potvrde FPZG-a i upisa C-42; demo ostaje bez te blokade, a tehnička greška ne smije spriječiti predaju. Vrijedi D-129: Izjava se gradi kao korak bez blokade. Pitanje vlasniku: ostaje li pri D-129 ili donosi novu odluku.
