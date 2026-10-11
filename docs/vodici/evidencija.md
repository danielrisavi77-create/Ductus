# Evidencija i forenzika: JCS, hash, potvrde, pohrana, rekonstrukcija

Ako se ovaj vodič i dokument ili kod razilaze, vrijedi dokument odnosno kod; nesklad prijavi u IZVJEŠTAJU.

Vodič je podsjetnik i karta, ne izvor pravila. Pravila su u `CLAUDE.md`, `docs/PRODUCT.md` §5 i §9, `docs/BACKEND.md` §4.1 i §6 (BACKEND ima prednost nad ARCHITECTURE u pojedinostima), `docs/ARCHITECTURE.md` §0.1, §2a, §5, §6, §8, §8a, `docs/DECISIONS.md` i `STATE.md` "Ne smije se izgubiti" (B-8, B-12). Gdje kod nešto provodi bez dokumenta, piše "provedeno u kodu, izvor u dokumentu nije nađen".

## 1. Kada koristiti

Kad se diraju putanje: `src/domain/forensics/**` (uključujući `golden-vectors/`), `src/domain/evidence/`, `src/domain/json.ts`, `src/application/evidence/`, `src/application/ports/` (evidence-*, signing-key-provider, authorization), `src/adapters/evidence/`, `src/adapters/crypto/`, te testovi uz njih i `tests/integration/s3-evidence-payload-store.integration.test.ts`.

Uz ovaj vodič primjenjuju se kratki projektni skillovi: `ductus-provenance-invariants` (prije predaje svakog evidence/forensics diffa), `ductus-worker`, `ductus-attack-plan` (obavezan plan napada prije koda za critical zadatak), `ductus-synthetic-data` (fixtureovi), `ductus-review` i `ductus-qa` za druge sesije. Karte šireg konteksta: `docs/vodici/karta-aplikacije.md` (slojevi, gdje je što) i `docs/vodici/testovi.md` (svi testni slojevi). Kartica uloge: `.claude/uloge/pisac-backend.md`; pravilo po putanji: `.claude/rules/evidencija-i-prijava.md`.

Što NIJE u ovom području: tablice, RLS, RPC `reserve`/`attach_signature` i migracije (`docs/vodici/baza.md`, `ductus-new-table`); korak editora `src/domain/document/edit-step.ts` (`docs/vodici/editor-i-dokument.md`; format koraka, vidi 2.7); prijava (`docs/vodici/prijava.md`, `ductus-identity-isolation`).

## 2. Karta

Što je implementirano, a što planirano: `docs/ARCHITECTURE.md` §0.1 kaže da su moduli u dokumentu ciljna arhitektura. Nema API rute `ingest`, nema web ni worker composition roota, nema trajnog adaptera repozitorija prihvata (STATE.md B-8 je u tijeku). Sve ispod je kod koji postoji na `main`.

