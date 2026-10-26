# Ductus: plan i program backenda

Verzija 0.3 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi · Status: PRIJEDLOG (čeka potvrdu dijela D-08 o dobavljačima i trošku, rok B0.1 16. 11. 2026., te D-72, D-73 (samo izbor biblioteke; vlastiti OIDC klijent odlučen 11. 10. 2026., a sesije u bazi i identitet u RLS-u potvrđeni u D-90) i D-75; D-71 i D-74 potvrđene 10. 10. 2026.; dio D-08 o aplikaciji i D-34 odlučeni 11. 10. 2026., D-71 i D-72 dopunjeni 11. 10. 2026. domenom evidencije, D-102)

Ovaj dokument zamjenjuje otvoreni D-08. Izvori: dokument "Pisač: Backend arhitektura i vizija vNext" (dalje vNext), tri istraživanja (hosting, potpisi i vrijeme, prijava i ovlasti), `ARCHITECTURE.md` v0.2, te dva neovisna pregleda (arhitektonsko-sigurnosni i provjera činjenica na primarnim izvorima). **Verzija 0.1 imala je pogrešku koja je mijenjala preporuku: Scaleway Managed PostgreSQL nema PITR ni na jednom tipu čvora** (provjereno u službenom repozitoriju dokumentacije `scaleway/docs-content`, commit od 2. 10. 2026.). Ova verzija to ispravlja i ugrađuje ostale nalaze pregleda (šest kritičnih, 19 važnih). Cijene su s datumom 3. 10. 2026.; gdje nešto nije potvrđeno s primarnog izvora, piše NEPROVJERENO.

## 1. Sažetak odluke

Preporuka je **uvjetna**: potvrđuje je tek ono što spikeovi B0.1 i B0.2 izmjere. Ako ne prođu, vraća se vlasniku, ne mijenja se tiho.

