# ADR: dnevnik potvrda po domeni evidencije

- **Status:** PRIJEDLOG specifikacije. Čeka neovisni review, kako D-93 traži „prije koda”, i vlasnikove odgovore na otvorena pitanja iz §11. Tek nakon toga gradi se izvedba (Linear DAN-391).
- **Datum:** 2. 11. 2026.
- **Zadatak:** Linear DAN-55, M3.9-P01 (`docs/PROGRAM-RAZRADA.md`, M3.9). Samo dokument; ne mijenja kod, migracije ni druge dokumente.
- **Stanje koda:** `main` na `9680a00`.
- **Izvori:** D-93, D-102, D-72 i D-209, D-92 i D-215 (`docs/DECISIONS.md`), `docs/backend/evidencija.md` §4.1 i §4.2 (`BACKEND.md` §4.1 i §4.2), RFC 9162 (prije RFC 6962), C2SP tlog-checkpoint i signed-note.

## 1. Što se odlučuje

D-93 opisuje jedan kumulativni append-only Merkle log. Njegova dopuna od 11. 10. 2026. i D-102 traže da svaka domena evidencije (jedna ustanova u jednoj regiji) ima vlastiti dnevnik. `BACKEND.md` §4.2 t. 1 zato kaže da tekst o jednom logu „čeka usklađivanje s tom podjelom”. Ovaj dokument je to usklađivanje: za jednu domenu određuje format zapisa, granicu, sadržaj, redoslijed, cutover, kontrolnu točku, provjeru dosljednosti, objavu i čitatelje. Navodi i što izvedba mora pokazati testom.

Pravilo tumačenja: svako pravilo iz D-93 i `BACKEND.md` §4.2 vrijedi nepromijenjeno, ali **unutar jedne domene**. Gdje ovaj dokument nešto dodaje, to je izričito označeno kao prijedlog izvedbe ili kao pitanje vlasniku (§11).

## 2. Stanje odluka na koje se oslanja

- **D-93**, ODLUČENO, uz dopunu 11. 10.: Merkle log, list po `receiptSchema`, cutover, gapless indeks, dnevna kontrolna točka, vanjska povijest prije potpisa.
- **D-102**, ODLUČENO: domena evidencije, vlastiti ključ kontrolne točke i vlastiti dnevnik po domeni; bez globalnog brojača.
- **D-72 i D-209**, ODLUČENO 2. 11. 2026.: DigiCert i Sectigo kao TSA; Internet Archive kao prvi neovisni primatelj; zaseban javni repo; javni broj potvrda u DPIA-i.
- **D-92 i D-215**, ODLUČENO: digest i potpis potvrde v1 i v2; pretpostavka da izvan razvojnih i demo računala nema trajnih v1 potvrda.
- **D-08, dio o dobavljačima**, PRIJEDLOG (B0.1): o njemu ovisi izbor vanjske pohrane povijesti (§11, O5). Na tome se ne gradi dok nije odlučeno.

Nijedan dio ove specifikacije ne gradi na odluci sa statusom PRIJEDLOG. Gdje bi izvedba to morala, stoji pitanje u §11.

## 3. Granica domene

1. **Jedan dnevnik po domeni.** Dnevnik nosi `evidenceDomainId` domene (`evidence.domain.id`, kanonski UUID v4). Indeksi, cutover, kontrolne točke, ključ kontrolne točke i vanjska povijest su po domeni. Ne postoji brojač, redoslijed, brava ni spremnik zajednički dvjema domenama (D-102 t. 4).
2. **Pripadnost potvrde.** Potvrda pripada domeni svog paketa (`evidence.package.evidence_domain_id`).
   - Potvrda v2 nosi `evidenceDomainId` u potpisanom sadržaju. Upis u dnevnik odbija potvrdu kojoj se ta vrijednost razlikuje od domene paketa. Takav zapis blokira cutover i nikad ne ulazi u tuđi dnevnik.
   - Potvrda v1 nema domenu u sadržaju. Domena se uzima iz paketa, pa list v1 nije kriptografski vezan za domenu (§10, t. 4).