### 2.1 Domena: `src/domain/forensics/`
- `jcs.ts`: `canonicalizeJcs`, `jcsUtf8Bytes`, `MAX_JCS_DEPTH = 256`. RFC 8785, nova v2 evidencija.
- `crypto.ts`: `sha256WebCrypto` (Web Crypto, hex malim slovima). Isti fajl nosi stariji `merkleRoot` i `buildProvenanceRoots` (v1).
- `evidence-segment-v2.ts`: tip i validator odsječka (`isEvidenceSegmentV2`, `assertEvidenceSegmentV2`, `canonicalEvidenceSegmentV2`, `digestEvidenceSegmentV2`), `EVIDENCE_SOURCES_V2`, `isEvidenceMinuteV2`, `MAX_EVIDENCE_PROFILE_ID_LENGTH = 120`.
- `evidence-chain-v2.ts`: `MAX_EVIDENCE_SEGMENT_BYTES` (2 MiB), `exceedsEvidenceSegmentLimit`, `verifyCanonicalEvidencePayloadV2` (stroga UTF-8 provjera i usporedba bajtova s kanonskim oblikom), `verifyEvidenceChainV2` (lanac prema glavi, vraća `discontinuities`), `decideEvidenceRetry`.
- `evidence-replay-v2.ts`: `EvidenceStepReplayerV2` (sučelje za editorski replayer), `replayEvidenceSegmentsV2`, `findEvidenceStartBreakV2`, `digestCanonicalDocumentV2`.
- `evidence-receipt.ts`: potvrda v1 (`EvidenceReceiptPayloadV1`, `isSignedEvidenceReceipt`, `digestEvidenceReceiptPayload`) i potvrda v2 (`EvidenceReceiptPayloadV2`, `digestEvidenceReceiptPayloadV2` koji vraća i 59-bajtni `signingInput`, `isEvidenceDomainId`, `isReceiptPrincipalId`).
- `evidence-receipt-verifier.ts`: `verifySignedEvidenceReceiptV2(signed, expected, trustedKeys)`, tip `EvidenceDomainKey` (domena, namjena `receipt|checkpoint`, `validFrom`, `validTo`, `revokedAt`), razlozi odbijanja. Ne baca; "ne mogu provjeriti" je `verification_unavailable`, nije odbijanje.
- `ed25519-encoding.ts`: provjera ključa i potpisa iz samih bajtova prije Web Cryptoa (`isSoundEd25519Point`, `isCanonicalEd25519Signature`, `ed25519KeyFromSpki`).
- `signature.ts`: `SignatureEnvelope`, `PublicVerificationKey` i njihovi validatori (zatvoreni skup polja).
- `ledger.ts`, `integrity.ts`, `replay.ts`: stariji sloj "v1" (`ForensicEvent`, `canonicalize`, hash lanac događaja). U `jcs.ts` piše da v1 hashevi moraju ostati provjerljivi starim algoritmom. Nijedan kod u `app/` ne uvozi taj sloj; koristi ga `forensics.test.ts` i `replay.test.ts`.
- `golden-vectors/evidence-v2.json` i `load.ts` (`loadGoldenVectors`, `applyPayloadEdit`, `goldenKeyVerifier`): jedini izvor očekivanih bajtova i hasheva za testove klijenta i poslužitelja. Samo za testove (čita `node:fs`).
- `index.ts` izvozi samo `ledger`, `integrity`, `replay`, `crypto`. V2 moduli se uvoze izravno po imenu datoteke.

### 2.2 `src/domain/json.ts`
`isPlainObject`, `hasOnlyKeys` (odbija i Symbol i neenumerabilne ključeve), `ownProperty`. Zajednička pravila za svaki validator nepouzdanog JSON-a. Napomena: `evidence-segment-v2.ts` ima vlastite lokalne `isPlainObject` i `hasOnlyKeys` (provjeravaju samo `Object.keys`), ne ove iz `json.ts`.

### 2.3 `src/domain/evidence/`
`basis.ts` (`EvidenceBasis`, `evaluateEvidenceBasis`) nije forenzička evidencija zapisa. To je osnova tvrdnje (tvrdnja, verzija izvora, ulomak). Ne miješati s evidence segmentima; ima svoje testove `basis.test.ts` i `basis.hardening.test.ts`.

### 2.4 Aplikacija: `src/application/evidence/` i `ports/`
- `evidence-outbox.ts`: strana klijenta. `buildEvidenceIngestCommandV2`, `createEvidenceOutboxItem`, `beginEvidenceOutboxAttempt`, `applyEvidenceOutboxOutcome` (potvrda koja ne odgovara naredbi blokira stavku).
- `evidence-gateway.ts`: `EvidenceGateway.ingest` (strana poslužitelja), redoslijed provjera je zapisan u komentaru iznad `ingest`.
- `evidence-reconstruction.ts`: `reconstructAndCompareEvidence` (tanki prolaz B-14), redoslijed prednosti ishoda zapisan u komentaru.
- `ports/evidence-ingest.ts`: `EvidenceIngestCommandV2`, `EvidenceSegmentDescriptorV2`, `isEvidenceIngestCommandV2`, ishodi `EvidenceIngestOutcome`, `isEvidencePackageId`, `isSha256Hex`.
- `ports/evidence-object-key.ts`: `evidenceObjectKey` (`v2/<institutionId>/<package>/<hash>.json`), `evidenceStorageRef` (`<label>:<ključ>`), `isInstitutionId`, `isStorageDomainLabel`.
- `ports/evidence-trust.ts`: `EvidenceContextPort`, `EvidencePayloadStore` (`putImmutable`), `EvidenceAcceptanceRepository` (`lookup`, `reserve`, `attachSignature`).
- `ports/evidence-reconstruction.ts`: `EvidenceChainReader`, `EvidencePayloadReader` (samo poslužiteljska strana, nikad klijentu).
- `ports/signing-key-provider.ts`: `SigningKeyProvider` (`sign`, `verify`, `publicVerificationKey`; jedan ključ, bez domene i namjene). `ports/authorization.ts`: `append_evidence` je "higher-consistency".

