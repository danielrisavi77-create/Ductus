# Ductus: plan i program backenda

Verzija 0.3 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi · Status: PRIJEDLOG (čeka potvrdu D-08, D-71 do D-75)

Ovaj dokument zamjenjuje otvoreni D-08. Izvori: dokument "Pisač: Backend arhitektura i vizija vNext" (dalje vNext), tri istraživanja (hosting, potpisi i vrijeme, prijava i ovlasti), `ARCHITECTURE.md` v0.2, te dva neovisna pregleda (arhitektonsko-sigurnosni i provjera činjenica na primarnim izvorima). **Verzija 0.1 imala je pogrešku koja je mijenjala preporuku: Scaleway Managed PostgreSQL nema PITR ni na jednom tipu čvora** (provjereno u službenom repozitoriju dokumentacije `scaleway/docs-content`, commit od 2. 10. 2026.). Ova verzija to ispravlja i ugrađuje ostale nalaze pregleda (šest kritičnih, 19 važnih). Cijene su s datumom 3. 10. 2026.; gdje nešto nije potvrđeno s primarnog izvora, piše NEPROVJERENO.

## 1. Sažetak odluke

Preporuka je **uvjetna**: potvrđuje je tek ono što spikeovi B0.1 i B0.2 izmjere. Ako ne prođu, vraća se vlasniku, ne mijenja se tiho.

| Pitanje | Preporuka | Zašto i što je provjereno |
| --- | --- | --- |
| Supabase | **Ne kao osnova.** | Potvrđeno: Edge Functions 2 s CPU i 256 MB; PITR dodatak 100/200/400 USD mjesečno za 7/14/28 dana; Realtime 500 veza na Pro. Argument CPU-a još nije izmjeren za naše radove (B0.2): ako rekonstrukcija 15.000 riječi stane znatno ispod 2 s, taj argument otpada. Ostali razlozi stoje: Next.js ionako traži drugi host, cijena PITR-a, vezanost uz Auth/RLS/Vault |
| Baza | **UpCloud Managed PostgreSQL (Developer), PITR 3 dana**, finska tvrtka | Zamjena za Scaleway PG koji PITR nema. Potvrđeno u dokumentaciji UpCloud-a: dnevni puni backup, WAL se kopira "continuously at 5-minute intervals", retencija 3, 15 ili 31 dan, Developer plan 3 dana; privatna mreža podržana. **Postupak povrata u točku nije dokumentiran** (Terraform provider nema parametar za fork ni vrijeme povrata), pa ga B0.1 mora izvesti (Dodatak A). Rezerva: Neon Launch (Frankfurt, PITR do 7 dana, američka tvrtka) |
| Aplikacija | Next.js (Docker) i zaseban worker na **UpCloud Cloud Native VM-u** u istom okruženju kao baza | Jedan dobavljač za računalo i bazu daje privatnu mrežu (baza bez javne adrese), nižu latenciju i izbjegava problem Hetznera: za CX tipove službena stranica kaže da je "number of available servers limited" i "currently unavailable", pa se CX43 možda ne može kupiti. Hetzner ostaje opcija za drugi račun (rezerva), ne za primarni put |
| Objekti | Scaleway Object Storage (S3, privatni bucket), 0,016 EUR/GB | Potvrđena cijena. Uz dnevnu replikaciju u drugi račun (§4.7) |
| E-pošta | Scaleway TEM, oko 14 EUR godišnje za 5.000 poruka | Potvrđeno |
| Prijava | Vlastiti OIDC klijent prema AAI@EduHr, sesije u bazi; **Better Auth s `accountLinking.enabled: false`** ili `openid-client`, odluka na M1 | Potvrđeno: Better Auth ima OIDC discovery i PKCE, ali povezivanje računa po e-pošti je **zadano uključeno**, a polje `email` je obvezno i jedinstveno (rizik ako AAI ne vrati `mail`) |
| Ovlasti | RLS + `current_actor()` (provjera tokena sesije u bazi) + `can()` + pgTAP; bez OpenFGA | §4.4. RLS je obrana u dubinu, ne granica protiv kompromitirane aplikacije |
| Potpisi | **Dva odvojena Ed25519 ključa u AWS KMS** (ključ potvrda, ključ dnevnog korijena), potpisivanje izvan web procesa | Preokret u odnosu na v0.1. Adapter `aws-kms-ed25519-signer` već postoji u kodu, a ugovor porta traži KMS/HSM. KMS sprječava izvoz ključa. Potvrđeno sa službenog cjenika: 1 USD mjesečno po ključu, 0,15 USD na 10.000 potpisa asimetričnim ključem (izvan besplatne kvote), cjenik ne navodi razlike po regijama. Za 2 ključa i 100.000 potpisa: oko 3,5 USD mjesečno. U KMS idu samo hashevi |
| Neovisno vrijeme | Dnevni korijen + RFC 3161 žig u valu 2 (D-72), **uz poštenu tvrdnju (§4.2)**; svaki dan **dva neovisna besplatna TSA-a** (DigiCert i Sectigo), FINA kad postoji poslovni subjekt | Besplatni TSA-ovi nemaju objavljene uvjete korištenja, SLA ni ograničenja (FreeTSA za komercijalnu uporabu traži kontakt), pa se tretiraju kao usluga bez jamstva: dva neovisna žiga dnevno, spremljen lanac certifikata. FINA: 0,11 EUR po žigu, certifikat 86,27 EUR (5 godina), **pristupnicu podnosi poslovni subjekt**. Nije GO preduvjet |
| Transparency log, C2PA, QTSP paket | Ne u pilotu | §2 |
| Red poslova | pg-boss u workeru, `migrate: false` | Potvrđeno: PG 13+, aktivno održavan |
| Obavijesti | Polling, ali nastavnik dobiva obavijest o reviziji najviše po P-03 prozoru | §4.5 |
| Trošak prve godine | **oko 460 do 600 EUR bez PDV-a, oko 575 do 750 EUR s PDV-om** | §7. Ne ulazi u D-66 (infrastruktura 300 do 500): odluka vlasnika |

Jedna točka kvara ostaje: jedan VM. Prihvatljivo za pilot samo uz dokazan povrat, rezervni put na **drugom računu** i zamjenski postupak predaje koji FPZG propisuje (D-69).

## 2. vNext: što uzimamo, što odgađamo