**Odluka vlasnika 11. 10. 2026. (D-08; issue #87, komentar 6105246182):** dio o aplikaciji (Next.js i worker, PostgreSQL s RLS-om i ulogama, pohrana kompatibilna sa S3, vlastiti OIDC klijent, sve u EU-u) je ODLUČEN, uz dopunu o domeni evidencije (D-102). Dio o dobavljačima i trošku (u tablici ispod retci s imenovanim dobavljačima i redak o trošku; retci Prijava i Ovlasti pripadaju aplikacijskom dijelu) ostaje PRIJEDLOG do provjere B0.1, s rokom 16. 11. 2026. Ključ potvrda, ključ kontrolne točke, spremnik pohrane i dnevnik potvrda su po domeni evidencije (jedna ustanova u jednoj regiji), ne jedan za sve.

| Pitanje | Preporuka | Zašto i što je provjereno |
| --- | --- | --- |
| Supabase | **Ne kao osnova.** | Potvrđeno: Edge Functions 2 s CPU i 256 MB; PITR dodatak 100/200/400 USD mjesečno za 7/14/28 dana; Realtime 500 veza na Pro. Argument CPU-a još nije izmjeren za naše radove (B0.2): ako rekonstrukcija 15.000 riječi stane znatno ispod 2 s, taj argument otpada. Ostali razlozi stoje: Next.js ionako traži drugi host, cijena PITR-a, vezanost uz Auth/RLS/Vault |
| Baza | **UpCloud Managed PostgreSQL (Developer), PITR 3 dana**, finska tvrtka | Zamjena za Scaleway PG koji PITR nema. Potvrđeno u dokumentaciji UpCloud-a: dnevni puni backup, WAL se kopira "continuously at 5-minute intervals", retencija 3, 15 ili 31 dan, Developer plan 3 dana; privatna mreža podržana. **Postupak povrata u točku nije dokumentiran** (Terraform provider nema parametar za fork ni vrijeme povrata), pa ga B0.1 mora izvesti (Dodatak A). Rezerva: Neon Launch (Frankfurt, PITR do 7 dana, američka tvrtka) |
| Aplikacija | Next.js (Docker) i zaseban worker na **UpCloud Cloud Native VM-u** u istom okruženju kao baza | Jedan dobavljač za računalo i bazu daje privatnu mrežu (baza bez javne adrese), nižu latenciju i izbjegava problem Hetznera: za CX tipove službena stranica kaže da je "number of available servers limited" i "currently unavailable", pa se CX43 možda ne može kupiti. Hetzner ostaje opcija za drugi račun (rezerva), ne za primarni put |
| Objekti | Scaleway Object Storage (S3, privatni bucket), 0,016 EUR/GB | Potvrđena cijena. Uz dnevnu replikaciju u drugi račun (§4.7) |
| E-pošta | Scaleway TEM, oko 14 EUR godišnje za 5.000 poruka | Potvrđeno |
| Prijava | Vlastiti OIDC klijent prema AAI@EduHr, sesije u bazi; **Better Auth s `accountLinking.enabled: false`** ili `openid-client`, odluka na M1 | Potvrđeno: Better Auth ima OIDC discovery i PKCE, ali povezivanje računa po e-pošti je **zadano uključeno**, a polje `email` je obvezno i jedinstveno (rizik ako AAI ne vrati `mail`) |
| Ovlasti | RLS + `current_actor()` (provjera tokena sesije u bazi) + `can()` + pgTAP; bez OpenFGA | §4.4. RLS je obrana u dubinu, ne granica protiv kompromitirane aplikacije |
| Potpisi | **Dva odvojena Ed25519 ključa u AWS KMS** (ključ potvrda, ključ dnevnog korijena), potpisivanje izvan web procesa | Preokret u odnosu na v0.1. Adapter `aws-kms-ed25519-signer` već postoji u kodu, a ugovor porta traži KMS/HSM. KMS sprječava izvoz ključa. Potvrđeno sa službenog cjenika: 1 USD mjesečno po ključu, 0,15 USD na 10.000 potpisa asimetričnim ključem (izvan besplatne kvote), cjenik ne navodi razlike po regijama. Za 2 ključa i 100.000 potpisa: oko 3,5 USD mjesečno. U KMS ide 59-bajtna prefiksirana digest-poruka za potvrde, odnosno točan tekst C2SP bilješke (bez potpisnih redaka) za kontrolne točke |
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
        +-----> AWS KMS (D-92 Sign nad prefiksiranim digestom; D-93 Sign nad izvornim C2SP tekstom; dva ključa)
        +-----> OpenRouter (samo kad student pokrene AI; izvan pilota, D-77)
        +-----> TSA (RFC 3161, jednom dnevno, iz workera)
Javno: dnevni potpisani korijen + žig (bez sadržaja rada); drugi neovisni primatelji korijena (§4.2)
```

Pravila:

1. **Baza nema javnu adresu** (privatna mreža unutar UpCloud okoline). Object Storage ima javni S3 endpoint uz autentikaciju i uvijek je izvan privatne mreže; zato su ključevi bucketa uske ovlasti, a veza `verify-full`. KMS je također vanjski poziv.
2. **Uloge u bazi** (svaka s pgTAP retkom): `ductus_migrator` (jedini s DDL-om; pokreće se **s VM-a pri deployu**, ne iz GitHub Actionsa, da se baza ne otvara IP rasponima runnera), `ductus_app` (podliježe RLS-u, bez `BYPASSRLS`, **bez `EXECUTE` na evidencijske funkcije**), `ductus_worker` (bez `BYPASSRLS`, samo uske `SECURITY DEFINER` funkcije za rekonstrukciju, ponovni potpis i korijen), `ductus_retention` (samo funkcija brisanja pokazivača na sadržaj), `ductus_evidence` (NOLOGIN, vlasnik funkcija sheme `evidence`), `ductus_identity` (NOLOGIN, vlasnik tablica sheme `identity` i funkcija `current_actor()` i odjave [D-90]), `ductus_auth` (jedina uloga s `EXECUTE` na otvaranje sesije [D-90]; namijenjena ruti povratka s prijave, B-6). Sve osim `ductus_migrator` su grupne uloge bez prijave i stvara ih migracija; `ductus_migrator`, korisnike s prijavom i lozinke daje okolina (provisioning iz B0.1), nikad migracija. Zadane ovlasti oduzimaju `EXECUTE` od PUBLIC za nove funkcije čiji je vlasnik `ductus_migrator`, `ductus_identity` ili `ductus_evidence`.
3. **Web proces ne drži nikakav materijal ključa.** Potpisuje worker preko KMS-a: ingest ruta zapisuje objekt i poziva RPC, a potpis se priključuje u workeru (stanje `pending_signature` već postoji kao normalan tok; klijent dobiva "spremljeno na poslužitelju" tek kad je potvrda potpisana, kao do sada).
4. Tajne: GitHub Environments sa zaštitom za CI, na VM-u `sops` + `age`; **`age` ključ i pričuvne kopije tajni drži vlasnik izvan VM-a** (potrebno za RTO).
5. Sadržaj radova nikad u logove, predmemoriju ni analitiku (§4.9).
6. **Bez server-side renderiranja sadržaja** (kao u `ARCHITECTURE.md` §1). Ništa u pilotu ne traži SSR, a `no-store` u odgovoru ne isključuje Next.js Data/Full Route Cache. Sve rute sa sadržajem su API rute s `dynamic = 'force-dynamic'`, `revalidate = 0`, ESLint pravilom i E2E testom s dva korisnika.
7. API rute s verzijom protokola (ne Server Actions) za sinkronizaciju, zbog starih klijenata nakon deploya; `upgrade_required` za predugo offline klijente.

## 4. Ključne dizajnerske odluke

### 4.1 Evidencija, potpis i bucket

- Tok odsječka: validacija i točni bajtovi; zapis objekta (`v2/<ustanova>/<paket>/<hash>.json` u spremniku domene evidencije, D-102; bez upserta, duplikat se prihvaća tek nakon usporedbe bajtova); **jedan RPC** koji radi CAS reviziju i `reserve` (§2); potpis u workeru; `attach_signature`.
- **Domena evidencije (D-102; odluka vlasnika 11. 10. 2026., komentar 6105084144).** Domena evidencije je jedna ustanova u jednoj regiji. Svaka domena ima vlastiti par ključeva za potpis (ključ potvrda i ključ kontrolne točke dnevnika; precizira D-71), vlastiti spremnik pohrane iz konfiguracije operatera (nikad zadani ili zajednički) i, u valu 2, vlastiti dnevnik potvrda. Tablica ključeva (`signing_key`) od prvog dana nosi doseg (domena), a oznaka ključa u potvrdi jednoznačno određuje ključ. Potpisani sadržaj potvrde v2 nosi neproziran, nepromjenjiv identifikator domene evidencije (nije naziv ni ID ustanove), uveden u istoj, jedinoj izmjeni vektora v2 kao `revision` i `clientTransactionId` (DAN-54), prije prvog stvarnog potpisa; ovdje se vrijednost ne izmišlja. Javni popis domena (identifikator, ustanova, dnevnik, javni ključevi) je kasniji zadatak. Tablice rada, dokumenta, evidencije i predaje nose ključ ustanove izravno (D-103). Postupak uvođenja nove ustanove (spremnik, ključevi, konfiguracija) ne postoji.
- **Potpis potvrde (D-92):** `D = SHA-256(JCS(receiptPayloadV2))`; `receiptSchema` je `ductus-evidence-receipt-v2`. Worker šalje Ed25519 KMS-u (`ED25519_SHA_512`, `RAW`) točne bajtove `UTF-8("ductus-evidence-receipt-v2") ‖ 0x0A ‖ D`, pri čemu je `D` sirovih 32 bajta; verifikator rekonstruira iste bajtove i provjerava potpis.
- **Hash dokumenta (evidencija v2).** Kanonski dokument je JSON vrijednost. Njegovi kanonski bajtovi su UTF-8 zapis RFC 8785 (JCS) oblika te vrijednosti: ključevi poredani po UTF-16 kodnim jedinicama, brojevi u ECMAScript zapisu, bez Unicode normalizacije, bez bjelina. Hash dokumenta je SHA-256 tih bajtova, zapisan kao 64 mala heksadekadska znaka. Vrijednost s usamljenim surogatom, brojem koji nije konačan ili nizom ili objektom ugniježđenim dublje od 256 razina (`MAX_JCS_DEPTH`) nema kanonski oblik i nema hash. Razina je svaki niz ili objekt na putu od korijena do vrijednosti, uključujući korijenski i prazan; vrijednost s 256 razina ima kanonski oblik, a s 257 nema. Izvedba: `canonicalizeJcs` (`src/domain/forensics/jcs.ts`) i `digestCanonicalDocumentV2` (`src/domain/forensics/evidence-replay-v2.ts`).
- **Granice formata v2 (B-8b).** Dubina od najviše 256 razina vrijedi za svaku vrijednost koja se kanonizira: dokument, odsječak i potvrdu. `evidenceProfileId` je neprazan tekst od najviše 120 UTF-16 kodnih jedinica (`MAX_EVIDENCE_PROFILE_ID_LENGTH` u `src/domain/forensics/evidence-segment-v2.ts`), jednako u odsječku, u descriptoru naredbe i u potvrdi. Obje granice određuju što klijent i poslužitelj smiju hashirati i prihvatiti, pa su dio formata v2: mijenjaju se samo novom verzijom formata, na klijentu i poslužitelju zajedno, nikad samo izmjenom konstante. Testovi ih zato drže zapisane brojem.
- **Hash uklonjenog raspona (`removedSha256`, format koraka `ductus-edit-steps-v1`, B-12).** Brisanje, izrezivanje i zamjena raspona u formatu su isti korak `replace`. Takav korak s `from` < `to` koji uklanja barem jedan znak ili cijeli blok nosi `removedSha256`: SHA-256 UTF-8 bajtova RFC 8785 (JCS) oblika ProseMirrorova JSON-a uklonjenog odsječka, `document.slice(from, to).toJSON()`, zapisan kao 64 mala heksadekadska znaka. `document` je dokument neposredno prije tog koraka, dakle nakon ranijih koraka istog događaja. Unutar jednog bloka taj JSON sadrži samo tekstne čvorove, a preko granice bloka blokove sa svim atributima sheme (`nodeId`, `level`) i `openStart`/`openEnd` kad nisu 0. Oznake ostaju, a tekst se ne normalizira: NFC i NFD oblik istog teksta imaju različit hash. Polja nema na umetanju (`from` = `to`), na koraku sa `structure` (raspon koji uklanja samo granice blokova, npr. spajanje) ni na koracima `replaceAround`, `addMark`, `removeMark` i `attr`, čiji ga zatvoreni skup ključeva ne poznaje; brisanje praznog bloka uklanja cijeli blok i nosi hash, nikad `structure`. Parser formata (`parseEditSteps`, `src/domain/document/edit-step.ts`) provjerava samo prisutnost i oblik: `replace` s `from` < `to` bez `structure` mora imati polje (`missing_field`), drugdje ga ne smije imati, a vrijednost mora biti `^[0-9a-f]{64}$` (`invalid_removed_hash`). Isto i samo to provjerava validator odsječka pri prihvatu. Vrijednost provjerava replayer (`removedRangeSha256` i `createEditStepsV1Replayer` u `src/adapters/evidence/edit-steps-v1-replayer.ts`, PR #391): na dokumentu prije koraka utvrdi uklanja li raspon znak ili cijeli blok, traži hash točno tada i `structure` točno kad ne uklanja, pa izračunani hash uspoređuje sa zapisanim. Nepodudaranje odbija korak; `replayEvidenceSegmentsV2` tada zaustavlja cijeli replay s ishodom `step_failed` (uz indeks odsječka i redni broj događaja), ništa ne popravlja ni preskače, a rekonstrukcija daje `mismatch` s tim razlogom. Bilježenje na klijentu mora izračunati istu vrijednost prije slanja koraka. Definiciju drži test s poznatim odgovorom: za sintetički odsječak JCS `{"content":[{"text":"Odlomak B","type":"text"}]}` hash je `90d4f8aa06a3d89df35caec6d423df7e3f221ba5d01e33ffc23ecaa232c815bf`.
- **`removedSha256` pri prihvatu i promjena definicije (odluke vlasnika 17. 10. 2026.; https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6235204707).** (1) Prihvat odsječka provjerava samo oblik `removedSha256` (prisutnost i format) i ne pokreće replay prije potpisa. Potpis pri prihvatu potvrđuje primitak točno poslanog, ne ispravnost. Krivi hash otkriva rekonstrukcija i označava ga `mismatch`, a zapis ostaje kao dokaz. Razlog: odbijanje pri prihvatu zaustavilo bi sinkronizaciju zbog greške klijenta i riskiralo gubitak rada, a replay pri prihvatu traži stanje dokumenta na poslužitelju. (2) Definicija `removedSha256` (hashirani oblik, JCS `Slice.toJSON`, atributi sheme) mijenja se samo novom verzijom formata koraka, kao kod granica formata v2.
- **Skup čvorova formata `ductus-edit-steps-v1` (F-150).** Skup tipova čvorova i oznaka koje format koraka v1 i kanonski dokument `schemaVersion: 1` prihvaćaju samo raste: tip se ne uklanja i ne mijenja mu se značenje. Datirani popis: `paragraph`, `heading` (razine 1 do 3), `text` i oznake `bold` i `italic` od početka formata; `bulletItem` od 26. 10. 2026. (#846) i `quote` od 26. 10. 2026. (#847). Promjena koja uvodi novi tip u istom PR-u dopisuje ga ovdje i u test koji popis drži (`src/adapters/evidence/edit-steps-v1-replayer.test.ts`). Replay koji u koraku naiđe na tip čvora ili oznake koji je tekst, a ne poznaje ga nigdje, javlja `unsupported_format`, ne `step_failed`: zapis tada nije čitljiv ovom verzijom, a ne dokazano kriv. Ishod i dalje blokira (fail closed).
- **Ponovno slanje (odluka uz DAN-46, 10. 10. 2026.).** Pod istim principalom, paketom i `clientRequestId`: isti descriptor i bajt-identičan JCS (isti SHA-256 primljenih bajtova) je `duplicate` i vraća izvornu potvrdu ili nastavlja oporavak `pending_signature`, bez nove pohrane, rezervacije i potpisa; isti descriptor uz drukčije bajtove je `invalid`, izvorni prihvat ostaje netaknut, a promijenjeni bajtovi se ne pohranjuju i ne potpisuju; drukčiji descriptor je `idempotency_conflict`. Autorizacija ide prije lookupa, a zabrane novog ingesta (zatvoren paket, smanjen limit) ne smiju doći ispred legitimnog oporavka. Hash se računa nad primljenim bajtovima, strogo dekodiranima kao UTF-8 (nevaljan niz ili BOM je `invalid`), nikad nad `segmentHash` koji klijent deklarira. Čista odluka je `decideEvidenceRetry` u `src/domain/forensics/evidence-chain-v2.ts`; gateway je preuzima u B-8b.
- **RPC-i se prepisuju, ne prenose.** Postojeći `pisac_evidence_reserve`, `_lookup`, `_ensure_package` i `_authorize_append` primaju identitet kao **parametar** (`p_principal_id`) i jedina im je zaštita da ih smije izvršiti samo `service_role`. U Ductusu su `SECURITY DEFINER` s vlasnikom `ductus_evidence` i praznim `search_path`, **ne primaju identitet kao parametar nego ga izvode iz `current_actor()`** (§4.3), a `ductus_app` ih poziva samo kroz uske omotače. pgTAP test: `ductus_app` ne može dodati evidenciju s tuđim principalom.
- **Evidencijske tablice su samo za dodavanje.** Okidači `BEFORE UPDATE OR DELETE` na `acceptances` dopuštaju samo prijelaz `pending_signature` u `signed` uz nepromijenjen `receipt_payload`, `descriptor` i hash, i zabranjuju `DELETE` osim brisanja pokazivača na sadržaj kroz funkciju retentiona. Glavu lanca (`packages.head_*`) mijenja samo `reserve`. `attach_signature` provjerava da `payloadDigestSha256` odgovara `receipt_payload` i da je `keyId` poznat i neopozvan (tablica `signing_key`). Prema D-102 (komentar 6105084144) tablica ključeva od prvog dana nosi doseg (domena), a oznaka ključa u potvrdi jednoznačno određuje ključ. Provjeravatelj potvrde v2 traži da domena ključa bude domena iz potpisanog sadržaja i da ključ ima namjenu potvrde (pravilo je niže, uz ugovorni vektor); isto pravilo `attach_signature` izvodi (`key_scope`: algoritam, namjena `receipt`, domena i ustanova ključa moraju odgovarati potvrdi; `db/migrations/20261019170000*`). Granica: potpis se veže samo u transakciji koja je rezervirala potvrdu (`other_transaction` inače), pa oporavak `pending_signature` u drugoj transakciji tek slijedi uz worker (B-9).
- **Ugovor adaptera pohrane sadržaja (odluka vlasnika 11. 10. 2026., issue #87, komentar 6109015743).** Jamstva `s3-evidence-payload-store` (`putImmutable`) vrijede za običan, nepromjenjiv ulaz kakav predaje gateway evidencije, jedini pozivatelj. Ulaz koji se mijenja tijekom poziva, getteri s učinkom i slični oblici pozivatelja koji ne postoji poznata su granica, ne nalaz; već ugrađene zaštite ostaju. Svaki novi pozivatelj adaptera uz gateway ponovno otvara ovu granicu i traži vlastiti plan napada.
- **Siročad u bucketu:** automatsko brisanje objekata bez metapodataka **ne radimo u pilotu**. Offline klijent ponavlja odsječak danima kasnije, a `putImmutable` ne piše postojeći objekt, pa zadržava staro vrijeme; posao čišćenja bi mogao obrisati objekt na koji zakašnjeli `reserve` upravo pokazuje. Siročad se samo broji i prijavljuje; brisanje tek nakon 30 dana, uz ponovnu provjeru u bazi neposredno prije brisanja i savjetodavno zaključavanje po hashu. Nakon `reserve` radi se HEAD objekta prije potpisa. Test: konkurentno čišćenje i zakašnjeli `reserve`.
- Autor odsječka dolazi iz sesije na poslužitelju, nikad iz polja klijenta. **Odluka vlasnika 11. 10. 2026. (D-34, potvrđeno; komentar 6105246182) za izravne izmjene nastavnika:** prijedlog sprema poslužitelj pod nastavnikovom sesijom; studentov zapis nosi izvor „primijenjeni prijedlog” i oznaku prijedloga; poslužitelj uspoređuje primijenjeno s pohranjenim prijedlogom, a razliku bilježi kao studentovu promjenu. Mjesto u formatu zapisa rezervira se jednom, prije prve stvarne evidencije, zajedno za prijedloge i izravne izmjene.

- **Kompatibilnost v1/v2 (D-92):** prije odbacivanja v1 provesti i zabilježiti read-only inventar svih `signed` i `pending_signature` v1 potvrda u stvarnim trajnim/deployed izvorima. Repo pregled ne zamjenjuje taj inventar. Ako inventar pronađe `signed` zapise, zadržati v1 verifikator odabran prema `receiptSchema` ili dokazivu migraciju koja čuva postojeće potpise. Za svaki `pending_signature` v1 zapis mora ostati dostupan v1 potpisni put odabran prema `receiptSchema` koji dovršava potpis nad točno nepromijenjenim rezerviranim `receipt_payload`, dok se red ne isprazni ili ne provede izričita provjerljiva migracija. V2 potpisnik se ne smije primijeniti na v1 zapis.


**Ugovorni known-answer vektor (D-92 / D-93; samo sintetički podaci):**

- Receipt-v2 payload u UTF-8 JCS-u s točno ovim redoslijedom ključeva (20 ključeva; `clientTransactionId` iza `acceptedAt`, `evidenceDomainId` između `eventCount` i `evidencePackageId`, `principalId` između `previousReceiptId` i `receiptId`, `revision` iza `receiptSchema`): `{"acceptedAt":"2026-10-03T06:05:00.000Z","clientTransactionId":"tx-š-1","documentId":"doc-1","eventCount":1,"evidenceDomainId":"d21fe0a3-103c-42e5-a29e-c102f9030af5","evidencePackageId":"evidence-1","evidenceProfileId":"standard-v1","evidenceSchema":"ductus-evidence-segment-v2","payloadBytes":123,"predecessorSegmentHash":null,"previousReceiptId":null,"principalId":"72cd1705-85fc-4754-a382-c2500d038368","receiptId":"receipt-1","receiptSchema":"ductus-evidence-receipt-v2","revision":7,"segmentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"segment-1","sequenceFrom":1,"sequenceTo":1,"sessionId":"session-1"}`.
- SHA-256/JCS: `017cf1f3c88b10c1c39ea5d21eade560b838f1bdea4603c79a06886d90d2d706`. RAW ulaz (59B): `6475637475732d65766964656e63652d726563656970742d76320a017cf1f3c88b10c1c39ea5d21eade560b838f1bdea4603c79a06886d90d2d706`.
- Javno objavljen RFC 8032 testni privatni seed (isključivo za test, nikad produkcija): `9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60`. Javni Ed25519 ključ: `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`. Očekivani Ed25519 potpis nad RAW 59B: `0d5276f2d2167892fb5ce379189b85b6fc1616417941bb899726d53ab78e9d43f5ca72fe4a4dcf94770c695550022f4ce1fea38cae6fcf5b74fc5eb44448fb0b`.
- D-93 minimalni C2SP checkpoint unsigned note bytes: UTF-8 `ductus.example/log\n0\n47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=\n` (svaki `\n` jedan LF). RAW Ed25519 potpis (64B) nad tim bajtovima: `7496eaafeb57fa3fd1c902c726cc3ad6bc37a41fa959f484639dc33e5c25f355876412d6938b76a86141f1ed3e6d7c73826c974d27b660546d55c0fa6c752a06`. C2SP Ed25519 `key ID = SHA-256(UTF-8(name) || 0x0A || 0x01 || publicKeyRaw32)[:4]` uz `name=ductus.example/log` daje `eec718bd`. Kanonski verifier key `ductus.example/log+eec718bd+AddamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea`; signature line je točno `— ductus.example/log 7scYvXSW6q/rV/o/0ckCxybMOta8N6QfqVn0hGOdwz5cJfNVh2QS1pOLdqhhQfHtPm18c4Jsl00ntmBUbVXA+mx1KgY=` (base64 od 4B key ID || 64B signature). Potpuni signed note je unsigned tekst + prazna linija + navedena signature line + LF. Test odbija drukčiji signer name, ID izveden iz KMS ARN-a, samo 64B signature bez 4B ID-a i pogrešne/newline bajtove. Samo RFC javni testni seed, nikada produkcijski ključ.
- **Odluke vlasnika 10. i 11. 10. 2026. (D-98 dopuna; D-102; https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6105084144; DAN-54):** potvrda v2 nosi `revision`, `clientTransactionId`, `evidenceDomainId` i `principalId`. `revision` je cijeli broj od 1 naviše; `clientTransactionId` je neprazan tekst od najviše 128 UTF-16 kodnih jedinica, bez kontrolnih znakova i usamljenih surogata; `evidenceDomainId` je kanonski UUID verzije 4 malim slovima (36 znakova), neproziran i nepromjenjiv identifikator domene evidencije (jedna ustanova u jednoj regiji), nikad izveden iz ID-a ili imena ustanove, regije ni vremena. **Značenje (odluka vlasnika 11. 10. 2026., točka 5; https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6105502093; prijedlog u PR-u 246):** `revision` i `clientTransactionId` znače „commit u kojem je ovaj odsječak prihvaćen”. Jedna potvrda imenuje jedan commit, ali nijedan provjeravatelj, tablica ni test ne smije pretpostaviti da jedna revizija ima točno jednu potvrdu, ni da je redni broj odsječka jednak reviziji; time kasnije slanje više odsječaka u jednom commitu ne mijenja potpisani format. Potvrda v2 tvrdi tri stvari: da su bajtovi odsječka s otiskom `segmentHash` primljeni i pohranjeni; da nastavljaju lanac iza prethodnika `predecessorSegmentHash`; i da je dokument s otiskom `finalDocumentHash` tog odsječka spremljen kao revizija `revision`. Treću tvrdnju jamči tek RPC koji u istoj transakciji radi CAS i `reserve` (§2); dok njega nema, v2 potvrdu ne izdaje nitko. **Autor i vrijeme prihvata (odluka od 11. 10. 2026.; https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6107934097, točka 2; DAN-54):** potvrda v2 nosi i `principalId`, autora kojeg je poslužitelj izveo iz sesije zahtjeva koji je poslao odsječak, nikad iz polja klijenta; oblik je kanonski UUID verzije 4 malim slovima, kao korisnički ID koji poslužitelj dodjeljuje. Uloga autora i oznaka izvanmrežnog rada namjerno nisu u potvrdi v2 (odluka vlasnika 11. 10. 2026.; https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6108404647, točka 2); na mjestu potpisa poslužitelj ih nema. `acceptedAt` je u potvrdi v2 početak UTC minute u kojoj je poslužitelj prihvatio odsječak, u obliku `YYYY-MM-DDTHH:mm:00.000Z` (oblik iz D-24); poslužitelj prije potpisa odbacuje sekunde i milisekunde, a čitatelj odbija svaki drugi oblik i nikad ga ne zaokružuje. Potvrda v1 zadržava puni trenutak. Provjeravatelj potvrdu umirovljenog, neopozvanog ključa prihvaća samo za `acceptedAt < validTo`, a početak i kraj valjanosti ključa uvijek su na cijeloj UTC minuti, u obliku `acceptedAt`, uz `validFrom < validTo`; zapis ključa koji to ne ispunjava nije ključ (`key_unknown`) i nikad se ne zaokružuje (odluka vlasnika 11. 10. 2026.; https://github.com/danielrisavi77-create/Ductus/issues/87#issuecomment-6108490197). `validFrom` je na cijeloj minuti jer je kraj jednog ključa početak sljedećeg; s `acceptedAt` se i dalje ne uspoređuje. Vrijeme opoziva ostaje točan trenutak, jer se ni s čim ne uspoređuje: opozvan ključ ne potvrđuje ništa. Ključ potvrde mora pripadati domeni iz potpisanog sadržaja i imati namjenu potvrde; očekivanu domenu i popis ključeva pozivatelj uzima iz izvora različitog od odgovora koji nosi potvrdu. Razloge `domain_mismatch` i `commit_mismatch` provjeravatelj daje tek za potvrdu čiji je potpis provjerio; svaki drugi razlog znači samo da potvrde nema i ništa u njemu nije autentificirano. `principalId` i `segmentHash` nisu dio očekivanja: uspoređuje ih pozivatelj. Javni ključ i `R` potpisa moraju biti točke podgrupe prostog reda u jedinom kanonskom zapisu, a `S` manji od reda grupe; provjeravatelj to utvrđuje sam, prije poziva Web Crypto, pa se takav ključ ili potpis odbija jednako u svakoj okolini. Sažetak i samu provjeru Ed25519 radi Web Crypto: gdje ga nema, gdje nema SHA-256 ili Ed25519, ili gdje njegov poziv ne uspije, ishod je `verification_unavailable`. To nije razlog odbijanja: znači da provjera nije obavljena i ne govori ništa o potvrdi, koja se dotad ne smatra provjerenom. Gornji vektor sadrži sva četiri polja i jednom izmjenom zamjenjuje prethodni v2 vektor bez njih (SHA-256/JCS `c829e34d42c491db3ab19132c9caa4574bfd86c752e9fa64c26470662e3566e6`); to je jedina izmjena v2 vektora prije prve stvarno potpisane potvrde. Prethodni vektor nije korišten za stvarnu potvrdu u ovom repozitoriju: do DAN-54 kod nije imao v2 potpisnika, a jedini repozitorij prihvata bio je u memoriji; inventar stvarnih trajnih izvora iz D-92 time nije zamijenjen. Prethodni oblik ostaje u zlatnim vektorima kao odbijen (`receiptV2.former`), a novi je ondje `receiptV2.accepted[0]` (`src/domain/forensics/golden-vectors/evidence-v2.json`); test `src/domain/forensics/evidence-receipt-v2.test.ts` drži zapis u ovom dokumentu i u toj datoteci jednakima. Izvedba formata i provjere: `src/domain/forensics/evidence-receipt.ts` i `evidence-receipt-verifier.ts`; gateway, RPC i tablice domena i ključeva dolaze zasebnim PR-ovima, a dotad gateway izdaje v1.
- **Odluka vlasnika 10. 10. 2026. (D-24, D-56):** odsječak ne nosi vrijeme po događaju finije od minute ni `elapsedMs`; ingest takav odsječak odbija. Zlatne vektore iz #174 (milisekunde, `elapsedMs`) ispravlja zaseban `critical` zadatak.
- **Potpisana potvrda predaje v1 (B-12, DAN-87; vlasnikova odluka P4 na #385: format predlaže pisac po uzoru na D-92, review i QA ga provjeravaju, vlasnik potvrđuje D-redak).** Potvrda kaže da je predaja zapisana nakon što se rekonstrukcija njezine revizije podudarila; ne tvrdi autorstvo ni izvornost (`docs/PRODUCT.md` §5 pravila 1 i 9). `receiptSchema` je `ductus-submission-receipt-v1`; `D = SHA-256(JCS(payload))`, a potpisuje se Ed25519 nad točno 61 bajtom `UTF-8("ductus-submission-receipt-v1") ‖ 0x0A ‖ D`. Drugi prefiks znači da potpis potvrde predaje nikad ne prolazi kao potpis potvrde v2 ni obrnuto. Zatvoren skup od 15 ključeva: `submissionId`, `assignmentId` (kanonski UUID malim slovima), `evidenceDomainId`, `principalId` (kanonski UUID v4, kao u potvrdi v2), `assignmentVersion` i `revision` (cijeli broj od 1), `documentId`, `evidencePackageId` (oblici iz tablica evidencije), `artifactSha256` (hash rekonstruiranog dokumenta), `evidenceHeadSegmentHash` (zadnji odsječak rekonstrukcije, onaj koji je stvorio reviziju), `evidenceRecord` (`continuous` ili `with_gaps`, oznaka praznine iz P1; poslužitelj još ne bilježi praznine, pa izdaje samo `continuous`), `requestedAt` i `dueAt` (vrijeme baze s mikrosekundama, oblik `YYYY-MM-DDTHH:mm:ss.ffffffZ`, da zahtjev mikrosekundu nakon roka nikad ne izgleda pravovremen) i `afterDeadline`, koji mora biti `requestedAt > dueAt` (P6), inače potvrda nije valjana. Ključ je ključ potvrda domene evidencije iz `evidenceDomainId` (D-102); potvrda se ne sprema, nego se iz zapisa predaje potpisuje pri svakom odgovoru, pa je uz isti ključ bajt-identična. Izvedba: `src/domain/forensics/submission-receipt.ts`. Kontrolni vektor (samo sintetički podaci, isti RFC 8032 testni seed kao gore): payload `{"afterDeadline":false,"artifactSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","assignmentId":"3b7e2f4a-9c1d-4e8b-a5f6-0d2c4b6a8e91","assignmentVersion":1,"documentId":"doc-1","dueAt":"2026-11-02T11:00:00.000000Z","evidenceDomainId":"d21fe0a3-103c-42e5-a29e-c102f9030af5","evidenceHeadSegmentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","evidencePackageId":"evidence-1","evidenceRecord":"continuous","principalId":"72cd1705-85fc-4754-a382-c2500d038368","receiptSchema":"ductus-submission-receipt-v1","requestedAt":"2026-11-02T10:58:00.123456Z","revision":7,"submissionId":"c4a1e9d2-7b3f-4a65-8e0c-1f2d3b4c5a69"}`; SHA-256/JCS predaje: `f24592900fb8c817c52186dda58e025139f0da331cb95f0bf7cb0f8456dddd61`; RAW ulaz predaje (61B): `6475637475732d7375626d697373696f6e2d726563656970742d76310af24592900fb8c817c52186dda58e025139f0da331cb95f0bf7cb0f8456dddd61`; potpis nad RAW 61B: `add389dc7589b3c9bc2183b5c539152b4887ff590ae4d59f3b17c74125bf8e36cca1daa68f7173a4273a89a789134971c6c25e49301514d24ed34ba585daaa08`.
- Negativni testovi: izmijenjen 1 bajt note/receipt → FAIL; potpis nad SHA-256 note-teksta umjesto izvornog UTF-8 note-teksta → FAIL; izostavljen završni LF, drugačiji prefiks, neispravan signer ID/key ID → FAIL; RAW note dulji od 4096B → fail-closed (bez poziva KMS-u); v1 `pending_signature` ne prelazi na v2 bez eksplicitne kompatibilne migracije.

### 4.2 Dnevni korijen i vanjsko vrijeme (val 2, s poštenom tvrdnjom)

**Dopuna 11. 10. 2026. (D-93, D-72, D-102; komentari 6105034219 i 6105084144):** dnevnik potvrda i njegove kontrolne točke odvajaju se po ustanovi i regiji, svaka domena evidencije ima vlastiti dnevnik; jedan zajednički dnevnik više nije cilj. Točka 1 niže opisuje jedan log i čeka usklađivanje s tom podjelom (zadatak u Linearu); do tada vrijedi ova dopuna. Ništa što se gradi danas ne pretpostavlja globalni brojač, redoslijed ni spremnik.

1. **Jedan kumulativni append-only log (D-93)**, ne zasebno stablo po danu. Za list se prvo izračunava digest prema `receiptSchema`: v1 je `D_v1 = SHA-256(JCS(receiptPayloadV1))`, v2 je `D_v2 = SHA-256(JCS(receiptPayloadV2))` (isti digest koji se potpisuje prema D-92); RFC 6962 zatim koristi `SHA-256(0x00 ‖ D_schema)` za list i `SHA-256(0x01 ‖ L ‖ R)` za unutarnji čvor. Verifikator odabire payload, digest i potpisni verifier prema `receiptSchema`; postojeći payloadi i potpisi ostaju bajt-po-bajt nepromijenjeni. Prije prvog log append-a aktivirati trajni cutover gate bez obzira na to je li inventar prazan. `reserve` i promjena gatea moraju dijeliti istu transakcijsku serijalizacijsku bravu: svaki prihvat koji dobije bravu prije gatea mora završiti prije inventarnog snapshot-a, a nakon zatvaranja gatea `reserve` vraća ponovljivu privremenu grešku i ne potvrđuje zapis. Gate ostaje zatvoren tijekom read-only inventara iz D-92, validacije cijelog postojećeg skupa po `receiptSchema`, izrade odvojene nepromjenjive `evidence.log_entry` mape za sve sheme te izračuna, potpisivanja, žigosanja i neovisne trajne pohrane prve cutover kontrolne točke; time nijedan prihvat ne može upasti između snapshot-a i početne točke. Tek nakon provjere da je početna točka neovisno pohranjena gate se otvara, a neuspjeh ili nepotpun/neispravan inventar ostavlja ga zatvorenim. Dodijeliti uzastopne 0-based indekse determinističkim redom kanonskog UTC `acceptedAt` uzlazno, zatim bajtovnim leksikografskim redoslijedom UTF-8 za jedinstveni nepromjenjivi `receiptId`. Uključiti i nepotpisane rezervacije; svaki `pending_signature` zadržava potpisni put specifičan za svoju shemu, uključujući v1 put iz D-92. Neispravan ili nepotpun zapis blokira cutover; nijedan se zapis ne smije preskočiti, prepisati ili tiho migrirati. Prva potpisana, RFC 3161 žigosana i izvan baze neovisno pohranjena cutover kontrolna točka obuhvaća sve mapirane zapise, a `tree_size` mora biti jednak njihovu broju; tek nakon nje nastavljaju se rezervacije, a novi zapisi dobivaju sljedeće indekse. Ako je inventar prazan, početna kontrolna točka ima `tree_size = 0` i RFC 6962 prazan korijen. Svaka nova potvrda nakon cutover-a dobiva **0-based indeks bez praznina** pri prihvatu (`reserve`) unutar serijalizirane transakcije. Ugovorni test B4 mora pod konkurentnim prihvatima, rollbackom i idempotentnim retryjem dokazati jedinstvene uzastopne indekse te da rollback ne potroši indeks i retry ne doda novi. Worker jednom dnevno objavljuje kontrolnu točku C2SP tlog-checkpoint (ishodište, veličina, korijen) i **consistency dokaz** prema prethodnoj kontrolnoj točki; dan bez novih zapisa objavljuje istu točku s novim žigom. Prije koda: pisana specifikacija (poredak, cutover, objava, provjera) i neovisni review (Linear DAN-55).
2. Kontrolnu točku potpisuje drugi KMS ključ: čisti Ed25519 (`ED25519_SHA_512`, `MessageType: RAW`) nad **točnim UTF-8 tekstom C2SP bilješke (bez potpisnih redaka)** kontrolne točke, uključujući završni `LF`, bez hashiranja/prefiksa iz D-92. C2SP omotnica čuva ime potpisnika, 4-bajtni key ID i 64-bajtni Ed25519 potpis u base64 liniji; isti exact bytes verificiraju se standardnim C2SP verifierom. KMS limit 4096 B se provjerava prije poziva; veći tekst se odbija, ne potpisuje se njegov digest. **Prije svakog potpisa signer mora pročitati povijest kontrolnih točaka ishodišta iz neovisne, append-only pohrane izvan domene povrata baze** (npr. neovisnih primatelja i njihovog trajno sačuvanog checkpoint feeda), checkpoint iz vraćene baze nije autoritativan. Prije poziva KMS-u provjeravaju se consistency dokazi novog checkpointa prema svim poznatim, izvana sačuvanim potpisanim checkpointima. `tree_size` mora biti barem jednak najvećoj izvana zabilježenoj veličini; manji se odbija. Pri jednakoj veličini korijen mora biti jednak, a postojeći potpisani checkpoint vraća se idempotentno bez novog potpisa. Veći checkpoint prihvaća se samo ako je konzistentan sa svakim ranijim poznatim potpisanim checkpointom. Time se provodi C2SP-ovo pravilo da se ne potpisuje checkpoint koji nije konzistentan s prethodno potpisanim checkpointom. Nedostupna vanjska povijest ili neslaganje zatvara put: ne potpisuje se, ne traži se TSA žig i ništa se ne objavljuje; indeksi se ne vraćaju na nulu niti se ponovno inicijaliziraju dok se baza ne uskladi s dokazanom vanjskom poviješću. B5 test povrata baze namjerno vraća staru kopiju i potvrđuje da regresivni ili razgranati checkpoint nije potpisan, žigosan ni objavljen. Uz kontrolnu točku traže se **dva RFC 3161 žiga od neovisnih besplatnih TSA-ova** (`http://timestamp.digicert.com` i `http://timestamp.sectigo.com`; HTTP je prihvatljiv jer je odgovor potpisan, ali provjeravaju se potpis i lanac). Nijedan nema objavljene uvjete korištenja, SLA ni ograničenja; traži se jedan žig dnevno po TSA-u, bez ponavljanja češće od jednom u minuti, uspjeh dana znači barem jedan valjan žig, a dan bez žiga je alarm. Pravnu osnovu ne daju, kako piše i u DPIA-i. FINA (kvalificirani pružatelj u Hrvatskoj) dolazi kad postoji poslovni subjekt (obrt), ili ako FPZG pristane biti ugovorna strana: 0,11 EUR po žigu, certifikat 86,27 EUR na 5 godina, endpoint `https://tsa.fina.hr/ts-rfc3161`.
3. Objava: javni repozitorij **i neovisni primatelji kontrolnih točaka** (dnevni e-mail koordinatoru FPZG-a; arhiviranje u Internet Archive ili Software Heritage). Javni repozitorij kontrolira isti operater (može force-pushati), pa sam po sebi nije svjedok.
4. **Što to dokazuje:** potvrda se smatra sidrenom tek kad se njezin inclusion dokaz provjeri prema prvoj uspješno potpisanoj, RFC 3161 žigosanoj i objavljenoj kontrolnoj točki za koju je `tree_size` veći od njezina 0-based indeksa. `tree_size` je broj listova, pa indeks `i` ulazi samo ako je `i < tree_size`. Žig dokazuje da su taj korijen i veličina stabla postojali najkasnije u trenutku žiga; ne dokazuje da je to jedina kontrolna točka tog ishodišta ni da log sadrži sve potvrde.
5. **Što ne dokazuje:** bez neovisnog primatelja ne štiti od split viewa (npr. dviju kontrolnih točaka istog ishodišta i veličine s različitim korijenima); ne štiti od krivotvorenja potvrde u prozoru do prve uspješno potpisane, žigosane i objavljene kontrolne točke koja sadrži njezin indeks (uobičajeno 24–48 sati, dulje ako TSA ne radi), ni od neistinitosti sadržaja ili autorstva. Taj tekst ide u sučelje i DPIA.
6. Paket dokaza za predaju izdaje se kao "sidren" tek kad se inclusion dokaz potvrdi prema prvoj uspješno potpisanoj, žigosanoj i objavljenoj kontrolnoj točki čiji je `tree_size` veći od 0-based indeksa potvrde; do tada nosi oznaku "još nije sidren".
7. Za radove s dugim rokom čuvanja uz `.tsr` spremaju se lanac certifikata TSA i stanje opoziva u trenutku žiga, uz plan ponovnog žigosanja prije isteka certifikata.
8. Veličina loga u potpisanoj kontrolnoj točki mora biti točna i ne može se zaokružiti; `tree_size` i javni broj odgovaraju samo stvarnim indeksiranim potvrdama. Za pilot se prihvaća javna objava točnog ukupnog broja potvrda i zapisuje u DPIA (D-93). Popunjavajući listovi dodaju se samo ako ustanova to zatraži (D-93, odluka vlasnika potvrđena 10. 10. 2026.); dok takvog zahtjeva nema, log ih ne sadrži. Prije provedbe takvog zahtjeva zasebnim se PR-om mora definirati domenski model popunjavajućeg lista (vrsta lista, kako se razlikuje od stvarne potvrde i kako ulazi u `tree_size`) i izmijeniti ovaj ugovor; do tada `tree_size` odgovara samo stvarnim potvrdama.
9. Verifikator: CLI i web stranica koja radi u pregledniku (web stranica se smije odgoditi prema rezu iz `PROGRAM.md`, CLI ostaje; lanac, inclusion i consistency dokaz, potpis, `.tsr`, javni ključ) uz ručnu provjeru `openssl`-om.

### 4.3 Prijava, sesije i identitet u bazi

- Next.js ruta pokreće OIDC Authorization Code s PKCE-om prema `login.aaiedu.hr` (OIDC potvrđen na službenoj Srce wiki stranici, discovery `/.well-known/openid-configuration`, registar resursa, Lab `fed-lab.aaiedu.hr`).
- **Tko smije registrirati klijenta (potvrđeno na aaiedu.hr):** "Registrirani davatelj usluge u sustavu AAI@EduHr može biti partner sustava ili pak matična ustanova koja je ujedno i davatelj elektroničkih identiteta." Lab smiju koristiti "sve osobe koje ovlašteni predstavnik davatelja usluge (matične ustanove ili partnera AAI@EduHr) za to ovlasti" e-poštom na `aai@srce.hr`. **Daniel kao fizička osoba ne može sam registrirati Ductus ni dobiti Lab.** Put za pilot: FPZG (matična ustanova) registrira Ductus kao svoju uslugu u Registru resursa, a odgovorna osoba FPZG-a e-poštom ovlašćuje Daniela za Lab (do 5 testnih identiteta na `aai-test.hr`). Partnerstvo (vlastiti obrt ili tvrtka) je put za drugu ustanovu; uvjeti nisu provjereni (stranica blokira dohvat).
- **Obvezno (izlazni kriterij M1):** `state` i `nonce`; provjera `iss`, `aud`, `azp`, `exp`, `iat`, prikvačen algoritam, keširanje i rotacija JWKS-a, dopušten pomak sata. AAI vraća atribute s userinfo endpointa, pa `sub` iz userinfo odgovora mora biti jednak `sub` iz ID tokena (OIDC Core 5.3.2). Novi ID sesije pri prijavi (session fixation), kolačić `__Host-...; HttpOnly; Secure; SameSite=Lax`, zaštita `returnTo` od otvorenog preusmjeravanja, na mijenjajućim rutama obavezan `Origin` (bez zaglavlja odbij) i `Sec-Fetch-Site`.
- **Odjava:** RP-initiated logout prema `end_session_endpoint` AAI-ja i back-channel logout koji zatvara sesije u bazi. Bez toga na zajedničkom računalu sljedeća osoba klikne "Prijava" i ulazi kao prethodni student.
- Istek sesije tijekom pisanja nije odjava: journal se ne briše, ponovna prijava istog korisnika nastavlja. Dexie je po originu, pa "vezan uz korisnika" znači logičku oznaku; kad se prijavi drugi korisnik na istom pregledniku, journal prethodnog ostaje pod njegovom oznakom, nedostupan novom korisniku, i nastavlja se pri njegovoj ponovnoj prijavi (D-118).
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
- Obavijest nastavniku o novoj reviziji nastaje **najviše jednom po P-03 prozoru** (D-39 potvrđena; odnos s D-06 otvoren u Owner queue, do odluke vrijedi D-06), pa polling od 30 do 60 s ne pretvara pogled u uživo (D-06). Test.
- AI proxy (izvan pilota, D-77; vrijedi nakon pilota) je obična Next.js ruta koja provodi popis dopuštenih pružatelja po fakultetu i zadatku, uz `provider.only`, isključene fallbackove i `data_collection: deny` u zahtjevu prema OpenRouteru, te ograničenje troška po studentu. Studentov ključ šifrira se aplikacijski: AES-256-GCM, KEK iz okoline, **AAD = `user_id` + namjena + verzija ključa**. Ne `pgsodium` (u najavi ukidanja).
- Uvoz DOCX i PDF: parsira se **u pregledniku ili u izoliranom poslu** s ograničenjem veličine i vremena (zip bombe, XXE), nikad u web procesu.

### 4.6 Rekonstrukcija i predaja

- Isti kod kao klijent (ProseMirror u Nodeu) u workeru, u kontejneru s ograničenim CPU-om da ne guši ingest. B0.2 mjeri 15.000 riječi (pilot) i 80.000 (doktorski, izvan pilota, `PROGRAM.md`).
- **Vrijeme predaje je `requested_at` iz sata baze u trenutku klika**, prije reda rekonstrukcija. Potvrda nosi to vrijeme. Nepodudarnost nakon roka ide u zamjenski postupak s očuvanim `requested_at`. Jedan izvor vremena za sve pravno relevantne trenutke: sat baze; prikaz u Europe/Zagreb. Load test (B9): 100 % predaja u 15 minuta prije roka.
- Kontrolne točke s punim tekstom: B0.2 (`docs/spikes/B0.2.md`) pokazao je da svakih 200 koraka volumen raste kvadratno; PRIJEDLOG je oko 2.000 koraka, odluka uz B0.3.

### 4.7 Kopije, povrat, čuvanje

- **Baza:** PITR 3 dana na UpCloud Developer (RPO procjenjuje B0.1, ne pretpostavlja se 5 minuta), plus dnevni šifrirani logički `pg_dump` (`age`) u spremnik drugog dobavljača.
- **Bucket (po domeni evidencije, D-102):** spremnik pohrane nije jedan zajednički; opis kopija ispod nije još usklađen s podjelom po domeni. `pg_dump` ne sadrži odsječke. Dnevna replikacija bucketa (`rclone sync` bez brisanja, šifrirano) u drugi račun (Hetzner Object Storage ili sl.). Bez toga gubitak ili blokada Scaleway računa znači da potvrde postoje, a sadržaj koji dokazuju ne postoji (uvjet zaustavljanja pilota).
- **Backup postoji tek kad je restore dokazan:** mjesečna proba povrata baze **i** bucketa u privremeno okruženje, pa `ductus verify` nad uzorkom radova, zapis rezultata.
- **Rezervni put na drugom računu** (Scaleway Instance ili Hetzner) u istom OpenTofu kodu; RTO se mjeri u probi i uključuje DNS, novu adresu, tajne i povrat ključeva (KMS ključevi ostaju na AWS-u). Cilj RTO 4 sata je cilj, ne tvrdnja.
- **Brisanje po roku i kopije.** Versioning bucketa i backupi znače da `DeleteObject` ne briše: retention briše i verzije (`DeleteObjectVersion`) ili životni ciklus nesadašnjih verzija s kratkim rokom. Za svaku vrstu kopije (PITR, dump, replika, snimke) zapisan je rok čuvanja; brisanje po roku postaje potpuno tek kad istekne najdulji. Hashevi čvorova Merkle stabla ne brišu se (ne sadrže sadržaj).
- Prozor održavanja upravljane baze zakazuje se izvan rokova predaje (D-69) i upisuje u `OPERATIONS.md`.

### 4.8 Migracije i sheme

**Odlučeno (D-91, 8. 10. 2026.): dbmate**, uz zaštitne mjere jer alat bilježi samo broj verzije i ne dokumentira zaključavanje:

1. `db/migrations.sum` sa SHA-256 svake migracije; CI pada ako se postojeća migracija izmijeni ili obriše (samo dodavanje).
2. Svako pokretanje migracija u CI-ju i deployu koristi `dbmate up --strict` ili `dbmate migrate --strict`, čime odbija migracije izvan redoslijeda.
3. Deploy drži `pg_advisory_lock` na zasebnoj vezi dok dbmate radi.
4. Reproducibilnost: CI na svježoj bazi pokreće `dbmate --no-dump-schema up --strict`, zatim dumpa u privremenu datoteku s `dbmate --schema-file "$tmp/schema.sql" dump` i uspoređuje dump s commitanim `db/schema.sql` iz Git HEAD-a. Tako migracija ne može prepisati očekivanu shemu prije usporedbe; `pg_dump` je iste glavne verzije kao server.
5. Zanošenje stvarnih okruženja: pgTAP matrica (vlasnici, ovlasti, RLS, politike, `SECURITY DEFINER` s praznim `search_path`) nad stagingom i produkcijom te normalizirani `pg_dump --schema-only` između njih.
6. Uloge u zasebnoj idempotentnoj bootstrap skripti (djeluju na razini klastera; na upravljanoj bazi provjerava ih B0.1); ovlasti i vlasništvo funkcija u migracijama, s pgTAP provjerom; aplikacijske uloge nemaju pristup `schema_migrations`.
7. Produkcija samo naprijed: deploy poziva isključivo `dbmate up --strict` kao `ductus_migrator` s VM-a; `rollback` postoji samo lokalno. `pg-boss` radi s `migrate: false`, a njegova točna verzija pinana je u `package.json` i lockfileu. CI contract test zahtijeva da instalirana verzija bude jednaka točnom pinu u `package.json` i lockfileu; uspoređuje početnu dbmate migraciju s `getConstructionPlans`; za svaku nadogradnju gradi **lanac podržanih skokova**: za svaki skok koristi odgovarajući točno pinani (uključujući povijesni) `pg-boss` artefakt i njegov `getMigrationPlans` samo za raspon schema verzija koji ta verzija podržava, pa uređenu konkatenaciju svih generiranih SQL skokova uspoređuje s uređenom konkatenacijom pripadnih dbmate migracija. Povijesni artefakti i njihovi lockfile/integrity pinovi su **obvezni** za sve podržane skokove čiji SQL nije u trenutačnom paketu. **Nepodržani major prijelaz**, uključujući `pg-boss` v10→v11 za koji upstream ne daje automatsku migraciju, **ne smije se izmišljati kao `getMigrationPlans` skok**: zahtijeva zaseban verzijski pinan i vlasnički odobren data-preserving runbook (inventar čekajućih/zakazanih/retry poslova, pauza workera, drain ili provjerljivo preseljenje poslova, schema cutover, idempotentnost, rollback/recovery i usporedba sadržaja prije/poslije), izoliran QA/staging dokaz i eksplicitni release gate. Bez tog dokaza deploy i CI padaju zatvoreno. SQL jednakost s generiranim planom primjenjuje se samo na podržane segmente; nepodržana granica mora proći odvojene ugovorne testove bez gubitka poslova. Nije dopušten jedan `getMigrationPlans` za raspon koji paket ne podržava. Odvojeni CI testovi pokrivaju svježu bazu, najmanje dvije uzastopne nadogradnje i odbijanje nepodudarnih SQL planova. Nadogradnja `pg-boss` prolazi istim putem.

   **Raspored plana na dbmate datoteke (dio točke 7).** `getMigrationPlans` u `pg-boss` 12.x ne vraća samo jednu transakciju. Kad raspon sadrži korake s asinkronim indeksima, iza transakcijskog bloka (nakon njegova `COMMIT`) dodaje naredbe `CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS …` i `DROP INDEX CONCURRENTLY IF EXISTS …`, svaku s komentarom podrijetla; provjereno na 12.37.1 (`dist/migrationStore.js`, `migrateCommands` vraća `sql` i `concurrent`; indeksi `job_i5` i `job_i7` do `job_i13`). `job_iN` su imena predložaka u izvoru paketa: plan uz `partitionTables: []` stvara indekse `job_common_iN` na `pgboss.job_common` (s particijama i po jedan po particiji), pa se u planu i u `pg_indexes` traže pod tim imenom; u nastavku se navode imena predložaka. `DROP` dolazi u uređenim parovima s `CREATE`: korak v33 prvo briše `job_i5`, a zatim ga gradi s novom definicijom, a korak v40 prvo gradi `job_i11`, a zatim briše `job_i5`. PostgreSQL odbija `CREATE INDEX CONCURRENTLY` i `DROP INDEX CONCURRENTLY` unutar transakcije i u višenaredbenom nizu, pa se takav plan ne može primijeniti ni kao transakcijska dbmate migracija ni kao jedna `transaction:false` migracija s više naredbi. Zato se usporedba iz točke 7 radi nad planom raspoređenim po ovim pravilima:

   - transakcijski dio skoka ide u jednu transakcijsku dbmate migraciju;
   - svaka naredba iza `COMMIT`-a ide u **zasebnu** dbmate migraciju s `transaction:false` i točno jednom naredbom, redom kojim ih plan navodi i odmah iza transakcijske migracije istog skoka;
   - contract test na isti način dijeli generirani plan i uspoređuje dio po dio: transakcijski dio s transakcijskom migracijom, svaku `CONCURRENTLY` naredbu s njezinom migracijom. Broj i redoslijed moraju se podudarati; izostavljena, dodana ili spojena naredba ruši test, kao i `CONCURRENTLY` naredba unutar transakcijske migracije;
   - `CONCURRENTLY` naredba, bilo `CREATE` bilo `DROP`, ne smije se izbaciti ni zamijeniti običnim `CREATE INDEX` ili `DROP INDEX` da bi migracija prošla. Uz `migrate: false` te indekse nitko naknadno ne gradi ni ne briše, a shema bi nosila novu verziju bez njih. Izostavljen `DROP` iz para ne ruši sljedeću naredbu: `CREATE INDEX … IF NOT EXISTS job_common_i5` (predložak `job_i5`) tada tiho zadrži indeks stare definicije;
   - broj naredbi ovisi o `partitionTables`: bez tih metapodataka plan gradi indekse samo na `job_common`, a s njima i na svakoj particiji. Ugovor zato pokriva samo bazu bez particioniranih redova: test dokazuje da ih nema i pada zatvoreno ako ih nađe. Particionirani redovi traže zasebnu odluku i proširenje ovog ugovora;
   - zaseban CI test pokriva skok preko verzije sheme s asinkronim indeksom: na svježoj bazi nakon svih migracija postoje svi indeksi koje plan na kraju ostavlja i valjani su (`pg_index.indisvalid`), a prekinuta izgradnja koja ostavi nevaljan indeks ruši provjeru. Sama valjanost ne otkriva preskočen `DROP`, pa test uspoređuje i skup indeksa i definiciju svakoga (`pg_get_indexdef`) s bazom koju gradi `getConstructionPlans` iste pinane verzije: indeks koji plan briše ne smije postojati, a indeks koji plan briše pa ponovno gradi mora imati novu definiciju. Test uključuje skok preko koraka s parom `DROP`/`CREATE`.

Expand/migrate/contract i pgTAP u CI-ju bez `supabase start` vrijede i dalje.

**Provjera podataka prije migracije `20261018130000_institution_plain_label_marks.sql` (#377, #446).** Migracija pooštrava `institution.is_plain_label` i staje ako neki spremljeni naziv kolegija, ustanove ili zadatka više ne prolazi. Prije deploya koji je primjenjuje pokreni nad tom bazom, s prijavom kojom radi dbmate:

```powershell
$env:DATABASE_URL = '<prijava dbmatea, lokalno postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus>'
node src/server/db/plain-label-check.ts
```

Provjera čita pravilo i popis stupaca iz same migracije, pa radi isto i prije i nakon što je migracija primijenjena. Radi u transakciji `READ ONLY` kao `ductus_identity`, uloga pod kojom u migraciji radi zaštita, i ispisuje samo tablicu, stupac i primarni ključ svakog retka koji bi zaustavio migraciju, nikad sam naziv. Izlaz 0: takvih redaka nema; 1: redci su ispisani i deploy čeka vlasnikovu odluku o njima; 2: provjera nije mogla raditi. Nad produkcijom je pokreće operater, ne agent.

### 4.9 Opservabilnost i curenje sadržaja

- Parametri baze: `log_statement=none` i da greška ne ispisuje naredbu s parametrima (provjeriti u B0.1 smije li se mijenjati; inače pozivati funkcije tako da tekst ne ide kroz parametre loga). Caddy access log bez query stringova; Next.js neuhvaćene greške bez tijela zahtjeva.
- GlitchTip EU ili Sentry s `sendDefaultPii=false` i `beforeSend` koji odbacuje tijela. Canary test radi **u CI-ju i na stagingu nad logovima aplikacije, Caddyja i baze**.
- Pet alarma u `OPERATIONS.md` (e-pošta i push): backlog `pending_signature`, neuspjeli dnevni korijen ili žig, neuspjeli backup ili replikacija bucketa, disk i istek TLS-a i broj veza na bazi, vanjski uptime monitor. SLO-ovi: "potvrda potpisana unutar N minuta", "korijen žigosan do 02:00".

### 4.10 Trenutno stanje rada (B-11)

**Odluka vlasnika 17. 10. 2026. (issue #87, komentar 6235841029):** nastavnik i mentor trenutno spremljeno stanje rada (`docs/PRODUCT.md` §5 pravilo 7, D-06, P-03) čitaju iz **kontrolnih točaka teksta vezanih hashom** (`document_checkpoint`, `ARCHITECTURE.md` §3 i §5), i to već u demou. Replay u web procesu ne koristi se za ovaj prikaz, ni kao odstupanje za demo. Ovaj odjeljak je ugovor za kod B-11 i za dijelove B-8 i F-8 koji nose snimku; gdje se `ARCHITECTURE.md` §3, §5 i §5a razlikuju u pojedinostima, vrijedi ovaj odjeljak.

1. **Što je snimka.** Snimka je kanonski dokument jedne revizije: točni UTF-8 bajtovi njegova JCS oblika, isti oni nad kojima se računa hash dokumenta v2 (§4.1). Poslužitelj snimku ne izvodi iz koraka: prima je od klijenta i čuva je samo ako je SHA-256 primljenih bajtova jednak `content_hash` te revizije u `document_revision`, a time i `finalDocumentHash` odsječka koji ju je stvorio. Tu jednakost provjerava baza pri svakom upisu (okidač nad `sha256()` primljenih bajtova), ne samo gateway, i drugog puta upisa nema. Snimka tako pripada lancu evidencije jednako čvrsto kao hash revizije. Ona ne tvrdi da je koraci odsječaka stvarno proizvode: to utvrđuje samo rekonstrukcija pri predaji (B-12, D-11). Usporedba rekonstrukcije sa snimkom nije dio demoa; uvodi se zasebnom izmjenom ovog ugovora. B-11 zato snimku nikad ne prikazuje kao provjerenu rekonstrukciju. Snimka je u bazi, ne u spremniku domene evidencije (D-102): nije odsječak ni potvrda.
2. **Ruta `ingest` i drain klijenta, od prvog dana.** Zahtjev rute `ingest` uz bajtove odsječka nosi **obavezno** polje sa snimkom dokumenta nakon zadnjeg događaja odsječka. Format odsječka v2, njegov hash i potvrda se ne mijenjaju; snimka nije dio nijednog od njih. Polje je obavezno od prve verzije rute; zahtjev bez njega je `invalid`. Gateway prije pohrane odsječka snimku dekodira strogo kao UTF-8 (nevaljan niz ili BOM je `invalid`), provjerava da je valjan dokument sheme editora (`validateDocument`), da je ponovni JCS bajt-identičan primljenom i da je SHA-256 jednak `finalDocumentHash` odsječka. Svako odstupanje odbija cijeli commit: ne pohranjuje se ni odsječak ni snimka, a klijent ponavlja. Snimka se upisuje u istoj transakciji baze kao `commit_evidence_segment` (CAS i `reserve`, §4.1), pa nastaju obje ili nijedna; ako adapter to ne može jamčiti dvama pozivima u istoj transakciji, snimka postaje parametar istog RPC-a. Ponovno slanje (`duplicate`) s bajt-identičnom snimkom je idempotentno; drukčija snimka za istu reviziju je `invalid`, a izvorna ostaje. Drain na klijentu za svaki zatvoreni odsječak čuva snimku u journalu dok odsječak ne dobije potvrdu i šalje je s njim; i nakon rada bez mreže svaki odsječak u redu nosi vlastitu snimku. Poznata cijena: uz 15.000 riječi oko 130 KB po commitu (`docs/spikes/B0.2.md`). **Granica veličine snimke (odluka vlasnika 19. 10. 2026., issue #87, komentar 6256655038):** 2 MiB (2 097 152 bajta), ista kao D-96 i prikaz uživo (§4.12), jedna konstanta na klijentu i poslužitelju zajedno (§4.13 t. 2); zamjenjuje 1 MiB iz ADR-a `2026-10-11-ugovor-spremanja-i-zapisa` §5.2.
3. **Revizija 0.** Revizija 0 je početni dokument rada: dokument koji editor stvara za novi rad, u kanonskom obliku sheme F1. Njegovi točni bajtovi i hash fiksiraju se known-answer testom u PR-u koji uvodi tablicu snimki (ovdje se vrijednost ne izmišlja). Snimka revizije 0 nastaje u istoj transakciji kao redak dokumenta. Rekonstrukcija pri predaji (B-12) u demou kreće od known-answer bajtova revizije 0, istog dokumenta koji fiksira taj test, i ne čita tablicu snimki („od prvog događaja”, D-98 dopuna (b)). Svaka promjena toga je izmjena D-98 dopune (b) i pitanje za vlasnika. Predložak zadatka i uvoz datoteke (`ARCHITECTURE.md` §5c) nisu revizija 0; uvode se zasebnom izmjenom ovog ugovora.
4. **Kraj sesije (`ARCHITECTURE.md` §3, D-39).** `ARCHITECTURE.md` §3 predviđa oznaku „kraj sesije” na reviziji. Tablica `document_revision` je samo za dodavanje, pa se oznaka upisuje pri umetanju, nikad naknadnim `UPDATE`-om: nova revizija nosi oznaku početka sesije kad je od prethodne prošlo više od P-01. Prethodna revizija je tada kraj sesije, a najnovija revizija postaje kraj sesije kad od nje prođe više od P-01. Pravilo mora biti isto kao granica sesije u sažetku procesa (B-13: P-01 nad minutama odsječka, ne nad `accepted_at`), uz test jednakosti; ako RPC te minute nema, gateway ih predaje u descriptoru. Oznaka koristi vrijednost P-01 u trenutku umetanja i kasnije se ne preračunava. Test jednakosti zato vrijedi uz nepromijenjen P-01; ako ustanova promijeni P-01, B-13 čita zamrznute oznake umjesto da granice računa iznova, ili se razlika prikazuje kao poznato ograničenje uz istu vrstu dokaza (D-44). Ako vlasnik umjesto D-06 odabere D-39 (otvoreno u Owner queueu), čitanje bira drugu reviziju (zadnji kraj sesije), a shema ostaje ista.
5. **Tablica snimki (`document_checkpoint`; fizički naziv i shema u PR-u koji je uvodi).**
   - Stupci: ključ ustanove, dokument, revizija, bajtovi snimke kao tekst (ne `jsonb`, koji mijenja bajtove), SHA-256 i vrijeme baze. Složeni strani ključ (dokument, ustanova, revizija) prema `document_revision` sprječava miješanje ustanova i snimku revizije koja ne postoji (D-103).
   - `ENABLE` i `FORCE ROW LEVEL SECURITY`, vlasnik je uloga bez prijave, a `ductus_app` nema izravan DML ni politiku čitanja: čita se samo kroz RPC iz točke 6. pgTAP matrica pokriva studenta vlasnika, drugog studenta istog kolegija, nastavnika zadatka, nastavnika drugog kolegija iste ustanove, persone druge ustanove te uloge `ductus_worker` i `ductus_retention`.
   - Redak se ne mijenja. Briše ga samo prorjeđivanje, u istoj transakciji kao upis nove snimke, i funkcija retentiona. Čuvaju se samo snimke ovih revizija: revizija 0; najnovija revizija; najnovija revizija prihvaćena prije početka trenutnog P-03 prozora; svaki kraj sesije (točka 4); revizija na kraju zabilježene praznine (`ARCHITECTURE.md` §5 i §6 t. 3). Ostale se brišu pri sljedećem upisu, pa snimke unutar sesije postoje samo prolazno i nikad se ne prikazuju (pravilo 7). Razmak od oko 2.000 koraka iz `ARCHITECTURE.md` §5 ostaje PRIJEDLOG (B0.3) i nije dio ovog ugovora.
   - Tablica nije dio jamstva sheme `evidence` (samo dodavanje), jer se prorjeđuje; njezino uvođenje ne smije oslabiti okidače koji to jamstvo provode.
   - Rok čuvanja: klasa „Radne verzije” (`ARCHITECTURE.md` §3, C-21; prijedlog roka „do kraja akademske godine zadatka”, potvrđuje FPZG, D-30). Snimke su prvi tekst radova u bazi: `pg_dump` i PITR odsad sadrže tekst radova, pa napomena iz §4.7 da `pg_dump` ne sadrži odsječke više ne znači da kopije baze nemaju sadržaja. Brisanje po roku potpuno je tek kad istekne najdulji rok kopija (§4.7). Snimka nikad ne ide u log; canary iz §4.9 pokriva i tekst snimke.
6. **Čitanje: jedan RPC, ista funkcija za sve koji smiju čitati.**
   - `SECURITY DEFINER`, prazan `search_path`, identitet i ustanova iz `current_actor()`, nikad iz parametra; jedini parametar je dokument.
   - Smiju čitati: nastavnik zadatka kojem rad pripada (aktivno članstvo s ulogom `teacher` u kolegiju zadatka); mentor rada kad postoji `mentorship` (u demou ne postoji); student vlasnik, koji dobiva bajt-identičan odgovor (pravilo 5, D-80 t. 6). Ishod ne ovisi o tome tko pita. Svi ostali, uključujući drugu ustanovu, dobivaju isti odgovor kao za nepostojeći dokument.
   - **D-37:** za zadatak kraći od P-04 stanje se ne daje prije predaje (zaseban ishod, ne `unavailable`). **Otvoreno (vlasnik):** P-04 („rok kraći od 24 sata”) je PRIJEDLOG u Owner queueu (`STATE.md`), zajedno s načinom na koji se trajanje zadatka mjeri. Vrijednost je konfiguracija ustanove (pravilo 12), ne konstanta u kodu.
   - **P-03:** prozori su poravnati na sat baze; početak trenutnog prozora je `now()` baze zaokružen naniže na višekratnik P-03 (UTC). Trenutak prihvaćanja revizije je `document_revision.created_at`: `commit_evidence_segment` u njega i u `segment.accepted_at` iste transakcije upisuje isti `clock_timestamp()`, a revizija 0 ima `now()` transakcije koja ju je stvorila. `acceptedAt` iz potvrde je zaokružen na minutu i nije izvor ovog vremena. Odgovor je snimka revizije r, najnovije revizije prihvaćene prije početka trenutnog prozora, i nikad novije, bez obzira na broj poziva, kartica, uređaja ili predmemoriju (#177, napadi 13 i 27). Polling klijenta (D-74, 30 do 60 s) ne određuje svježinu. P-03 je postavka ustanove sa zadanom vrijednošću 5 minuta. Poznata granica: transakcija koja počne prije granice prozora, a postane vidljiva nakon nje, nosi `created_at` prije granice. Odgovor se tada za isti prozor može jednom pomaknuti na tu reviziju; i ona je prihvaćena prije početka prozora, pa se ne otkriva ništa novije od P-03. PR koji uvodi RPC to pokriva testom. Ako ustanova promijeni P-03, snimka koju zahtijeva novi prozor možda je već prorijeđena; do sljedećeg upisa ishod je `unavailable`, što je prihvaćeno.
   - **Izlaz, zatvoren oblik:** kanonski dokument revizije r (JCS tekst), njegov SHA-256 kao oznaka verzije, početak trenutnog prozora i P-03 prozor u kojem je revizija r prihvaćena (zadnja promjena iz D-80 t. 2, kvantizirana na isti prozor; #177 napad 14). Izlaz nema broj revizije, broj odsječaka ili commitova, točno vrijeme, autora pojedinih promjena ni ijedno međustanje. Prikaz teksta radi klijent (D-74, bez renderiranja sadržaja na poslužitelju).
   - **Neuspjeh:** ako snimke revizije r nema, ili se SHA-256 ponovno izračunat pri čitanju ne slaže s `content_hash`, ishod je `unavailable` („stanje nije dostupno”). Nikad djelomičan tekst, nikad starija ni novija revizija umjesto r, nikad tvrdnja o uzroku. Nepodudarnost hasha bilježi se kao incident bez sadržaja.
7. **Brojke uz tekst u nastavničkom prikazu.** Vlasnik je uz odluku tražio da nastavnik vidi i brojke koje se već broje („lijepljenje, pisanje”). Ovaj ugovor ne uvodi nijednu novu brojku.
   - Već postoje u sažetku procesa B-13 (`projectProcessSummary`, `src/domain/projection/process-summary.ts`): sesije po P-01 (broj i rasponi na minutu); lijepljenja iznad P-02 kao zasebne stavke s veličinom u znakovima i oznakom da izvor nije opažen; broj manjih lijepljenja; praznine i stanje zapisa. Svaka stavka nosi vrstu dokaza (D-44).
   - `docs/PRODUCT.md` §7 navodi i stavke koje prvi korak B-13 još nema: razdoblje rada, aktivno vrijeme uređivanja (zbroj trajanja sesija, uz stalni tekst da nije mjera truda), verzije, uvoze i izmjene nastavnika. Brz put iz D-80 t. 2 dodaje zadnju promjenu, otvorene zahtjeve za doradu i stanje izjave. To su sljedeći koraci B-13 i B-11, ne nove metrike. „Pisanje” u tom smislu znači sesije i aktivno vrijeme uređivanja.
   - Sažetak procesa nema rez P-03: vlasnik je 19. 10. 2026. odlučio da se nakon D-142 (živi prikaz) rez ukida (#87 6256655038, točka 3). Sažetak se računa nad svim prihvaćenim odsječcima jedinog paketa dokumenta, zaključno s glavom paketa, pa i nad onima prihvaćenima u tekućem prozoru; mjera iz #177 napada 14 za sažetak više ne vrijedi. Popis koji ne završava na glavi paketa ne daje sažetak. Student i nastavnik dobivaju isti izlaz iste funkcije (pravilo 5).
   - Iznimka za predan rad (DAN-289 A2, ugovor #756; vlasnik #87 6397418697): kad za dokument postoji upisana predaja, sažetak završava na predanoj reviziji, ne na glavi paketa. Glava sažetka je zadnji odsječak čija potvrda nosi predanu reviziju (brojem), kao u `app.read_submission_record`, a popis su svi odsječci paketa do njega redom lanca. Ako nijedna potvrda ne nosi predanu reviziju, ishod je `unavailable`, nikad glava paketa. Sam zahtjev za predaju i odbijena predaja (`artifact_mismatch`) ne režu sažetak.
   - Sesija koja nije otvorena (istekla, zatvorena ili nepoznata) prije svega daje `ZD401` u `app.read_process_summary_source`, a ruta `POST /api/process-summary` vraća 401 `unauthorized`, kao bez kolačića, čitanje komentara i živi prikaz (DAN-85, nalaz 1 na #458). Svako drugo odbijanje ostaje isti 404 `not_found`: tuđi rad, druga ustanova, nepostojeći dokument i ID koji ne može postojati. ID koji ne može postojati odbija se prije baze, pa i uz isteklu sesiju daje 404.
   - Prikaz ostaje opisni (D-105): bez postotka, udjela, zbroja lijepljenja, poretka po veličini, boje i ocjene (`docs/PRODUCT.md` §5 pravila 2 i 3, §7 „Zabranjeno u sažetku”).
   - Brzina tipkanja, pauze i ritam nisu dio ovog prikaza. Bilježenje ritma postoji samo kao D-56: samo u mentorskim radovima, vrijeme promjena u koracima od 100 ms isključivo za reprodukciju, bez ikakve mjere, i tek nakon pravnog mišljenja i izmjene Ustava C-14 i C-19. To je izvan opsega B-11 i demoa.

### 4.11 Komentari uz odlomak (B-10, DAN-86)

Ugovor prije koda (issue #177; vlasnikova odluka na #87, `issuecomment-6236582503`). Komentar je **zaseban zapis sa sidrom** koji klijent prikazuje kao dekoraciju. Nikad nije oznaka u dokumentu, nikad ne mijenja dokument, reviziju, segment, potvrdu ni hash; dokument ima jednog pisača (D-34). Napadi 1 do 12 iz #177 su kriterij prihvata.

**Shema i vlasništvo.** Nova shema `collaboration` (vlasnik `ductus_migrator`); tablice i RPC-ovi su u vlasništvu `ductus_identity` (on već posjeduje `app.current_actor()` i `institution.actor_assignment_role()`). Komentar nije evidencija: `ductus_identity` ne dobiva nikakvo pravo na shemi `evidence` (provjera iz `040` ostaje). Vezu dokumenta čita jedna uska funkcija `collaboration.document_scope(p_document_id text) RETURNS (institution_id uuid, assignment_id uuid, principal_id uuid)` u vlasništvu `ductus_evidence`, `SECURITY DEFINER`, prazan `search_path`, `EXECUTE` samo za `ductus_identity`; `ductus_app` je ne izvršava. `ductus_evidence` dobiva `USAGE` i `CREATE` na shemi `collaboration` samo dok migracija stvara tu funkciju i gubi ih na kraju migracije. Nema stranog ključa prema `evidence.document`: brisanje dokumenta po pravilu čuvanja ne smije ovisiti o komentarima; postojanje se provjerava pri upisu.

**Tablica `collaboration.comment_thread`** (jedna nit, jedno sidro).

| Stupac | Tip i ograničenje |
| --- | --- |
| `id` | `uuid`, PK, generira baza |
| `institution_id`, `assignment_id`, `owner_id` | `uuid NOT NULL`, iz `document_scope` pri stvaranju, nikad iz parametra |
| `document_id` | `text NOT NULL` |
| `anchor` | `jsonb NOT NULL`, oblik `TextAnchor` iz `src/domain/collaboration/anchor.ts` (`CHECK`) |
| `state` | `text NOT NULL CHECK IN ('open','answered','resolved')` |
| `created_by` | `uuid NOT NULL`, iz `app.current_actor()` |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

**Tablica `collaboration.comment`** (komentari niti redom).

| Stupac | Tip i ograničenje |
| --- | --- |
| `id` | `uuid`, PK, generira baza |
| `thread_id`, `institution_id` | `uuid NOT NULL`, strani ključ na nit iste ustanove |
| `position` | `integer NOT NULL`, 1 do 10000, `UNIQUE (thread_id, position)`; 1 je nastavnikov komentar koji otvara nit |
| `author_id` | `uuid NOT NULL`, iz `app.current_actor()`; nema parametra autora |
| `author_role` | `text NOT NULL CHECK IN ('teacher','student')`, iz `actor_assignment_role` u trenutku upisa |
| `body` | `text NOT NULL`, granice ispod (`CHECK`) |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Tekst komentara je nepromjenjiv; u B-10 nema uređivanja ni brisanja komentara (brisanje ide uz pravila čuvanja, D-50 i kasniji korak). Odgovor zaključava redak niti, pa istodobni odgovori dobivaju različite pozicije.

**Tko što smije.** Odnos se računa pri svakom pozivu iz `document_scope` i `actor_assignment_role`, bez predmemorije, pa uklonjeni nastavnik gubi i čitanje i pisanje odmah (§4.4).

| Akter | Čita | Novi korijen sa sidrom | Odgovor | Promjena stanja |
| --- | --- | --- | --- | --- |
| Student vlasnik dokumenta (`principal_id` = akter, ista ustanova, `actor_assignment_role` = `student`) | sve niti svog dokumenta | ne | da | ne |
| Nastavnik kolegija tog zadatka (`actor_assignment_role` = `teacher`, otvoreno članstvo) | sve niti dokumenta | da | da | da |
| Svi ostali (N2 drugog kolegija, Student B istog kolegija, N1 druge ustanove, administrator, istekla ili nepostojeća sesija) | ništa | ne | ne | ne |

Sesija bez aktera: `ZD401`. Svaki drugi odbijen slučaj, uključujući nepostojeći dokument ili nit: `ZD403` s istom porukom, bez razlike u obliku odgovora (napadi 1 i 12).

**Stanja niti.** Jedini prijelazi; svaki drugi je `ZD409`:

| Iz | U | Okidač |
| --- | --- | --- |
| (nema) | `open` | nastavnik stvara korijen |
| `open` | `answered` | odgovor studenta |
| `answered` | `open` | odgovor nastavnika |
| `open`, `answered` | `resolved` | nastavnik `resolve_thread` |
| `resolved` | `open` | nastavnik `reopen_thread` |

Odgovor u niti `resolved` je `ZD409` (nit se prvo ponovno otvara). Ostali prijelazi (npr. odgovor nastavnika na `open`, odgovor studenta na `answered`) ne mijenjaju stanje.

**RPC potpisi** (`SECURITY DEFINER`, `SET search_path = ''`, `EXECUTE` samo `ductus_app`):

- `collaboration.create_comment(p_document_id text, p_body text, p_anchor jsonb) RETURNS uuid`: samo nastavnik; vraća `id` nove niti.
- `collaboration.reply_comment(p_thread_id uuid, p_body text) RETURNS uuid`
- `collaboration.resolve_thread(p_thread_id uuid) RETURNS void`, `collaboration.reopen_thread(p_thread_id uuid) RETURNS void`
- `collaboration.list_comments(p_document_id text) RETURNS TABLE (thread_id, comment_id, comment_position, author_role, is_own, body, anchor, state, created_window)`; `anchor` je popunjen samo u retku pozicije 1: **ista funkcija i isti oblik izlaza za studenta i nastavnika** (`PRODUCT.md` §5 t. 5).

`ductus_app` nema nikakvu ovlast ni na jednoj tablici sheme `collaboration`, ni `SELECT`: izravno čitanje otkrilo bi točna vremena i ID-ove osoba, pa klijent čita samo kroz `list_comments` (napad 4). Tablice imaju `FORCE ROW LEVEL SECURITY` sa samo vlasnikovom politikom, pa ni pogrešno dodijeljen grant ne pokazuje ni ne mijenja nijedan redak; retci su u pgTAP matrici.

**Što se nikad ne vraća.** `author_id` drugih osoba, `institution_id`, točno vrijeme (`created_at` se vraća samo zaokružen na prozor P-03 od 5 minuta, `created_window`; redoslijed nosi `comment_position`), sadržaj dokumenta, segmenti, hashevi i revizije. Poslužitelj **ne razrješuje sidro** prema sadržaju i ne vraća nikakav isječak dokumenta: vraća sidro kako ga je nastavnik spremio, iz teksta koji je već vidio, a klijent ga razrješuje lokalno s `resolveTextAnchor` (exact, moved, ambiguous, missing). Zato poziv ne može otkriti tekst noviji od nastavnikova pogleda (napad 8). Neprouzdano sidro (`ambiguous`, `missing`) prikazuje se kao "sidro nije pouzdano" uz komentar koji ostaje vidljiv, nikad na pogrešnom mjestu (napad 7). Student ne stvara sidro jer bi ono nosilo njegov noviji tekst.

**Granice ulaza** (strogi validator bez nove ovisnosti u `src/domain/collaboration/comment.ts`, po uzoru na `src/server/institution/create-course.ts`; ista pravila kao `CHECK` u bazi):

- `body`: nakon NFC normalizacije 1 do 2000 znakova, nije samo bjelina; odbijaju se kontrolni znakovi osim `\n` i `\t` te dvosmjerni nadjačavajući znakovi (U+202A do U+202E, U+2066 do U+2069).
- `anchor`: točno polja `nodeId` (UUID kao `isNodeId` u `src/domain/document/schema.ts`), `quote` (1 do 500 znakova), `prefix` i `suffix` (do 64), `startHint` i `endHint` (cijeli brojevi, 0 ≤ `startHint` < `endHint` ≤ 1 000 000); nepoznato ili nedostajuće polje je odbijeno; isti zabranjeni znakovi kao u `body`. Duljine se broje u kodnim točkama, kao `char_length` u bazi.
- Tijelo HTTP zahtjeva do 16 KiB; dopuštena su samo točno propisana polja, nepoznato polje se odbija. Pogreška je `ZD422` bez odjeka ulaza.
- Prikaz je uvijek tekst (React tekstni čvor), nikad HTML ni Markdown (napad 10).

**Evidencija netaknuta.** Nijedan RPC ne čita ni ne piše `evidence.document_revision`, `segment`, `package` ni `receipt`; pgTAP potvrđuje da su `current_revision`, `current_content_hash` i lanac segmenata jednaki prije i poslije komentara (napad 6). Riječi poput "rizik" ili "sumnjivo" u komentaru nastavnika se ne filtriraju (kontrola lažnog blokiranja); rječnik zabranjenih izraza vrijedi za tekst sučelja, ne za korisnikov unos.

**Logovi.** Samo ID-ovi (`document_id`, `thread_id`, kod greške), nikad `body` ni `anchor` (§4.9, napad 11).

**Napadi iz #177 na testove.**

| Napad | Dokaz |
| --- | --- |
| 1, 12 | pgTAP: N2, Student B, N1 druge ustanove, administrator i bez sesije dobivaju `ZD403`/`ZD401` na svakom RPC-u, i na `list_comments`; nepostojeći dokument ili nit daje isti `ZD403`; neovlašten poziv s neispravnim ulazom i dalje dobiva `ZD403`, ne `ZD422` |
| 2 | pgTAP: nastavnik sa zatvorenim članstvom (`member_to`) odmah dobiva `ZD403` na čitanju i pisanju |
| 3 | pgTAP i katalog: nema parametra autora; `author_id` jednak akteru |
| 4 | pgTAP: izravni `SELECT`/`INSERT`/`UPDATE`/`DELETE` pod `ductus_app` odbijeni (`42501`), uz pogrešno dodijeljen grant 0 redaka; katalog: `ductus_app` izvršava točno pet RPC-ova (`bag_eq`) |
| 5 | pgTAP: svaki redak tablice prijelaza i svaki nedopušten prijelaz (`ZD409`) |
| 6 | pgTAP: hash, revizija i segmenti jednaki prije i poslije |
| 7 | unit (`anchor.test.ts`): obrisan, premješten, izmijenjen i dupliciran odlomak daju `missing`/`moved`/`ambiguous`, nikad pogrešan raspon; pgTAP: komentar ostaje u `list_comments` |
| 8 | pgTAP i katalog: izlaz `list_comments` nema stupca sa sadržajem dokumenta |
| 9 | unit (validator) i pgTAP (`CHECK`): prazno, 1 MB, kontrolni znakovi, RTL override, nepoznato polje |
| 10 | unit/e2e u koraku sučelja: `<script>` u tekstu prikazan doslovno |
| 11 | unit: log rute sadrži samo ID-ove (canary) |

**Koraci.** (1) ovaj ugovor; (2) migracija, RLS, RPC-ovi i pgTAP matrica; (3) ugovor ulaza (validator), poslužiteljski omotač i ruta s unit testovima (`Closes #177`). Prikaz u editoru je Frontendov korak.

**Poznate granice do B-11.** Nastavnikovo pravo komentiranja još ne ovisi o vidljivosti prema D-37, P-03 i potvrdi obavijesti; B-11 (§4.10, PR #395) to veže. Sidro se ne provjerava prema reviziji koju je nastavnik vidio jer bi provjera prema trenutačnoj reviziji bila bočni kanal (napad 8); vezanje uz reviziju pogleda dolazi s B-11.

### 4.12 Prikaz uživo (B-LIVE, DAN-216)

Ugovor prije koda. **Odluka vlasnika (issue #87, komentari 6254642740 i 6254721033; u `docs/DECISIONS.md` je upisuje orkestratorov docs PR kao D-142 do D-144):** student piše u jednoj prijavi, a mentor ili nastavnik zadatka rad vidi uživo, istodobno, u drugoj prijavi. To vrijedi od prvog dana i za kratke zadatke (mijenja D-37). Student za to zna prije prve rečenice (obavijest, S3) i vidi isti prikaz svog rada. Reprodukcija znak po znak (D-143) nije dio ovog ugovora.

**Redoslijed spajanja.** U repou `docs/PRODUCT.md` §5 pravilo 7 još kaže „najviše svakih P-03, ne tipkanje uživo”, a D-37 kratke zadatke skriva do predaje. Ovaj odjeljak opisuje ponašanje po novoj odluci, ali **nijedan kodni PR prema njemu ne spaja se prije orkestratorova docs PR-a** koji usklađuje PRODUCT §5 pravilo 7, D-37 i odnos prema §4.10. Do tada je nesklad otvoren i zapisan na PR-u. Odnos prema §4.10 (snimke P-03 iz evidencije) odlučuje taj docs PR; ovaj ugovor §4.10 ne mijenja i ne čita njegove tablice.

1. **Zaseban kanal, ne evidencija.** D-24 odsječke zatvara do 30 s i vrijeme zaokružuje na minutu, pa evidencija nije dovoljno brza za prikaz uživo. Prikaz uživo zato ima vlastiti kanal: **zadnje stanje dokumenta** koje student objavljuje i koje ovlašteni čitaju.
   - Stanje nije dokaz: nema lanca hasheva, potpisa ni potvrde; ne ulazi u rekonstrukciju, predaju (B-12) ni sažetak procesa (B-13); ne čita i ne piše nijednu tablicu sheme `evidence`, osim iznimke za predan rad ispod. Kanonski oblik dokumenta i hash dokumenta v2 (§4.1, D-133 i D-134 su PRIJEDLOG) ostaju netaknuti: kanal ih samo koristi.
   - Šalje se cijeli kanonski dokument (JCS bajtovi sheme editora, isti oblik kao snimka iz §4.10 t. 1), nikad događaj, tipka, raspon izmjene, trajanje ili vrijeme klijenta. Kanal zato ne nosi tipke, vrijeme ni povijest, a Ductus iz njega ne računa brzinu, pauze ni ritam (`docs/PRODUCT.md` §5 pravilo 4; D-56 ostaje izvan opsega). Svojstvo samog prikaza uživo (D-142) jest da čitač vidi kad se stanje promijenilo, s točnošću svog pollinga (točka 7), i razliku dvaju stanja koja je vidio; ugovor to ne skriva, a obavijest (S3), DPIA i pravno mišljenje (D-55) moraju to reći točno ovako. Ne bilježi se ništa izvan editora.
   - Čuva se samo **zadnje** stanje: novi upis prepisuje prethodni. Nema povijesti, međustanja ni vremena upisa.
   - **Iznimka za predan rad** (DAN-289 A3, ugovor #756; vlasnik #87 c.6397418697 i c.6397773534, opcija (a)): nakon upisane predaje kanal ne prikazuje zadnje stanje, nego oznaku predaje i točno predanu reviziju. Kanal zato smije pročitati dvije stvari i ništa drugo: je li dokument predan (`app.document_submitted(p_document_id text) RETURNS boolean`) i tekst predane revizije iz `evidence.document_checkpoint`, provjeren prema `submission.artifact_hash` (`app.submitted_document_text(p_document_id text) RETURNS TABLE (content_hash text, body text)`). Ustanova dolazi iz sesije (`current_actor()`), nikad iz parametra. Obje su `SECURITY DEFINER` funkcije uloge `ductus_evidence` s praznim `search_path`, `EXECUTE` ima samo `ductus_identity`, a ta uloga i dalje nema pristup shemi `evidence`. Kanal nikad ne vraća reviziju, vrijeme ni ID predaje.
2. **Tablica `collaboration.live_state`** (shema i vlasništvo kao §4.11: tablica i RPC-ovi u vlasništvu `ductus_identity`, opseg dokumenta iz `collaboration.document_scope`).

| Stupac | Tip i ograničenje |
| --- | --- |
| `document_id` | `text NOT NULL` |
| `institution_id`, `assignment_id`, `owner_id` | `uuid NOT NULL`, iz `document_scope` pri prvom upisu, nikad iz parametra; strani ključevi na zadatak i korisnika iste ustanove |
| `body` | `text NOT NULL`, `octet_length` 1 do 2 097 152 (D-96) (`CHECK`); tekst, ne `jsonb`, koji mijenja bajtove |
| `content_hash` | `text NOT NULL`, SHA-256 (hex) bajtova `body`; računa ga baza pri upisu, `CHECK` jednakosti |
| `write_token` | `uuid NOT NULL`, nova slučajna vrijednost pri svakom prihvaćenom upisu |

   - PK (`document_id`, `institution_id`). Nema stranog ključa prema `evidence.document` (kao §4.11); postojanje dokumenta provjerava `document_scope` pri upisu.
   - **Nema stupca s vremenom ni brojačem.** `write_token` je neproziran: iz njega se ne čita broj upisa ni redoslijed. Vrijeme zadnjeg upisa ne postoji ni u tablici ni u odgovoru.
   - `ENABLE` i `FORCE ROW LEVEL SECURITY`, samo vlasnikova politika za `ductus_identity`. `ductus_app`, `ductus_worker` i `ductus_retention` nemaju nikakvu ovlast na tablici, ni `SELECT`; klijent piše i čita samo kroz RPC-ove iz točke 3.
   - Rok čuvanja: klasa „Radne verzije” (`ARCHITECTURE.md` §3, C-21). Kaskade nema (nema stranog ključa prema dokumentu), pa redak briše samo `collaboration.delete_live_state(p_document_id text, p_institution_id uuid)` iz točke 3, koja se poziva u istoj transakciji kao brisanje dokumenta po roku i brisanje pri povlačenju studenta (D-12). Tekst rada u bazi ulazi u `pg_dump` i PITR (§4.10 t. 5 vrijedi i ovdje). `body` nikad ne ide u log; canary iz §4.9 pokriva i ovaj kanal.
3. **RPC-ovi** (`SECURITY DEFINER`, `SET search_path = ''`, identitet i ustanova iz `current_actor()`, `EXECUTE` samo `ductus_app`):
   - `collaboration.publish_live_state(p_document_id text, p_expected_token uuid, p_body text) RETURNS TABLE (outcome text, write_token uuid)`. Smije samo student vlasnik (`collaboration.actor_role` = `student`, otvoreno članstvo) koji je potvrdio trenutnu verziju obavijesti zadatka (`institution.has_acknowledged_current`). Redak se zaključava (`FOR UPDATE`), pa je usporedba tokena i upis jedan korak. Ishodi:
     - `accepted`: `p_expected_token` jednak spremljenom (ili retka nema i parametar je `NULL`); `body` i hash se prepisuju, vraća se novi token.
     - `unchanged`: hash `p_body` jednak spremljenom; ništa se ne piše, vraća se trenutni token.
     - `conflict`: token zastario, ili je `NULL` a redak postoji; ništa se ne piše, vraća se trenutni token. Time zakašnjelo ponovno slanje ne može prepisati novije stanje.
   - `collaboration.read_live_state(p_document_id text, p_known_hash text) RETURNS TABLE (outcome text, content_hash text, body text)`. Ishodi: `state` (hash i tijelo), `unchanged` (`p_known_hash` jednak spremljenom; tijelo se ne šalje), `empty` (student još ništa nije objavio). Nikad ne vraća `write_token`, ID osoba, ustanovu ni vrijeme.
   - **Nakon predaje** (iznimka iz točke 1): `publish_live_state` ništa ne piše i daje `ZD403`, kao svaka odbijena objava, prije provjere ulaza. `read_live_state` ne čita zadnje stanje, nego studentu i nastavniku jednako vraća `submitted` s hashem i tekstom predane revizije (tijelo izostaje kad je `p_known_hash` jednak tom hashu, kao kod `unchanged`), ili `unavailable` kad snimke predane revizije nema ili se njezini bajtovi ne slažu s `artifact_hash`. Nastavnikovo čitanje i dalje se upisuje u zapis pristupa. Sam zahtjev i odbijena predaja (`artifact_mismatch`) ne mijenjaju ništa.
   - `collaboration.delete_live_state(p_document_id text, p_institution_id uuid) RETURNS void`: `SECURITY DEFINER` u vlasništvu `ductus_identity`, `SET search_path = ''`, `EXECUTE` samo `ductus_retention` (ne `ductus_app`). Briše redak ako postoji; bez retka ne radi ništa. Ne prima ni ne vraća tijelo.
   - **Redoslijed provjera u `publish_live_state`** (ishodi su tako međusobno isključivi): ovlast, valjanost ulaza, zaključavanje retka, zatim (a) hash `p_body` jednak spremljenom daje `unchanged` bez obzira na token; (b) inače token kao gore daje `accepted` ili `conflict`. Isto tijelo sa zastarjelim tokenom je dakle `unchanged` i vraća trenutni token, što objavljivaču samo osvježi token.
   - **Pogreške:** sesija bez aktera `ZD401`; svaki drugi odbijen slučaj, uključujući nepostojeći dokument, `ZD403` s istom porukom. Ovlast se provjerava **prije** valjanosti ulaza, pa neovlašten poziv s neispravnim ulazom dobiva `ZD403`, ne `ZD422`. Neispravan `p_body` vlasnika (prazan, iznad granice, neispravan oblik hasha u `p_known_hash`) je `ZD422` bez odjeka ulaza.
4. **Ovlasti samo iz odnosa (Ustav C-23, `docs/PRODUCT.md` „Pristup nastaje isključivo iz odnosa”).** Odnos se računa pri svakom pozivu iz `document_scope` i `collaboration.actor_role`, bez predmemorije, pa uklonjeni nastavnik ili student gubi pristup odmah (§4.4).

| Akter | `read_live_state` | `publish_live_state` |
| --- | --- | --- |
| Student vlasnik rada, otvoreno članstvo, potvrđena trenutna obavijest | da | da |
| Student vlasnik bez potvrde trenutne verzije obavijesti | da | `ZD403` |
| Nastavnik kolegija zadatka (aktivno članstvo `teacher`) | da | `ZD403` |
| Mentor rada | da, kad postoji `mentorship` (u demou ne postoji; tada se dodaje redak u `actor_role` i matrici) | `ZD403` |
| Student B istog kolegija, nastavnik drugog kolegija iste ustanove, nastavnik sa zatvorenim članstvom (`member_to`), persona druge ustanove, administrator ustanove | `ZD403` | `ZD403` |
| Bez sesije | `ZD401` | `ZD401` |

5. **Isti izračun za studenta i mentora (pravilo 5).** Postoji jedna funkcija čitanja; ishod i bajtovi ne ovise o tome tko pita. Student svoj rad u prikazu vidi kroz isti `read_live_state` i istu rutu kao mentor, ne iz lokalnog editora. Test na razini baze i na razini API-ja uspoređuje odgovore studenta i nastavnika bajt po bajt.
6. **HTTP.** Ruta `/api/live/[documentId]`:
   - `PUT`: tijelo su sirovi JCS bajtovi dokumenta; zaglavlje `If-Match: "<token>"`, ili `If-None-Match: *` za prvi upis. Vrijede zaštite mutacije (`checkMutationRequest`, Origin i `Sec-Fetch-Site`). Tijelo se čita kao tok s granicom 2 MiB (D-96) i prekida čim je prijeđe. Gateway prije RPC-a provjerava: strogi UTF-8 bez BOM-a, `validateDocument`, ponovni JCS bajt-identičan primljenom (kao §4.10 t. 2). Odgovori: 200 `{outcome, token}`, 409 `{outcome: "conflict", token}` (token je `null` kad stanja još nema), 413 iznad granice, 422 za neispravno tijelo, 404 za `ZD403`, 401.
   - `PUT` prije prvog bajta tijela pita bazu za sesiju (kao F-098, §4.13 t. 1). Bez zaglavlja uvjeta, s oba ili s pogrešnim oblikom daje 428. Neispravan ID dokumenta daje 404 prije baze. Ostale odgovore (403, 405, 415, 400, 408, 503) i točna tijela navodi tablica u opisu PR-a koraka 3 (#496), a provodi ih `src/server/collaboration/live-route.ts`.
   - `GET`: `If-None-Match: "<hash>"` daje 304 kad je stanje isto; inače 200 s bajtovima dokumenta, `ETag` jednak hashu i `Cache-Control: no-store`. 204 kad je `empty`, 404 za `ZD403`, 401. Druga vrijednost `If-None-Match` čita se kao da je nema. Ishod `submitted` daje isto (200 s bajtovima predane revizije ili 304) uz zaglavlje `Ductus-Live-State: submitted`, koje ne nosi ništa drugo; `unavailable` daje 503 `unavailable`, nikad zadnje stanje. Nastavnikovo čitanje upisuje otvaranje u zapis pristupa (pravilo 17), pa ruta traži pozitivan dokaz da zahtjev šalje stranica aplikacije (F-107): bez zaglavlja `Ductus-Protocol` jednakog `DUCTUS_PROTOCOL_VERSION` daje 403 prije baze, kao i `Sec-Fetch-Site` koji postoji, a nije `same-origin`. Isto vrijedi za `HEAD`.
   - Log rute: samo `document_id`, ishod i kod greške.
7. **Učestalost i opterećenje.** Bez nove usluge i nove ovisnosti.
   - Student: najviše jedan zahtjev u letu; promjene u međuvremenu se stapaju u zadnje stanje; novi zahtjev kreće najranije 1 s nakon početka prethodnog. Šalje se samo kad se kanonski dokument promijenio.
   - Mentor, nastavnik i student u prikazu: `GET` s `If-None-Match` svake 1 s dok je stranica vidljiva (`visibilitychange`); nakon pogreške odmak od 2 s do najviše 30 s.
   - Kašnjenje od tipke do prikaza tako je oko 2 s ili manje. Te su vrijednosti tehničke konstante klijenta, ne pragovi P iz Owner queuea, i ne prikazuju se korisniku.
   - Poznata cijena: uz 15.000 riječi oko 130 KB po objavi (`docs/spikes/B0.2.md`), najviše jedna u sekundi po studentu koji piše; čitanje bez promjene je 304 bez tijela. Slanje razlika umjesto cijelog dokumenta je kasniji korak bez promjene RPC-ova.
   - Kanal guranja (npr. `LISTEN/NOTIFY` i SSE) može kasnije zamijeniti polling bez promjene tablice i RPC-ova. **Pitanje za vlasnika (nije blokirajuće):** treba li ga uvesti prije pilota; ovisi o hostingu (D-08, dio o dobavljačima).
8. **Prekid veze.**
   - Student bez mreže: editor i journal rade dalje neovisno o kanalu. Objavljivač čuva samo zadnje neposlano stanje (nema reda). Po povratku veze šalje ga sa zadnjim tokenom; na `conflict` preuzima vraćeni token i šalje ponovno (jedan pisač, D-34).
   - Mentor vidi zadnje stanje koje je stiglo. Nema zasebnog signala prisutnosti ni „student je izvan mreže”; čitač vidi samo je li se stanje promijenilo (točka 1).
   - Mentor bez mreže: stranica zadržava zadnji tekst i označava stanje **vlastite** veze; po povratku nastavlja s `If-None-Match`.
   - Odjava: objavljivač staje prije ograde odjave; redak ostaje.
   - Uklonjeni student ili nastavnik dobiva `ZD403` već pri sljedećem pozivu.
   - Dvije kartice istog studenta: u svakom CAS krugu pobjeđuje zadnji prihvaćeni upis; druga kartica dobiva `conflict` i preuzima token (poznata granica, isti dokument ima jednog pisača po uređaju, D-34).
9. **Evidencija netaknuta.** pgTAP potvrđuje da su `current_revision`, `current_content_hash` i lanac segmenata jednaki prije i poslije objave i čitanja, i da nijedan RPC kanala nema ovlast na shemi `evidence`.

**pgTAP matrica (retci za `collaboration.live_state` i RPC-ove).**

| Redak | Očekivano |
| --- | --- |
| Student vlasnik: objava, ponovna objava istog tijela, čitanje | `accepted`, `unchanged`, `state` s istim bajtovima |
| Student vlasnik: zastarjeli token; `NULL` token kad redak postoji | `conflict` s trenutnim tokenom, tijelo nepromijenjeno |
| Student vlasnik: isto tijelo s važećim tokenom; isto tijelo sa zastarjelim tokenom | `unchanged` s trenutnim tokenom u oba slučaja, token se ne mijenja |
| `delete_live_state` pod `ductus_retention`; brisanje dokumenta po roku i povlačenje studenta (D-12) | 0 redaka u `live_state` za taj dokument; `ductus_app` nema `EXECUTE` (`42501`) |
| Student vlasnik bez potvrde trenutne verzije obavijesti (i nakon nove verzije zadatka) | objava `ZD403`, čitanje dopušteno |
| Nastavnik kolegija | čitanje bajt-identično studentovu; objava `ZD403` |
| Student B istog kolegija, nastavnik drugog kolegija iste ustanove, nastavnik sa zatvorenim članstvom, persona druge ustanove, administrator ustanove | `ZD403` na oba RPC-a, i s neispravnim ulazom |
| Nepostojeći dokument | isti `ZD403` |
| Bez sesije | `ZD401` |
| Izravni `SELECT`/`INSERT`/`UPDATE`/`DELETE` pod `ductus_app`, `ductus_worker`, `ductus_retention` | `42501`; uz pogrešno dodijeljen grant 0 redaka (FORCE RLS) |
| Katalog | `ductus_app` izvršava točno očekivani skup RPC-ova sheme `collaboration` (`bag_eq`), a `ductus_retention` samo `delete_live_state`; izlaz `read_live_state` nema stupca s tokenom, vremenom ni ID-om osobe; tablica nema stupca tipa `timestamptz` |
| `CHECK` | prazno tijelo, tijelo iznad 2 097 152 bajta, hash koji ne odgovara tijelu odbijeni |
| Evidencija | stanje dokumenta i segmenata jednako prije i poslije |

**Koraci.** (1) ovaj ugovor; (2) migracija, RLS, RPC-ovi i pgTAP matrica; (3) validator tijela, poslužiteljski omotač i ruta `GET`/`PUT` s unit i integracijskim testovima (uključujući bajt-jednakost studenta i nastavnika kroz API i canary loga); (4) klijentski modul objavljivača i čitača prema točkama 7 i 8, usklađen s FE-D10 (DAN-215). Svaki korak je zaseban PR vezan uz DAN-216.

**Poznate granice.**

- Nakon predaje objava se još ne zaključava; to dolazi s B-12.
- Potvrda obavijesti dana za verziju koja još ne spominje prikaz uživo vrijedi kao potvrda. Za pilot zadatak treba novu verziju obavijesti s tekstom S3, pa studenti potvrđuju ponovno.
- Nastavnik još nema popis radova ni imena studenata (identitet ih ne čuva), pa FE-D10 ID dokumenta ne može dobiti iz postojećeg API-ja. **Pitanje za orkestratora:** kako FE-D10 u demou dolazi do ID-a rada.
- Na `main` još nema produkcijskog puta koji stvara `evidence.document` (B-8); testovi ga postavljaju sami.
- Poslužiteljsko ograničenje broja zahtjeva još ne postoji; učestalost iz točke 7 drži klijent.
- Na `main` još nema puta brisanja dokumenta po roku ni povlačenja studenta (D-12); korak 2 uvodi `delete_live_state` i pgTAP redak, a poziva ga onaj PR koji uvodi taj put.

### 4.13 Ruta `ingest`: slanje odsječka i snimke (B-8, DAN-83)

Ugovor prije koda za poslužiteljski ulaz evidencije. Značenje (jedno slanje nosi jedan odsječak i cijeli dokument, u jednoj transakciji, s jednim ključem ponavljanja), redoslijed provjera i ishodi su iz ADR-a `docs/adr/2026-10-11-ugovor-spremanja-i-zapisa.md` (§5.2 do §5.4, odluke vlasnika 1 do 7); snimka je iz §4.10 t. 2 i 3, potpis u demou iz `docs/PLAN-DEMO.md` §7 t. 4 (D-98) i ADR odluke 6. Ovaj odjeljak samo prevodi to u HTTP, imenuje što na `main` nedostaje i redoslijed koraka. Gdje se razlikuje od ADR-a u značenju, vrijedi ADR.

**Stanje na `main` (`f62c918`).** Postoje `app.commit_evidence_segment` (CAS revizije i `reserve`, potvrda v2 u stanju `pending_signature`), validator odsječka v2 (`verifyCanonicalEvidencePayloadV2`), format i sažetak potvrde v2 (`digestEvidenceReceiptPayloadV2`), S3 adapter (`putImmutable`), zaštite mutacije (`src/server/http/mutation-request.ts`) i gateway koji još izdaje potvrdu v1. Ne postoje: ruta, put koji studentu stvara rad (`evidence.project`, `document`, `package`), tablica snimki (§4.10 t. 5), RPC koji priključuje potpis, trajni razvojni ključ i adapter prema bazi. Zato danas nijedan rad nema evidenciju na poslužitelju i svaka predaja završava kao `no_evidence`.

1. **Ruta `POST /api/evidence/commit`.** `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `revalidate = 0`, svaki odgovor `Cache-Control: no-store` i JSON bez odjeka ulaza. ID dokumenta ne ide u URL. Prije čitanja ijednog bajta tijela, ovim redom: `checkMutationRequest` s očekivanim originom iz `OIDC_REDIRECT_URI` (kao ruta komentara; 405, 403 `forbidden`); zaglavlje `Ductus-Protocol: 1`, inače 426 `upgrade_required` (§3 t. 7); `Content-Type: application/json`, inače 415; kolačić sesije u obliku tokena, inače 401 `unauthenticated`; deklarirani `Content-Length` koji `readBodyWithLimit` odbija nepročitan (`declaredLengthRefusal`: 413 iznad granice, 400 neispravan) odbija se bez upita bazi; zatim sesija u bazi (`app.current_actor()` pod `withActor`): zatvorena, istekla ili nepoznata daje 401 `unauthenticated`, baza koja ne odgovara 503 `context`, kako se najveće tijelo nikad ne bi držalo za kolačić koji samo ima ispravan oblik. Tijelo se zatim čita `readBodyWithLimit` s granicom `MAX_COMMIT_REQUEST_BYTES` i vremenskom granicom (413, 408, 400).
2. **Tijelo zahtjeva**, zatvoren skup ključeva (nepoznat ili nedostajući ključ je `invalid`); tijelo se dekodira strogo kao UTF-8 bez BOM-a:

| Polje | Oblik |
| --- | --- |
| `documentId` | ID dokumenta iz rute rada (točka 6) |
| `clientTransactionId` | jedini ključ ponavljanja (ADR §5.2); oblik `isReceiptClientTransactionId` (1 do 128 UTF-16 jedinica, bez kontrolnih znakova i usamljenih surogata) |
| `baseRevision` | cijeli broj ≥ 0 |
| `segments` | niz s točno jednim elementom (ADR §5.1 t. 2): točni JCS bajtovi odsječka v2 u standardnom base64 s paddingom |
| `document` | točni JCS bajtovi snimke dokumenta nakon zadnjeg događaja odsječka, base64 kao gore (§4.10 t. 2; obavezno) |

   - Bajtovi putuju kao base64, ne kao JSON tekst, da poslužitelj hashira točno one bajtove koje je klijent hashirao (§4.1 "Ponovno slanje": hash se računa nad primljenim bajtovima). Base64 koji se ne kodira natrag u isti tekst je `invalid`.
   - Klijent ne šalje descriptor, paket ni autora. Descriptor gradi poslužitelj iz provjerenog odsječka (`segmentHash` i `payloadBytes` iz primljenih bajtova), paket izvodi iz dokumenta, a autora iz sesije.
   - `gap` nije dio verzije 1 (ključ je nepoznat, dakle `invalid`). Ulazi zasebnim korakom kad plan napada potvrdi kodove uzroka i vlasnik ih vidi (ADR odluka 7).
   - `MAX_COMMIT_REQUEST_BYTES` je jedna konstanta koju uvoze klijent i ruta, izračunata iz granice odsječka (D-96), granice snimke i 4 KiB omotnice, nikad zaseban broj. Granica snimke `MAX_DOCUMENT_SNAPSHOT_BYTES` je 2 MiB (2 097 152 bajta; odluka vlasnika 19. 10. 2026., issue #87, komentar 6256655038; §4.10 t. 2).
3. **Redoslijed provjera nakon čitanja tijela** (ADR §5.3; svaki korak prije sljedećeg):
   1. oblik omotnice i polja; dekodirani odsječak iznad D-96 ili snimka iznad svoje granice je `too_large`;
   2. **kontekst prije skupog rada**: `app.evidence_commit_context(p_document_id text, p_client_transaction_id text)` pod `withActor`. Akter bez sesije daje 401. Dokument koji ne postoji, tuđi, druge ustanove, nastavnikov poziv i uklonjen student daju isti 404 `not_found`. Inače vraća paket, ustanovu, profil, `max_payload_bytes`, je li ključ ponavljanja već poznat i stanje lanca bez zaključavanja (`current_revision`, `document_hash`, `head_segment_hash`, `last_sequence_to`). Za ključ koji nije poznat odgovara `not_accepting` pod istim uvjetima kao RPC prihvata (paket ne prima evidenciju, trenutna verzija nije potvrđena ili još nije otvorena); poznat ključ i dalje dobiva `ok`, da ponovni pokušaj dođe do svoje potvrde. Bez ovoga bi svatko s valjanim kolačićem punio spremnik;
   3. odsječak: strogi UTF-8, `verifyCanonicalEvidencePayloadV2` (JCS bajt po bajt, zatvoreni koraci, minute D-24), `documentId` odsječka jednak `documentId` zahtjeva, profil jednak profilu paketa; inače `invalid`. Veličina iznad `max_payload_bytes` paketa je `too_large`;
   4. snimka: strogi UTF-8, `validateDocument`, ponovni JCS bajt-identičan primljenom (inače `invalid`), SHA-256 jednak `finalDocumentHash` odsječka (inače `document_mismatch`);
   5. za ključ koji nije poznat, prije pohrane se redom RPC-a (njegove t. 9 do 12) provjerava stanje iz konteksta: zastarjela baza je `stale_base`, druga glava lanca `chain_conflict`, slijed koji ide unatrag `invalid`, a prekid slijeda ili drugo stanje dokumenta `not_continuous`, sa stanjem kao iz RPC-a. RPC sve ponovno provjerava pod zaključanim redcima; siroče ostaje moguće samo kad se lanac promijeni između konteksta i transakcije. Zatim se objekt zapisuje (`putImmutable`, ključ `evidenceObjectKey` iz ustanove i paketa koje je vratio kontekst) samo ako ključ ponavljanja nije poznat; za poznat ključ ruta samo izračuna isti ključ objekta i ide na korak 6 (ADR t. 5 i 6). Siroče nakon neuspjele transakcije samo se broji (§4.1);
   6. **jedna transakcija** (`withActor`): RPC prihvata sa snimkom u istoj transakciji (§4.10 t. 2). Dalje se grana samo po ishodu RPC-a; ishodi bez grane ovdje idu na žicu prema tablici iz t. 4.
      - **`reserved` (novi prihvat):** web proces čita vraćeni `receipt_payload`, traži da je valjan v2 i da je njegov JCS bajt-identičan vraćenom tekstu te da su `documentId`, `clientTransactionId`, `segmentHash` i `revision = baseRevision + 1` jednaki zahtjevu → potpisuje `signingInput` (D-92) razvojnim ključem i sam provjerava potpis → RPC priključuje potpis → potvrda transakcije → 200 `committed`. Svaka greška u tom lancu baca iznimku, `withActor` poništava cijelu transakciju i nema ni revizije, ni odsječka, ni snimke, ni potvrde (ADR odluka 6).
      - **`duplicate_signed` (ponovljeni zahtjev, npr. nakon izgubljenog odgovora):** web proces **ne potpisuje i ne zove RPC potpisa**. Iz vraćenog `receipt_payload` i spremljenog potpisa složi potpisanu potvrdu, provjeri da je valjan v2, da `payloadDigestSha256` odgovara payloadu, da potpis prolazi ključem iz registra (t. 7) i da su `documentId`, `clientTransactionId` i `segmentHash` jednaki zahtjevu, pa vraća 200 `duplicate` s tom, bajt-identičnom potvrdom (ADR §5.3 t. 5 i 8: bez novog objekta, prihvata i potpisa). Transakcija ništa nije zapisala. Ako provjera spremljene potvrde ne prođe, ishod je 503 `repository` i incident bez sadržaja, nikad novi potpis.
      - **`duplicate_pending`:** u demou ne smije postojati (ADR odluka 6); 503 `repository` i incident bez sadržaja, nikad potpis tog prihvata.

      Potpis se ne radi izvan transakcije ni nad postojećim prihvatom. Time u demou nema odsječka bez potpisane potvrde, što predaja ionako blokira (vlasnikov odgovor na P3, #385 `issuecomment-6256252275`).
4. **Ishodi na žici.** `status` i HTTP kod; imena koja klijent već poznaje (`src/domain/serverSync/contract.ts`) zadržavaju oblik, pa `parseCommitOutcome` ostaje primjenjiv za uspjeh i `stale_base`.

| `status` | HTTP | Tijelo uz `status` | Klijent (ADR §5.4) |
| --- | --- | --- | --- |
| `committed`, `duplicate` | 200 | `revision`, `receipt: {status: "signed", signedReceipt}` | "spremljeno na poslužitelju" tek nakon provjere potpisa ključem iz rute rada |
| `stale_base`, `chain_conflict`, `not_continuous` | 409 | `currentRevision`, `documentHash`, `headSegmentHash`, `lastSequenceTo` | usklađivanje |
| `txid_reused` | 409 | | oporavak (`RECOVERY_REQUIRED`) |
| `invalid`, `document_mismatch` | 422 | | ne ponavlja |
| `too_large` | 413 | | ne ponavlja |
| `not_accepting` | 409 | | ne ponavlja; zadatak nije otvoren, obavijest nije potvrđena ili paket više ne prima zapis |
| `not_found` | 404 | | ne ponavlja |
| `unauthenticated` | 401 | | čuva red, nakon prijave istog korisnika ponavlja isti zahtjev |
| `unavailable` | 503 | `stage`: `context`, `storage`, `repository` ili `signing`; `Retry-After` | ponavlja isti zahtjev s istim ključem |
| `upgrade_required` | 426 | | osvježava aplikaciju |

   - Razlog (`reason`) nikad ne ide na žicu, samo kod u log. `pending_signature` nije odgovor u demou.
   - **`unauthorized` iz ADR §5.4 namjerno se spaja s 404 `not_found`.** Na žici nema zasebnog `unauthorized`: odbijena ovlast i nepostojeći dokument daju isti odgovor, gdje god se utvrde (provjera konteksta u t. 3.2 ili ponovna provjera u RPC-u u t. 3.6), pa odgovor ne otkriva postoji li dokument. Klijent ga, kao i ADR `unauthorized`, ne ponavlja.
   - **Preslikavanje svakog ishoda RPC-a prihvata (t. 3.6 i t. 5) na žicu.** Popis je zatvoren: ishod koji nije u njemu je 503 `repository` uz incident, nikad uspjeh.

| Ishod RPC-a | `status` | HTTP |
| --- | --- | --- |
| `reserved`, pa potpis i RPC potpisa uspješni | `committed` | 200 |
| `duplicate_signed`, spremljena potvrda provjerena | `duplicate` | 200 |
| `unauthorized` (sesija, članstvo ili zadatak promijenjeni nakon t. 3.2) | `not_found` | 404 |
| `context_mismatch`, `invalid` | `invalid` | 422 |
| `idempotency_conflict` | `txid_reused` | 409 |
| `stale_base`, `chain_conflict`, `not_continuous` | isto ime, sa stanjem iz t. 5 | 409 |
| `not_accepting` | `not_accepting` | 409 |
| `too_large` | `too_large` | 413 |
| `duplicate_pending`; greška potpisa, RPC-a potpisa ili provjere vraćene potvrde; `concurrent_conflict` stare verzije RPC-a; nepoznat ishod | `unavailable` (`stage`: `signing` za potpis, inače `repository`) | 503 |
5. **Izmjene RPC-a prihvata** (nova migracija, `CREATE OR REPLACE`; postojeća se ne mijenja, §4.8). Današnji `concurrent_conflict` spaja zastarjelu baznu reviziju i neslaganje `initialDocumentHash`, a `chain_conflict` spaja krivog prethodnika i krivi redni broj. Nova verzija vraća `stale_base` (bazna ≠ tekuća), `chain_conflict` (prethodnik ≠ glava), `not_continuous` (prethodnik = glava, a redni broj nije sljedeći ili početni hash nije hash spremljenog dokumenta) i `invalid` za vraćanje rednog broja unatrag (ADR t. 9 do 12). Uz sva tri sukoba vraća reviziju, hash dokumenta, glavu i zadnji redni broj iz istih zaključanih redaka. Za `duplicate_signed` vraća i spremljeni potpis, jer današnji RPC vraća samo `receipt_payload`, pa ponovljeni zahtjev ne bi mogao dobiti izvornu potpisanu potvrdu. Redoslijed brava ostaje paket, zadatak, članstvo, dokument. Ako potpis traje dulje od 10 s, `idle_in_transaction_session_timeout` prekida transakciju i ishod je `unavailable`.
6. **Ruta rada `POST /api/evidence/open`** (preduvjet: bez nje klijent nema `documentId`). Tijelo `{assignmentId}`; iste zaštite kao točka 1. RPC `app.open_student_work(p_assignment_id uuid)`:
   - samo aktivan student kolegija zadatka (`app.lock_student_assignment`); svi ostali, uključujući nepostojeći zadatak, dobivaju 404 `not_found`. Aktivan student koji nije potvrdio trenutnu verziju obavijesti dobiva 409 `not_accepting`: on zna da zadatak postoji, pa razlika ništa ne otkriva, a klijent zna da treba potvrda (F-7). Prije potvrde nema retka rada ni slanja evidencije;
   - idempotentno: jedan projekt po paru (zadatak, student), osiguran jedinstvenim indeksom, pa dvije kartice ne stvaraju dva rada; prvi poziv stvara projekt, dokument s revizijom 0 (known-answer iz §4.10 t. 3), njezinu snimku i paket. ID-ove generira baza; ID paketa ima oblik `isEvidencePackageId`;
   - paket dobiva domenu evidencije ustanove (D-102). Domenu daje konfiguracija operatera (lokalno skripta `db/local`), nikad migracija; bez nje ishod je 503 `context`;
   - profil zapisa je jedna konstanta koju dijele hvatanje zapisa na klijentu i poslužitelj; `max_payload_bytes` je D-96;
   - odgovor: `documentId`, `evidenceProfileId`, `currentRevision`, `documentHash`, `headSegmentHash`, `lastSequenceTo`, snimka tekuće revizije (base64), javni ključevi potvrda domene (točka 7) i `submitted` (DAN-289 O2, #756): `true` točno kad postoji upisana predaja pozivatelja za taj zadatak (`app.work_submitted`), inače `false`; odgovor baze koji nije boolean daje 503 `context`, nikad `false`. Ista ruta služi usklađivanju iz ADR §5.4 t. 1. Paket i ustanova ne idu na žicu.
7. **Ključ potpisa u demou.** Današnji razvojni potpisnik stvara novi ključ u memoriji pri svakom pokretanju procesa, pa nakon ponovnog pokretanja nijedna ranija potvrda nije provjerljiva i predaja (B-12) bi je čitala kao neispravan zapis (ADR §7 (b)). **Odluka vlasnika 19. 10. 2026. (issue #87, komentar 6256655038): prihvaćeno kako slijedi, samo za razvoj i demo; ključ nikad u repou.** Razvojni seed od 32 bajta u lokalnoj datoteci izvan repoa (putanja iz okoline, stvara je lokalna skripta); oznaka i verzija ključa izvedene iz javnog ključa; javni ključ upisan u registar ključeva domene (`evidence.signing_key`: domena, ustanova, namjena `receipt`, javni ključ, `valid_from`, `valid_to`, `revoked_at`; RLS i pgTAP retci; upis lokalnom skriptom, ne migracijom). RPC koji priključuje potpis provjerava da `payloadDigestSha256` odgovara `receipt_payload` i da je ključ u registru za domenu paketa, s namjenom potvrde i neopozvan (§4.1). Provjeravatelji (klijent, B-12) uzimaju ključ iz registra, nikad od "trenutnog potpisnika". Bez datoteke ključa ingest je 503 `signing`; brava `NODE_ENV=production` ostaje.
8. **Logovi.** Samo `documentId`, ishod, `stage` i kod greške. Nikad bajtovi odsječka ili snimke, tekst dokumenta ni ključ ponavljanja; canary iz §4.9 pokriva i ovu rutu.

**pgTAP retci (novi RPC-ovi i tablice).** `open_student_work`: student vlasnik (prvi i ponovljeni poziv daju iste ID-ove), student bez potvrde obavijesti (`not_accepting`, nijedan redak rada), nastavnik, student B, persona druge ustanove i bez sesije; paralelni prvi poziv daje jedan projekt. `evidence_commit_context`: isti odgovor za nepostojeći, tuđi i dokument druge ustanove. RPC prihvata: `stale_base`, `chain_conflict`, `not_continuous` i vraćanje unatrag kao zasebni ishodi sa stanjem iz zaključanih redaka; ponovljeni poziv istim ključem nakon potpisa vraća `duplicate_signed` sa spremljenim potpisom i ne mijenja nijedan redak; uklonjen student između dvaju poziva dobiva `unauthorized`. RPC potpisa: tuđi prihvat, već potpisan prihvat, sažetak koji ne odgovara, ključ druge domene i opozvan ključ odbijeni. `ductus_app` nema izravan DML ni na jednoj novoj tablici (uz pogrešno dodijeljen grant 0 redaka). Katalog: `ductus_app` izvršava točno očekivani skup RPC-ova.

**Koraci** (svaki zaseban PR vezan uz DAN-83; plan napada je #155, a svaka njegova stavka dobiva test ili obrazloženje):

1. Ovaj ugovor.
2. Migracija: tablica snimki (§4.10 t. 5) s known-answer revizijom 0, `open_student_work` s jedinstvenim indeksom projekta, `evidence_commit_context`, pgTAP.
3. Migracija: nova verzija RPC-a prihvata (točka 5, sa snimkom u istoj transakciji), registar ključeva i RPC potpisa (točka 7), pgTAP.
4. Adapter prema bazi, gateway v2 (potvrda v2, potpis u transakciji) i trajni razvojni potpisnik, s integracijskim testom koji prolazi ponovno pokretanje procesa.
5. Rute `POST /api/evidence/open` i `POST /api/evidence/commit` s unit i integracijskim testovima: Origin i `Sec-Fetch-Site` (kriterij B-8), granice, svaki redak preslikavanja iz točke 4, canary loga. Obavezan integracijski test ponavljanja nakon izgubljenog odgovora: isti zahtjev dvaput daje 200 `committed`, pa 200 `duplicate` s bajt-identičnom potvrdom, bez nove revizije, objekta, potpisa i poziva RPC-a potpisa. Obavezan i test uklanjanja studenta između t. 3.2 i t. 3.6: 404 `not_found`, jednak odgovoru za nepostojeći dokument.

**Što Frontend treba za spajanje** (F-8, klijentsko slanje nije dio ovog ugovora):

- hvatanje zapisa koje proizvodi odsječak v2 i JCS snimku nakon njegova zadnjeg događaja; journal čuva snimku uz odsječak dok ne dobije potvrdu (§4.10 t. 2);
- transport za `drain-runner` koji gradi omotnicu iz točke 2 i preslikava ishode iz točke 4 u `DrainOutcome`;
- red se šalje redom, odsječak po odsječak. Današnje preskakanje starijih redaka reda (`supersededUpTo`, oblik `REPLACE_DOCUMENT`) ne smije preskočiti nijedan odsječak;
- provjera potpisa ključem iz rute rada (točka 6), nikad iz odgovora koji nosi potvrdu;
- `documentId` iz rute rada umjesto lokalne konstante; 409 `not_accepting` iz rute rada znači da student još nije potvrdio trenutnu verziju obavijesti (F-7).

**Poznate granice.**

- Prijava praznine (`gap`) nije u verziji 1, pa demo kroz rutu ne može proizvesti zabilježenu prazninu (scenarij C4 iz #385) dok kodovi uzroka nisu potvrđeni (ADR odluka 7).
- Potpis u transakciji drži brave paketa, zadatka, članstva i dokumenta dok traje potpis razvojnim ključem (ADR §9). To vrijedi samo za demo (D-98); izvan demoa potpisuje worker.
- Poslužiteljsko ograničenje broja zahtjeva ne postoji.
- Upisana predaja u istoj transakciji zatvara pakete svog dokumenta (`accepts_evidence`). Nakon toga nov commit dobiva `not_accepting`, a paket predanog dokumenta ne može se ponovno otvoriti (DAN-289 A1, ugovor #756). Ponovno slanje ključa prihvaćenog prije predaje i potpis njegove potvrde rade kao prije.

**Odluke vlasnika 19. 10. 2026.** (issue #87, komentar 6256655038; upis u `docs/DECISIONS.md` ide zasebnim docs PR-om orkestratora):

1. Granica snimke `MAX_DOCUMENT_SNAPSHOT_BYTES` je 2 MiB, ista kao prikaz uživo; zamjenjuje 1 MiB iz ADR §5.2 (t. 2, §4.10 t. 2).
2. Trajni razvojni ključ i registar ključeva prihvaćeni su kako piše u točki 7, samo za razvoj i demo; ključ nikad u repou.

## 5. Što još nije potvrđeno (spike prije odluke)

| Stavka | Provjera | Gdje |
| --- | --- | --- |
| Uvjetni upis kod dobavljača pohrane (dodana provjera, odluka 11. 10. 2026., D-08) | Provjera kod dobavljača pohrane | B0.1 |
| Ključevi po spremniku kod dobavljača pohrane (dodana provjera, odluka 11. 10. 2026., D-08) | Provjera kod dobavljača pohrane | B0.1 |
| PostgreSQL 17 i ovlasti nad ulogama kod upravljane baze (dodana provjera, odluka 11. 10. 2026., D-08) | Provjera kod upravljane baze | B0.1 |
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

B0.1 je pomaknut naprijed (odluka vlasnika 11. 10. 2026., D-08), rok 16. 11. 2026.; preduvjet su računi dobavljača (Owner queue u `STATE.md`). **Odluka vlasnika 11. 10. 2026. (tumačenje točke 3, potvrđeno; issue #87, komentar 6105263690):** migracije na kritičnom putu demoa (#240 i sljedeći korak B-8) se ne zaustavljaju; B0.1 kreće čim postoje računi dobavljača; rizik prepisa migracija do tada ostaje zapisan.

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
12. Ako dira povjerenje: za **lokalni sintetički FPZG demo do 2. 11. 2026.** (D-76, D-159) dovoljan je provjerljiv prolaz s izmišljenim podacima u izoliranom lokalnom worktreeju i Dockeru, uz čiste relevantne lokalne i CI testove, propisani neovisni review i QA prema `docs/ENGINEERING_SYSTEM.md` §5, zapis punog testiranog SHA-a te dokaz povrata i čišćenja gdje je primjenjivo. To je dokaz lokalnog demoa, ne spremnosti za udaljeni deploy ili pilot. **Za svaku novu komponentu i svaku naknadnu promjenu koja dira povjerenje, prije njezina udaljenog deploya (uključujući javni preview) ili pilota obvezan je sintetički prolaz te komponente ili promjene na živom stagingu koji koristi iste vrste resursa kao produkcija (upravljana baza, KMS, S3), s povratom.** Lokalni prolaz ne mijenja ostale točke ovog popisa, RLS i auth granice, ograničenje razvojnih ključeva i lažnog OIDC-a na lokalno/CI, niti pravila za FAIL/BLOCK. Pouka iz R4: prvi stvarni RPC poziv otkrio je grešku koju je migracija prešla.

Dodatna matrica kvarova:

| Kvar | Ispravno ponašanje |
| --- | --- |
| VM pada | Klijent nastavlja lokalno ("čeka poslužitelj"); rezervni put na drugom računu; FPZG zamjenski postupak ako traje preko praga |
| Worker pada | Ingest prima; potvrde ostaju `pending_signature`; backlog je alarm |
| Baza nedostupna | Ingest 503, klijent ponavlja; potvrda ne postoji bez zapisa u bazi |
| Bucket nedostupan | Nema metapodataka ni potvrde |
| KMS nedostupan | `pending_signature`; ponovni potpis iste potvrde; dnevni korijen čeka |
| TSA nedostupan | Kontrolna točka potpisana i objavljena "bez žiga"; posao ponavlja; vrijeme žiga se ne unazađuje; paket dokaza ostaje "još nije sidren" |
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
| B0.1 Spike okruženja | UpCloud VM + Managed PG, skripta uloga, PITR povrat u točku, RTT, log parametri, KMS ključ | Zapis s brojkama; PITR radi ili se odabire varijanta B | prije M2 (migracije demoa ne čekaju B0.1, §5); pomaknut naprijed 11. 10. 2026., rok 16. 11. 2026., uz tri dodatne provjere (§5) | 2 do 3 |
| B0.2 Spike rekonstrukcije | ProseMirror u Nodeu za 15.000 i 80.000 riječi na stvarnom stroju | Vrijeme, memorija, volumen; granice posla određene | prije M3 | 1 do 2 |
| B0.3 Odluka | Vlasnik potvrđuje dio D-08 o dobavljačima i trošku, D-72, D-73 (samo izbor biblioteke; vlastiti OIDC klijent odlučen 11. 10. 2026., a sesije u bazi i identitet u RLS-u potvrđeni u D-90) i D-75 prema rezultatima (D-71 i D-74 potvrđene 10. 10. 2026.; dio D-08 o aplikaciji odlučen 11. 10. 2026.) | ODLUČENO u `DECISIONS.md` | | 0 |
| B0.4 Prepis ARCHITECTURE | Cijeli dokument (uključujući §2, §3, §8, §11), §12 s točnim popisom prijenosa | Bez Supabasea i Netlifyja | M0 | 1 do 2 |
| B1 Okruženja | `docker compose` (Postgres, S3-kompatibilna pohrana (RustFS), Mailpit, lažni OIDC), OpenTofu (dva računa), CI deploy, migracijski alat, `sops`/`age`, uloge, Caddy, deploy s VM-a | `docker compose up` i `npm test` zeleno; staging se podiže iz koda | M0 | 5 do 7 |
| B2 Identitet | OIDC klijent s popisom iz §4.3, sesije, `current_actor()`, `withActor`, test GUC-a, odjava | Prijava na AAI Labu; svi testovi iz §4.3 zeleni; nema lažnog pružatelja u produkciji | M1 | 3 do 5 (uz sigurnosni pregled, neovisan o autoru) |
| B3 Ovlasti | Novi referentni model, `can()`, RLS, pgTAP matrica, diferencijalni test | Matrica zelena | M2 | uključeno u M2, +1 |
| B4 Evidencija | Točan popis prijenosa (§2), novi RPC-i, okidači, uloge, jedan RPC za commit i `reserve`, worker potpis preko KMS-a, kontrolne točke, praznine | Ugovorni testovi nad in-memory i pg/S3; B4 test dokazuje 0-based indekse bez praznina pod konkurentnim prihvatima, rollbackom i idempotentnim retryjem; property testovi; sintetički prolaz na stagingu s povratom | M3 | +5 do 8 |
| B5 Dnevni korijen i žig | Kumulativni log i dnevna kontrolna točka (D-93), consistency dokaz, KMS potpis uz usporedbu s potpunom vanjskom append-only poviješću, TSA, objava, neovisni primatelji i CLI verifikator | Neovisna provjera prolazi; C2SP known-answer vektor kontrolne točke iz §4.1 prolazi standardnim verifierom, uključujući negativne slučajeve; promjena odsječka ruši provjeru; dan bez TSA-a se oporavlja; test povrata baze dokazuje da se regresivni ili razgranati checkpoint ne potpisuje, žigoše ni objavljuje; konkurentni `reserve` tijekom cutovera s praznim inventarom ne može upasti između snapshot-a i prve vanjski pohranjene kontrolne točke, a nakon otvaranja gatea dobiva indeks 0; kvar cutovera ostavlja gate zatvorenim | M3 do M7 | 4 do 5 |
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

- Potvrditi ili promijeniti dio D-08 o dobavljačima i trošku, D-72, D-73 (samo izbor biblioteke; vlastiti OIDC klijent odlučen 11. 10. 2026., a sesije u bazi i identitet u RLS-u potvrđeni u D-90) i D-75 (D-71 i D-74 potvrđene 10. 10. 2026.; dio D-08 o aplikaciji odlučen 11. 10. 2026.; vidi i odluku o troškovima u §7).
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

