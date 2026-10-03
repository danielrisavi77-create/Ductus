# Ductus: plan i program backenda

Verzija 0.1 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi · Status: PRIJEDLOG (čeka potvrdu D-08, D-71 do D-75)

Ovaj dokument zamjenjuje otvoreni D-08. Nastao je iz triju izvora: dokument "Pisač: Backend arhitektura i vizija vNext" (3. 10. 2026., dalje vNext), istraživanje opcija hostinga, potpisa i vremena te prijave i ovlasti (3. 10. 2026., sirovi izvještaji nisu u repou), i `ARCHITECTURE.md` v0.2. Brojke o cijenama su bez PDV-a, s datumom 3. 10. 2026., i označeno je što nije potvrđeno s izvora. Kad se ovaj dokument potvrdi, `ARCHITECTURE.md` se prepisuje prema njemu (zadatak B0.4).

## 1. Sažetak odluke

| Pitanje | Preporuka | Zašto |
| --- | --- | --- |
| Je li Supabase prava osnova? | **Ne za Ductus.** | Edge Functions imaju 2 s CPU i 256 MB, a rekonstrukcija rada od 80.000 riječi traži više. PITR je dodatak od 100 USD mjesečno (sam premašuje budžet). Vault ima jedan korijenski ključ projekta. Next.js ionako ne radi na Supabaseu, pa bi trebao drugi host. Gubi se i većina razloga za Supabase kad nema PostgRESTa ni klijentskog pristupa bazi. |
| Aplikacija | Next.js (standalone, Docker) i zaseban worker proces na Hetzner VPS-u (Njemačka ili Finska) | CPU bez limita, 16 EUR mjesečno za 8 vCPU / 16 GB |
| Baza | Upravljani PostgreSQL na Scalewayu (Francuska ili Nizozemska) | Backupi i PITR su posao dobavljača, ne tvoj. **PITR na najmanjem tipu (DB-DEV-S) nije potvrđen**, to je prvi spike |
| Objekti | Scaleway Object Storage (S3, privatni bucket) | 0,016 EUR/GB, standardni S3, bez lock-ina |
| E-pošta | Scaleway TEM | oko 1 do 2 EUR mjesečno za 5.000 poruka |
| Prijava | Vlastiti OIDC klijent prema AAI@EduHr s našim sesijama u bazi (Better Auth s generic OAuth pluginom ili `openid-client`, odluka na M1 spikeu) | Jedan pružatelj, bez automatskog spajanja računa po e-pošti, nema ovisnosti o Supabase Authu |
| Ovlasti | Postgres RLS + `SECURITY DEFINER` funkcija `can()` + pgTAP; bez OpenFGA | Pet vrsta odnosa, nijedna tranzitivna. Odgovara D-07 |
| Potpisi | Ed25519 ključ aplikacije (šifriran, KEK iz okoline) iza sučelja `SigningKeyProvider`; KMS tek na okidač | KMS ne štiti od kompromitirane aplikacije (napadač i dalje zove Sign). Zaštitu daje vanjski žig (niže) |
| Neovisno vrijeme | **Dnevni potpisani korijen + RFC 3161 žig (FINA) već u valu 1**, javno objavljen | Jedina jeftina mjera koja odgovara na "što ako operater prepiše povijest". Oko 40 EUR godišnje, pomiče D-10 iz "nakon pilota" |
| Transparency log, C2PA, QTSP paket | Ne u pilotu | Vidi §2 |
| Red poslova | pg-boss u worker procesu | Bez Redisa i dodatnih servisa |
| Obavijesti | Polling lagane krajnje točke (30 do 60 s) | P-03 kaže najviše svakih 5 minuta, realtime servis nije potreban |
| Procjena troška prve godine | oko 450 do 600 EUR | unutar D-66 (infrastruktura + domena + e-pošta); vidi §7 |

Ostaje jedan rizik koji se ne smije preskočiti: **jedan VPS je jedna točka kvara**. To je prihvatljivo za pilot samo uz dokazanu probu povrata, hladni rezervni poslužitelj podignut iz koda (OpenTofu) i zamjenski postupak predaje koji FPZG propisuje (D-69).

## 2. Što uzimamo iz vNext dokumenta, što odgađamo

vNext je dobar kao ciljna arhitektura i kao popis načela. Nije plan za pilot: pretpostavlja Azure, OpenFGA, Tesseru, PowerSync, .NET servis za dokumente, regionalne ćelije i C2PA. Jedan čovjek s budžetom od 1000 EUR to ne može održavati, a ništa od toga ne mijenja ono što pilot mora dokazati. Zato:

### Prihvaćamo bez izmjene

- Svih 12 načela (§2 vNext): nema tihog last-write-winsa, identitet nije ovlast, dokaz nije presuda, lokalno nije kanonsko, audit nije dokaz, AI nije kritičan za dostupnost, server ne izmišlja povijest (praznine ostaju praznine), povrat stvara novu reviziju, privatnost kroz arhitekturu.
- Protokol commita (CAS, server dodjeljuje broj revizije, idempotencija, `STALE_BASE`).
- Evidence v2 (R1): JCS RFC 8785 + SHA-256, **točni bajtovi s mreže jednaki ponovno izračunatom JCS nizu**, kontinuirani raspon slijeda, lanac hasheva prije/poslije.
- Redoslijed R4: nepromjenjivi zapis objekta, zatim atomarna rezervacija u bazi (`FOR UPDATE` na paketu, provjera konteksta, idempotencije i prethodnika, dodjela `receiptId` i `acceptedAt`, pomak glave lanca u istoj transakciji), zatim potpis, zatim priključivanje potpisa. Stanje `pending_signature` s ponovljivim potpisom iste prihvaćene stvari.
- Idempotencija: pregled postojećeg prihvaćanja **prije** ponovnog uploada i prije provjere `acceptsEvidence`; isti ključ s drugim opisnikom je `IDEMPOTENCY_CONFLICT`.
- Razdvajanje svrha ključeva: ključ potvrda i ključ dnevnog korijena su različiti (dva Ed25519 ključa), enkripcija tajni treći mehanizam.
- Matrica kvarova (§32) i **Definition of Done za komponentu** (§38). Preuzimamo je u §6 ovog dokumenta kao obveznu kontrolnu listu.
- Protokol evolucije shema: svaki trajni format ima verziju, nikad se ne reinterpretiraju stari bajtovi, `expand, migrate, contract`, jasan `upgrade_required` za predugo offline klijente.
- Command gateway kao pravilo: nema "insert row" ni "upload object" kao proizvodnog API-ja. U Ductusu je to prirodno, jer klijent nikad ne govori izravno s bazom.
- Break-glass za administratora (korak-gore provjera, razlog, uski opseg, istek, nepromjenjiv trag), u pojednostavljenom obliku: administratorski pristup sadržaju traži razlog i ide u `audit`.
- Raw tekst nikad u operativne logove; sigurnosni događaji su zapisi domene, ne linije loga.

### Odgađamo, s okidačem (nadopuna `ARCHITECTURE.md` §11)

| vNext | Okidač za usvajanje | Što radimo umjesto toga |
| --- | --- | --- |
| R5 Tessera, javni transparency log | Netko izvana stvarno ospori zapis, ili ustanova traži neovisnog svjedoka | Vlastito Merkle stablo (oko 100 redaka, `@noble/hashes`), testirano na vektorima iz `transparency-dev/merkle`; dnevni potpisani korijen u javnom repozitoriju. Tessera je Go biblioteka i prekompleksna; Rekor v2 nije za privatne zapise; mreža svjedoka je još u razvoju |
| R6 eIDAS kvalificirani žig | Pravni postupak koji traži pravnu presumpciju | RFC 3161 žig FINA-e nad dnevnim korijenom (oko 0,11 EUR po žigu). Pravni učinak kvalificiranog žiga ne tvrdimo bez odvjetnika |
| R7 C2PA | Kad SDK stvarno podrži DOCX; službena tablica `c2pa-rs` navodi PDF, ne DOCX | Odvojeni potpisani paket dokaza uz predaju; za PDF kasnije PAdES |
| R8 OpenFGA | Odnosi postanu tranzitivni ili hijerarhijski, ili više servisa treba iste odluke | `can()` u SQL-u; `authz/*.fga` iz pisac-editora ostaje specifikacija za pgTAP |
| Azure Key Vault, AWS KMS | Prvi plaćeni ugovor ili sigurnosni pregled koji to traži | `SigningKeyProvider` je već u R3/R4 s adapterima; prebacivanje je konfiguracija |
| PowerSync | Stvarno offline stanje osim dokumenta | Dexie |
| R9 LTI 1.3, Edu-API, ISVU | Srce prihvati Merlin alat, ili više od 3 kolegija | AAI@EduHr OIDC |
| R11 .NET servis za dokumente | Izvezeni DOCX ne prolazi stvarni Word korpus | Postojeći DOCX izvoz iz pisac-editora i WordReplica kao orakul |
| R12 regionalne ćelije | Prva ustanova izvan EU-a | Jedan EU okoliš |
| Temporal | Dugotrajni višekoračni tokovi s ljudskim odobrenjem | pg-boss |
| EvidenceProfile "High Assurance" i "Controlled" | Ispiti pod nadzorom | Profili Ductusa: standard (eseji, seminari) i pregled (mentorski radovi, D-56) |