vNext je dobra ciljna arhitektura i popis načela. Nije plan pilota: pretpostavlja Azure, OpenFGA, Tesseru, PowerSync, .NET servis za dokumente, regionalne ćelije i C2PA.

### Prihvaćamo

- **Načela** (vNext §2, ima ih 12): nema tihog last-write-winsa; identitet nije ovlast; dokaz nije presuda; lokalno nije kanonsko; suradnja nije akademska povijest; audit nije dokaz; AI nije kritičan za dostupnost; server ne izmišlja povijest (praznine ostaju praznine); povrat stvara novu reviziju; završni artefakt mora biti provjerljiv bez žive baze; privatnost kroz arhitekturu; dokaz prije usvajanja nove tehnologije.
- Protokol commita (CAS, server dodjeljuje broj revizije, idempotencija, `STALE_BASE`).
- Evidence v2 (R1): JCS + SHA-256, točni bajtovi s mreže jednaki ponovno izračunatom JCS nizu, kontinuirani raspon slijeda, lanac hasheva.
- Redoslijed R4 (objekt, atomarna rezervacija, potpis, priključivanje potpisa), `pending_signature`, idempotencija s pregledom prije ponovnog uploada. **Uz izmjene iz §4.1** (utrka čišćenja siročadi, odnos prema commitu dokumenta).
- Razdvajanje svrha ključeva, matrica kvarova, Definition of Done (§6), expand/migrate/contract, `upgrade_required`.
- Command gateway: nema "insert row" ni "upload object" kao proizvodnog API-ja.
- Break-glass za administratora u pojednostavljenom obliku (razlog, uski opseg, istek, nepromjenjiv trag u `audit`).

### Odgađamo, s okidačem (dopuna `ARCHITECTURE.md` §11)

| vNext | Okidač | Umjesto toga |
| --- | --- | --- |
| R5 Tessera | Netko izvana ospori zapis ili ustanova traži svjedoka | Vlastito Merkle stablo (oko 100 redaka, `@noble/hashes`), testirano na vektorima iz `transparency-dev/merkle`. Tessera je sad "generally available" (v1.x), ali je Go biblioteka s drugačijom operativnom cijenom |
| R6 eIDAS kvalificirani žig | Pravni postupak traži presumpciju | RFC 3161 žig; pravni učinak ne tvrdimo bez odvjetnika |
| R7 C2PA | `c2pa-rs` podrži DOCX (službena tablica ga ne navodi) | Odvojeni potpisani paket dokaza; za PDF kasnije PAdES |
| R8 OpenFGA | Odnosi postanu tranzitivni ili više servisa treba iste odluke | `can()` u SQL-u |
| PowerSync, LTI 1.3, Edu-API, ISVU, .NET konverzija, regionalne ćelije, Temporal | Kao u `ARCHITECTURE.md` §11 | Dexie, AAI OIDC, postojeći DOCX izvoz, jedan EU okoliš, pg-boss |
| Azure Key Vault | Samo ako AWS postane neprihvatljiv | Azure ne navodi Ed25519 u dokumentaciji; postojeći adapter je ES256 |

### Ispravak popisa prijenosa (`ARCHITECTURE.md` §12 i R1 do R4)

Pregled koda u `pisac-editor` pokazao je da v0.1 netočno opisuje prijenos. Točan popis:

- **Prenosi se bez izmjene:** `src/domain/forensics`, `src/domain/*` (čist od Supabasea; komentari koji upućuju na Supabase migracije se brišu), `src/application/ports/*`, `src/application/evidence/*` (gateway oko 328 redaka + testovi), in-memory adapteri, `src/adapters/crypto/aws-kms-ed25519-signer*` i `development-ed25519-signer*`, ugovorni testovi.
- **Prepisuje se:** sve SQL migracije (`evidence_r4_*` i F1). Razlozi: daju `grant ... to service_role/anon/authenticated`, a te uloge ne postoje izvan Supabasea; funkcije su u shemi `public` s prefiksom `pisac_`; vlasništvo se provjerava preko `pisac_workspaces.owner_id` kojeg model Ductusa nema; F1 RPC-i koriste `auth.uid()` i namijenjeni su izravnom pozivu iz preglednika. Također `src/lib/evidence/*` (uvozi `@supabase/supabase-js` i `lib/supabase/*`) i svi `supabase-*` adapteri.
- **Novo:** `pg-evidence-*` adapteri (običan `pg`), `s3-evidence-payload-store`, `withActor`, nova shema `evidence` s ulogama (§3), novi izvršni referentni model ovlasti (§4.4), migracijski alat (§4.8).
- Realna procjena prijenosa i prepisa B4: **5 do 8 večeri dodatno**, ne +2.

### Što dokument vNext ne rješava, a moramo

- **Granica tvrdnji.** Najviša poštena tvrdnja iz vNext §1 koristi se doslovno u sučelju i DPIA-i; Ductus ne tvrdi da je student pritisnuo svaku tipku niti da nije koristio drugi uređaj (D-53, D-54).
- **Odnos commita dokumenta i prihvata evidencije.** U kodu su to dvije odvojene transakcije (`pisac_commit_document` i `pisac_evidence_reserve`). Bez odluke nastaje revizija bez odsječka (lažna praznina) ili odsječak bez revizije, a "spremljeno na poslužitelju" znači dvije stvari. Odluka (ADR u M3, prije koda): **jedan RPC koji u istoj transakciji radi CAS reviziju i `reserve`**; objekt u S3 zapisuje se prije, a ako RPC padne, ostaje siroče (§4.1). Ugovorni test za oba ishoda.

## 3. Topologija pilota

```
Preglednik (Next.js klijent, Tiptap, Dexie)
        |  HTTPS
   Caddy (TLS, HSTS)                         UpCloud VM (EU), privatna mreža
        |
   web: Next.js (bez ključeva)  <-------->   worker: pg-boss, potpisivanje preko KMS,
        |                                     rekonstrukcija, dnevni korijen, retention, e-pošta
        |   privatna mreža, bez javne adrese
        +-----> UpCloud Managed PostgreSQL (PITR)
        +-----> Scaleway Object Storage (privatni bucket, S3 API, javni endpoint s autentikacijom)
        +-----> Scaleway TEM
        +-----> AWS KMS (samo Sign nad digestom s prefiksom, D-92; dva ključa)
        +-----> OpenRouter (samo kad student pokrene AI; izvan pilota, D-77)
        +-----> TSA (RFC 3161, jednom dnevno, iz workera)
Javno: dnevni potpisani korijen + žig (bez sadržaja rada); drugi neovisni primatelji korijena (§4.2)
```

