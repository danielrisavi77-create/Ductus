# Backend: worker, poslovi, rekonstrukcija i predaja

Dio plana backenda. Verzija, status i popis svih odjeljaka su u indeksu `docs/BACKEND.md`; brojevi odjeljaka su isti kao u indeksu, pa referenca "`BACKEND.md` §N" vodi ovamo.

### 4.5 Poslovi, obavijesti, AI

- pg-boss u workeru, `migrate: false` (njegovu shemu vodi `ductus_migrator`). **Tijela poslova su samo ID-ovi** (test).
- Obavijest nastavniku o novoj reviziji nastaje **najviše jednom po P-03 prozoru** (D-39 potvrđena; odnos s D-06 otvoren u Owner queue, do odluke vrijedi D-06), pa polling od 30 do 60 s ne pretvara pogled u uživo (D-06). Test.
- AI proxy (u pilotu, D-194; mijenja D-77) je obična Next.js ruta koja provodi popis dopuštenih pružatelja po fakultetu i zadatku, bez automatskog prelaska na pružatelja izvan popisa, uz ograničenje troška po studentu (pojedinosti ispod). Pružatelj i model računa još nisu odlučeni (D-194 t. 6 i 7, PRIJEDLOG), pa su `provider.only` i `data_collection: deny` iz ranijeg teksta o OpenRouteru samo primjer jamstva koje pružatelj mora dati ugovorom, ne odabrana tehnika. Kineski pružatelji i modeli kineskih tvrtki ne smiju biti dostupni (D-194 t. 2); PRIJEDLOG izvedbe: zabrana je u kodu, ne samo u konfiguraciji fakulteta, s negativnim testom. Ako se čuva ključ, šifrira se aplikacijski: AES-256-GCM, KEK iz okoline, **AAD = `user_id` + namjena + verzija ključa**. Ne `pgsodium` (u najavi ukidanja).
  - **Ograničenje troška (zahtjev za M9.2).** Ograničenje vrijedi po studentu, kao prije D-194, i ne ovisi o modelu računa (D-194 t. 6, PRIJEDLOG): ako trošak snosi operater, jedan račun ili ukradena sesija bez njega mogu potrošiti proračun svih studenata. Proxy prije poziva pružatelja provjerava tri granice i odbija poziv koji bi prešao bilo koju:
    - po studentu i zadatku u danu;
    - po studentu u danu, za sve zadatke zajedno;
    - gornja granica operatera po ustanovi i za cijelu uslugu. Ustanova ne može postaviti granicu iznad nje.
  - Granice se broje na poslužitelju po računu iz sesije, nikad po vrijednosti iz zahtjeva. Potrošnja se rezervira u istoj transakciji u kojoj se granica provjerava, prije poziva pružatelja, pa paralelni zahtjevi istog računa ne prelaze granicu; nakon odgovora rezervacija se svodi na stvarni trošak. Odbijeni poziv ne doseže pružatelja. Testovi: paralelni zahtjevi istog računa na rubu granice; potrošnja jednog studenta ne mijenja granicu drugoga; dosegnuta granica operatera odbija svaki poziv; vrijednost iz zahtjeva ne mijenja granicu.
  - **Alati pružatelja (C-37, zahtjev za M9.2).** D-194 t. 4 uključuje alate pružatelja (npr. pretraga weba, izvršavanje koda, datoteke). Uz njih podmetnuta uputa u tekstu rada ili uvezenoj datoteci može tražiti dohvat adrese koja nosi dio rada, pa C-37 vrijedi i za alate:
    - popis dopuštenih alata drži poslužitelj po zadatku; zahtjev klijenta ga ne proširuje, a zahtjev s alatom izvan popisa se odbija;
    - nema odlaznog dohvaćanja adrese koju bira model ili koja dolazi iz teksta rada ili uvezene datoteke; izvršavanje koda je bez mrežnog pristupa;
    - rezultat alata je nepouzdan podatak kao tekst rada: šalje se omeđen, s ograničenjem veličine, i nikad ne mijenja pravila zadatka ni upute.
    - **Odlučeno 1. 11. 2026. (Daniel; https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6551403710):** alati su po zadanom isključeni, a nastavnik ih uključuje za svaki zadatak posebno, kao namjene razine 2 iz D-64. Pravila iznad vrijede i kad je alat uključen.
    - Testovi: podmetnuta uputa u uvezenom DOCX-u ne uključuje alat i ne izaziva odlazni dohvat; alat koji zadatak ne dopušta se odbija; rezultat alata iznad granice veličine se reže.
- Uvoz DOCX i PDF: parsira se **u pregledniku ili u izoliranom poslu** s ograničenjem veličine i vremena (zip bombe, XXE), nikad u web procesu.

### 4.6 Rekonstrukcija i predaja

- Isti kod kao klijent (ProseMirror u Nodeu) u workeru, u kontejneru s ograničenim CPU-om da ne guši ingest. B0.2 mjeri 15.000 riječi (pilot) i 80.000 (doktorski, izvan pilota, `PROGRAM.md`).
- **Vrijeme predaje je `requested_at` iz sata baze u trenutku klika**, prije reda rekonstrukcija. Potvrda nosi to vrijeme. Nepodudarnost nakon roka ide u zamjenski postupak s očuvanim `requested_at`. Jedan izvor vremena za sve pravno relevantne trenutke: sat baze; prikaz u Europe/Zagreb. Load test (B9): 100 % predaja u 15 minuta prije roka.
- Kontrolne točke s punim tekstom: B0.2 (`docs/spikes/B0.2.md`) pokazao je da svakih 200 koraka volumen raste kvadratno; PRIJEDLOG je oko 2.000 koraka, odluka uz B0.3.