### Ne usvajamo

- Azure Key Vault kao zadani potpisnik. Dokumentacija ne navodi Ed25519 za Azure, a Ductus potvrde su Ed25519 (D-10). Adapter ostaje u kodu kao opcija, ne kao zadani put.
- `Principal` s `authenticationContext`, `affiliations` i brokerom federacije (SATOSA) prije druge ustanove. Zadržavamo tanko sučelje `Principal` (`id`, `issuer`, `externalSubject`, `homeOrg`) kako se prijava ne bi razlila kroz kod, ali bez brokera.

### Nešto što dokument ne rješava, a mi moramo

- **Prijenos koda.** `ARCHITECTURE.md` §12 trenutno ne navodi R1 do R4. Treba ih dodati: `src/domain/forensics` (JCS, lanac, potvrde, već navedeno), `src/domain/evidence`, `src/adapters/crypto/*`, `src/lib/evidence/*`, sučelja repozitorija i spremišta objekata, SQL migracije `evidence_r4_*`. **Adapteri `supabase-evidence-*` ne prenose se**; zamjenjuju ih `pg-evidence-*` (običan `pg` klijent prema istim RPC funkcijama) i `s3-evidence-payload-store`. Ugovorni testovi koji sada rade nad Supabase adapterima postaju ugovorni testovi koji rade nad oba (in-memory i pg/S3).
- **Sesija bez Supabasea.** RLS politike u pisac-editoru koriste `auth.uid()`. U Ductusu aplikacijska uloga u svakoj transakciji postavlja `set_config('app.user_id', ..., true)` i `app.institution_id`, a politike čitaju `current_setting`. Bez toga RLS ne postoji. To je prvi pgTAP test (anonimna uloga nema ništa, uloga bez postavljenog korisnika nema ništa).
- **Granica tvrdnji.** vNext najviša poštena tvrdnja (§1) uzima se doslovno kao tekst za sučelje i DPIA. Ductus ne tvrdi da je student pritisnuo svaku tipku niti da nije koristio drugi uređaj (već u `PRODUCT.md`, D-53 i D-54).

## 3. Ciljna topologija pilota

```
Preglednik (Next.js klijent, Tiptap, Dexie)
        |  HTTPS
   Caddy (TLS, HSTS, rate limit)            Hetzner VPS (EU)
        |
   Next.js app (standalone)  <---------->  Worker (Node): pg-boss, rekonstrukcija,
        |                                   potpisi na čekanju, dnevni korijen,
        |                                   retention, e-pošta
        |   TLS, privatna mreža ili IP allowlist
        +-----> Scaleway Managed PostgreSQL (PITR, tajne uloge)
        +-----> Scaleway Object Storage (privatni bucket, versioning)
        +-----> Scaleway TEM (SMTP/API)
        +-----> OpenRouter (samo kad student pokrene AI, kroz proxy rutu)
        +-----> FINA TSA (RFC 3161, jednom dnevno, iz workera)
Javni repozitorij: dnevni potpisani korijen + .tsr žig (bez ikakvog sadržaja rada)
```

Pravila granica:

1. Klijent govori samo s Next.js aplikacijom; baza i bucket nemaju javnu adresu.
2. Tri uloge u bazi: `ductus_migrator` (samo CI na staging i ručno odobrenje na produkciju, nikad iz agenta), `ductus_app` (podliježe RLS-u, bez `BYPASSRLS`, bez prava na sheme evidencije osim kroz RPC), `ductus_evidence` (vlasnik funkcija sheme `evidence`; privatna shema bez ikakvih prava za aplikacijsku ulogu osim `EXECUTE` na RPC).
3. Potpisni ključ postoji samo u worker procesu i ingest ruti, nikad u klijentskom paketu; učitava se iz šifrirane datoteke uz KEK iz okoline. Rotacija i opoziv kao u `ARCHITECTURE.md` §8.
4. Tajne okoline: u CI-ju GitHub Environments sa zaštitom, na VPS-u `sops` + `age` datoteka. Ništa u repou (Gitleaks).
5. Stranice sa sadržajem rada ne smiju završiti u predmemoriji ni u logovima: `Cache-Control: no-store`, bez analitike treće strane, Sentry ili GlitchTip s `sendDefaultPii=false` i `beforeSend` koji odbacuje tijela zahtjeva; CI test s "canary" nizom provjerava da se tekst rada ne pojavljuje u logovima.
6. Server-side rendering sadržaja sad je dopušten (ograničenje iz Netlify varijante otpada, jer je kod na EU poslužitelju), ali samo iza autorizirane sesije.