3. **Ishodište (C2SP `origin`).** Svaka domena ima jedinstveno, nepromjenjivo ishodište. Prijedlog oblika je `<host operatera>/log/<evidenceDomainId>`. Host operatera još ne postoji (§11, O1). U testovima vrijedi samo `ductus.example/log` iz KAT-a u `BACKEND.md` §4.1. Ishodište se nikad ne izvodi iz naziva ustanove, regije ni vremena, jer ni `evidenceDomainId` nije izveden (D-102 t. 2).
4. **Ključ kontrolne točke.** Svaka domena ima vlastiti Ed25519 ključ (`evidence.signing_key`, `purpose = 'checkpoint'`, isti `evidence_domain_id`). Ključ potvrda (`purpose = 'receipt'`) nikad ne potpisuje kontrolnu točku, i obrnuto. Ime ključa u signed-note retku jednako je ishodištu. Key ID je `SHA-256(UTF-8(ime) ‖ 0x0A ‖ 0x01 ‖ javniKljuč32)[:4]` (`BACKEND.md` §4.1).

## 4. Što se upisuje i što ne

**Upisuje se:** svaka potvrda evidencije domene sa `receiptSchema` `ductus-evidence-receipt-v1` ili `ductus-evidence-receipt-v2`, jedan list po `receiptId`. To uključuje i rezervacije u stanju `pending_signature` (D-93).

**Ne upisuje se:**
- sadržaj odsječka, tekst rada, ime, e-pošta ni bilo koji podatak izvan digesta;
- potpis potvrde, jer list sidri payload, a potpis je zaseban dokaz;
- popunjavajući listovi, dok ih ustanova ne zatraži i dok zaseban PR ne definira njihov model (D-93);
- potvrde predaje (`ductus-submission-receipt-*`), dok vlasnik ne odluči drukčije (§11, O2).

**Zapis u bazi (prijedlog izvedbe).** `evidence.log_entry` (ime iz D-93) ima po retku:

| Polje | Značenje |
| --- | --- |
| `evidence_domain_id` | domena; zajedno s `log_index` primarni ključ |
| `log_index` | 0-based indeks bez praznina unutar domene |
| `receipt_id` | jedinstven u cijeloj tablici; jedna potvrda, jedan list |
| `receipt_schema` | `ductus-evidence-receipt-v1` ili `-v2` |
| `payload_digest` | 32 bajta `D_schema = SHA-256(JCS(receiptPayload))` |
| `leaf_hash` | 32 bajta `SHA-256(0x00 ‖ D_schema)` |

Redak je nepromjenjiv: okidač zabranjuje `UPDATE`, `DELETE` i `TRUNCATE`, kao kod ostalih evidencijskih tablica (`BACKEND.md` §4.1). Upisuje ga samo `reserve` ili cutover, kroz `SECURITY DEFINER` funkciju; klijent nikad ne piše izravno (`CLAUDE.md`). Za novu tablicu vrijede RLS i retci u pgTAP matrici pristupa.

**Stanje dnevnika domene (prijedlog izvedbe).** Jedan redak po domeni (npr. `evidence.log_head`) nosi `state` (`pre_log`, `cutover`, `active`) i `next_index`. Taj redak je brava domene iz §6.

## 5. Format