Pravila:

1. **Baza nema javnu adresu** (privatna mreža unutar UpCloud okoline). Object Storage ima javni S3 endpoint uz autentikaciju i uvijek je izvan privatne mreže; zato su ključevi bucketa uske ovlasti, a veza `verify-full`. KMS je također vanjski poziv.
2. **Uloge u bazi** (svaka s pgTAP retkom): `ductus_migrator` (jedini s DDL-om; pokreće se **s VM-a pri deployu**, ne iz GitHub Actionsa, da se baza ne otvara IP rasponima runnera), `ductus_app` (podliježe RLS-u, bez `BYPASSRLS`, **bez `EXECUTE` na evidencijske funkcije**), `ductus_worker` (bez `BYPASSRLS`, samo uske `SECURITY DEFINER` funkcije za rekonstrukciju, ponovni potpis i korijen), `ductus_retention` (samo funkcija brisanja pokazivača na sadržaj), `ductus_evidence` (NOLOGIN, vlasnik funkcija sheme `evidence`).
3. **Web proces ne drži nikakav materijal ključa.** Potpisuje worker preko KMS-a: ingest ruta zapisuje objekt i poziva RPC, a potpis se priključuje u workeru (stanje `pending_signature` već postoji kao normalan tok; klijent dobiva "spremljeno na poslužitelju" tek kad je potvrda potpisana, kao do sada).
4. Tajne: GitHub Environments sa zaštitom za CI, na VM-u `sops` + `age`; **`age` ključ i pričuvne kopije tajni drži vlasnik izvan VM-a** (potrebno za RTO).
5. Sadržaj radova nikad u logove, predmemoriju ni analitiku (§4.9).
6. **Bez server-side renderiranja sadržaja** (kao u `ARCHITECTURE.md` §1). Ništa u pilotu ne traži SSR, a `no-store` u odgovoru ne isključuje Next.js Data/Full Route Cache. Sve rute sa sadržajem su API rute s `dynamic = 'force-dynamic'`, `revalidate = 0`, ESLint pravilom i E2E testom s dva korisnika.
7. API rute s verzijom protokola (ne Server Actions) za sinkronizaciju, zbog starih klijenata nakon deploya; `upgrade_required` za predugo offline klijente.

## 4. Ključne dizajnerske odluke

### 4.1 Evidencija, potpis i bucket

- Tok odsječka: validacija i točni bajtovi; zapis objekta (`v2/<paket>/<hash>.json`, bez upserta, duplikat se prihvaća tek nakon usporedbe bajtova); **jedan RPC** koji radi CAS reviziju i `reserve` (§2); potpis u workeru; `attach_signature`.
- **RPC-i se prepisuju, ne prenose.** Postojeći `pisac_evidence_reserve`, `_lookup`, `_ensure_package` i `_authorize_append` primaju identitet kao **parametar** (`p_principal_id`) i jedina im je zaštita da ih smije izvršiti samo `service_role`. U Ductusu su `SECURITY DEFINER` s vlasnikom `ductus_evidence` i praznim `search_path`, **ne primaju identitet kao parametar nego ga izvode iz `current_actor()`** (§4.3), a `ductus_app` ih poziva samo kroz uske omotače. pgTAP test: `ductus_app` ne može dodati evidenciju s tuđim principalom.
- **Evidencijske tablice su samo za dodavanje.** Okidači `BEFORE UPDATE OR DELETE` na `acceptances` dopuštaju samo prijelaz `pending_signature` u `signed` uz nepromijenjen `receipt_payload`, `descriptor` i hash, i zabranjuju `DELETE` osim brisanja pokazivača na sadržaj kroz funkciju retentiona. Glavu lanca (`packages.head_*`) mijenja samo `reserve`. `attach_signature` provjerava da `payloadDigestSha256` odgovara `receipt_payload` i da je `keyId` poznat i neopozvan (tablica `signing_key`).
- **Siročad u bucketu:** automatsko brisanje objekata bez metapodataka **ne radimo u pilotu**. Offline klijent ponavlja odsječak danima kasnije, a `putImmutable` ne piše postojeći objekt, pa zadržava staro vrijeme; posao čišćenja bi mogao obrisati objekt na koji zakašnjeli `reserve` upravo pokazuje. Siročad se samo broji i prijavljuje; brisanje tek nakon 30 dana, uz ponovnu provjeru u bazi neposredno prije brisanja i savjetodavno zaključavanje po hashu. Nakon `reserve` radi se HEAD objekta prije potpisa. Test: konkurentno čišćenje i zakašnjeli `reserve`.
- Autor odsječka dolazi iz sesije na poslužitelju, nikad iz polja klijenta. **Otvoreno pitanje:** kod izravnih izmjena nastavnika (D-34) revizija nastaje na studentovu klijentu, pa autora ("nastavnik") postavlja klijent. Rješenje se mora odrediti u M6 (npr. potpisani zahtjev nastavnikove sesije, koji klijent prilaže); do tada D-34 ostaje PRIJEDLOG.

### 4.2 Dnevni korijen i vanjsko vrijeme (val 2, s poštenom tvrdnjom)