## 4. Ključne dizajnerske odluke

### 4.1 Evidencija i potpis

- Tok odsječka: validacija i točni bajtovi, zapis objekta (`v2/<paket>/<hash>.json`, bez upserta, duplikat se prihvaća tek nakon usporedbe bajtova), RPC `reserve` (jedna transakcija), potpis, RPC `attach_signature`. Sve je iza jedne Next.js rute `/api/ingest` s ograničenjem veličine tijela čitanjem toka.
- Worker svakih nekoliko minuta ponovno potpisuje `pending_signature` zapise (isti `receiptId` i `acceptedAt`) i čisti objekte bez metapodataka starije od 24 sata. To zamjenjuje `pg_cron`, čija je dostupnost na upravljanom Postgresu NEPROVJERENA.
- Potpis potvrde po odsječku (oko 100.000 mjesečno, jeftino na svakom hostu). Dnevni korijen potpisuje se zasebnim ključem.

### 4.2 Dnevni korijen i vanjsko vrijeme (novo u valu 1)

1. Worker jednom dnevno gradi Merkle stablo nad svim potvrdama primljenim taj dan (listovi su hashevi kanonskih potvrda, bez sadržaja i bez osobnih podataka), potpisuje korijen ključem korijena i traži RFC 3161 žig od FINA-e (`tsa.fina.hr`).
2. Rezultat (korijen, potpis, `.tsr`, broj listova, korijen prethodnog dana) objavljuje se u javni repozitorij `ductus-roots`. Vrijeme commita **nije** pouzdano vrijeme; pouzdano je samo `.tsr`.
3. Što to dopušta tvrditi: potvrda je bila u korijenu dana D, a taj je korijen postojao najkasnije u trenutku žiga. Posljedica: operater ne može neprimijetno prepisati povijest unatrag prije žiga, ni s ukradenim potpisnim ključem.
4. Što ne dopušta: ne štiti od "split viewa" bez neovisnih zrcala, ne dokazuje istinitost sadržaja ni autorstvo. Tekst u sučelju i DPIA mora to reći.
5. Verifikator: mali CLI i web stranica koja radi u pregledniku (hash lanac, inclusion dokaz, potpis, `.tsr`, javni ključ), uz uputu za ručnu provjeru `openssl`-om. Taj dio već postoji kao D-49 i A-07; ovdje se samo pomiče najjednostavniji oblik u val 1.
6. **Ovisnost koju vlasnik mora riješiti:** FINA ugovor, minimalna mjesečna naknada i cijena pristupnog certifikata NEPROVJERENI (cijena 0,11 EUR po žigu je s javnog cjenika od 1. 1. 2026.). Certilia QTSA je za ovaj obujam preskupa (najmanji paket oko 478 EUR godišnje). Do ugovora radi besplatni TSA kao privremena zamjena **samo u stagingu**; produkcija ne kreće bez ugovora ili odluke da se žig preskoči uz upisanu posljedicu.

### 4.3 Prijava i sesije