### 2.5 Adapteri
- `adapters/evidence/s3-evidence-payload-store.ts`: `S3EvidencePayloadStore.putImmutable` i `verifyIdentity`, `S3StorageCapability`, `STORAGE_IDENTITY_KEY`. Samo upis i provjera identiteta spremnika; nema `readImmutable` na S3 adapteru.
- `s3-signature.ts`: SigV4 (`signS3Request`, `S3SecretCredentials` zapečaćeni ključevi).
- `evidence-storage-config.ts`: `loadEvidenceStorageConfig` iz varijable `EVIDENCE_STORAGE_DOMAINS` i `EVIDENCE_S3_*`.
- `in-memory-*`: payload store (i čitač), repozitorij prihvata (i čitač lanca, izdaje samo v1), kontekst paketa. Za unit testove i tanki prolaz.
- `adapters/crypto/development-ed25519-signer.ts` (ključ u memoriji, odbija `NODE_ENV=production`) i `aws-kms-ed25519-signer.ts` (injektirani transport, `ED25519_SHA_512`, `RAW`, lista `trustedKeyVersions`).

### 2.6 Ovisnosti slojeva
`ARCHITECTURE.md` §0.1: ovisnost ide prema unutra, domain ne ovisi o Reactu, SQL-u, pohrani ni vendor SDK-u. Domena importira samo domenu; aplikacija domenu i portove; adapteri portove i domenu. `s3-*` koristi `node:crypto`, pa je samo za Node.

### 2.7 Format koraka
`captureContext.transactionFormat` imenuje format koraka; replayer kaže koji razumije (`EvidenceStepReplayerV2.transactionFormat`). Jedini format u kodu je `EDIT_STEP_FORMAT_V1 = "ductus-edit-steps-v1"` u `src/domain/document/edit-step.ts` (zatvoren skup ključeva, bez vremena u koraku, korak koji uklanja sadržaj nosi `removedSha256`, `MAX_EDIT_STEP_BYTES`). Dodavanje ili promjena formata koraka je promjena formata evidencije (vidi 5.4). Produkcijski replayer koji radi `apply` nad ProseMirrorom nisam našao; postoje samo testni replayeri.

## 3. Tok podataka

Klijent (`evidence-outbox.ts`):
1. Odsječak (`EvidenceSegmentV2`) -> `digestEvidenceSegmentV2` -> `canonicalizeJcs` (provjerava `assertEvidenceSegmentV2`) -> UTF-8 bajtovi i SHA-256 (`segmentHash`, `payloadBytes`).
2. `buildEvidenceIngestCommandV2` slaže naredbu: `clientRequestId`, `descriptor` (sadrži hash i veličinu), `canonicalPayload` (točan JCS niz). Zamrznuta je.
3. Ishod poslužitelja: `applyEvidenceOutboxOutcome`. `accepted`/`duplicate` s potvrdom koja se ne podudara s naredbom daje `blocked`, `unavailable` vraća u `pending`.

Poslužitelj (`EvidenceGateway.ingest`), svaki korak prije sljedećeg:
1. Principal iz sesije (nikad iz naredbe).
2. Granica veličine (`evidencePayloadExceedsLimit`) i oblik naredbe (`isEvidenceIngestCommandV2`), bez čitanja stanja.
3. `AuthorizationPort.check` za `append_evidence`; dok ne dopusti, ništa o paketu se ne traži (nepostojeći i tuđi paket daju isti `unauthorized`).
4. `EvidenceContextPort.resolve`: paket, dokument, profil moraju odgovarati; ustanova dolazi samo iz retka paketa na poslužitelju.
5. `repository.lookup` i odluka o ponovnom slanju (`decideEvidenceRetry` nad hashom primljenih bajtova).
6. Samo za novi prihvat: `acceptsEvidence`, limit paketa, `verifyCanonicalEvidencePayloadV2`, hash i veličina jednaki deskriptoru, `descriptorMatchesSegment`.
7. `payloadStore.putImmutable` (ključ iz ustanove koju je poslužitelj razriješio) pa `repository.reserve` (u produkciji jedan RPC: CAS revizija i rezervacija, BACKEND §4.1).
8. `signAcceptedRecord`: potpis preko `SigningKeyProvider`, provjera potpisa, `attachSignature`. Danas to izdaje potvrdu v1 (potpis nad JCS bajtovima payloada). BACKEND §4.1 to izričito kaže: "dotad gateway izdaje v1".

