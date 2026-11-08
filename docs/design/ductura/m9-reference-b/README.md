# Referentna slika M9: A-AI-POL, S31-AI i N-AI-ATT (paket 14, DAN-411)

Paket 14 iz `docs/design/EKRANI.md` §4, ovdje ekrani A-AI-POL, S31-AI i N-AI-ATT (N-AI-ATT dodan zasebnim PR-om nakon #1698; status PRIJEDLOG do vlasnikove potvrde reference po ekranu, Q-8). Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Samo specifikacija sučelja (D-269 O7), bez koda. Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183); dotad su prijedlog. Podaci su izmišljeni.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `a-ai-pol.html` | pregled i uređivanje (polazno pravilo AI-ja i dopušteni oblici pomoći odvojeno od Asistenta i granica troška), pružatelji samo za čitanje, objava nove verzije, neispravan unos, trošak nije podešen, učitavanje i greška | D-52, D-117, D-175, D-265 Q18, D-267 O5, D-270 O11 |
| `s31-ai.html` | bez uporabe Asistenta, zapisana uporaba s razgovorima koji se obvezno prilažu, pregled točnih verzija prije potvrde, ostali razgovori se ne prilažu, učitavanje, greška, Asistent nije dopušten, vanjski alat (poveznica, izvoz, zalijepljen tekst) s pregledom; uvjetna varijanta U s oznakom podudaranja | D-40, D-41, D-58, D-77, D-186, D-263 Q22, D-268 O3 i O6 |
| `n-ai-att.html` | popunjeno (izjava, prijenosi iz Asistenta s prenesenim tekstom i mjestom u radu, priloženi razgovori, vanjski alat), otvoren priloženi razgovor u potvrđenoj verziji, prazno (bez uporabe), Asistent nije dopušten i izjavljen samo vanjski alat, dopuna izjave na čekanju, učitavanje, greška; uvjetna varijanta U s oznakom podudaranja | D-40, D-41, D-58, D-77, D-263 Q22, D-268 O3 i O6, `docs/PRODUCT.md` §5 |

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`: Playwrightov Chromium, cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja. Svijetla ljuska je `data-theme="light"`. Kontrolni zbrojevi su u `SHA256SUMS`.

## Odluke u slici

- A-AI-POL: administrator mijenja samo polazno pravilo AI-ja fakulteta (zabrana, djelomično dopušteno, poticanje; D-52), dopuštene oblike pomoći i pragove (D-117, D-265 Q18). Pravilo i oblici pomoći su zasebne skupine, odvojene od dostupnosti Asistenta i granica troška. Nova verzija vrijedi kao polazno pravilo za nove kolegije; kolegiji koji već imaju svoje pravilo i pravila koja je student potvrdio se ne proširuju (D-175, pravilo 14). Pružatelji su samo za čitanje iz verzionirane konfiguracije `config/faculties` (D-270 O11). Prazna konfiguracija troška znači da je Asistent isključen (D-267 O5). Studentu se razlog ne iznosi.
- Granice troška imaju jedinicu (EUR dnevno) i ne smiju prijeći gornju granicu operatera (`docs/backend/poslovi-i-predaja.md:13`); stanje 4 pokazuje poruku za prekoračenje.
- N-19 se ne crta.
- S31-AI: izjava se sastavlja iz zapisa (D-40). Razgovori iz kojih je tekst prenesen u rad prilažu se obvezno i student ih ne može isključiti, i kad je preneseni tekst kasnije obrisan; ostali su po odabiru (D-41, D-268 O3). Oznaka podudaranja iz D-58 isključena je do rješenja U-4 (D-268 O6), pa je u stanjima 1 do 6c nema. Uvjetna varijanta U, odvojena na kraju, prikazuje je samo za slučaj da se U-4 riješi: razgovor čiji se odgovor podudara s tekstom rada u barem osam uzastopnih riječi prilaže se obvezno, citati i navodi su izuzeti, a uz oznaku piše da se ne odnosi na vanjske AI alate (D-58). Vanjski alat dodaje se poveznicom, izvozom ili zalijepljenim tekstom i označen je „izjavljeno” (D-41, D-77). Prije potvrde student pregledava točne verzije svih razgovora koji se prilažu; dok pregled nije otvoren, „Potvrdi” nije dostupan, a svaka promjena odabira traži novi pregled (D-263 Q22). Ime u sučelju je Ductura (D-186).
- N-AI-ATT: nastavnik vidi izjavu kako ju je student potvrdio (D-40) i za svaki prijenos iz Asistenta vrijeme, pružatelja, model, svrhu i preneseni tekst s mjestom u radu (D-41). Popis prijenosa prikazuje samo tekst koji je u predanoj verziji; tekst napisan i obrisan između poslanih verzija nastavnički pregled ne prikazuje (`docs/PRODUCT.md` §5 pravilo 7), a razgovor iz kojeg je takav tekst prenesen ostaje obvezno priložen (D-268 O3). Razgovore koje je student priložio sam i vanjske razgovore („izjavljeno”, D-77) prikazuje odvojeno; razgovore koje student nije priložio nastavnik ne vidi. Otvoren razgovor je samo za čitanje, u točnoj verziji koju je student potvrdio (D-263 Q22). Oznaka podudaranja iz D-58 je, kao u S31-AI, samo u uvjetnoj varijanti U (D-268 O6). Nema postotka, ocjene ni AI analize, a student u svojoj predaji vidi isti prikaz (`docs/PRODUCT.md` §5 pravila 1, 2, 3, 5, 7 i 13).

## Granice

- Stanja su izvedena iz navedenih odluka jer opis zadatka u Linearu nije bio dostupan; vlasnik ih potvrđuje spajanjem.
- Iznosi granica i jedinica (EUR dnevno) su primjer; jedinicu i iznose potvrđuje mjerenje troška (D-267 O5).
- Popis oblika pomoći uzet je iz postojećeg kataloga sučelja (formatiranje, lektoriranje i jezična provjera, pronalaženje literature, transkribiranje, prevođenje); konačan popis određuje konfiguracija fakulteta.
- A-AI-POL nije imao redak u `EKRANI.md`; dodan je uz ovaj paket.
- S31-AI: prag podudaranja (osam riječi) i izuzeće citata uzeti su iz D-58; način mjerenja nije dio slike. Nazivi razgovora, vremena i odlomci su izmišljeni.
- S31-AI: D-268 O6 (odlučeno 5. 11. 2026.) drži oznaku „podudara se s odgovorom AI pomoćnika” isključenom do rješenja U-4 (M9.6-P04, nakon pilota), pa zadana stanja prikazuju samo obvezne razgovore s poznatim prijenosom teksta. Prva verzija slike prikazivala je oznaku u zadanim stanjima; ispravljeno po reviewu na #1698. Varijanta U nije odobrena za pilot i vrijedi tek uz odluku o U-4.
- N-AI-ATT: stanje „dopuna izjave na čekanju” izvedeno je iz stanja 5 u S31-AI; tekst poziva studentu nije dio ove slike. Pružatelj i model su zamjenski („Primjer d.o.o., Model A”) dok je Q-10 otvoren. „Otvori odlomak u radu” pretpostavlja da nastavnički pregled rada može otvoriti zadani odlomak; način toga nije dio slike.

## Provjera rječnika

Tekst je provjeren funkcijom `findForbiddenTerms` (`scripts/forbidden-terms/terms.ts`) nad vidljivim tekstom i atributima `aria-label`, `title`, `alt`, `placeholder`. `scan.ts` ne čita `docs/design/`, pa je provjera pokrenuta izravno. Prvi prolaz je prijavio „spremljeno” bez pojašnjenja u dvije rečenice; tekst je ispravljen i ponovni prolaz nema nalaza. `s31-ai.html` je provjeren istim postupkom (8 odsječaka, bez nalaza); pozitivna kontrola s namjerno umetnutim zabranjenim izrazima prijavila je oba izraza. `n-ai-att.html` je provjeren istim postupkom (23 odsječka, bez nalaza); pozitivna kontrola prijavila je oba umetnuta izraza.