1. **Jedan kumulativni append-only log (D-93)**, ne zasebno stablo po danu. Hashiranje prema RFC 6962: list = `SHA-256(0x00 ‖ D)`, unutarnji čvor = `SHA-256(0x01 ‖ L ‖ R)`, gdje je `D = SHA-256(JCS(receiptPayloadV2))` isti digest koji se potpisuje (D-92). Ponovni potpis nakon rotacije ili kompromitacije ključa ne mijenja listove. Svaka potvrda dobiva indeks bez praznina pri prihvatu (`reserve`), pod jednim sekvencerom; u log ulaze i `pending_signature` zapisi, a zakašnjeli zapis jednostavno ulazi kad je prihvaćen. Worker jednom dnevno objavljuje kontrolnu točku u formatu C2SP tlog-checkpoint (ishodište, veličina, korijen) i **consistency dokaz** prema prethodnoj kontrolnoj točki; dan bez novih zapisa objavljuje istu točku s novim žigom. Prije koda: pisana specifikacija (poredak, objava, provjera) i neovisni review (Linear DAN-55).
2. Kontrolnu točku potpisuje drugi KMS ključ (čisti Ed25519 nad tekstom točke); traže se **dva RFC 3161 žiga od neovisnih besplatnih TSA-ova** (`http://timestamp.digicert.com` i `http://timestamp.sectigo.com`; HTTP je u redu jer je odgovor potpisan, ali se provjerava potpis i lanac). Nijedan nema objavljene uvjete, SLA ni ograničenja, pa vrijedi: jedan žig dnevno po TSA-u, bez ponavljanja češće od jednom u minutu, uspjeh dana znači barem jedan valjan žig, a dan s nijednim je alarm. Pravnu osnovu ne daju; tako piše i u DPIA-i. FINA (kvalificirani pružatelj u Hrvatskoj) dolazi kad postoji poslovni subjekt (obrt), ili ako FPZG pristane biti ugovorna strana: 0,11 EUR po žigu, certifikat 86,27 EUR na 5 godina, endpoint `https://tsa.fina.hr/ts-rfc3161`.
3. Objava: javni repozitorij **i neovisni primatelji korijena** (dnevni e-mail koordinatoru FPZG-a; arhiviranje u Internet Archive ili Software Heritage). Javni repozitorij kontrolira isti operater (može force-pushati), pa sam po sebi nije svjedok.
4. **Što to dokazuje:** kad je korijen dana D žigosan i objavljen, svaka kasnija promjena potvrda iz tog dana je otkriva svatko tko drži objavljeni korijen. Žig dokazuje da je hash postojao najkasnije u trenutku žiga, ne da je to jedini korijen tog dana ni da sadrži sve potvrde.
5. **Što ne dokazuje:** ne štiti od dva različita korijena za isti dan bez neovisnog primatelja (split view); ne štiti od krivotvorenja potvrda u prozoru prije sidrenja (24 do 48 sati, dulje ako TSA ne radi) ni prije prvog uspješnog žiga; ne dokazuje istinitost sadržaja ni autorstvo. Taj tekst ide u sučelje i DPIA.
6. Paket dokaza za predaju izdaje se kao "sidren" tek kad je pripadni korijen žigosan; do tada nosi oznaku "još nije sidren".
7. Za radove s dugim rokom čuvanja uz `.tsr` spremaju se lanac certifikata TSA i stanje opoziva u trenutku žiga, uz plan ponovnog žigosanja prije isteka certifikata.
8. Veličina loga u potpisanoj kontrolnoj točki mora biti točna i ne može se zaokružiti. Za pilot se prihvaća javna objava ukupnog broja potvrda i zapisuje u DPIA (D-93); popunjavajući nasumični listovi uvode se samo ako ustanova to zatraži.
9. Verifikator: CLI i web stranica koja radi u pregledniku (web stranica se smije odgoditi prema rezu iz `PROGRAM.md`, CLI ostaje; lanac, inclusion i consistency dokaz, potpis, `.tsr`, javni ključ) uz ručnu provjeru `openssl`-om.

### 4.3 Prijava, sesije i identitet u bazi

- Next.js ruta pokreće OIDC Authorization Code s PKCE-om prema `login.aaiedu.hr` (OIDC potvrđen na službenoj Srce wiki stranici, discovery `/.well-known/openid-configuration`, registar resursa, Lab `fed-lab.aaiedu.hr`).
- **Tko smije registrirati klijenta (potvrđeno na aaiedu.hr):** "Registrirani davatelj usluge u sustavu AAI@EduHr može biti partner sustava ili pak matična ustanova koja je ujedno i davatelj elektroničkih identiteta." Lab smiju koristiti "sve osobe koje ovlašteni predstavnik davatelja usluge (matične ustanove ili partnera AAI@EduHr) za to ovlasti" e-poštom na `aai@srce.hr`. **Daniel kao fizička osoba ne može sam registrirati Ductus ni dobiti Lab.** Put za pilot: FPZG (matična ustanova) registrira Ductus kao svoju uslugu u Registru resursa, a odgovorna osoba FPZG-a e-poštom ovlašćuje Daniela za Lab (do 5 testnih identiteta na `aai-test.hr`). Partnerstvo (vlastiti obrt ili tvrtka) je put za drugu ustanovu; uvjeti nisu provjereni (stranica blokira dohvat).
- **Obvezno (izlazni kriterij M1):** `state` i `nonce`; provjera `iss`, `aud`, `azp`, `exp`, `iat`, prikvačen algoritam, keširanje i rotacija JWKS-a, dopušten pomak sata. AAI vraća atribute s userinfo endpointa, pa `sub` iz userinfo odgovora mora biti jednak `sub` iz ID tokena (OIDC Core 5.3.2). Novi ID sesije pri prijavi (session fixation), kolačić `__Host-...; HttpOnly; Secure; SameSite=Lax`, zaštita `returnTo` od otvorenog preusmjeravanja, na mijenjajućim rutama obavezan `Origin` (bez zaglavlja odbij) i `Sec-Fetch-Site`.
- **Odjava:** RP-initiated logout prema `end_session_endpoint` AAI-ja i back-channel logout koji zatvara sesije u bazi. Bez toga na zajedničkom računalu sljedeća osoba klikne "Prijava" i ulazi kao prethodni student.
- Istek sesije tijekom pisanja nije odjava: journal se ne briše, ponovna prijava istog korisnika nastavlja. Dexie je po originu, pa "vezan uz korisnika" znači logičku oznaku; kad se prijavi drugi korisnik na istom pregledniku, journal prethodnog se prije toga briše ili blokira prijavu.
- Identitet: `hrEduPersonUniqueID` + izdavatelj; **nikad automatsko spajanje po e-pošti**. Koji je identifikator trajan i ne dodjeljuje se ponovno potvrditi sa Srcem; spremiti i `sub` i `hrEduPersonUniqueID`. OIB se ne traži.
- **RLS bez Supabasea.** `ductus_app` u svakoj transakciji postavlja `app.session_token` (slučajni token iz kolačića). `SECURITY DEFINER` funkcija `current_actor()` hashira token, traži redak u tablici `session` (na koju `ductus_app` nema `SELECT`), provjerava istek i vraća `user_id` i ustanovu. Politike čitaju `nullif(current_setting('app.session_token', true), '')`. Zašto ne sirovi `app.user_id`: `set_config` smije pozvati svaka uloga, pa bi SQL injekcija glumila bilo kojeg korisnika. Jedan modul `withActor(token, fn)` je jedini izvoz za pristup bazi, ESLint zabranjuje izravni `pool.query`, a test provjerava da se GUC ne zadržava na vezi nakon transakcije (nakon prvog `SET LOCAL` GUC vraća `''`, ne NULL; ni `SET` bez `LOCAL` ni `false` u `set_config` ne smiju se pojaviti u kodu ni u bibliotekama).
- **RLS je obrana u dubinu**, ne granica protiv kompromitirane aplikacije; tako se piše u dokumentaciji i DPIA-i.
- Lažni OIDC pružatelj samo lokalno i u CI-ju (`node-oidc-provider` u procesu ili `mock-oauth2-server`); CI test provjerava da ga produkcijska konfiguracija nema.