Rekonstrukcija (`reconstructAndCompareEvidence`): čitanje lanca i glave, čitanje bajtova po `segmentHash`, `verifyEvidenceChainV2` prema glavi, potvrde i potpisi svakog odsječka, početni prekid (`findEvidenceStartBreakV2`), replay samo do prvog prekida, usporedba JCS-a s ciljnim dokumentom. Ishodi: `match`, `mismatch` (razlog i indeks), `discontinuity`, `no_evidence`, `unavailable`. Samo `match` pušta predaju (PRODUCT §5 pravilo 11, BACKEND §4.6).

Potvrda v2 (domena, još ne spojena u gateway): `digestEvidenceReceiptPayloadV2` -> `D = SHA-256(JCS(payload))` -> ulaz potpisa `UTF-8("ductus-evidence-receipt-v2") ‖ 0x0A ‖ D` (59 B) -> provjera `verifySignedEvidenceReceiptV2` s očekivanjem i popisom ključeva koje pozivatelj ima iz drugog izvora nego sam odgovor.

## 4. Invarijante

1. Hash dokumenta i odsječka je SHA-256 nad UTF-8 bajtovima RFC 8785 oblika; ključevi po UTF-16 jedinicama, bez normalizacije Unicodea, bez praznina; usamljeni surogat, nekonačan broj, ciklus, rijetki niz, ne-obični objekt, accessor i vrijednost dublja od 256 razina nemaju kanonski oblik. Izvor: BACKEND §4.1 "Hash dokumenta", STATE.md B-8. Test: `jcs.test.ts`, `golden-vectors.test.ts`, `canonicalization.property.test.ts`.
2. Granica dubine 256 (`MAX_JCS_DEPTH`) i `MAX_EVIDENCE_PROFILE_ID_LENGTH = 120` dio su formata v2: mijenjaju se samo novom verzijom formata, na klijentu i poslužitelju zajedno, nikad samo konstantom. Izvor: BACKEND §4.1 "Granice formata v2 (B-8b)". Test: `jcs.test.ts` ("nesting limit"), `evidence-segment-v2.test.ts`, `evidence-receipt.test.ts`.
3. Nepoznata polja se odbijaju: odsječak, događaj, `captureContext`, deskriptor, naredba (nema polja uz `clientRequestId`, `descriptor`, `canonicalPayload`, pa ni principala), potvrda i potpisna omotnica, ključ, očekivanje, konfiguracija pohrane. Izvor: BACKEND §6 t. 2, STATE.md B-8. Test: `evidence-segment-v2.test.ts`, `evidence-ingest.test.ts`, `evidence-receipt.test.ts`, `signature.test.ts`, `evidence-storage-config.test.ts`.
4. Jedna granica veličine odsječka, 2 MiB (2 097 152 bajta kanonskih bajtova), ista konstanta za klijent i poslužitelj (`MAX_EVIDENCE_SEGMENT_BYTES`); paket smije imati niži limit, nikad viši. Provjera ide prije parsiranja i prije enkodiranja predugog niza. Izvor: D-96, STATE.md B-8. Test: `evidence-chain-v2.test.ts`, `evidence-ingest.test.ts`, `evidence-gateway.test.ts`, zlatni `sizeLimit`.
5. Poslužitelj prihvaća samo bajtove koji su, bajt po bajt, kanonski JCS valjanog odsječka; hash se računa nad primljenim bajtovima strogo dekodiranima kao UTF-8 (nevaljan niz i BOM su `invalid`), nikad nad hashom koji klijent navede. Izvor: ARCHITECTURE §5 t. 3.2, BACKEND §4.1 "Ponovno slanje". Test: `evidence-chain-v2.test.ts`, `evidence-chain-v2.property.test.ts`, `golden-vectors.test.ts` (`segmentPayloads.rejected`).
6. Ponovno slanje pod istim principalom, paketom i `clientRequestId`: isti deskriptor i isti bajtovi je `duplicate` (izvorna potvrda, bez nove pohrane, rezervacije i potpisa); isti deskriptor, drukčiji bajtovi je `invalid`; drukčiji deskriptor je `idempotency_conflict`. Autorizacija ide prije lookupa. Izvor: BACKEND §4.1 (DAN-46). Test: `evidence-chain-v2.test.ts` (`decideEvidenceRetry`), `evidence-gateway.test.ts`.
7. Autor odsječka dolazi iz sesije, nikad iz polja klijenta; ustanova u ključu objekta dolazi iz retka paketa na poslužitelju, nikad iz zahtjeva. Izvor: ARCHITECTURE §5 t. 3.1, BACKEND §4.1. Test: `evidence-gateway.test.ts`, `evidence-domain-id.test.ts`, `evidence-object-key.test.ts`.
8. Odsječak ne nosi vrijeme po događaju ni `elapsedMs`; `observedStartedAt`/`observedEndedAt` su cijele UTC minute oblika `YYYY-MM-DDTHH:mm:00.000Z`, nikad zaokružene u čitaču. Izvor: D-24 dopuna, D-56, PRODUCT §5 pravilo 4 i §9. Test: `golden-vectors.test.ts` ("time in a segment"), `evidence-segment-v2.test.ts`.
9. Atribucija promjene je zatvoren skup `EVIDENCE_SOURCES_V2`; `editor` i `composition` samo uz pozitivan dokaz, inače `keyless-input` ili `unattributed`; poslužitelj atribuciju ne vidi. Izvor: komentar iznad `EVIDENCE_SOURCES_V2` (D-54); PRODUCT §5 pravila 3 i 9 vrijede (nepoznato je praznina, hash nije dokaz autorstva). Test: `evidence-segment-v2.test.ts`.
10. Lanac: svaki odsječak imenuje hash prethodnika (`null` za prvi), isti dokument; glava = zadnji hash i broj odsječaka. `ok: true` znači samo da su bajtovi oni na koje se glava obvezuje; prekide niza ili dokumenta pozivatelj uspoređuje s zabilježenim prazninama, `regression` nikad nije zabilježena praznina. Izvor: komentar `verifyEvidenceChainV2`, D-11. Test: `evidence-chain-v2.test.ts`, `evidence-chain-v2.property.test.ts`.
11. Potvrda v2 se potpisuje čistim Ed25519 nad točno 59 bajtova D-92; nikad nad JCS tekstom ni golim digestom. Digest funkcija baca za payload koji nije v2, pa v2 ulaz potpisa ne postoji za v1 zapis. Izvor: D-92, BACKEND §4.1. Test: `evidence-receipt-v2.test.ts` (uključuje test koji drži BACKEND.md i JSON vektore jednakima), `golden-vectors.test.ts`.
12. v1 i v2 ostaju odvojeni po `receiptSchema`; v2 potpisnik se ne smije primijeniti na v1 zapis; `pending_signature` v1 završava na v1 putu. Izvor: D-92, BACKEND §4.1 "Kompatibilnost v1/v2". Test: `evidence-receipt-v2.test.ts` ("stay apart").
13. Provjera potvrde v2 nikad ne baca i ne pogađa: ključ pripada domeni iz potpisanog sadržaja i ima namjenu `receipt`; opozvan ključ ne potvrđuje ništa; umirovljen ključ vrijedi samo za `acceptedAt < validTo`; zapis ključa s vremenom koje nije cijela minuta nije ključ; `domain_mismatch` i `commit_mismatch` smiju se dati samo za potvrdu čiji je potpis provjeren; `principalId` i `segmentHash` uspoređuje pozivatelj. Očekivanje i popis ključeva moraju doći iz izvora različitog od odgovora s potvrdom. Izvor: D-102, D-71, BACKEND §4.1 (odluke 11. 10.), komentar `verifySignedEvidenceReceiptV2`. Test: `evidence-receipt-verifier.test.ts`, `ed25519-encoding.test.ts`.
14. Potvrda v2 nosi `revision`, `clientTransactionId`, `evidenceDomainId` (UUID v4 malim slovima, neproziran, nikad izveden iz ustanove ili vremena) i `principalId`; `revision` i `clientTransactionId` znače "commit u kojem je odsječak prihvaćen", pa nijedan kod ne smije pretpostaviti jednu potvrdu po reviziji. Izvor: D-102, BACKEND §4.1. Test: `evidence-receipt-v2.test.ts` ("limits of the four fields").
15. Objekt se piše pod `v2/<institutionId>/<paket>/<hash>.json`, bez prepisivanja i brisanja; postojeći objekt je `existing` tek nakon bajt-po-bajt usporedbe, a `stored` tek uz echo SHA-256 checksuma i čitanje natrag. Svaka dvojba je `unavailable`; adapter ne ponavlja i ne slijedi preusmjeravanja. Izvor: ARCHITECTURE §5 t. 3.2, BACKEND §4.1, D-102 (spremnik po domeni). Test: `s3-evidence-payload-store.test.ts`, `evidence-object-key.test.ts`, integracijski `s3-evidence-payload-store.integration.test.ts`.
16. Domena pohrane je jedna ustanova u jednoj regiji; nema zadanog ni zajedničkog spremnika; ustanova bez domene nema pohranu; dvije domene ne dijele ustanovu, spremnik ni pristupni ključ (zajednički ključ samo uz `loopback-only`, nikad u produkciji); krajnja točka je https (http samo na loopback); tajne su zapečaćene (`S3SecretCredentials`) i ne vide se ni kroz JSON, `inspect` ni nabrajanje. Izvor: D-102, BACKEND §4.1, §6 t. 10. Test: `evidence-storage-config.test.ts`, `s3-signature.test.ts`.
17. Adapter S3 se ne koristi bez potvrđene sposobnosti (uvjetni upis i echo checksuma, uz datum i oznaku ugovornog testa) i s rokom `requestTimeoutMs` bez zadane vrijednosti. Izvor: BACKEND §6 t. 10 (konfiguracijska brava); detalji "provedeno u kodu, izvor u dokumentu nije nađen" (oznake #155, P2, P9, S14 u komentarima su iz plana napada). Test: `s3-evidence-payload-store.test.ts`, `evidence-storage-config.test.ts`.
18. Potpisnik: u produkciji KMS (`ED25519_SHA_512`, `RAW`), materijal ključa ne napušta KMS; razvojni potpisnik odbija produkciju; KMS adapter potpisuje i provjerava samo za konkretne dopuštene verzije ključa i odbija poruku veću od 4096 B ili praznu. Potpisuje worker, web proces nema pravo potpisa (iznimka: demo, D-98 dopuna (a)). Izvor: ARCHITECTURE §8, D-71, D-98. Test: `development-ed25519-signer.test.ts`, `aws-kms-ed25519-signer.test.ts`.
19. Rekonstrukcija ne gleda preko prekida, ne zaključuje iz praznog zapisa (`no_evidence` nikad nije `match`), a pad ovisnosti je `unavailable`, ne presuda. Izvor: D-11, PRODUCT §5 pravilo 11, STATE.md B-12. Test: `evidence-thin-slice.test.ts`, `evidence-golden-vectors.test.ts`.
20. Integritet nije dokaz autorstva i u sučelju se ne tvrdi više od "zapis je cjelovit i neizmijenjen od primitka". Izvor: PRODUCT §5 pravilo 9 i rječnik zabranjenih izraza.

## 5. Kako napraviti promjenu

Sve u ovom području je `critical` (`docs/ENGINEERING_SYSTEM.md` §5: evidence, hash/JCS, potpisi, KMS, rekonstrukcija; floor po putanji `evidence`, `forensics`, `crypto`, `signing`, `JCS`, `replay`; cijeli `tests/` je najmanje `critical`). To znači: neovisni review i zaseban QA PASS na aktualnom headu (§5), plan napada prije koda (`ductus-attack-plan`) i ostalo što za `critical` PR navodi kartica uloge `.claude/uloge/pisac-backend.md`, sintetički staging prolaz kad vrijedi BACKEND §6 t. 12. Putanje iz D-97 u ovom području nema.

### 5.1 Promjena kanonizacije, granice ili polja odsječka
1. Zaustavi se: to je promjena formata v2 (BACKEND §4.1). Treba odluku vlasnika i novu verziju formata; klijent i poslužitelj zajedno.
2. Ako je odluka dana: izmijeni validator i `*_KEYS` skupove u `evidence-segment-v2.ts`, deskriptor u `ports/evidence-ingest.ts`, outbox i `descriptorMatchesSegment` u gatewayu.
3. Zlatne vektore (`golden-vectors/evidence-v2.json`) ne generiraj iz koda koji se testira (komentar u `load.ts`); očekivane vrijednosti dolaze izvana. Promjena vrijednosti je promjena ugovora i ide kao zaseban critical zadatak (kao u BACKEND §4.1 za vrijeme po događaju).
4. Dodaj negativni test koji bi prošao bez zaštite, zatim dokaz da zaštita odbija (`docs/TESTING.md` §5), plus property test.

### 5.2 Promjena potvrde (v2, nova polja, provjeravatelj)
1. Polje potvrde je dio potpisanog sadržaja: nova polja mijenjaju vektor. BACKEND §4.1 kaže da je v2 vektor mijenjan jednom, prije prvog stvarnog potpisa. Svaka daljnja promjena traži odluku.
2. Ažuriraj `evidence-receipt.ts`, `evidence-receipt-verifier.ts`, `golden-vectors/evidence-v2.json` i vektor u `docs/BACKEND.md` §4.1 zajedno; `evidence-receipt-v2.test.ts` pada ako se dokument i JSON razilaze.
3. Gateway, RPC i tablice domena i ključeva dolaze zasebnim PR-ovima (BACKEND §4.1). Ne spajaj v2 u gateway uz promjenu formata u istom PR-u.

### 5.3 Promjena pohrane (adapter, domene, ključ objekta)
1. Ključ objekta mijenja samo `evidenceObjectKey`; `storageRef` nosi oznaku domene, nikad URL, krajnju točku ni ime spremnika.
2. S3 adapter: svaka nova grana mora imati provjeru roka prije zahtjeva i prije svakog ishoda koji nešto tvrdi o sadržaju (komentar `WritePhase`). Ne dodaj ponavljanje, brisanje ni multipart.
3. Konfiguracija: novo polje ide u `TOP_FIELDS`/`DOMAIN_FIELDS`, poruke grešaka nikad ne nose vrijednost.
4. Testovi: jedinični (`s3-evidence-payload-store.test.ts`, `s3-signature.test.ts`, `evidence-storage-config.test.ts`), integracijski protiv lokalnog stoga. Pohranu za produkciju ugovorni test mora potvrditi posebno (komentar u integracijskom testu).
5. Novi pozivatelj `putImmutable` osim gatewayja ponovno otvara ugovor adaptera i traži vlastiti plan napada (BACKEND §4.1, odluka 11. 10., komentar 6109015743).

### 5.4 Novi format koraka ili replayer
1. Format koraka je dio formata evidencije (`captureContext.transactionFormat`); novi format traži odluku i novu verziju.
2. Replayer implementira `EvidenceStepReplayerV2`: `apply` primjenjuje korak točno ili baca, nikad ne pogađa; `toCanonical` daje JSON čiji je JCS hashiran. STATE.md B-12: replay za delete/cut/replace mora provjeriti hash uklonjenog raspona (vidi 7).
3. Test: nesklad hasha nakon događaja mora dati `document_hash_mismatch`, ne tihi nastavak (`evidence-thin-slice.test.ts`).

### 5.5 Potpisnik ili ključevi
1. `SigningKeyProvider` nema domenu ni namjenu; D-102 traži ključeve po domeni. Prošireni port je promjena ugovora; potpisnik pritom ne smije dobiti drugu poruku nego D-92 59 B (potvrde) ili točan C2SP tekst (kontrolna točka, val 2).
2. KMS adapter ne piše vlastiti AWS potpis; transport se injektira. Test mora pokriti rotaciju (povijesna verzija se provjerava, neprovjerena se ne koristi za potpis).
3. Računi dobavljača (AWS KMS) su u Owner queue; ne gradi na pretpostavci da postoje.

### 5.6 Što ne raditi u ovom području
Ne dodavati tablice ni RPC-e ovdje (`ductus-new-table`); ne koristiti stvarne radove i osobne podatke u fixtureima (`ductus-synthetic-data`); ne mijenjati `package.json` (kartica Backend); ne primjenjivati migracije na produkciju.

## 6. Provjera

Naredbe iz `package.json`:
- `pnpm lint`, `pnpm typecheck`
- `pnpm test:unit` (vitest projekt `unit`: `src/**/*.test.ts` i `tests/unit/**`, bez `*.property.test.ts` i `*.integration.test.ts`)
- `pnpm test:property` (projekt `property`, `FC_NUM_RUNS` skalira, `tests/property/setup.ts`)
- sužen opseg: `pnpm exec vitest run --project unit src/domain/forensics` (ili `src/application/evidence`, `src/adapters`); property: `pnpm exec vitest run --project property src/domain/forensics`
- integracija S3: `pnpm stack:up`, zatim `pnpm test:integration` (projekt `integration`, RustFS na `127.0.0.1:9100` iz `compose.yaml`); `pnpm stack:down` na kraju. Agent smije pokrenuti stog samo ako mu uloga to dopušta.

CI (`.github/workflows/ci.yml`): posao "Lint, typecheck, test and build" pokreće lint, typecheck, `test:unit`, `test:property` i build; posao "Local stack (compose.yaml)" pokreće `pnpm test:db` i `pnpm test:integration` (uz e2e). Zahtjev "svi testovi zeleni prije commita" je u `CLAUDE.md`; nikad ne brisati ni preskakati test bez jednakovrijedne zamjene.

## 7. Zamke

- Dva sloja: `ledger`/`integrity`/`replay` (v1, `canonicalize` bez RFC 8785 provjera) i v2 (`jcs.ts`, `evidence-*-v2`). Novi kod koristi samo `canonicalizeJcs`; `integrity.canonicalize` je za povijesne v1 hasheve.
- `src/domain/evidence/basis.ts` nije evidencija zapisa (2.3).
- Receipt v1 i v2 imaju različit `acceptedAt`: v1 puni trenutak, v2 početak UTC minute. Ne dijeli provjere među njima (`evidence-receipt.ts`).
- Duljine se mjere u UTF-16 jedinicama (`value.length`) za tekstove, a veličina odsječka u UTF-8 bajtovima; mješanje daje pogrešnu granicu.
- `sequenceTo - sequenceFrom === eventCount - 1` (ne `from + count - 1`): zbrajanje može zaokružiti u doublu (komentari u validatorima).
- Nikad ne dekodiraj tijelo zahtjeva sam prije `verifyCanonicalEvidencePayloadV2`; predaj `Uint8Array` (komentar funkcije).
- Čitač lanca mora vratiti glavu i listu iz istog snimka; lista skraćena zajedno s glavom izgleda kao cijeli kraći zapis (`ports/evidence-reconstruction.ts`).
- `ok: true` verifikatora potvrde ne kaže da je tvoj odsječak prihvaćen: usporedi `payload.segmentHash` i `principalId` sam.
- Zlatni vektori: datoteka je ASCII s LF krajevima i čita se `JSON.parse` iz bajtova, ne importom (bundler može prepisati ključ `__proto__`).
- Podrazumijevani identifikatori još nose staro ime: razvojni potpisnik ima `keyId` `pisac-dev-ed25519`, komentari spominju "Pisač". D-88: shema evidencije je `ductus-evidence-*`; ne vraćaj `pisac-evidence-*`.
- Hash lanac i JCS ne dokazuju autorstvo; ne dodaj tekst sučelja ni nazive koji to sugeriraju (PRODUCT §5, rječnik).
- Tajne i ključevi nikad u repou ni u porukama grešaka i logovima; adapter bilježi samo ID-ove i hasheve, nikad sadržaj (BACKEND §4.9, komentar `warn`). Javni RFC 8032 testni seed postoji samo za testove.
- Nova datoteka u `tests/` je `critical` bez dopune popisa (`ENGINEERING_SYSTEM.md` §5).

## 8. Otvoreno (ne graditi na ovome)

- D-08, dio o dobavljačima i trošku (UpCloud, Scaleway, AWS KMS): PRIJEDLOG do provjere B0.1, rok 16. 11. 2026. Koncept domene pohrane je odlučen, konkretan dobavljač nije. Računi dobavljača su u Owner queue.
- D-72 (dnevni korijen, RFC 3161 žig) i ARCHITECTURE §8a: PRIJEDLOG, val 2; log po domeni evidencije (D-93, D-102). Ništa danas ne pretpostavlja globalni brojač, redoslijed ni spremnik.
- Razmak kontrolnih točaka "oko 2.000 koraka": PRIJEDLOG, potvrđuje se uz B0.3 (ARCHITECTURE §5). B-12 za demo ide bez tablice kontrolnih točaka (D-98 dopuna (b)).
- D-96: 2 MiB je "privremena" vrijednost; mijenja se samo novom odlukom, na obje strane.
- Inventar v1 potvrda (D-92): read-only popis `signed` i `pending_signature` u stvarnim trajnim izvorima nije proveden; dok nije, v1 verifikator i v1 potpisni put ostaju.
- Nije izvedeno (BACKEND §4.1): pravilo "ključ pripada domeni i ima namjenu potvrde" za `attach_signature`; javni popis domena; postupak uvođenja nove ustanove (spremnik, ključevi, konfiguracija); opis kopija bucketa (§4.7) nije usklađen s podjelom po domeni.
- Gateway izdaje v1; v2 je samo u domeni; RPC, tablice domena i ključeva te stvarni adapter prihvata su zasebni PR-ovi (STATE.md: #247 potvrda v2, #245 domene pohrane po ustanovi). Spajanje domene pohrane je u dijelovima (B-8i B2, "1/3").
- Ključ ustanove u tablicama rada, dokumenta, evidencije i predaje (D-103): migracija preduvjeta ide kao zaseban critical PR (#240); vidi `docs/vodici/baza.md`.
- Provjera identiteta spremnika (`verifyIdentity`) postoji, ali nisam našao pozivatelja (nema composition roota).
- Owner queue: "Vidljivost repoa" (prije stvarnih podataka), D-56 (reprodukcija s ritmom, pravno mišljenje), izvršitelj obrade prema ustanovi. Ne dodaji bilježenje ritma.