1. **List:** `leaf_hash = SHA-256(0x00 ‖ D_schema)`, pri čemu je `D_schema` sirovih 32 bajta. Verifikator prema `receiptSchema` u payloadu bira digest i provjeravatelj potpisa. Postojeći payloadi i potpisi ostaju bajt po bajt nepromijenjeni (D-93).
2. **Unutarnji čvor i korijen:** `SHA-256(0x01 ‖ L ‖ R)` i MTH iz RFC 9162 §2.1.1 za bilo koji `tree_size`, ne samo za potencije broja 2. Korijen praznog stabla je `SHA-256("")`, u base64 `47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=`.
3. **Dokazi:** inclusion dokaz prema RFC 9162 §2.1.3 i consistency dokaz prema §2.1.4. Prijenosni oblik dokaza (JSON s indeksom, `tree_size` i nizom base64 hasheva) određuje izvedba i CLI verifikator (M3.9-P05, P07) i ulazi u njihov KAT.
4. **Kontrolna točka:** C2SP tlog-checkpoint bez proširenih redaka. Tekst bilješke su točno tri retka, svaki završava s LF:
   ```
   <ishodište>
   <tree_size, dekadski, bez vodećih nula>
   <korijen, standardni base64 s paddingom>
   ```
   Potpis je čisti Ed25519 (`ED25519_SHA_512`, `RAW`) nad točnim UTF-8 bajtovima tog teksta, uključujući završni LF. Nema prefiksa ni hashiranja iz D-92. Iza teksta slijedi jedan prazan redak, a zatim potpisni redak `— <ime> base64(keyID ‖ potpis64)` (C2SP signed-note; crtica je U+2014, iza nje i iza imena po jedan razmak). Tekst dulji od 4096 B odbija se prije poziva KMS-u.
5. **Žig:** dva RFC 3161 zahtjeva (DigiCert, Sectigo; D-209) nad SHA-256 cijele potpisane bilješke, dakle teksta i potpisnog retka. Uspjeh dana je barem jedan valjan žig, a dan bez žiga je alarm (`BACKEND.md` §4.2 t. 2).

## 6. Dodavanje u dnevnik i redoslijed

1. **Nakon cutovera** `reserve` u istoj transakciji:
   - zaključa redak stanja domene (`SELECT … FOR UPDATE`);
   - provjeri `state = 'active'`;
   - upiše potvrdu i `log_entry` s `log_index = next_index`;
   - poveća `next_index`.

   Rollback ne troši indeks. Idempotentni retry (isti principal, paket i `clientRequestId`, `BACKEND.md` §4.1) vraća postojeću potvrdu i ne dodaje list. Indeks se zato nikad ne uzima iz PostgreSQL sekvence, jer sekvenca ostavlja praznine.
2. **Redoslijed je redoslijed serijalizacije**, ne vremena. `acceptedAt` se postavlja nakon zaključavanja, pa unutar domene obično raste s indeksom. Verifikator to ipak ne smije pretpostaviti (§10, t. 2).
3. **Cutover po domeni.** Postupak je onaj iz D-93 i `BACKEND.md` §4.2 t. 1, proveden posebno za svaku domenu:
   - zatvori se gate, pod istom bravom kao `reserve`;
   - slijedi read-only inventar potvrda te domene i validacija po `receiptSchema`;
   - indeksi se dodjeljuju po kanonskom UTC `acceptedAt` uzlazno, zatim bajtovnom UTF-8 redoslijedu `receiptId`;
   - prva kontrolna točka se rezervira, potpiše, žigosa i neovisno pohrani kao u §7 t. 6 do 8, s `tree_size` jednakim broju mapiranih zapisa;
   - tek tada gate se otvara (`state = 'active'`).

   Neispravan ili nepotpun inventar ostavlja gate zatvorenim. Zatvoren gate blokira samo svoju domenu.
4. **Nova domena** nastala nakon izvedbe dnevnika počinje u stanju `cutover` s praznim inventarom. Prihvaća potvrde tek kad je njezina početna kontrolna točka (`tree_size = 0`, prazan korijen) potpisana, žigosana i neovisno pohranjena. Do tada `reserve` vraća ponovljivu privremenu grešku. To je doslovna primjena D-93 („bez obzira na to je li inventar prazan”) i dio je uključivanja ustanove.

## 7. Kontrolna točka i provjera dosljednosti

**Dnevni posao po domeni** (worker, `src/runtime/worker/`, D-214). Svaka domena ide zasebno; pad jedne ne zaustavlja druge.

