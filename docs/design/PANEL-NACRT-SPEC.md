# Ductus: specifikacija panela Nacrt (S-14)

Verzija 0.1 · 31. 10. 2026. · Product/UX analiza i specifikacija. Nije odluka i ne mijenja `docs/DECISIONS.md`.

**Status:** jedina odluka je vlasnikova: panel Nacrt **ulazi u program**, treba specifikaciju i smještaj u fazu (31. 10. 2026., točka 5, #87 [c.6543799262](https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6543799262)). Sve ostalo u ovom dokumentu je **PRIJEDLOG** i označeno je tako; ništa se ne gradi na PRIJEDLOGU čija bi promjena bila skupa (osobito pohrana plana, vidljivost mentoru i naziv, §9). Bez koda; za kod vrijedi Ustav i `docs/PRODUCT.md` §5.

Izvori: `docs/design/ductura/README.md` §5.1 (kartice desnog panela), prototip `docs/design/ductura/editor-v11.dc.html` (kartica `na`), `docs/design/ductura/PROVJERE.md` §6 i `INTEGRACIJA.md`, `docs/PROGRAM-RAZRADA.md` na grani PR-a #1009 (M5, otvoreno pitanje 5), `docs/PRODUCT.md` §5 i §6, odluke D-28, D-41, D-60, D-64, D-77, D-80, D-117, D-123, D-130, D-142, D-143, D-183, D-188 (#972, otvoren).

## 1. Što je panel Nacrt

Kartica **Nacrt** u desnom panelu editora (ekran S-10), uz Asistent, Literaturu, Upute, Komentare i Rad. Pomaže studentu da vidi **strukturu vlastitog argumenta** dok piše. Prototip ima tri prikaza (segmentirani prekidač):

| Prikaz | Što prikazuje | Odakle dolazi |
| --- | --- | --- |
| **Obrnuti nacrt** | Po poglavlju (naslov s brojem) prva rečenica svakog odlomka, numerirana (¶1, ¶2 …). Napomena kad prva rečenica ima više od 35 riječi: „glavna misao se gubi”. Klik vodi na odlomak. Poglavlje bez odlomaka: „još nema odlomaka”. | Izvedeno iz dokumenta. |
| **Nit** (argumenta) | „Pitanje rada” (teza), ispod nje poglavlja s upisanom **svrhom** svakog poglavlja (bez zaključka i literature), kvačica/prazan krug uz svrhu, „Svrha nije zapisana · zapiši”. Na dnu „Odgovara li zaključak na pitanje”: pojmovi iz pitanja koje zaključak „spominje” i „ne spominje”, „Otvori zaključak”; ako zaključka nema: „Zaključak još nije napisan.” | Pitanje i svrhe upisuje student; usporedba je izvedena. |
| **Pojmovnik** | Pojam, definicija, zabranjene istoznačnice („ne: leksik”), broj uporaba, „Definirano u 2.1”, „Gdje se koristi ›” (kruži kroz mjesta), „N mjesta za provjeru”; „+ Novi pojam”; „Često u tekstu” (riječi s 3 ili više pojavljivanja koje nisu u pojmovniku); popis **kratica** s razrješenjem. | Pojmove upisuje student; brojke su izvedene. |

Povezani, ali izvan kartice: prekidač „Samo naslovi” (≡) u traci alata pokazuje svrhe poglavlja uz naslove, a svrhu se uređuje i u lijevoj strukturi; podcrtavanje pojmova u tekstu (pojam prije definicije, istoznačnica) radi editor. Panel je **alat za pisanje studenta**; u prototipu ga nastavnički pregled radova nema.

## 2. Korisnici i tokovi

**Student (primarni).**
1. Piše uvod i zapisuje pitanje rada (Nit) → bira naslov poglavlja i upisuje jednu rečenicu svrhe → panel pokazuje poglavlja bez svrhe kao otvorena, ne kao grešku.
2. Pri doradi otvara Obrnuti nacrt i čita samo prve rečenice: ako se čitaju kao argument, struktura je dobra; klik vodi na odlomak koji treba preurediti.
3. Pri pisanju zaključka otvara Nit i vidi koji pojmovi iz pitanja u zaključku još nisu spomenuti; ne mora ih spomenuti.
4. Definira pojam jednom u Pojmovniku, „Gdje se koristi ›” vodi kroz mjesta; usklađuje naziv.
5. Prije predaje (S5) ništa iz panela ne blokira predaju (D-61, D-62, pravilo 11).

**Mentor / nastavnik.** Ne koristi panel i ne dobiva izvedene nalaze iz njega. Moguće je (PRIJEDLOG, pitanje 2) da u pregledu rada vidi studentovo pitanje rada i svrhe poglavlja kao kontekst; to bi bila prezentacija studentova unosa, ne mjera.

**Koordinator, administrator, povjerenstvo.** Bez dodira.

## 3. Stanja (svako mora imati definiran prikaz)

| Stanje | Očekivano ponašanje |
| --- | --- |
| Rad bez naslova / bez odlomaka | Nacrt: „Naslovi se pojavljuju ovdje kad ih dodaš.” Bez praznog bijelog panela. |
| Pitanje rada nije upisano | „Pitanje još nije zapisano.” + radnja „Zapiši”. Provjera zaključka se ne prikazuje. |
| Svrha poglavlja nije upisana | Prazan krug + „zapiši”; nije greška i ne broji se kao propust. |
| Zaključka nema | „Zaključak još nije napisan.” bez ocjene. |
| Pojam bez definicije u tekstu | „U tekstu još bez definicije”; nema crvene boje. |
| Veliki rad (do 15.000 riječi, kasnije 80.000) | Računa se po poglavlju, s odgodom ~400 ms, u pozadinskoj niti (`PROVJERE.md` §5); tipkanje se ne koči. |
| Predano / zamrznuto | Pregled ostaje čitljiv; uređivanje pitanja, svrha i pojmovnika (PRIJEDLOG, pitanje 6). |
| Oporavak (`RECOVERY_REQUIRED`), blokirani zapis | Kao i editor: samo čitanje; uređivanje plana isključeno uz isti razlog kao u traci stanja. |
| Bez mreže | Panel radi lokalno; plan se sprema istim ciklusom kao dokument i nosi stanje spremanja. |
| Druga kartica / zastarjela kartica | Plan prati isto pravilo zastarjele kartice kao dokument; nema tihog prepisivanja. |
| „Kako vidi nastavnik” (S-17) | Panel nije dio prikaza; nikakav izračun iz panela ne ulazi u taj prikaz. |
| Ekran ispod 1000 px | Panel se otvara gumbom ▥ preko teksta (README §5.1); fokus se vraća na gumb pri zatvaranju. |

## 4. Podaci

| Podatak | Vrsta | Tko piše | Tko vidi | Napomena |
| --- | --- | --- | --- | --- |
| Pitanje rada (teza) | upis studenta | student | student; mentor PRIJEDLOG (pitanje 2) | `PROVJERE.md` §6 već navodi „plan (… teza)” po radu. |
| Svrha poglavlja | upis studenta, po `hid` naslova | student | kao gore | Veže se uz **stabilan id bloka** (F-044, #176), ne uz tekst naslova. |
| Pojmovnik: pojam, definicija, istoznačnice | upis studenta | student | „kao rad” (`INTEGRACIJA.md` §6c) | `INTEGRACIJA.md` navodi `{ term, variants[] }`, prototip nosi i `def`: uskladiti (pitanje 7). |
| Obrnuti nacrt, brojke uporaba, „spominje / ne spominje”, kratice, „često u tekstu” | **izvedeno** | nitko | student | Ne sprema se (PRIJEDLOG): računa se iz dokumenta i plana; ne ulazi u sažetak nalaza (`PROVJERE.md` §6), sažetak procesa, izvoz ni predaju. |

Pohrana plana je novi zapis uz rad: nova tablica s RLS-om i retkom u pgTAP matrici pristupa, pisanje samo kroz RPC, brisanje s radom (kao D-130). Plan **nije** promjena dokumenta: ne ulazi u evidenciju, prikaz uživo (D-142) ni reprodukciju (D-143); to treba zapisati u ugovoru zadatka (PRIJEDLOG, pitanje 1).

## 5. Ograničenja iz postojećih odluka

- **PRODUCT §5 pravila 1, 2, 3, 13.** Panel ne tvrdi ništa o autoru ni o AI-ju, nema ocjene, postotka ni oznake rizika; izračuni su deterministični, ne AI analiza. „Ne spominje” je podatak o tekstu, ne o osobi. Prazno je prazno, ne krivnja.
- **Rječnik zabranjenih izraza** (PRODUCT §5) vrijedi za svaki tekst panela, poruke i `aria-label`. Provjera obuhvaća i tekstove izvan JSX-a (M0.4).
- **Pravilo 5 i D-130.** Panel ne prikazuje studentu ništa što je mentorov radni zapis; mentor iz panela ne dobiva ništa što student ne vidi.
- **Pravilo 12 i D-117 (Lekta).** Pragovi pravila pisanja (prototipov prag od 35 riječi u prvoj rečenici, prepoznavanje „zaključka” po naslovu) ne smiju biti tvrdo u kodu; dolaze iz paketa pravila (M4) ili se ne prikazuju. Do M4 panel nema pragova (PRIJEDLOG, pitanje 4).
- **AI (D-41, D-64, D-77, D-80, pravilo 13).** Panel nema AI funkcije. Prijedlozi tipa „restrukturiranje” i „predloži svrhu poglavlja” su svrhe razine 2 iz D-64, pripadaju M9 i dolaze tek uz izričito uključenje nastavnika, kroz katalog svrha. Ova specifikacija ih ne uvodi. Tekst studenta ne napušta preglednik zbog panela.
- **D-142 / D-143.** Bez promjene prikaza uživo i reprodukcije; vidi §4.
- **D-188 (#972, otvoren), D-123, D-183.** Boje ne smiju biti heksvrijednosti iz prototipa (`#6FBFA5`, `#D3AC63` pripadaju starom smjeru); koriste se tokeni D-188. Amber „treba pažnju” je upućujuća, ne crvena. PR s promjenom izgleda mora imati referentni ekran: `editor-v11.dc.html`, kartica `na`; paket `screenshots-v3/rad-*.png` treba provjeriti prikazuje li ovu karticu.
- **Pristupačnost (F-03, WCAG 2.1 AA).** Prekidač prikaza kao grupa s `aria-pressed`; svaki prikaz dostupan tipkovnicom; „Gdje se koristi ›” najavljuje redni broj mjesta; stanje se ne prenosi samo bojom.
- **Hrvatski.** Sav tekst sučelja na hrvatskom; podudaranje pojmova mora raditi za hrvatske nastavke (prototip: prefiks od 5 do 6 slova) i ne smije biti tvrdo vezano za hrvatski kad jezik rada nije hrvatski (F-06 u M2.10).

## 6. Faza i ovisnosti

**Smještaj (PRIJEDLOG): M5 Akademski editor, novi korak M5.14 „Panel Nacrt (S-14)”**, uz S-10, S-13 i S-45 koje M5 već navodi. Razlog: panel čita dokument i njegovu strukturu poglavlja; nema ni evidencije ni AI-ja. Procjena (hipoteza, bez mjerenja): 3 do 5 večeri, ovisno o pohrani plana.

Podjela da se prvi dio ne veže na skupe odluke:

| Dio | Sadržaj | Uloga | Ovisi o |
| --- | --- | --- | --- |
| M5.14a | Ljuska kartice + prikaz **Obrnuti nacrt** (samo izvedeno iz dokumenta, bez pohrane) | F | M5.2 (traka alata, popis naslova; #976, #980), M5.3 (numerirani naslovi), M0.5 (ljuska D-188), stabilni id blokova (F-044) |
| M5.14b | Pohrana plana: pitanje rada, svrhe poglavlja, pojmovnik (tablica, RLS, RPC, pgTAP, sinkronizacija s dokumentom) | B | odluke 1, 2, 6 (§9); M2 (model rada), M3.11 (stanja spremanja) |
| M5.14c | Prikazi **Nit** i **Pojmovnik** nad pohranom | F | M5.14b; M2.10 (jezik rada); M4.3 ako se prikazuju pragovi |

Zavisnost unatrag: M5.8 (opseg po poglavlju, D-60) i M5.14 dijele model poglavlja; zajednički popis poglavlja ne duplicirati. Kad se #1009 spoji, `docs/PROGRAM-RAZRADA.md` dobiva redak M5.14 i otvoreno pitanje 5 se zatvara; to radi orkestrator, ne ovaj dokument.

## 7. Kriteriji prihvaćanja (provjerljivi)

Svaki kriterij postaje test u PR-u koji ga gradi (unit/property, pgTAP, E2E ili provjera izgleda D-183).

*Opće (M5.14a)*
1. Kartica „Nacrt” postoji u desnom panelu editora i otvara prikaz Obrnuti nacrt; prekidač prikaza upravljiv tipkovnicom, `aria-pressed` odgovara stanju.
2. Za dokument s poglavljima i odlomcima panel prikazuje točno jednu prvu rečenicu po odlomku, po redu, s brojem poglavlja; klik/Enter pomiče kursor na taj odlomak.
3. Poglavlje bez odlomaka prikazuje „još nema odlomaka”; dokument bez naslova prikazuje stanje praznog panela iz §3.
4. Prikaz nacrta ne mijenja dokument, ne šalje ništa na poslužitelj i ne stvara redak u evidenciji (test: broj zapisa evidencije prije i poslije otvaranja panela jednak).
5. Rad od 15.000 riječi: promjena u jednom poglavlju preračunava samo to poglavlje; glavna nit ne bude blokirana dulje od praga koji PR navede (mjereno).
6. Tekst panela i `aria-label`i prolaze skener zabranjenih izraza; u njima nema riječi „rizik”, „sumnjivo”, postotka ni tvrdnje o autoru.
7. Nijedan izračun panela ne ulazi u sažetak procesa, izvoz, predaju ni nastavnički prikaz (test jednakosti prikaza D-80 (6) ne mijenja se).

*Plan (M5.14b/c, ovisi o odlukama §9)*
8. Student može upisati, urediti i obrisati pitanje rada, svrhu poglavlja i pojam; promjena preživi osvježavanje, odjavu i prijavu, te se sprema istim ciklusom i stanjima spremanja kao dokument.
9. Svrha poglavlja ostaje uz poglavlje nakon preimenovanja ili premještanja naslova (veže se na id bloka); brisanje poglavlja ne ostavlja svrhu bez poglavlja.
10. Klijent ne piše plan izravno u tablicu; pgTAP matrica dokazuje: student piše i čita samo svoj plan, druga osoba ne čita ništa, mentor čita samo ako je odluka 2 pozitivna i samo za rad u svojem mentorstvu.
11. Brisanje rada briše plan; student ga dobiva pravom pristupa (D-130 obrazac).
12. Nit: za svaki naslov poglavlja (osim zaključka i literature) prikazan je zapis svrhe ili „Svrha nije zapisana”; poglavlja bez svrhe ne mijenjaju nijedan drugi dio sučelja i ne blokiraju predaju.
13. Provjera zaključka prikazuje „Spominje” i „Ne spominje” isključivo kao popis pojmova iz pitanja; nema ukupnog rezultata, postotka, ocjene ni boje kvara; tekst kaže da je pomoć, ne sud.
14. Pojmovnik: ponovni upis istog pojma ne stvara dvostruki redak; „Gdje se koristi ›” kruži kroz sva mjesta i vraća se na prvo; brojka uporaba odgovara broju mjesta koja kruženje obilazi.
15. Panel i planovi su dostupni samo u pisanju: u prikazu „Kako vidi nastavnik” (S-17) panela nema.
16. U stanju predaje/zamrznuto i `RECOVERY_REQUIRED` uređivanje plana je onemogućeno uz razlog; čitanje radi.
17. Bez mreže: panel i uređivanje plana rade; nakon povratka veze plan se sinkronizira bez gubitka, a offline oznaka dokumenta (pravilo 10) ne mijenja značenje.
18. Nijedan prag pravila pisanja (duljina prve rečenice, prepoznavanje zaključka) nije u kodu; ili dolazi iz paketa pravila s verzijom, ili je isključen.
19. Provjera izgleda D-183: snimke širine računala i mobitela uz referentni ekran, sa svim stanjima iz §3 koje PR mijenja; boje iz tokena D-188.
20. Axe/E2E: nema novih povreda; tab-redoslijed prolazi tabove, prekidač, stavke i radnje bez zamke fokusa.

## 8. Rizici i UX napomene (hipoteze, ne opažanja)

Nema opažanja korisnika o ovom panelu; sljedeće su hipoteze iz prototipa i treba ih provjeriti u pilotu.
- **Naziv.** „Nacrt” već znači verziju predaje (D-28 „nacrt, komentar, nova verzija”; „Promjene od nacrta”, „Nacrt 1”, etapa „Nacrt”, „Nacrt izvješća”). U istom editoru student vidi dvije stvari istog imena. „Obrnuti nacrt” je i stručni izraz kojega studentu možda nije poznat. Naziv je odluka vlasnika (pitanje 3).
- **Osjećaj ocjenjivanja.** „Ne spominje” u jantarnoj boji i napomena „glavna misao se gubi” mogu se čitati kao ocjena rada ili kao znak da je nešto „krivo”. Ublažiti tekst i boju; ne dodavati zbroj.
- **Podudaranje po prefiksu** daje lažne pogotke i promašaje (prototipov STOP popis je tvrdo kodiran). Prikaz mora biti označen kao pomoć, ne rezultat.
- **Vidljivost plana.** Ako mentor vidi svrhe poglavlja kao čitljivu strukturu, to je korist; ako ih student zna samo za sebe, ne smije to doznati naknadno (pravilo 6 i obavijest S3).

## 9. Otvorena pitanja za vlasnika (PRIJEDLOG)

1. **Pohrana plana.** Sprema li se plan (pitanje, svrhe, pojmovnik) na poslužitelju uz rad kao zaseban zapis izvan evidencije (prijedlog), ili ostaje samo lokalno do predaje? Lokalno je jeftinije, ali ne preživi drugi uređaj i ne omogućuje odluku 2.
2. **Vidljivost mentoru.** Vide li mentor/nastavnik pitanje rada i svrhe poglavlja kao kontekst u pregledu rada (prijedlog: da, samo čitanje, kao dio rada „kao rad”, bez izračuna), ili ništa? Utječe na obavijest S3 (pravilo 6).
3. **Naziv kartice.** Zadržava li se „Nacrt” ili ide jasniji naziv (npr. „Struktura”, „Argument”)? Isto za „Obrnuti nacrt” (npr. „Prve rečenice”).
4. **Pragovi i „zaključak”.** Prototipov prag od 35 riječi i prepoznavanje zaključka po naslovu: preuzima li ih Lekta kao pravilo (M4), ili ih panel do tada nema (prijedlog)?
5. **Podcrtavanje pojmova u tekstu** (pojam prije definicije, istoznačnica): dio je panela (M5.14) ili provjere oblika (M4.4 Upute)? Prijedlog: Upute, uz isti izvor pojmovnika.
6. **Nakon predaje.** Ostaje li plan uređiv u ciklusu dorade (D-28) i je li svaka runda zasebna snimka plana? Prijedlog: uređiv za vrijeme dorade, bez snimki.
7. **Oblik pojmovnika.** `INTEGRACIJA.md` nosi `{ term, variants[] }`, prototip i definiciju; prijedlog: definicija ostaje, jer ju student piše i prikaz je koristi.
8. **Kratice.** Dio su Pojmovnika (prototip) ili posebne provjere (Upute)? Prijedlog: ostaju u Pojmovniku, samo čitanje.
9. **Procjena i raspored.** Prihvaća li se M5.14a/b/c i redoslijed iz §6 kao okvir za ugovore, prije nego orkestrator izda DAN tikete?

## 10. Veza s drugim dokumentima

- `docs/FEATURES.md`: redak „S-14” (oznaka ekrana iz mape ekrana od 31. 10. 2026.; **ne miješati** sa serijom S-01 do S-12 iz brainstorminga, to su druge oznake).
- `docs/PROGRAM-RAZRADA.md` (#1009): redak M5.14 i zatvaranje otvorenog pitanja 5 nakon spajanja i nakon odgovora na §9.
- Odluka (D-broj) tek nakon odgovora na pitanja 1, 2 i 3; ovaj dokument ne zauzima D-broj.