### 4.4 Ovlasti

- `can(actor, action, object)` je jedino mjesto odluke; RLS i RPC pozivaju nju.
- **Ispravak v0.1:** odnosi **nisu** bez nasljeđivanja. Postoji kolegij, zadatak, projekt i dokument lanac, i R2 model ima tuple-to-userset. Argument protiv OpenFGA (D-07) vrijedi jer su odnosi plitki i broj vrsta mali, ne zato što nema nasljeđivanja.
- **R2 referentni model nije model Ductusa.** R2 ima uloge `assistant`, `co_mentor`, `reviewer`, `auditor`, vremenski ograničen `break_glass`, a nastavnik kolegija u njemu **ne** vidi rad, dok D-06 daje nastavniku trenutno stanje. Zato se piše **novi izvršni referentni model Ductusa** (TypeScript, iz `PRODUCT.md` i `ARCHITECTURE.md` §7), a R2 i `authz/*.fga` služe samo kao izvor neprijateljskih slučajeva. Diferencijalni test uspoređuje `can()` s tim novim modelom.
- Opoziv je odmah: nema predmemorije odluka. Čitanje evidencije i izvoz evidencije su zasebne sposobnosti; administrator ustanove nije superadministrator sadržaja.

### 4.5 Poslovi, obavijesti, AI

- pg-boss u workeru, `migrate: false` (njegovu shemu vodi `ductus_migrator`). **Tijela poslova su samo ID-ovi** (test).
- Obavijest nastavniku o novoj reviziji nastaje **najviše jednom po P-03 prozoru** (i po D-39 samo na kraju sesije ako se potvrdi), pa polling od 30 do 60 s ne pretvara pogled u uživo (D-06). Test.
- AI proxy (izvan pilota, D-77; vrijedi nakon pilota) je obična Next.js ruta koja provodi popis dopuštenih pružatelja po fakultetu i zadatku, uz `provider.only`, isključene fallbackove i `data_collection: deny` u zahtjevu prema OpenRouteru, te ograničenje troška po studentu. Studentov ključ šifrira se aplikacijski: AES-256-GCM, KEK iz okoline, **AAD = `user_id` + namjena + verzija ključa**. Ne `pgsodium` (u najavi ukidanja).
- Uvoz DOCX i PDF: parsira se **u pregledniku ili u izoliranom poslu** s ograničenjem veličine i vremena (zip bombe, XXE), nikad u web procesu.

### 4.6 Rekonstrukcija i predaja

- Isti kod kao klijent (ProseMirror u Nodeu) u workeru, u kontejneru s ograničenim CPU-om da ne guši ingest. B0.2 mjeri 15.000 riječi (pilot) i 80.000 (doktorski, izvan pilota, `PROGRAM.md`).
- **Vrijeme predaje je `requested_at` iz sata baze u trenutku klika**, prije reda rekonstrukcija. Potvrda nosi to vrijeme. Nepodudarnost nakon roka ide u zamjenski postupak s očuvanim `requested_at`. Jedan izvor vremena za sve pravno relevantne trenutke: sat baze; prikaz u Europe/Zagreb. Load test (B9): 100 % predaja u 15 minuta prije roka.
- Kontrolne točke s punim tekstom: B0.2 (`docs/spikes/B0.2.md`) pokazao je da svakih 200 koraka volumen raste kvadratno; PRIJEDLOG je oko 2.000 koraka, odluka uz B0.3.

### 4.7 Kopije, povrat, čuvanje

- **Baza:** PITR 3 dana na UpCloud Developer (RPO procjenjuje B0.1, ne pretpostavlja se 5 minuta), plus dnevni šifrirani logički `pg_dump` (`age`) u spremnik drugog dobavljača.
- **Bucket:** `pg_dump` ne sadrži odsječke. Dnevna replikacija bucketa (`rclone sync` bez brisanja, šifrirano) u drugi račun (Hetzner Object Storage ili sl.). Bez toga gubitak ili blokada Scaleway računa znači da potvrde postoje, a sadržaj koji dokazuju ne postoji (uvjet zaustavljanja pilota).
- **Backup postoji tek kad je restore dokazan:** mjesečna proba povrata baze **i** bucketa u privremeno okruženje, pa `ductus verify` nad uzorkom radova, zapis rezultata.
- **Rezervni put na drugom računu** (Scaleway Instance ili Hetzner) u istom OpenTofu kodu; RTO se mjeri u probi i uključuje DNS, novu adresu, tajne i povrat ključeva (KMS ključevi ostaju na AWS-u). Cilj RTO 4 sata je cilj, ne tvrdnja.
- **Brisanje po roku i kopije.** Versioning bucketa i backupi znače da `DeleteObject` ne briše: retention briše i verzije (`DeleteObjectVersion`) ili životni ciklus nesadašnjih verzija s kratkim rokom. Za svaku vrstu kopije (PITR, dump, replika, snimke) zapisan je rok čuvanja; brisanje po roku postaje potpuno tek kad istekne najdulji. Hashevi čvorova Merkle stabla ne brišu se (ne sadrže sadržaj).
- Prozor održavanja upravljane baze zakazuje se izvan rokova predaje (D-69) i upisuje u `OPERATIONS.md`.

### 4.8 Migracije i sheme

**Odlučeno (D-91, 8. 10. 2026.): dbmate**, uz zaštitne mjere jer alat bilježi samo broj verzije i ne dokumentira zaključavanje:

1. `db/migrations.sum` sa SHA-256 svake migracije; CI pada ako se postojeća migracija izmijeni ili obriše (samo dodavanje).
2. Uvijek `--strict` (odbija migracije izvan redoslijeda).
3. Deploy drži `pg_advisory_lock` na zasebnoj vezi dok dbmate radi.
4. Reproducibilnost: CI na svježoj bazi radi `dbmate up` i `dbmate dump` i uspoređuje rezultat s commitanim `db/schema.sql`; `pg_dump` iste glavne verzije kao server.
5. Zanošenje stvarnih okruženja: pgTAP matrica (vlasnici, ovlasti, RLS, politike, `SECURITY DEFINER` s praznim `search_path`) nad stagingom i produkcijom te normalizirani `pg_dump --schema-only` između njih.
6. Uloge u zasebnoj idempotentnoj bootstrap skripti (djeluju na razini klastera; na upravljanoj bazi provjerava ih B0.1); ovlasti i vlasništvo funkcija u migracijama, s pgTAP provjerom; aplikacijske uloge nemaju pristup `schema_migrations`.
7. Produkcija samo naprijed: deploy poziva isključivo `dbmate --strict up` kao `ductus_migrator` s VM-a; `rollback` postoji samo lokalno. pg-boss radi s `migrate: false`, a njegov SQL (iz `getConstructionPlans` ili `getMigrationPlans`) commitira se kao dbmate migracija; nadogradnja pg-bossa ide istim putem.

Expand/migrate/contract i pgTAP u CI-ju bez `supabase start` vrijede i dalje.

### 4.9 Opservabilnost i curenje sadržaja

- Parametri baze: `log_statement=none` i da greška ne ispisuje naredbu s parametrima (provjeriti u B0.1 smije li se mijenjati; inače pozivati funkcije tako da tekst ne ide kroz parametre loga). Caddy access log bez query stringova; Next.js neuhvaćene greške bez tijela zahtjeva.
- GlitchTip EU ili Sentry s `sendDefaultPii=false` i `beforeSend` koji odbacuje tijela. Canary test radi **u CI-ju i na stagingu nad logovima aplikacije, Caddyja i baze**.
- Pet alarma u `OPERATIONS.md` (e-pošta i push): backlog `pending_signature`, neuspjeli dnevni korijen ili žig, neuspjeli backup ili replikacija bucketa, disk i istek TLS-a i broj veza na bazi, vanjski uptime monitor. SLO-ovi: "potvrda potpisana unutar N minuta", "korijen žigosan do 02:00".

## 5. Što još nije potvrđeno (spike prije odluke)

| Stavka | Provjera | Gdje |
| --- | --- | --- |
| Povrat u točku na UpCloud Developer: postupak (Hub, API ili podrška), stvarni RPO, trajanje, stvara li novu instancu | Dodatak A, oko 30 minuta i nekoliko centi | B0.1 |
| Cijene UpCloud VM-a: sažeci cjenika se razlikuju (Cloud Native 4 GB / 1 vCPU 12 EUR i 8 GB / 2 vCPU 24 EUR prema jednom, 2 vCPU / 4 GB 15 EUR prema drugom) i je li disk uključen | Pogledati cjenik u konzoli pri otvaranju računa | B0.1 |
| Uloge na upravljanoj bazi: `CREATE ROLE NOLOGIN`, `ALTER FUNCTION OWNER`, `GRANT role TO role`, `max_connections`, promjena log parametara, ekstenzije | Pokrenuti skriptu uloga i pgTAP | B0.1 |
| Latencija VM do baze i trajanje `reserve` | Mjerenje | B0.1 |
| Jesu li UpCloud Cloud Native tipovi dostupni i po kojoj cijeni za računalo koje ne guši pri rekonstrukciji | Cjenik i narudžba | B0.1 |
| Rekonstrukcija 15.000 i 80.000 riječi (vrijeme, memorija, volumen kontrolnih točaka) | Lokalna osnovica gotova 3. 10. 2026. (`docs/spikes/B0.2.md`): CPU i memorija nisu problem, volumen točaka svakih 200 koraka jest. Ostaje ponoviti na stroju koji se stvarno kupuje | B0.2 |
| AWS KMS Ed25519 u eu-central-1: latencija potpisa | Mjerenje | B0.1 |
| Uvjeti za partnera AAI@EduHr (može li obrt ili fizička osoba), rokovi, trajnost identifikatora | Pitati Srce, ali tek ako FPZG put ne uspije (§4.3) | Owner queue |
| FINA: minimalna mjesečna naknada, uvjeti, tko je ugovorna strana | Upit | Owner queue |
| Sentry EU na besplatnom planu | Pročitati | B9 |

Riješeno 3. 10. 2026.: cijena KMS-a (službeni cjenik), uvjeti besplatnih TSA-ova (ne postoje objavljeni, zato dva neovisna žiga), tko registrira AAI klijenta (§4.3), PITR mehanizam na UpCloud-u (dokumentacija). Ostaje samo ono što traži račun: stvarni povrat i cijene u konzoli.

## 6. Obvezna kontrolna lista za svaku backend komponentu

PR se ne spaja dok nije ispunjeno ili dok nije zapisano zašto nije primjenjivo.

1. Domenski ugovor (tipovi + Zod shema, verzionirana).
2. Validacija na granici (veličine, nepoznata polja odbijena).
3. Redak u pgTAP matrici i test odbijanja.
4. Matrica kvarova.
5. Idempotencija i ponovni pokušaji.
6. Klasa podataka i rok čuvanja, uključujući kopije.
7. Neprijateljski testovi (izmijenjeni bajtovi, ponovljeni ID s drugim sadržajem, tuđa i istekla sesija, uklonjeni nastavnik, SQL pod `ductus_app` koji pokušava glumiti drugog).
8. Plan migracije i povrata.
9. Opservabilnost bez sadržaja; canary test.
10. Konfiguracijska brava (zatvoreno bez potpune konfiguracije).
11. CI zelen, uključujući pgTAP i property testove.
12. Ako dira povjerenje: **sintetički prolaz na živom stagingu koji koristi iste vrste resursa kao produkcija (upravljana baza, KMS, S3), s povratom.** Pouka iz R4: prvi stvarni RPC poziv otkrio je grešku koju je migracija prešla.

Dodatna matrica kvarova:

| Kvar | Ispravno ponašanje |
| --- | --- |
| VM pada | Klijent nastavlja lokalno ("čeka poslužitelj"); rezervni put na drugom računu; FPZG zamjenski postupak ako traje preko praga |
| Worker pada | Ingest prima; potvrde ostaju `pending_signature`; backlog je alarm |
| Baza nedostupna | Ingest 503, klijent ponavlja; potvrda ne postoji bez zapisa u bazi |
| Bucket nedostupan | Nema metapodataka ni potvrde |
| KMS nedostupan | `pending_signature`; ponovni potpis iste potvrde; dnevni korijen čeka |
| TSA nedostupan | Korijen potpisan i objavljen "bez žiga"; posao ponavlja; vrijeme žiga se ne unazađuje; paket dokaza "još nije sidren" |
| Ključ potvrda kompromitiran | Postupak iz `ARCHITECTURE.md` §8; listovi su bez potpisa pa ponovni potpis ne ruši dokaze |
| Račun kod dobavljača blokiran | Povrat iz kopija na drugi račun (baza iz PITR/dumpa, bucket iz replike); proba ovo mjeri |
| Greška pri deployu | Migracije samo naprijed (expand/contract); povrat slike |

## 7. Trošak (procjena 3. 10. 2026., EUR godišnje)

| Stavka | Bez PDV-a | Napomena |
| --- | --- | --- |
| UpCloud Cloud Native VM (2 vCPU / 4 GB, 15 EUR mjesečno) | oko 180 | Veći tip (4 vCPU / 8 GB, 32 EUR mjesečno, oko 384) ako B0.2 traži; disk možda dodatno |
| UpCloud Managed PG Developer 2 GB (14 EUR mjesečno) | oko 168 | PITR 3 dana; bez HA i SLA; disk NEPROVJEREN |
| Scaleway Object Storage | 5 do 10 | |
| Scaleway TEM | oko 14 | |
| Replika bucketa (drugi račun) | 10 do 40 | |
| AWS KMS (2 ključa, 100.000 potpisa mjesečno) | oko 40 | 1 USD po ključu mjesečno + 0,15 USD na 10.000 potpisa, službeni cjenik |
| Domena `.hr` | 15 do 30 | sekundarni izvor |
| TSA žigovi | 0 | Dva besplatna TSA-a; FINA kasnije oko 40 EUR godišnje + certifikat 86,27 EUR na 5 godina |
| Praćenje grešaka i vanjski monitor | 0 do 20 | |
| Staging (privremeni resursi tjednima prije aktivacije, naplata po satu NEPROVJERENA) | 30 do 100 | Staging mora koristiti upravljanu bazu, KMS i S3 (§6 točka 12) |
| **Ukupno** | **oko 460 do 600** | |
| **S PDV-om (oko +25 %)** | **oko 575 do 750** | PDV se naplaćuje fizičkoj osobi bez obrta u sustavu PDV-a; potvrditi sa računovođom |

To je **iznad D-66** (infrastruktura 300 do 500 plus domena i e-pošta 50 do 100) i troši rezervu. Zato je odluka vlasnika:

- **Varijanta A (preporuka ako B0.1 prođe):** gore opisano. Dodatni trošak pokriva rezerva (100 do 200) i stavka "sigurnost" (0 do 200) iz D-66 se smanjuje.
- **Varijanta B:** Hetzner VM (ako se CX tip stvarno može naručiti; CPX32 dodaje oko 280 EUR godišnje) + PostgreSQL s WAL-G na vlastitom VM-u, bez upravljane baze. Jeftinija, ali PITR, nadogradnje i proba povrata postaju tvoj posao; baza ima javnu adresu ili tunel.
- Rezanje po potrebi: FINA tek s ugovorom, staging samo u zadnjim tjednima, replika bucketa na jeftiniji spremnik, jedan KMS ključ za prvi mjesec.
- Pri 5 puta većem broju korisnika procjena je 160 do 300 EUR mjesečno, izvan budžeta; to je tada pitanje financiranja.

## 8. Program backenda

Backend nije posebna faza nego okomiti rez kroz M0 do M11. **Procjena dodatka prema `PROGRAM.md`: realno 18 do 25 večeri** (v0.1 je rekao +6 do +10 bez osnove; uklonjeni Supabase poslovi nikad nisu bili zasebno procijenjeni, pa se "neto" ne može izračunati). Preporučujem da se dodatak vodi kao zaseban red u valu 1.

| Korak | Sadržaj | Izlazni kriterij | Faza | Večeri |
| --- | --- | --- | --- | --- |
| B0.1 Spike okruženja | UpCloud VM + Managed PG, skripta uloga, PITR povrat u točku, RTT, log parametri, KMS ključ | Zapis s brojkama; PITR radi ili se odabire varijanta B | prije M2 | 2 do 3 |
| B0.2 Spike rekonstrukcije | ProseMirror u Nodeu za 15.000 i 80.000 riječi na stvarnom stroju | Vrijeme, memorija, volumen; granice posla određene | prije M3 | 1 do 2 |
| B0.3 Odluka | Vlasnik potvrđuje D-08, D-71 do D-75 prema rezultatima | ODLUČENO u `DECISIONS.md` | | 0 |
| B0.4 Prepis ARCHITECTURE | Cijeli dokument (uključujući §2, §3, §8, §11), §12 s točnim popisom prijenosa | Bez Supabasea i Netlifyja | M0 | 1 do 2 |
| B1 Okruženja | `docker compose` (Postgres, S3-kompatibilna pohrana (RustFS), Mailpit, lažni OIDC), OpenTofu (dva računa), CI deploy, migracijski alat, `sops`/`age`, uloge, Caddy, deploy s VM-a | `docker compose up` i `npm test` zeleno; staging se podiže iz koda | M0 | 5 do 7 |
| B2 Identitet | OIDC klijent s popisom iz §4.3, sesije, `current_actor()`, `withActor`, test GUC-a, odjava | Prijava na AAI Labu; svi testovi iz §4.3 zeleni; nema lažnog pružatelja u produkciji | M1 | 3 do 5 (uz sigurnosni pregled, neovisan o autoru) |
| B3 Ovlasti | Novi referentni model, `can()`, RLS, pgTAP matrica, diferencijalni test | Matrica zelena | M2 | uključeno u M2, +1 |
| B4 Evidencija | Točan popis prijenosa (§2), novi RPC-i, okidači, uloge, jedan RPC za commit i `reserve`, worker potpis preko KMS-a, kontrolne točke, praznine | Ugovorni testovi nad in-memory i pg/S3; property testovi; sintetički prolaz na stagingu s povratom | M3 | +5 do 8 |
| B5 Dnevni korijen i žig | Kumulativni log i dnevna kontrolna točka (D-93), consistency dokaz, KMS potpis, TSA, objava i neovisni primatelji, CLI verifikator | Neovisna provjera prolazi; promjena odsječka ruši provjeru; dan bez TSA-a se oporavlja | M3 do M7 | 4 do 5 |
| B6 Poslovi i obavijesti | pg-boss, retention (uklj. verzije), e-pošta, `notification` s prozorom P-03 | Ponovljen posao ne duplicira učinak; nastavnik ne dobiva obavijest češće od P-03 | M6, M7, M10 | +1 do 2 |
| B7 AI proxy | Izvan pilota (D-77) | | nakon pilota | 0 u pilotu |
| B8 Predaja | `requested_at`, rekonstrukcija u workeru, usporedba JCS | Točna na svim scenarijima uključujući prazninu i pred-rokovni val | M7 | uključeno u M7 |
| B9 Operacije i GO | Backup i replika bucketa, mjesečna proba povrata (baza i bucket), alarmi, statusna stranica, `OPERATIONS.md`, load test, OWASP, popis podizvršitelja s DPA-ima | Svi crveni GO uvjeti zeleni; zapisana proba povrata | M11 | +3 do 4 |