1. Uzme zakup domene (single-flight; §8, t. 6).
2. Pročita vanjsku povijest kontrolnih točaka tog ishodišta iz pohrane izvan domene povrata baze (§11, O5). Povijest sadrži pohranjene točke i rezervacije kandidata (t. 6). Nedostupna povijest zatvara put: nema potpisa, žiga ni objave.
3. Provjeri da je vanjska povijest sama lanac. Svaki par uzastopnih točaka ima `n2 ≥ n1`, a pri `n2 = n1` isti korijen. Pri `n2 > n1` objavljeni consistency dokaz mora se provjeriti. Otvorena rezervacija (t. 6) ulazi u lanac kao njegova najveća točka, jer se ne zna je li njezin potpis već izdan.
4. Iz `log_entry` domene izračuna korijen za `tree_size = next_index` zaključan u trenutku čitanja. Za listove dodane od zadnje točke ponovno izračuna `D_schema` iz pohranjenog `receipt_payload` i usporedi s `payload_digest` i `leaf_hash`. Razlika je alarm i put se zatvara.
5. Usporedi novu točku s najvećom vanjskom točkom ili otvorenom rezervacijom `(n1, r1)`:
   - `n < n1`: odbija se;
   - `n = n1` uz drugi korijen: odbija se kao fork;
   - `n = n1` uz isti korijen: vraća se postojeća pohranjena točka bez KMS-a, a otvorena rezervacija dovršava se kroz t. 7 i 8 nad istim bajtovima i s istim potpisom;
   - `n > n1`: consistency dokaz `(n1 → n)` iz baze mora se provjeriti prema `r1`.

   Jer je vanjska povijest u t. 3 provjerena kao lanac, provjera prema najvećoj točki ekvivalentna je provjeri prema svakoj ranijoj, kako traži D-93. Izvedba smije provjeriti i svaku izravno.
6. **Prije KMS-a** trajno upiše rezervaciju kandidata u vanjsku povijest, uvjetnim dodavanjem (§8, t. 6). Rezervacija sadrži ishodište, `tree_size = n`, korijen, prethodnu točku `(n1, r1)`, consistency dokaz `(n1 → n)` i `D_schema` listova od `n1` do `n − 1`. Digesti omogućuju da se baza nakon povrata uskladi s rezervacijom. Dodavanje uspijeva samo ako je zadnji vanjski zapis pohranjena točka `(n1, r1)`, pa otvorena rezervacija može biti najviše jedna. Kod prve točke cutovera (§6 t. 3 i 4) povijest je prazna, a prethodne točke ni consistency dokaza nema. KMS se poziva tek kad ponovno čitanje potvrdi rezervaciju. Neuspio upis zatvara put bez potpisa, a nejasan ishod (npr. istek veze) vraća posao na t. 2. Rezervacija je izvan domene povrata baze, pa je povrat baze ne briše.
7. Potpiše tekst bilješke ključem kontrolne točke domene (KMS) i traži dva žiga.
8. Neovisno pohrani potpisanu bilješku, žigove i consistency dokaz uz rezervaciju, uvjetnim dodavanjem. Time rezervacija postaje pohranjena točka. Tek zatim objavi (§9).

   **Oporavak.** Otvorena rezervacija `(n1, r1)` je ona bez pohranjene točke iste veličine. Dok postoji, worker smije samo nju dovršiti; novi kandidat se ne rezervira. Ako baza za `tree_size = n1` daje korijen `r1`, worker dovršava rezervaciju (t. 7 i 8) istim tekstom bilješke, a veći kandidat rezervira tek u idućem prolazu. Ako baza ne daje korijen `r1` za `tree_size = n1` (manje listova ili drugi korijen, npr. nakon povrata baze), put se zatvara: nema poziva KMS-u, žiga ni objave, a zapisuje se alarm. Rezervacija se nikad ne povlači ni zamjenjuje. Put ostaje zatvoren dok se baza ne uskladi s dokazanom vanjskom poviješću, uključujući rezervaciju (`BACKEND.md` §4.2 t. 2); indeksi se ne vraćaju na nulu. Zato se ni nakon pada ni nakon povrata ne potpisuje drugi korijen iste veličine, a ishodište i ključ ostaju isti.
9. Dan bez novih listova objavljuje istu točku s novim žigom. Potpis je isti, jer je Ed25519 determinističan nad istim bajtovima.

**Provjera dodavanja u bazi** (svakodnevno i u B4 testu):
- `log_index` domene je točno `0 … next_index − 1`, bez praznina i duplikata;
- svaki `receipt_id` ima najviše jedan list;
- broj listova jednak je broju potvrda domene koje su mapirane ili prihvaćene nakon cutovera.