- Next.js ruta pokreće OIDC Authorization Code s PKCE-om prema `login.aaiedu.hr`, discovery je na `/.well-known/openid-configuration` (POTVRĐENO). AAI@EduHr podržava OIDC uz SAML i CAS. Klijent se registrira u Registru resursa (`registar.aaiedu.hr`, redirect URI, scopeovi, logout URI), uz ručno odobrenje.
- Scopeovi: `hrEduPersonUniqueID`, `hrEduPersonHomeOrg`, `hrEduPersonAffiliation`, ime i `mail` po potrebi. **OIB scope se ne traži** (nepotreban osobni podatak).
- Sesije su retci u bazi (`session`: hash tokena, `user_id`, istek, zadnja uporaba, korak-gore za administratore), kolačić `HttpOnly; Secure; SameSite=Lax`, provjera `Origin` na svakom mijenjajućem zahtjevu, kratak apsolutni istek i klizni istek. Odjava poništava redak i briše lokalni journal (uz blokadu ako ima nesinkroniziranih promjena, kao sada).
- Identitet se veže samo uz `hrEduPersonUniqueID` + izdavatelj. **Nikad automatsko spajanje po e-pošti** (rizik preuzimanja računa). Ovo je test u M1.
- Lažni OIDC pružatelj za lokalni razvoj i CI: `node-oidc-provider` u procesu testa (ili `mock-oauth2-server` u Dockeru). CI test provjerava da produkcijska konfiguracija nema lažnog pružatelja.
- Biblioteka: Better Auth (generic OAuth plugin, PKCE, sesije u bazi) je preporuka istraživanja. Auth.js je od rujna 2025. u održavanju Better Autha, Lucia je deprecirana. Ako M1 spike pokaže da biblioteka spaja račune po e-pošti ili ne dopušta traženo mapiranje, piše se ručni klijent nad `openid-client` (oko 300 redaka, sigurnosni pregled). Odluka je izlazni kriterij M1.

### 4.4 Ovlasti

- Funkcija `can(actor, action, object)` kao jedino mjesto odluke; RLS politike i RPC pozivaju nju. Odnosi: vlasnik projekta, student kolegija, nastavnik kolegija, mentor (iz `mentorship`), administrator ustanove.
- pgTAP matrica (`PROGRAM.md` GO uvjeti) ostaje uvjet za spajanje; diferencijalni test uspoređuje `can()` s izvršnim referentnim modelom iz R2 (`pisac-editor`, `src/domain/authorization`) nad istim slučajevima.
- Opoziv je odmah: nema predmemorije odluka. Svaki dohvat sadržaja ponovno provjerava članstvo (već u `ARCHITECTURE.md` §7).
- Evidencija (čitanje) i izvoz evidencije su zasebne sposobnosti. Administrator ustanove nije superadministrator sadržaja.

### 4.5 Poslovi, obavijesti, AI

- Worker koristi pg-boss (održava ga jedna osoba, što je rizik održavanja; zamjena je graphile-worker). Poslovi: ponovni potpis, retention (brisanje po klasi podataka), rekonstrukcija pri predaji, dnevni korijen i žig, e-pošta, podsjetnici.
- Obavijesti nastavniku i studentu: tablica `notification` i endpoint "što je novo od X" uz polling 30 do 60 s; poruke nose samo ID. Ako se kasnije pokaže potreba, doda se SSE preko `LISTEN/NOTIFY` bez promjene podatkovnog modela.
- AI proxy je obična Next.js ruta (ne edge) koja provjerava popis dopuštenih pružatelja po fakultetu i zadatku. Studentov OpenRouter ključ šifrira se aplikacijski: AES-256-GCM, KEK iz okoline, **AAD = `user_id` + namjena + verzija ključa**. Ne koristiti `pgsodium` (u najavi ukidanja) ni Supabase Vault.
- E-pošta: Scaleway TEM, SPF/DKIM/DMARC na vlastitoj domeni. DPA dokumente treba provjeriti prije produkcije.

### 4.6 Rekonstrukcija i predaja

- Rekonstrukcija koristi isti kod kao klijent (ProseMirror u Nodeu) u workeru, od najbliže kontrolne točke. Ograničenje CPU-a nema, ali ima vremenska i memorijska granica posla (npr. 120 s, 1 GB) i kvote po korisniku.
- M3 mjeri vrijeme na rad od 15.000 riječi, a ovdje ga proširujemo na **80.000 riječi** (doktorski) kao neizvediv scenarij na starom stacku koji sada postaje izvediv.
- Nepodudarnost JCS usporedbe blokira predaju i bilježi incident (nepromijenjeno).

### 4.7 Sigurnosna, sigurnosne kopije i povrat

- PITR i dnevni backupi baze kod dobavljača; dodatno **vlastiti logički `pg_dump` šifriran `age` ključem** u zasebni bucket drugog dobavljača (Hetzner Storage Box ili Object Storage) jednom dnevno, kako gubitak jednog računa ne bi značio gubitak svega.
- Bucket s evidencijom: versioning uključen; objekti se brišu samo workerom po retention pravilu (uloga `ductus_retention` s DeleteObject, aplikacijska uloga nema).
- **Backup postoji tek kad je restore dokazan.** Mjesečna automatska proba: povrat najnovije kopije u privremenu bazu, `ductus verify` nad uzorkom radova, zapis rezultata. Prva proba je uvjet za GO.
- Ciljevi pilota: RPO do 5 minuta (WAL), RTO do 4 sata (rezervni poslužitelj iz OpenTofu koda + povrat baze). Mjere se u probi, ne pretpostavljaju.
- Hetzner automatski backup VPS-a (20 % cijene) uključen, ali nije izvor istine: stanje je u bazi i bucketu, VPS je potrošan.

