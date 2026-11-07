# Referentna slika M9: A-AI-POL i S31-AI (paket 14, DAN-411)

Paket 14 iz `docs/design/EKRANI.md` §4, ovdje ekrani A-AI-POL i S31-AI; N-AI-ATT ide u zaseban PR. Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Samo specifikacija sučelja (D-269 O7), bez koda. Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183); dotad su prijedlog. Podaci su izmišljeni.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `a-ai-pol.html` | pregled i uređivanje (polazno pravilo AI-ja i dopušteni oblici pomoći odvojeno od Asistenta i granica troška), pružatelji samo za čitanje, objava nove verzije, neispravan unos, trošak nije podešen, učitavanje i greška | D-52, D-117, D-175, D-265 Q18, D-267 O5, D-270 O11 |
| `s31-ai.html` | bez uporabe Asistenta, zapisana uporaba s razgovorima koji se obvezno prilažu, pregled točnih verzija prije potvrde, ostali razgovori se ne prilažu, učitavanje, greška, Asistent nije dopušten, vanjski alat (poveznica, izvoz, zalijepljen tekst) s pregledom | D-40, D-41, D-58, D-77, D-186, D-263 Q22 |

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`: Playwrightov Chromium, cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja. Svijetla ljuska je `data-theme="light"`. Kontrolni zbrojevi su u `SHA256SUMS`.

## Odluke u slici

- A-AI-POL: administrator mijenja samo polazno pravilo AI-ja fakulteta (zabrana, djelomično dopušteno, poticanje; D-52), dopuštene oblike pomoći i pragove (D-117, D-265 Q18). Pravilo i oblici pomoći su zasebne skupine, odvojene od dostupnosti Asistenta i granica troška. Nova verzija vrijedi kao polazno pravilo za nove kolegije; kolegiji koji već imaju svoje pravilo i pravila koja je student potvrdio se ne proširuju (D-175, pravilo 14). Pružatelji su samo za čitanje iz verzionirane konfiguracije `config/faculties` (D-270 O11). Prazna konfiguracija troška znači da je Asistent isključen (D-267 O5). Studentu se razlog ne iznosi.
- Granice troška imaju jedinicu (EUR dnevno) i ne smiju prijeći gornju granicu operatera (`docs/backend/poslovi-i-predaja.md:13`); stanje 4 pokazuje poruku za prekoračenje.
- N-19 se ne crta.
- S31-AI: izjava se sastavlja iz zapisa (D-40). Razgovori iz kojih je tekst prenesen u rad prilažu se obvezno i student ih ne može isključiti; ostali su po odabiru (D-41). Razgovor čiji odgovor se podudara s tekstom rada u barem osam uzastopnih riječi označen je „podudara se s odgovorom AI pomoćnika” i prilaže se obvezno; citati i navodi su izuzeti, a za vanjske alate se tekst ne uspoređuje, što piše uz oznaku (D-58). Vanjski alat dodaje se poveznicom, izvozom ili zalijepljenim tekstom i označen je „izjavljeno” (D-41, D-77). Prije potvrde student pregledava točne verzije svih razgovora koji se prilažu; dok pregled nije otvoren, „Potvrdi” nije dostupan, a svaka promjena odabira traži novi pregled (D-263 Q22). Ime u sučelju je Ductura (D-186).

## Granice

- Stanja su izvedena iz navedenih odluka jer opis zadatka u Linearu nije bio dostupan; vlasnik ih potvrđuje spajanjem.
- Iznosi granica i jedinica (EUR dnevno) su primjer; jedinicu i iznose potvrđuje mjerenje troška (D-267 O5).
- Popis oblika pomoći uzet je iz postojećeg kataloga sučelja (formatiranje, lektoriranje i jezična provjera, pronalaženje literature, transkribiranje, prevođenje); konačan popis određuje konfiguracija fakulteta.
- A-AI-POL nije imao redak u `EKRANI.md`; dodan je uz ovaj paket.
- S31-AI: N-AI-ATT (nastavnički pregled) slijedi u idućem PR-u. Prag podudaranja (osam riječi) i izuzeće citata uzeti su iz D-58; način mjerenja nije dio slike. Nazivi razgovora, vremena i odlomci su izmišljeni.
- S31-AI: oznaka „podudara se s odgovorom AI pomoćnika” prikazana je kako je napisana u D-58 (potvrda ugovora na #1091). D-268 O6 drži tu oznaku isključenom do rješenja U-4 (M9.6-P04, nakon pilota); dok je isključena, obvezni su samo razgovori s poznatim prijenosom teksta. Nesklad ostaje otvoren.

## Provjera rječnika

Tekst je provjeren funkcijom `findForbiddenTerms` (`scripts/forbidden-terms/terms.ts`) nad vidljivim tekstom i atributima `aria-label`, `title`, `alt`, `placeholder`. `scan.ts` ne čita `docs/design/`, pa je provjera pokrenuta izravno. Prvi prolaz je prijavio „spremljeno” bez pojašnjenja u dvije rečenice; tekst je ispravljen i ponovni prolaz nema nalaza. `s31-ai.html` je provjeren istim postupkom (8 odsječaka, bez nalaza); pozitivna kontrola s namjerno umetnutim zabranjenim izrazima prijavila je oba izraza.