Nesklad je alarm i zatvara potpisivanje za tu domenu.

## 8. Istodobnost: zahtjevi za izvedbu

Ovaj PR je dokument i nema koda, pa tablični test istodobnosti ovdje **ne primjenjuje se**: nema izvršnog puta koji bi se mogao utrkivati. Svaki redak niže je zahtjev za izvedbu (DAN-391) i mora imati test u B4 ili B5.

| # | Scenarij | Zahtjev | Test |
| --- | --- | --- | --- |
| 1 | Dvije potvrde iste domene u istoj milisekundi | Serijalizacija na retku stanja domene; dva uzastopna indeksa, bez duplikata i praznine | B4, paralelni `reserve` |
| 2 | Istodobni prihvati u dvjema domenama | Nema zajedničke brave ni brojača; obje domene počinju od 0 i ne čekaju jedna drugu | B4, dvije domene |
| 3 | Rollback nakon dodjele indeksa; idempotentni retry | Rollback ne troši indeks; retry ne dodaje list | B4 (D-93) |
| 4 | `reserve` istodobno sa zatvaranjem gatea | Prihvat koji dobije bravu prije gatea završi prije snimke inventara; nakon zatvaranja `reserve` vraća ponovljivu privremenu grešku | B4, cutover |
| 5 | Prekid između upisa lista i objave korijena | List je u istoj transakciji kao potvrda, pa nema lista bez potvrde. Potvrda ostaje „još nije sidrena” dok točka s `tree_size > indeks` nije objavljena; sljedeći dnevni posao je uključuje | B4 + jedinični test statusa sidrenja |
| 6 | Dva workera nad istom domenom | Zakup po domeni u bazi. Uz to vanjska pohrana prima dodavanje rezervacije i točke samo uz očekivani zadnji zapis, pa drugi worker dobiva ili idempotentan isti rezultat ili odbijanje | B5, dva workera |
| 7 | Prekid nakon rezervacije, prije ili poslije potpisa, a prije žiga ili vanjske pohrane | Ponovno pokretanje nalazi otvorenu rezervaciju i dovršava je istim tekstom i potpisom (§7 t. 5); ništa nije objavljeno dok vanjska pohrana ne uspije | B5, prekid u svakom koraku |
| 8 | Prekid nakon vanjske pohrane, a prije zapisa u bazi | Vanjska povijest je mjerodavna; sljedeći posao prepoznaje točku ili rezervaciju i ne potpisuje drugu točku iste veličine | B5 |
| 9 | Povrat stare baze | Regresivna ili razgranata točka nije potpisana, žigosana ni objavljena; indeksi se ne vraćaju na nulu | B5 (D-93) |
| 10 | Kombinacija 7 i 9: vanjska povijest završava na točki 100; rezerviran je 101/A, worker padne prije ili poslije KMS-a i prije t. 8; baza se vrati na 100, a novi prihvat stvori 101/B | Rezervacija 101/A preživi povrat. Nema poziva KMS-u ni za 101/B ni za veću točku grane B; nema žiga ni objave; nema druge rezervacije veličine 101; alarm i zatvoren put dok se baza ne uskladi s rezervacijom | B5, lažni KMS broji pozive, prekid prije i poslije KMS-a |
| 11 | Nejasan ishod upisa rezervacije | KMS se ne poziva dok ponovno čitanje ne potvrdi rezervaciju; dva workera nikad ne drže dvije rezervacije iste veličine | B5, lažna pohrana s istekom nakon upisa |

## 9. Objava i tko čita

**Objava po domeni** (D-72, D-209):
- u zasebnom javnom repou, npr. `checkpoints/<evidenceDomainId>/<YYYY-MM-DD>.note`, uz `.tsr` za svaki žig i consistency dokaz prema prethodnoj objavljenoj točki;
- zatim arhiviranje u Internet Archive kao prvom neovisnom primatelju;
- e-mail FPZG-u kasnije.