## 5. Što istraživanje nije potvrdilo (mora se provjeriti, ne pretpostaviti)

| Stavka | Kako se provjerava | Gdje |
| --- | --- | --- |
| PITR i retencija na Scaleway DB-DEV-S | Podignuti instancu, izvesti stvarni povrat u točku; ako nema, sljedeći tip je oko 105 EUR/mj (razbija budžet), pa alternativa postaje Postgres uz WAL-G na vlastitom VPS-u | B0.1 |
| Latencija VPS (DE/FI) do Scaleway PG (Pariz/Amsterdam) | Mjerenje RTT i trajanje `reserve` RPC-a; ako je ingest sporiji od cilja, sve na Scalewayu (VM + PG + S3, oko 53 EUR/mj, privatna mreža) | B0.1 |
| Rekonstrukcija 15.000 i 80.000 riječi | Benchmark na CX43 s ProseMirrorom u Nodeu | B0.2 |
| AAI@EduHr Lab URL, tko odobrava, rokovi, uvjeti (treba li ustanova biti naručitelj), eduGAIN za izvanhrvatske SP-ove | Pisati na `aai@srce.hr`; za planiranje računati 2 do 6 tjedana (moja procjena, ne izvor) | Owner queue |
| Mapiranje hrEdu claimova u Better Authu | M1 spike | B2 |
| FINA minimalna naknada, certifikat za pristup TSA, uvjeti | Upit FINA-i | Owner queue |
| `pg_cron` na Scaleway Managed PG | Nije potrebno; worker preuzima | n/a |
| Cijene AWS/Azure za eu-central, besplatni TSA uvjeti, DPA dokumenti | Nije potrebno za preporuku; ako se vratimo na KMS, provjeriti tada | n/a |
| Sentry EU regija na besplatnom planu | Ako nije, GlitchTip EU (15 USD za 100k događaja) ili samostalno | B9 |

Istraživanje nije moglo čitati većinu stranica `aaiedu.hr` (robots.txt), pa je dio o prijavi velikim dijelom iz sažetaka i mora se potvrditi sa Srcem.

## 6. Obvezna kontrolna lista za svaku backend komponentu

Preuzeto i skraćeno iz vNext §38; PR se ne spaja dok nije ispunjeno ili dok nije izričito zapisano zašto nije primjenjivo.

1. Domenski ugovor (TypeScript tipovi + Zod shema; shema je verzionirana).
2. Validacija pri izvođenju na granici (veličine, nepoznata polja odbijena).
3. Model ovlasti: redak u pgTAP matrici i test koji dokazuje odbijanje.
4. Matrica kvarova: što se događa kad padne baza, bucket, worker, TSA, potpisnik.
5. Idempotencija i ponovni pokušaji (isti ulaz, isti rezultat).
6. Odluka o privatnosti i čuvanju: klasa podataka i rok.
7. Neprijateljski testovi (izmijenjeni bajtovi, ponovljeni ID s drugim sadržajem, tuđa sesija, istekla sesija, uklonjeni nastavnik).
8. Plan migracije i povrata (expand, migrate, contract).
9. Opservabilnost: metrika ili događaj bez sadržaja rada; canary test logova.
10. Konfiguracijska brava: bez potpune konfiguracije značajka je zatvorena (fail closed).
11. CI zelen, uključujući pgTAP i property testove.
12. Ako dira povjerenje (evidencija, potpis, predaja): **sintetički prolaz na živom stagingu s povratom prije aktivacije.** Pouka iz R4: uspješna migracija nije dokaz; tek prvi stvarni RPC poziv otkrio je grešku (`pg_catalog.coalesce`).

Dodatna matrica kvarova za naš okoliš:

| Kvar | Ispravno ponašanje |
| --- | --- |
| VPS pada | Klijent nastavlja lokalno, stanje "čeka poslužitelj"; rezervni poslužitelj iz koda; FPZG zamjenski postupak ako traje preko praga |
| Worker pada | Ingest i dalje prima; potpisi ostaju `pending_signature`; backlog je metrika s alarmom |
| Baza nedostupna | Ingest vraća 503, klijent ponavlja uz backoff; nijedna potvrda ne postoji bez zapisa u bazi |
| Bucket nedostupan | Nema metapodataka ni potvrde; klijent ponavlja |
| FINA TSA nedostupan | Dnevni korijen se potpisuje i objavljuje bez žiga i označava se "bez žiga"; posao ponavlja do žiga; žig se priključuje naknadno, ali se vrijeme žiga ne unazađuje |
| Ključ potvrda kompromitiran | Postupak iz `ARCHITECTURE.md` §8; žig dnevnog korijena ograničava razdoblje sumnje |
| Pogreška aplikacije pri deployu | Migracije samo naprijed uz expand/contract; deploy blue/green na istom VPS-u (dva kontejnera) ili brzi povrat slike |

## 7. Trošak (bez PDV-a, procjena 3. 10. 2026.)

| Stavka | EUR/god | Napomena |
| --- | --- | --- |
| Hetzner VPS CX43 (produkcija) | 192 | 15,99 EUR mjesečno |
| Hetzner backup VPS-a | oko 38 | 20 % cijene, NEPROVJERENO za CX43 |
| Staging (manji VPS ili Docker na istom) | 0 do 60 | Staging baza može biti Postgres u Dockeru na stagingu |
| Scaleway Managed PG (DB-DEV-S, disk, backup) | oko 156 | oko 13 EUR mjesečno; PITR NEPROVJEREN |
| Scaleway Object Storage | oko 5 do 10 | 0,016 EUR/GB |
| Scaleway TEM | oko 15 | NEPROVJEREN DPA |
| Domena `.hr` | 15 do 30 | sekundarni izvor |
| FINA žigovi (365) | oko 40 | plus nepoznata minimalna naknada |
| Drugi bucket za šifrirane dumpove (Hetzner) | oko 10 do 60 | NEPROVJEREN |
| Praćenje grešaka (GlitchTip EU / Sentry) | 0 do 20 | |
| **Ukupno** | **oko 470 do 640** | D-66: infrastruktura 300 do 500 + domena i e-pošta 50 do 100 |

Na gornjoj granici troška prekoračuje se infrastrukturna stavka D-66; razlika dolazi iz rezerve (100 do 200 EUR), što treba potvrditi. Ako PITR na DEV-S ne postoji, varijanta "PG s WAL-G na vlastitom VPS-u" je jeftinija (oko 25 EUR mjesečno ukupno), ali rad na bazi i probe povrata postaju tvoj posao. Pri 5 puta većem broju korisnika procjena je 160 do 300 EUR mjesečno (veći tip baze, HA, odvojeni app serveri), izvan ovog budžeta; to je tada stvar financiranja, ne arhitekture.

## 8. Program backenda

Backend nije posebna faza nego okomiti rez kroz M0 do M11. Dolje je što se u kojoj fazi radi i kako se razlikuje od `PROGRAM.md`. Procjene su u večerima (kao u `PROGRAM.md`), a **neto razlika prema trenutnom planu je oko +6 do +10 večeri** (prijava, worker, deploy i ops dodani, a Edge Functions, Realtime i Supabase CLI izbačeni; dnevni korijen i verifikator dodani u val 1).