Redoslijed i kontrolna točka 15. 12. 2026.:

1. B0.1 i B0.2 dolaze prije vezivanja za dobavljača; do tada M0 piše samo kod iza sučelja (baza, objekti, e-pošta, potpis, vrijeme).
2. B0.1 je **blokiran računima** kod UpCloud-a i AWS-a (Owner queue).
3. B5 se ne reže u prvom rezu. Ako treba rezati: prvo web verifikator (ostaje CLI), zatim objava u javni repozitorij (korijen, potpis i žig ostaju). **FINA ugovor nije GO preduvjet**; produkcija može krenuti s besplatnim TSA-om uz upisanu posljedicu.
4. Vanjske ovisnosti na kritičnom putu: Srce (2 do 6 tjedana je moja procjena, ne izvor; privatni subjekt možda mora preko FPZG administratora ili postati partner federacije), FINA, PR #49 i #50 (blokiraju M0), računi dobavljača.
5. Kapacitet iz `PROGRAM.md` (10 jedinica tjedno) računa samo Ductus; M4 traži rad u Lekti, a vlasnik vodi i druge projekte. Zato kontrolna točka ostaje stvarna, ne formalna.

## 9. Što treba od vlasnika

- Potvrditi ili promijeniti D-08, D-71 do D-75 (vidi i odluku o troškovima u §7).
- Računi: UpCloud, Scaleway (Object Storage, TEM), AWS (samo KMS, IAM korisnik s uskim ovlastima), 2FA svugdje, agent dobiva ograničene ključeve po okolišu.
- **FPZG, ne Srce, je prvi korak za AAI:** zamoliti odgovornu osobu FPZG-a za AAI@EduHr da (1) e-poštom na `aai@srce.hr` ovlasti Daniela za AAI@EduHr Lab i (2) registrira Ductus kao uslugu FPZG-a u Registru resursa (OIDC klijent, redirect URI, scopeovi). Tekst zahtjeva je u Dodatku B.
- FINA: tek kad postoji obrt (ili ako FPZG želi biti ugovorna strana); do tada dva besplatna TSA-a.
- Računovođa: PDV za fizičku osobu bez obrta.
- Lokalni stroj s Dockerom za M0.

## Dodatak A: proba povrata u točku na UpCloud-u (B0.1)

Cilj: dokazati da povrat u točku stvarno radi, izmjeriti RPO i trajanje. Traje oko 30 minuta, trošak je nekoliko centi (naplata po satu, instanca se briše nakon probe).

1. U UpCloud Hubu stvoriti Managed PostgreSQL, plan Developer, zona `de-fra1` (ili `fi-hel1`), u privatnoj mreži s jednim malim VM-om.
2. S VM-a pokrenuti pisanje markera svakih 10 sekundi, 20 minuta:
   ```sql
   create table pitr_probe (id bigserial primary key, written_at timestamptz not null default clock_timestamp());
   ```
   ```bash
   for i in $(seq 1 120); do psql "$DATABASE_URL" -qc "insert into pitr_probe default values"; sleep 10; done
   ```
3. Zapisati točno vrijeme T (UTC) oko 12. minute; zatim obrisati sve: `delete from pitr_probe;` (simulirana greška).
4. U Hubu (ili kroz podršku ako Hub to ne nudi) zatražiti povrat u točku T. Zapisati: gdje je opcija, stvara li novu instancu ili prepisuje postojeću, koliko traje.
5. Na vraćenoj bazi: `select max(written_at) from pitr_probe;` RPO = T minus `max(written_at)`. Očekivano do 5 minuta prema dokumentaciji.
6. Isto na istoj instanci: provjera uloga (`create role ductus_evidence nologin; grant ...; alter function ... owner to ...`), `show max_connections;`, smije li se mijenjati `log_statement` i `log_min_error_statement`.
7. Rezultat u `docs/spikes/B0.1.md`: koraci, vremena, RPO, slike zaslona, odluka. Obrisati instance.

Ako povrat u točku nije dostupan na Developer planu ili traje predugo: Neon Launch (PITR 7 dana) ili varijanta B, odluka vlasnika.

## Dodatak B: zahtjev FPZG-u za AAI@EduHr

> Poštovani, za pilot alata Ductus na FPZG-u (pisanje studentskih radova uz evidenciju procesa) prijava studenata i nastavnika ide isključivo preko AAI@EduHr. Prema pravilima AAI@EduHr uslugu može registrirati matična ustanova, a pristup AAI@EduHr Labu odobrava ovlašteni predstavnik ustanove. Molim (1) da ovlastite Daniela Rišavija za korištenje AAI@EduHr Laba e-porukom na aai@srce.hr i (2) da, kad Lab test prođe, registrirate Ductus kao uslugu FPZG-a u Registru resursa (OpenID Connect; tražimo samo atribute hrEduPersonUniqueID, hrEduPersonHomeOrg, hrEduPersonAffiliation i ime; OIB ne). Tehničke podatke (redirect URI, logout URI) dostavit ću. Hvala.