Javni repo kontrolira operater, pa sam nije svjedok (`BACKEND.md` §4.2 t. 3).

| Tko | Što čita | Kako |
| --- | --- | --- |
| Javnost i neovisni svjedoci | Kontrolne točke, žigove, consistency dokaze, javne ključeve kontrolnih točaka | Javni repo i Internet Archive |
| Nositelj potvrde (student; mentor ili druga uloga koja smije čitati tu potvrdu) | Inclusion dokaz za svoju potvrdu prema točki koja je sidri | Paket dokaza i prenosiv zapis (M7.10, DAN-389). Vrijedi ista ovlast kao za čitanje potvrde; dnevnik ne uvodi novo pravo čitanja |
| CLI verifikator | Payload, potpis, inclusion i consistency dokaz, bilješku, `.tsr`, javni ključ | Offline, bez pristupa bazi (`BACKEND.md` §4.2 t. 9) |
| Worker operatera | `log_entry` i stanje domene; piše vanjsku povijest | Servisna uloga, samo kroz RPC |
| Administrator ustanove | `tree_size` svoje domene | Već je javan; nema dodatnog pristupa listovima |

Popis listova domene (C2SP tiles ili slično) se u pilotu **ne objavljuje**. Vanjski monitor zato ne može samostalno pregledati cijeli dnevnik (§10, t. 5). Standardni format to omogućuje kasnije bez promjene dizajna.

## 10. Poznate granice

1. **Što sidrenje dokazuje.** Vrijedi točno `BACKEND.md` §4.2 t. 4 i 5: payload potvrde postojao je najkasnije u trenutku žiga prve točke s `tree_size > indeks`. Sidrenje ne dokazuje da je to jedina točka ishodišta bez neovisnog primatelja, da dnevnik sadrži sve potvrde, ni istinitost sadržaja ili autorstva (`docs/PRODUCT.md` §5).
2. **Indeks nije vrijeme.** Redoslijed listova dokazuje redoslijed indeksiranja u domeni, ne vremenski redoslijed `acceptedAt` ni redoslijed među domenama. Dvije domene nemaju zajednički poredak.
3. **List sidri payload, ne potpis.** Potvrda u `pending_signature` već je list. Potpis koji kasnije stigne dokazuje se zasebno ključem potvrda.
4. **v1 i domena.** List v1 nije vezan za domenu u potpisanom sadržaju. Pripadnost dolazi iz paketa. Prema D-215 izvan razvojnih i demo računala nema trajnih v1 potvrda; ako se to pokaže netočnim, ova granica se ponovno otvara.
5. **Potvrde izgubljene povratom baze.** Potvrda prihvaćena nakon zadnje neovisno pohranjene točke, a izgubljena povratom baze, ostaje valjano potpisana, ali nikad sidrena. Dnevnik je ne vraća. Postupak povrata (backup i restore, zaseban zadatak) mora takve potvrde navesti; ovaj dokument ga ne propisuje. Ako je takva potvrda već u rezervaciji kandidata, domena ostaje zatvorena za potpis dok se baza ne uskladi s rezervacijom (§7, Oporavak).
6. **Javni broj po ustanovi.** Uz dnevnik po domeni, `tree_size` otkriva točan broj potvrda svake domene, dakle po ustanovi i regiji, a ne samo ukupan broj kao u D-93. To treba potvrditi i zapisati u DPIA (§11, O3).
7. **Javni consistency dokazi** sadrže hasheve podstabala, a na rubu i hash pojedinog lista. Hash lista je SHA-256 nad digestom payloada s UUID-ovima i vremenom, pa se praktično ne može obrnuti. Ipak je to pseudonimni izvedeni podatak i ide u DPIA uz `docs/privacy/05`.
8. **Jamstva vrijede za pozivatelje** `reserve` (gateway evidencije, `BACKEND.md` §4.1), cutover i dnevni posao workera. Svaki novi pisac u `log_entry` ponovno otvara ovu specifikaciju.

## 11. Otvorena pitanja za vlasnika

Ništa od ovoga ne rješava pisac. Uz svako pitanje je preporuka i što bez odgovora ne smije krenuti.

