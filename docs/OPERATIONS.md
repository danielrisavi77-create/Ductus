# Operacije

Stanje: 9. 11. 2026. (DAN-540, M11.3-P04). Ovaj dokument je dokaz za GO redak „Operativni” iz `docs/PROGRAM.md` (odjeljak „GO uvjeti za stvarne studente”). Taj redak traži kontakt za podršku, postupak incidenta i imenovanu osobu na FPZG-u koja smije zaustaviti pilot.

Dokument ima četiri dijela: nositelje („Nositelji”), kontakt za podršku, četiri operativna postupka („Postupci”: pokretanje, gašenje, povrat, incident) i poglavlje „Pilot (M12)” (DAN-588, M12.1b).

**Provjera.** Svaki korak postupka imenuje naredbu koja postoji u repou (`Naredba:` i naredba u kodu) ili nositelja iz tablice „Nositelji” (`Nositelj:`). Za sada to provjerava samo review. Automatska provjera dokumenta planirana je u zasebnom zadatku (DAN-540, nalaz #1803 c.6751408864 je prvi ulaz). Dokument ne dokazuje da naredba radi na produkciji, ni da je nositelj imenovan; to piše uz svaki korak.

Oznake su iste kao u `docs/privacy/README.md`:

- `[PRAVILO]`: potvrđeno pravilo, izvor je naveden.
- `[ODLUKA]`: odluka vlasnika, FPZG-a ili pravnika koja još nije donesena.
- `[DOKAZ]`: dokaz koji još ne postoji.
- `izgrađeno` ili `planirano`: postoji li to na `main`.
- `[PRIJEDLOG, nije odluka]`: postupak koji predlaže ovaj dokument, kao u `docs/PROGRAM.md` „Pilot M12: prijedlozi odgovora”. Takav postupak vrijedi tek kad ga odobri osoba navedena uz stavku.

Imena i kontakti osoba ne upisuju se u ovaj dokument dok se ne odluči o vidljivosti repoa (D-277 NQ02, `STATE.md` Owner queue). Do tada su mjesta za njih označena u uglatim zagradama.

## Nositelji

Nositelj je uloga, ne osoba. Ključ u prvom stupcu je ono što korak postupka navodi iza `Nositelj:`. Ključ je samo naziv uloge, bez zagrada i oznaka; osoba se upisuje u stupac „Tko” kad se odluči o vidljivosti repoa.

| Nositelj | Odgovornost | Tko | Izvor | Stanje |
| --- | --- | --- | --- | --- |
| `vlasnik` | tehnički kvarovi, deploy, migracije na produkciju, kopije, povrat, zapis incidenta | vlasnik | D-69; `CLAUDE.md` (migracije ne primjenjuje agent) | `[PRAVILO]` |
| `zamjenik vlasnika` | zamjenjuje vlasnika u njegovoj odsutnosti | `[Q-13: imenovati]` | Q-13 (P11) | `[ODLUKA]` |
| `zaustavlja pilot` | smije zaustaviti pilot | `[Q-13: imenovati]` | `docs/PROGRAM.md` GO redak „Operativni”; `docs/privacy/05-otvorena-pitanja.md` t. 12 | `[ODLUKA]` |
| `prijavljuje povredu` | prijavljuje povredu podataka nadzornom tijelu (AZOP) u roku od 72 sata | `[Q-13: imenovati]` | Q-13 (P1); `docs/privacy/05-otvorena-pitanja.md` t. 12 | `[ODLUKA]` |
| `DPO ustanove` | službenik za zaštitu podataka FPZG-a; sudjeluje u odluci o prijavi povrede | `[Ustanova: imenovati]` | D-69; paket FPZG-u (Q-3) | `[ODLUKA]` |
| `koordinator pilota` | netehnička pitanja na FPZG-u: produljenje roka, upute, obavijest nastavnicima i studentima | `[Ustanova: imenovati]` | D-69; paket FPZG-u (Q-3, D-264 Q09) | `[ODLUKA]` |
| `AAI administrator` | problemi s AAI@EduHr računom | `[Ustanova: imenovati]` | D-69 | `[ODLUKA]` |

Dok uloge iz Q-13 nisu imenovane (rok 15. 1. 2027.), GO redak „Operativni” nije zelen, iako provjera koraka prolazi.

## Kontakt za podršku

- Raspodjela (D-69): netehnička pitanja ide `koordinator pilota`, problemi s AAI računom `AAI administrator`, tehnički kvarovi `vlasnik`. `[PRAVILO]`
- Kanal je gumb „Prijavi problem” u aplikaciji; šalje stanje spremanja i verziju aplikacije, bez sadržaja rada (D-69). `planirano`
- Adresa e-pošte za podršku dok gumb ne postoji, i radno vrijeme podrške. `[ODLUKA]` vlasnika; ne upisuje se dok je repo javan.
- Ako Ductus ne radi u zadnja 24 sata prije roka, vrijedi zamjenski postupak predaje koji FPZG propisuje unaprijed (D-69). `[ODLUKA]` FPZG-a.

## Postupci

Postupci vrijede za lokalni stog (`izgrađeno`) i za produkciju, koja još ne postoji: hosting čeka D-08 i B0.1. Korak koji se tiče produkcije zato ima nositelja, a ne naredbu. Adresa `http://localhost:3000` je lokalna; na produkciji se iste rute zovu na adresi izdanja. Postupci su `[PRIJEDLOG, nije odluka]` osim stavki označenih kao `[PRAVILO]`; odobrava vlasnik.

### Pokretanje

1. Instaliraj ovisnosti točno prema lockfileu. Naredba: `pnpm install --frozen-lockfile`. `izgrađeno`
2. Podigni lokalni stog, primijeni migracije na lokalnu bazu, upiši sintetičke podatke i pokreni aplikaciju na `localhost:3000`. Naredba: `pnpm local:up`. Aplikacija odbija start bez valjanog `APP_DATABASE_URL` (`src/server/env.ts`). `izgrađeno`
3. Provjeri da proces odgovara. Naredba: `curl -fsS http://localhost:3000/api/health`. `izgrađeno`
4. Provjeri spremnost po sposobnosti: `database`, `storage`, `signing`, `queue` (`ok`, `nedostupno` ili `nije_konfigurirano`). Naredba: `curl --fail-with-body -sS http://localhost:3000/api/ready`; odgovor `503` sa stanjem `draining` znači da se proces gasi, a `503` sa sposobnošću koja nije `ok` znači da ta sposobnost (npr. `database`) nije spremna; u oba slučaja promet se ne pušta na repliku (DAN-585, `app/api/ready/route.ts`). `izgrađeno`
5. Deploy zamrznutog izdanja na produkciju i primjena migracija na produkcijsku bazu. Nositelj: `vlasnik`. Agent ne primjenjuje migracije na produkciju (`CLAUDE.md`). `[PRAVILO]`; deploy je `planirano`.
6. U fazama A i B upiši izdanje (puni commit SHA) i stanje spremnosti u dnevni zapis. Nositelj: `vlasnik`.

### Gašenje

1. Pošalji web procesu signal `SIGTERM` (u terminalu `Ctrl+C` šalje `SIGINT`). Naredba: `kill -TERM <pid>`. Proces ne prima novi rad, `/api/ready` odgovara `503` sa stanjem `draining`, a rad u tijeku ima do 8 s (`SHUTDOWN_GRACE_MS`, `src/server/shutdown.ts`). Nakon roka proces izlazi s kodom 1 i zatvorenim kodom `SHUTDOWN_DEADLINE` u zapisu (DAN-587). `izgrađeno`
2. Worker se gasi istim signalom: posao u tijeku završava, a novi se odbija kodom `SHUTTING_DOWN`. Nositelj: `vlasnik`. `planirano`: ulaz workera je DAN-518.
3. Zaustavi lokalne servise, a podatke sačuvaj. Naredba: `docker compose stop`. `izgrađeno` Ne koristi `pnpm stack:down` kad podatke treba sačuvati, jer briše volumene i lokalnu bazu (`docker compose down -v`).
4. Gašenje produkcije. Nositelj: `vlasnik`. `planirano`
5. Upiši vrijeme i razlog gašenja u dnevni zapis (faze A i B) ili u zapis incidenta. Nositelj: `vlasnik`.

### Povrat

1. Odluči što se vraća (kod na prethodno izdanje ili podaci iz kopije), na koje izdanje i zašto; ako povrat prati incident, upiši njegov ID. Nositelj: `vlasnik`.
2. Ugasi aplikaciju po postupku „Gašenje”. Naredba: `kill -TERM <pid>`.
3. Vrati prethodno zamrznuto izdanje (puni commit SHA iz dnevnog zapisa) na produkciju. Nositelj: `vlasnik`. `planirano`
4. Samo ako je u koraku 1 odlučeno da se vraćaju podaci (ne samo kod): vrati bazu i pohranu iz kopije; inače preskoči korak jer bi novije podatke prepisao stariji. Nositelj: `vlasnik`. `planirano`: kopije i proba povrata su M11.2-P04 (D-277 NQ05). Dok proba povrata ne prođe, povrat iz kopije nije dokazan. `[DOKAZ]`
5. Provjeri stanje migracija. Naredba: `pnpm db:status`. Naredba gleda samo lokalnu bazu; usporedba s `db/migrations.sum` (D-91) na produkciji ide uz korak 3.
6. Pokreni po postupku „Pokretanje” i provjeri spremnost. Naredba: `pnpm local:up`, `curl --fail-with-body -sS http://localhost:3000/api/ready`.
7. Provjeri rekonstrukciju predanih radova na vraćenom izdanju; prag je 100 %, a svako odstupanje blokira izdanje (`docs/PRODUCT.md` §12). Nositelj: `vlasnik`. `[PRAVILO]`; alat je `[DOKAZ]`.
8. Upiši povrat u dnevni zapis: izdanje prije i poslije, razlog i ID incidenta. Nositelj: `vlasnik`.

Što povrat iz kopije radi s podacima obrisanima nakon nastanka kopije otvoreno je (D-12, Q-16; rok čuvanja D-30 je PRIJEDLOG). `[ODLUKA]`

### Incident

1. Otvori zapis incidenta s ID-om i vremenom (UTC). U dnevni zapis i javni repo ide samo ID; pojedinosti sigurnosnog nalaza nikad ne idu u javni repo (`CLAUDE.md`, „Vanjski botovi”). Nositelj: `vlasnik` ili `zamjenik vlasnika`. `[PRAVILO]` za javni repo.
2. Provjeri spremnost po sposobnosti. Naredba: `curl --fail-with-body -sS http://localhost:3000/api/ready`.
3. Pregledaj zapise poslužitelja: JSON redci na stdout i stderr, bez osobnih podataka i sadržaja rada (`src/server/log/logger.ts`, DAN-586). Nositelj: `vlasnik`.
4. U pilotu: ako je incident okidač STOP-a (neovlašten pristup, gubitak rada, lažan status), odluka o zaustavljanju ide po odjeljku „STOP”. Nositelj: `zaustavlja pilot`.
5. Ako incident uključuje povredu osobnih podataka, odluči o prijavi AZOP-u u roku od 72 sata. Nositelj: `prijavljuje povredu`, `DPO ustanove`.
6. Ograniči štetu: gašenje po postupku „Gašenje” ili povrat po postupku „Povrat”. Nositelj: `vlasnik`.
7. Ispravak ide kao novo izdanje kroz puni gate iz `docs/ENGINEERING_SYSTEM.md` §5 i §10. Nositelj: `vlasnik`. `[PRAVILO]`
8. Zatvori zapis: uzrok, ispravak, izdanje i provjera rekonstrukcije. U pilotu obavijesti FPZG. Nositelj: `vlasnik`, `koordinator pilota`.

## Pilot (M12)

### Okvir

- M12 je faza provedbe pilota, a ne faza razvoja (D-266 t. 5, D-191). `[PRAVILO]`
- Faze (D-203 E3, D-266 t. 8): **A** je tehnička proba sa sintetičkim radovima od 22. 2. 2027. Traje 4 puna tjedna i ne skraćuje se. **B** je nastava oko 22. 3. 2027. ili kasnije, tek nakon izlaza A i suglasnosti FPZG-a. **C** je evaluacija nakon 4. 6. 2027. `[PRAVILO]`
- Faza A ne počinje dok ugovor o obradi nije potpisan (D-266 t. 2, D-264 Q13). Do tada pristup operatera ima samo vlasnikov račun. `[PRAVILO]`
- Pragovi korisnosti i razumijevanja (`docs/PRODUCT.md` §12) zapisuju se u `docs/DECISIONS.md` prije faze A (D-266 t. 5, Q-12). Ovo poglavlje ih ne određuje. `[ODLUKA]`
- Nijedan tehnički pokazatelj iz dnevnog zapisa sam ne dovodi do ocjene ni posljedice za studenta (`docs/PRODUCT.md` §12). `[PRAVILO]`

### Uloge

Tri STOP uloge su Q-13 u Owner queueu (`STATE.md`). Odabir je „imenovati sve tri uloge prije razgovora s pravnikom”, a rok 15. 1. 2027. Vlasnik ih još nije imenovao. Dok ih ne imenuje, GO redak „Operativni” nije zelen.

Uloge su u tablici „Nositelji” na početku dokumenta: `zaustavlja pilot`, `prijavljuje povredu`, `zamjenik vlasnika`, `koordinator pilota`, `AAI administrator` i `vlasnik` za tehničke kvarove.

O05 iz `docs/PROGRAM.md` je samo prijedlog. Po njemu zaustaviti pilot može svatko od dvoje sam, koordinator FPZG-a ili operater, a ponovno pokretanje traži oboje i zapis incidenta. Ulogu imenuje FPZG. `[PRIJEDLOG, nije odluka]`

### Dnevni zapis

Dnevni zapis je jedan unos za svaki radni dan u fazama A i B. Pokazuje da su pilot i zamrznuto izdanje bili pod nadzorom, a izvor je za odluku o STOP-u, za izlaz A i za završno izvješće faze C. Polja i postupak su `[PRIJEDLOG, nije odluka]`; odobrava ih vlasnik.

**Tko piše:** vlasnik, a u njegovoj odsutnosti zamjenik vlasnika (`[Q-13: imenovati]`).

**Gdje:** `[ODLUKA vlasnika]`. Zapis o incidentu ne smije biti na javnom mjestu, jer sigurnosne pojedinosti nikad ne idu u javni repo (`CLAUDE.md`, „Vanjski botovi”). Dok je repo javan, dnevni zapis nije u repou.

**Polja unosa:**

| Polje | Sadržaj | Izvor | Stanje izvora |
| --- | --- | --- | --- |
| Datum i faza | npr. `2027-02-23`, faza A | | |
| Izdanje | oznaka i puni commit SHA zamrznutog izdanja (vidi „Zamrznuto izdanje”) | zapis o izdanju | `planirano` |
| Spremnost | stanje po sposobnosti: `database`, `storage`, `signing`, `queue` | `/api/ready` (`app/api/ready/route.ts`, `src/server/ready.ts`, DAN-585) | `izgrađeno` |
| Rekonstrukcija | broj predanih radova i broj podudarnih; prag je 100 %, a svako odstupanje blokira izdanje | `docs/PRODUCT.md` §12 | provjera po izdanju `[DOKAZ]` |
| Izgubljen rad | broj slučajeva; prag je 0 | `docs/PRODUCT.md` §12 | `[DOKAZ]` |
| Neovlašten pristup | broj slučajeva; prag je 0 | `docs/PRODUCT.md` §12 | `[DOKAZ]` |
| Lažan status | broj slučajeva u kojima je sučelje pokazalo da je rad pohranjen, a nije | `docs/PROGRAM.md`, uvjet zaustavljanja | `[DOKAZ]` |
| Prijave problema | broj i kategorija, bez sadržaja rada | gumb „Prijavi problem” (D-69) | `planirano` |
| Pravednost | slučajevi u kojima je legitiman način rada izazvao neopravdanu sumnju; svaki se analizira | `docs/PRODUCT.md` §12 | `[DOKAZ]` |
| Promjene | promjena izdanja ili konfiguracije toga dana, s razlogom | „Zamrznuto izdanje” | |
| STOP | „nema okidača” ili upućivanje na zapis incidenta | „STOP” | |
| Upisao | uloga, bez imena dok je repo javan | | |

**Što se ne upisuje:**

- U javni repo ne ide nijedan stvarni osobni ni studentski podatak, a od sigurnosnog nalaza samo njegov ID i status; pojedinosti nikad ne idu u javni repo. Ovo vrijedi za svaki dio dnevnog zapisa koji završi u repou. `[PRAVILO]` (`CLAUDE.md`, „Vanjski botovi”; `docs/privacy/README.md` „Granice nacrta”)
- Za sam dnevni zapis, gdje god ga vlasnik smjesti: ne upisuju se sadržaj rada, citati iz rada, imena studenata, AAI identifikatori ni drugi osobni podaci, nego samo brojevi i interni identifikatori incidenta; pojedinosti sigurnosnog nalaza idu samo u nejavni zapis incidenta. `[PRIJEDLOG, nije odluka]`; odobrava vlasnik. Navedena pravila uređuju javni repo i nacrte privatnosti, ne nejavni operativni zapis, pa ovo za nejavno mjesto još nije odluka.

**Faza C:**

- Ankete i razgovori iz evaluacije pohranjuju se odvojeno od evidencije pisanja i ne povezuju se s njom. `[PRAVILO]` (C-22, `docs/PRODUCT.md` §12)
- Dnevni zapis se u fazi C ne vodi. `[PRIJEDLOG, nije odluka]`; odobrava vlasnik. C-22 propisuje samo odvajanje evaluacije od evidencije pisanja, ne prestanak dnevnog zapisa.

### STOP

**Okidači** (`docs/PROGRAM.md`, rečenica ispod tablice GO uvjeta): pilot se zaustavlja ako se dogodi kritičan neovlašten pristup, gubitak rada ili lažan status (npr. „spremljeno” a nije). `[PRAVILO]`

Okidač ne čeka dnevni zapis. Tko ga uoči, odmah javlja osobi koja smije zaustaviti pilot.

**Tko odlučuje:** `[Q-13: imenovati]`. Prijedlog O05 je u odjeljku „Uloge”.

**Postupak** `[PRIJEDLOG, nije odluka]`; odobrava vlasnik, a za korake koji se tiču FPZG-a FPZG. Opći postupak „Incident” iz „Postupci” vrijedi i u pilotu; ovi koraci ga dopunjuju za STOP:

1. **Odluka i vrijeme.** Osoba koja smije zaustaviti pilot zapisuje okidač, vrijeme odluke (UTC) i izdanje na kojem se okidač dogodio. Zapis incidenta dobiva ID; u dnevni zapis ide samo taj ID.
2. **Zamjenski postupak.** Studenti i nastavnici koriste zamjenski postupak predaje koji FPZG propisuje unaprijed (D-69). Zaustavljanje nema posljedica za studenta (`docs/PRODUCT.md` §12). Zamjenski postupak propisuje FPZG. `[ODLUKA]`
3. **Obavijest.** Koordinator FPZG-a obavještava nastavnike i studente. Kanal određuje FPZG. `[ODLUKA]`
4. **Tehničko zaustavljanje.** Mehanizam u aplikaciji (zaslon operatera sa statusom pilota i STOP porukom, `docs/design/EKRANI.md` red 19) je `planirano` za M12. Dok ne postoji, način zaustavljanja određuje vlasnik. `[ODLUKA]` Pri zaustavljanju se ne brišu podaci ni zapisi; brisanje ide samo po pravilima čuvanja i povlačenja (D-12).
5. **Povreda osobnih podataka.** Ako okidač uključuje povredu osobnih podataka, o prijavi nadzornom tijelu u 72 sata odlučuje uloga iz Q-13 (`[Q-13: imenovati]`), zajedno s DPO-om FPZG-a. Tko u ustanovi prima obavijest otvoreno je pitanje `docs/privacy/05-otvorena-pitanja.md` t. 12. `[ODLUKA]`
6. **Ispravak.** Ispravak ide kao novo izdanje kroz puni gate iz `docs/ENGINEERING_SYSTEM.md` (vidi „Zamrznuto izdanje”). Migracije na produkciju ne primjenjuje agent (`CLAUDE.md`). `[PRAVILO]`

**Ponovno pokretanje:** prema O05 traži oboje, koordinatora FPZG-a i operatera, te zapis incidenta. `[PRIJEDLOG, nije odluka]` Dok FPZG ne odluči, pilot se ponovno pokreće samo uz zapis incidenta i uz izdanje na kojem je ispravak potvrđen.

**Faza A:** radovi su sintetički, pa okidač ne pogađa studente. Okidač u fazi A znači da izlaz A nije postignut, a proba se nastavlja s novim izdanjem. Ne skraćuje se (D-203 E3). `[PRIJEDLOG, nije odluka]`

### Zamrznuto izdanje

Zamrznuto izdanje je jedno točno određeno izdanje aplikacije na kojem pilot radi. Promjene mogu ići samo kroz postupak iz ovog odjeljka. Cilj je da se izmjereni pokazatelji (rekonstrukcija, izgubljen rad, lažan status) odnose na poznat kod. Odjeljak je `[PRIJEDLOG, nije odluka]` osim stavki označenih kao `[PRAVILO]`; odobrava vlasnik.

**Identifikator izdanja:** puni commit SHA s `main` i oznaka izdanja, upisani u dnevni zapis od prvog dana faze A. Uz to ide stanje migracija, sažetak iz `db/migrations.sum` (D-91 t. 1). Popis isporučenih komponenti (SBOM) dodaje se kad postoji (M11.9 u `docs/PROGRAM-RAZRADA.md`, `planirano`).

**Kada se zamrzava:** na ulasku u fazu A. Izlaz A potvrđuje to izdanje, a faza B počinje na istom izdanju ili na izdanju koje je prošlo isti izlazni prolaz A.

**Dopuštene promjene za vrijeme faza A i B:**

- ispravak okidača STOP-a;
- ispravak kritičnog sigurnosnog nalaza (u javnom repou samo ID nalaza);
- ispravak kvara zbog kojeg rekonstrukcija nije podudarna. Svako odstupanje rekonstrukcije blokira izdanje (`docs/PRODUCT.md` §12). `[PRAVILO]`

Nova funkcija, novi tekst sučelja i promjena koja nije ispravak ne idu u zamrznuto izdanje. Čekaju kraj faze B ili vlasnikovu izričitu iznimku zapisanu u dnevni zapis.

**Svaka promjena izdanja:**

1. Prolazi puni gate za svoju razinu rizika (`docs/ENGINEERING_SYSTEM.md` §5 i §10). `[PRAVILO]`
2. Novo izdanje dobiva novi identifikator i upisuje se u dnevni zapis s razlogom i ID-om incidenta, ako postoji.
3. Migraciju na produkciju primjenjuje vlasnik, ne agent (`CLAUDE.md`). `[PRAVILO]`
4. Rekonstrukcija predanih radova provjerava se i na novom izdanju; odstupanje blokira izdanje (`docs/PRODUCT.md` §12). `[PRAVILO]`
5. Promjena se ne uvodi u zadnja 24 sata prije roka predaje nekog zadatka u pilotu, osim ispravka okidača STOP-a. Rokovi u pilotu su radnim danom u podne (D-69).

**Granice:** ovo poglavlje ne određuje kako se izdanje tehnički isporučuje. Pokretanje, gašenje i povrat su u „Postupci”; deploy na produkciju i kopije su `planirano` (M11.2), a hosting čeka D-08 i B0.1.
