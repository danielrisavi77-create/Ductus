# Operacije

Stanje: 8. 11. 2026., na `main` od spajanja PR-a za DAN-588. Ovaj dokument je dokaz za GO redak „Operativni” iz `docs/PROGRAM.md` (odjeljak „GO uvjeti za stvarne studente”). Taj redak traži kontakt za podršku, postupak incidenta i imenovanu osobu na FPZG-u koja smije zaustaviti pilot.

Ovaj PR dodaje samo poglavlje „Pilot (M12)” (DAN-588, M12.1b). Kostur ostalih poglavlja dodaje DAN-540 (M11.3; Q-21 A u D-280): kontakt za podršku, opći postupak incidenta, deploy, kopije i probu povrata. Kad DAN-540 stigne, poglavlje o pilotu ostaje cjelina koju samo premješta na pravo mjesto.

Oznake su iste kao u `docs/privacy/README.md`:

- `[PRAVILO]`: potvrđeno pravilo, izvor je naveden.
- `[ODLUKA]`: odluka vlasnika, FPZG-a ili pravnika koja još nije donesena.
- `[DOKAZ]`: dokaz koji još ne postoji.
- `izgrađeno` ili `planirano`: postoji li to na `main`.
- `[PRIJEDLOG, nije odluka]`: postupak koji predlaže ovaj dokument, kao u `docs/PROGRAM.md` „Pilot M12: prijedlozi odgovora”. Takav postupak vrijedi tek kad ga odobri osoba navedena uz stavku.

Imena i kontakti osoba ne upisuju se u ovaj dokument dok se ne odluči o vidljivosti repoa (D-277 NQ02, `STATE.md` Owner queue). Do tada su mjesta za njih označena u uglatim zagradama.

## Pilot (M12)

### Okvir

- M12 je faza provedbe pilota, a ne faza razvoja (D-266 t. 5, D-191). `[PRAVILO]`
- Faze (D-203 E3, D-266 t. 8): **A** je tehnička proba sa sintetičkim radovima od 22. 2. 2027. Traje 4 puna tjedna i ne skraćuje se. **B** je nastava oko 22. 3. 2027. ili kasnije, tek nakon izlaza A i suglasnosti FPZG-a. **C** je evaluacija nakon 4. 6. 2027. `[PRAVILO]`
- Faza A ne počinje dok ugovor o obradi nije potpisan (D-266 t. 2, D-264 Q13). Do tada pristup operatera ima samo vlasnikov račun. `[PRAVILO]`
- Pragovi korisnosti i razumijevanja (`docs/PRODUCT.md` §12) zapisuju se u `docs/DECISIONS.md` prije faze A (D-266 t. 5, Q-12). Ovo poglavlje ih ne određuje. `[ODLUKA]`
- Nijedan tehnički pokazatelj iz dnevnog zapisa sam ne dovodi do ocjene ni posljedice za studenta (`docs/PRODUCT.md` §12). `[PRAVILO]`

### Uloge

Tri STOP uloge su Q-13 u Owner queueu (`STATE.md`). Odabir je „imenovati sve tri uloge prije razgovora s pravnikom”, a rok 15. 1. 2027. Vlasnik ih još nije imenovao. Dok ih ne imenuje, GO redak „Operativni” nije zelen.

| Uloga | Tko | Izvor | Stanje |
| --- | --- | --- | --- |
| Smije zaustaviti pilot | `[Q-13: imenovati]` | `docs/PROGRAM.md` GO redak „Operativni”; `docs/privacy/05-otvorena-pitanja.md` t. 12 | `[ODLUKA]` |
| Prijavljuje povredu podataka nadzornom tijelu (AZOP) u roku od 72 sata | `[Q-13: imenovati]` | Q-13 (P1); `docs/privacy/05-otvorena-pitanja.md` t. 12 | `[ODLUKA]` |
| Zamjenik vlasnika | `[Q-13: imenovati]` | Q-13 (P11) | `[ODLUKA]` |
| Koordinator pilota na FPZG-u: netehnička pitanja, produljenje roka, upute | `[Ustanova: imenovati]` | D-69; paket FPZG-u (Q-3, D-264 Q09) | `[ODLUKA]` |
| AAI administrator FPZG-a: problemi s AAI računom | `[Ustanova: imenovati]` | D-69 | `[ODLUKA]` |
| Tehnički kvarovi | vlasnik | D-69 | `[PRAVILO]` |

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

**Što se ne upisuje:** sadržaj rada, citati iz rada, imena studenata, AAI identifikatori ni drugi osobni podaci. Upisuju se samo brojevi i interni identifikatori incidenta. Pojedinosti sigurnosnog nalaza idu samo u nejavni zapis incidenta, a ovdje ostaje njegov ID. `[PRAVILO]` (`CLAUDE.md`, `docs/privacy/README.md` „Granice nacrta”)

**Faza C:** dnevni zapis se ne vodi. Ankete i razgovori iz evaluacije pohranjuju se odvojeno od evidencije pisanja i ne povezuju se s njom (C-22, `docs/PRODUCT.md` §12). `[PRAVILO]`

### STOP

**Okidači** (`docs/PROGRAM.md`, rečenica ispod tablice GO uvjeta): pilot se zaustavlja ako se dogodi kritičan neovlašten pristup, gubitak rada ili lažan status (npr. „spremljeno” a nije). `[PRAVILO]`

Okidač ne čeka dnevni zapis. Tko ga uoči, odmah javlja osobi koja smije zaustaviti pilot.

**Tko odlučuje:** `[Q-13: imenovati]`. Prijedlog O05 je u odjeljku „Uloge”.

**Postupak** `[PRIJEDLOG, nije odluka]`; odobrava vlasnik, a za korake koji se tiču FPZG-a FPZG:

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

**Granice:** ovo poglavlje ne određuje kako se izdanje tehnički isporučuje. Deploy i kopije su opseg DAN-540 i M11, a hosting čeka D-08 i B0.1.