- **O1. Ishodište i host operatera.** Pravna osoba operatera i javni host ne postoje (D-194 t. 3). Preporuka: `<host>/log/<evidenceDomainId>`, nepromjenjivo nakon prve točke. Blokira prvu stvarnu točku domene, ne izvedbu s `ductus.example`.
- **O2. Potvrde predaje u dnevniku?** D-93 govori o potvrdama evidencije v1 i v2. Preporuka: ne u prvoj izvedbi. Kasnije dodavanje mijenja značenje `tree_size` i javnog broja, pa traži novu odluku. Format lista se ne mijenja, jer payload predaje nosi vlastiti `receiptSchema`.
- **O3. Javni broj potvrda po domeni.** Posljedica D-102 nad D-93. Preporuka: prihvatiti i navesti u DPIA, uz D-209. Blokira objavu prve stvarne točke.
- **O4. Rotacija ključa kontrolne točke.** Preporuka: isto ishodište i isto ime; novi ključ ima novi key ID. Tijekom preklapanja bilješka nosi dva potpisna retka. Verifikator prihvaća ključ iz javnog popisa domene u rasponu valjanosti (`signing_key.valid_from`, `valid_to`). Blokira prvu rotaciju, ne izvedbu.
- **O5. Vanjska pohrana povijesti za signer.** D-93 traži append-only povijest izvan domene povrata baze, koju signer čita prije svakog potpisa. Internet Archive ima kašnjenje i nema uvjetno dodavanje, a javni repo kontrolira operater. Preporuka: WORM spremnik (object lock) kod drugog pružatelja ili računa nego sigurnosne kopije baze, uz Internet Archive kao svjedoka. Izbor dobavljača ovisi o D-08 (B0.1, PRIJEDLOG). Do odluke izvedba gradi port s lažnom pohranom za testove, ali ne stvarni adapter.
- **O6. Javni popis domena.** Ishodište otkriva `evidenceDomainId` prije javnog popisa iz D-102 t. 2. Preporuka: prihvatiti, jer je identifikator neproziran; popis domena objaviti najkasnije s prvom stvarnom točkom.

## 12. Klase ulaza: zahtjevi za izvedbu

Za ovaj dokument tablični test klasa ulaza **ne primjenjuje se**, jer PR ne mijenja kod. Izvedba mora pokriti barem:

| Klasa | Očekivano |
| --- | --- |
| v1 i v2 potvrda u istoj domeni | Digest po `receiptSchema`; oba lista se provjeravaju |
| v2 potvrda s `evidenceDomainId` druge domene | Odbijena; blokira cutover; ne ulazi ni u jedan dnevnik |
| `pending_signature` u inventaru | List postoji; potpisni put sheme ostaje (D-92) |
| Isti `acceptedAt` za dvije potvrde | Redoslijed po bajtovnom UTF-8 `receiptId` |
| Prazan inventar | `tree_size = 0`, prazan korijen, gate se otvara tek nakon pohrane |
| Tekst bilješke dulji od 4096 B | Odbijen prije KMS-a |
| Bilješka bez završnog LF-a, drugi prefiks, krivi key ID, potpis nad SHA-256 bilješke | Verifikator odbija (`BACKEND.md` §4.1) |
| `tree_size` 1, 2, 3, 7, 8, 9 | Korijen, inclusion i consistency jednaki referentnoj izvedbi RFC 9162 |
| Regresija, fork, nedostupna vanjska povijest | Nema potpisa, žiga ni objave |
| Otvorena rezervacija koju baza ne reproducira (manje listova ili drugi korijen) | Nema poziva KMS-u, žiga ni objave; nema nove rezervacije; alarm |

## 13. Što slijedi

1. Neovisni review ovog dokumenta (D-93).
2. Vlasnikovi odgovori na O1 do O6, upisani zasebnim docs PR-om u `docs/DECISIONS.md`.
3. Zaseban mali PR usklađuje `BACKEND.md` §4.2 t. 1 s ovim dokumentom.
4. Izvedba (DAN-391, M3.9-P02 i dalje) po §4 do §8, s testovima iz §8 i §12.
