# Backend: sažetak, vNext i topologija

Dio plana backenda. Verzija, status i popis svih odjeljaka su u indeksu `docs/BACKEND.md`; brojevi odjeljaka su isti kao u indeksu, pa referenca "`BACKEND.md` §N" vodi ovamo.

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
        +-----> AI pružatelj (samo kad student pokrene AI; u pilotu, D-194; pružatelj još nije izabran)
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