| Korak | Sadržaj | Izlazni kriterij | Faza | Večeri |
| --- | --- | --- | --- | --- |
| B0.1 Spike hostinga | Podići Scaleway PG i Hetzner VPS (privremeno), izmjeriti RTT i `reserve`, provesti stvarni PITR povrat na DEV-S | Zapis s brojkama; PITR radi ili je odabrana varijanta WAL-G | prije M2 | 1 do 2 |
| B0.2 Spike rekonstrukcije | Benchmark ProseMirror rekonstrukcije za 15.000 i 80.000 riječi u workeru | Vrijeme i memorija zapisani; granice posla određene | prije M3 | 1 |
| B0.3 Odluka D-08 | Vlasnik potvrđuje D-08, D-71 do D-75 prema rezultatima spikeova | Odluke u `DECISIONS.md` kao ODLUČENO | | 0 |
| B0.4 Prepis ARCHITECTURE | §1, §4, §5, §5a, §5b, §9, §10, §12 prema ovom dokumentu | `ARCHITECTURE.md` bez Supabasea i Netlifyja, §12 s R1 do R4 | M0 | 1 |
| B1 Okruženja | `docker compose` (Postgres, MinIO, Mailpit, lažni OIDC), OpenTofu za Hetzner i Scaleway, CI deploy na staging, `sops`/`age`, uloge u bazi, Caddy | `docker compose up` i `npm test` zeleno lokalno; staging se podiže iz koda | M0 | 3 do 4 |
| B2 Identitet | OIDC klijent, sesije u bazi, `app.user_id` u transakciji, test bez spajanja po e-pošti, lažni pružatelj samo lokalno i u CI-ju | Prijava na AAI Labu radi; test dokazuje da lažni pružatelj ne postoji u produkciji | M1 | 2 do 3 |
| B3 Ovlasti | `can()`, RLS, pgTAP matrica, diferencijalni test prema R2 modelu | Matrica zelena za sve uloge uključujući mentora | M2 | uključeno u M2 |
| B4 Evidencija | Prijenos R1 do R4; `pg-evidence-*` i `s3-evidence-payload-store`; ingest ruta; worker za ponovni potpis; kontrolne točke; praznine | Svi ugovorni testovi zeleni nad in-memory i pg/S3; property testovi; sintetički prolaz na stagingu s povratom | M3 | uključeno u M3, +2 |
| B5 Dnevni korijen i žig | Merkle stablo, potpis, FINA RFC 3161, objava u javni repozitorij, CLI verifikator | Neovisna provjera nad izvezenim paketom prolazi; promjena jednog odsječka ruši provjeru; dan bez TSA-a se ispravno oporavlja | M3 do M7 | 3 do 4 |
| B6 Poslovi i obavijesti | pg-boss, retention, e-pošta (TEM), `notification` + polling | Posao ponovljen nakon pada workera ne duplicira učinak | M6, M7, M10 | uključeno, +1 |
| B7 AI proxy | Ruta, popis pružatelja, envelope enkripcija ključa | Nedopušten pružatelj nedostupan; ključ nikad u odgovoru ni logu | M9 (val 2) | uključeno u M9 |
| B8 Predaja | Rekonstrukcija u workeru, usporedba JCS, potvrda | Podudarna rekonstrukcija na svim scenarijima uključujući prazninu | M7 | uključeno u M7 |
| B9 Operacije i GO | Backup i drugi bucket, mjesečna proba povrata, praćenje bez sadržaja, statusna stranica, `docs/OPERATIONS.md`, load test noći roka, OWASP provjera, DPA s dobavljačima | Svi crveni uvjeti iz GO tablice zeleni; zapisana proba povrata | M11 | uključeno u M11, +2 |

Redoslijed i kontrolna točka 15. 12. 2026.:

1. B0.1 i B0.2 dolaze **prije** bilo kakvog vezivanja za dobavljača; M0 do tada piše samo kod iza sučelja (pristupnici za bazu, objekte, e-poštu, potpis).
2. Ako B0.1 ne potvrdi PITR, vlasnik bira: (a) WAL-G na VPS-u uz mjesečnu probu povrata, (b) Scaleway tip s PITR-om uz probijen budžet, (c) sve na jednom Scaleway računu radi privatne mreže. Preporuka: (a) uz obaveznu probu, jer je to jedina varijanta koja ostaje ispod 500 EUR.
3. B5 se ne smije izbaciti u prvom rezu kontrolne točke. Ako treba rezati, prije njega ide verifikator s web stranicom (ostaje CLI), a nakon toga odgoda objave u javni repozitorij (korijen i žig ostaju). Predlažem da se to upiše u `PROGRAM.md` kao šesti rez.
4. Prije prve stvarne aktivacije evidencije: cijela kontrolna lista iz §6, sintetički prolaz na živom stagingu i povrat.

## 9. Što treba od vlasnika

- Potvrditi ili promijeniti D-08, D-71 do D-75 (ili reći što od ovoga ne želiš).
- Pisati Srcu (`aai@srce.hr`): registracija klijenta u Registru resursa, pristup Labu, potvrditi OIDC i atribute, uvjete za ustanovu, rokove.
- Upit FINA-i o RFC 3161 pristupu: ugovor, certifikat, minimalna naknada, uvjeti korištenja.
- Otvoriti račune Hetzner i Scaleway, uključiti dvofaktorsku prijavu, ne dijeliti root pristup agentu (agent dobiva ograničene API ključeve po okolišu).
- Odlučiti gdje je lokalni stroj s Dockerom na kojem teče M0.
