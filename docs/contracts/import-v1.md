# Uvoz v1: zapis uvoza, manifest, granice, naziv datoteke i potvrda pregleda

DAN-436, plan rb128 M8.0-S1, `Risk: critical`. Ovo je ugovor uvoza za M8. Kod uz njega su domenski tipovi i testovi koji ga pribijaju (`src/domain/provenance/import/`); nema UI-ja, tablice ni RPC-a. Tablicu `import_event`, RLS, pgTAP matricu i RPC gradi M8.2 po ovom ugovoru.

Podjela: proizvodni kod prelazi 300 redaka, pa se po potvrdi ugovora na #1836 isporučuje u dva PR-a. Prvi nosi ovaj dokument, manifest (§2), naziv datoteke (§3) i granice (§4). Drugi, složen na prvi, nosi potvrdu pregleda (§5, `confirmation.ts`).

Izvori:
- D-290, D-291 i D-292 (odgovori O2, O4 i O5 za M8);
- D-269 O8, D-198 t. 1, 5 i 7, D-24, D-281, D-282;
- `docs/contracts/evidence-segment-v4.md` (izvor `import`, oblik manifesta, B3, B5);
- `docs/ARCHITECTURE.md` (tablica `import_event`, „Uvoz”), `docs/spikes/M8.1-P03.md` (granice DOCX-a);
- B-8 (`STATE.md`) i `docs/backend/evidencija.md` §4.1.

Plan napada je #1911 (M1 do M16, N1 do N9, P1 do P9, E1 do E4, L1 do L4). Ovaj ugovor ga ne ponavlja, nego se poziva na njegove oznake.

**Status:** sve što je ovdje novo je PRIJEDLOG dok ga ne potvrdi review ovog ugovora (D-290, D-291, D-292). Formati v2, v3, v4 i `evidence-receipt-v2` se ne mijenjaju; njihovi golden vektori ostaju bajt po bajt isti (E3).

## 1. Zapis `import_event` (gradi M8.2)

Jedan redak po pripremljenom uvozu. Stvara ga poslužitelj; klijent ga ne piše izravno, samo kroz RPC.

| Polje | Značenje |
| --- | --- |
| `import_id` | UUID v4, jedinstven; isti kao `importId` u manifestu i u događaju `import` odsječka v4 |
| `owner_id`, `document_id` | vlasnik (student) i dokument; potvrda drugog vlasnika ili dokumenta vraća isto što i nepostojeći uvoz (P4) |
| `base_revision` | revizija dokumenta nad kojom je uvoz pripremljen (P9) |
| `manifest` | kanonski JCS bajtovi manifesta (§2) |
| `manifest_sha256` | SHA-256 tih bajtova; čuva se uz manifest, nikad u njemu |
| `import_kind`, `file_format`, `raw_byte_length` | preslika iz manifesta za upite i prikaz; izvor istine je manifest |
| `file_name` | normalizirani naziv (§3) ili `NULL`; izvan svakog hasha |
| `state` | `pending`, `confirmed` ili `cancelled` |
| `prepared_at` | vrijeme pripreme na poslužitelju; ne ulazi u manifest ni odsječak |
| `confirmed_event_id` | id događaja `import` nakon potvrde; jedinstven (E2) |

Vidljivost: student vidi svoje retke; mentor vidi projekciju (vrsta, format, veličina, naziv, potvrda) kroz postojeći put pristupa dokumentu (`docs/ARCHITECTURE.md`). Tablica dobiva RLS i retke u pgTAP matrici u M8.2.

## 2. Manifest `ductus-import-manifest-v1` i tri hasha

Oblik je zadan u `docs/contracts/evidence-segment-v4.md`; ovaj ugovor ga ne mijenja, nego pribija pravila čitanja (`manifest-v1.ts`).

Tri hasha:
1. `rawSha256`: SHA-256 primljenih bajtova datoteke;
2. `contentSha256`: SHA-256 kanonskog sadržaja koji ulazi u dokument;
3. `manifestSha256`: SHA-256(JCS(manifest)), mala heksadekadska slova. Događaj `import` odsječka v4 nosi ga kao `importManifestSha256`.

Pravila:
- Zatvoren skup ključeva. Nepoznat ključ, uključujući `author`, `fileName`, `email` i sam `manifestSha256`, odbija se (M1, M16; v4 B5).
- `traces` je obvezan uz `docx` (može biti prazan), a uz `pdf` ga nema ni kao `[]` (M8, M9). Najviše tri traga, svaka vrsta jednom, `count` ≥ 1, redom `comment`, `deletion`, `insertion` (redoslijed kodnih jedinica, isti kao JCS).
- `savedAt` samo uz `cloud-version`, cijela UTC minuta (D-24, M10). `cloud-version` je samo `docx`.
- Bajtovi manifesta moraju biti točno JCS bajtovi pročitane vrijednosti. Drugi razmaci, redoslijed ključeva, dupli ključ ili drugi zapis broja odbijaju se kodom `MANIFEST_NOT_CANONICAL`; nikad se ne prepisuju (B-8, M12).
- B3: poslužitelj iz primljenih bajtova sam izračuna `rawSha256`, `rawByteLength`, `contentSha256` i tragove. Bilo koja razlika odbija cijeli uvoz. Prva razlika, stalnim redom, daje kod: `RAW_SHA256_MISMATCH`, `RAW_BYTE_LENGTH_MISMATCH`, `CONTENT_SHA256_MISMATCH`, `TRACES_MISMATCH` (M14).
- Odbijanje nosi samo kod, nikad vrijednost iz ulaza (D-198 t. 5).

Golden vektori: `src/domain/provenance/import/golden-vectors/import-manifest-v1.json`, izvedeni izvan koda (Python `json.dumps` s poredanim ključevima i `hashlib`), M13.

## 3. Naziv datoteke (D-292)

Odgovor na otvoreni dio D-292:
- **Gdje:** samo u stupcu `import_event.file_name`. Naziv nije u manifestu, ni u jednom hashu, ni u odsječku ni u potvrdi predaje (N8). Zato se format v4 ne mijenja, a naziv se može izbrisati ili skratiti bez diranja dokaza.
- **Normalizacija** (`normalizeImportFileName`), redom:
  1. zadnji dio putanje (dijeli se na `/` i `\`), N1;
  2. uklanjaju se usamljeni surogati (N6), zatim nevidljivi znakovi `\p{Cc}`, `\p{Cf}`, `\p{Zl}`, `\p{Zp}`: kontrole C0 i C1, DEL, bidi kontrole, znakovi nulte širine (N2);
  3. NFC (N3); nevidljivi znakovi idu prije NFC-a, inače znak između slova i kombinirajućeg znaka ostavlja oblik koji nije NFC;
  4. razmaci se sažimaju u jedan i obrezuju;
  5. najviše **200 kodnih točaka**; rez je uvijek na granici kodne točke, a rezultat se ponovno čisti (N4);
  6. prazan rezultat, `.` ili `..` daje `NULL`: uvoz ide bez naziva (N5).
- Funkcija je idempotentna (N9, svojstveni test).
- Prikaz je uvijek tekstualni; naziv nikad ne ide u HTML bez escapea (N7). To provjerava M8 sučelje.
- **Čuvanje** prati D-30 (PRIJEDLOG, Q-16); ovaj ugovor ne gradi na njemu.

## 4. Granice (D-291)

Nijedna granica ovdje nije nova; review zapisuje brojeve.

| Granica | Vrijednost | Izvor |
| --- | --- | --- |
| `rawByteLength` | 1 do 2 MiB (`MAX_EVIDENCE_SEGMENT_BYTES`) | D-291: postojeća granica B-8 |
| Čitanje DOCX-a | `DEFAULT_DOCX_LIMITS` iz M8.1, s `maxInputBytes` = 2 MiB; 2000 ZIP unosa, 16 MiB po dijelu, 256 MiB ukupno, omjer 200, dubina XML-a 128 | `docs/spikes/M8.1-P03.md` |
| Pozivatelj | smije samo pooštriti granice uvoza (`resolveImportDocxLimits`), L3; opći `resolveDocxLimits` dopušta do 64 MiB, pa ga uvoz ne koristi izravno | M8.1 |
| Životni vijek pripreme | 60 minuta od `prepared_at`; poslije toga `EXPIRED` | ovaj ugovor |
| Broj stranica PDF-a | otvoreno do M8.3 | D-291 |

Sadržaj veći od granice odsječka odbija se, ne skraćuje (L2, B-8). Greška granice nosi samo kod (L4).

## 5. Idempotentna potvrda pregleda

Student pregleda uvoz i potvrdi ga. RPC u M8.2 uzme zaključavanje retka `import_event`, pozove čistu odluku `decideImportConfirmation` i tek onda zapiše događaj ili vrati postojeći.

Redoslijed odluke je stalan:
1. nema retka, drugi vlasnik, drugi dokument ili drugi `importId`: `NOT_FOUND` (P4; stranac ne doznaje postoji li uvoz);
2. `confirmed` s istim `manifestSha256`: `already-confirmed` s istim id-jem događaja, i nakon isteka, promjene revizije ili isključenog uvoza (P1, P8); s drugim hashom `MANIFEST_MISMATCH` (P2);
3. `cancelled`: `CANCELLED` (P3);
4. `pending`: drugi hash `MANIFEST_MISMATCH`, istek `EXPIRED` (P3), isključen uvoz `IMPORT_NOT_ALLOWED` (P7, D-282), druga revizija `REVISION_CHANGED` (P9), inače `confirm`.

Nekonzistentan redak (npr. `confirmed` bez id-ja događaja) nikad se ne potvrđuje.

### Istodobnost

Ne primjenjuje se u ovom PR-u: odluka je čista funkcija bez stanja. M8.2 mora imati negativni test u kojem dvije istodobne potvrde istog uvoza daju točno jedan događaj, a druga dobiva `already-confirmed` (P5). Zaštita su zaključavanje retka i jedinstveni `import_id` i `confirmed_event_id`. Odjava između pripreme i potvrde (P6) odbija se postojećom ogradom sesije u RPC-u M8.2.

## 6. Vezanje uz odsječak v4

- Događaj `import` mora upućivati na potvrđeni uvoz istog `importId` i istog `importManifestSha256`; inače se odbija (E1). Provjerava M8.2.
- Jedan potvrđeni uvoz veže najviše jedan događaj (E2).
- Uvezeni tekst nikad nije `observed` (E4).

## 7. Otvorena pitanja

- O1 i O3 plana M8: ugovor na njima ne gradi.
- Zamjenjuje li M8.0-S1 korak M8.9 (oba nose DAN-436; #1836).
- Je li 2 MiB dovoljno za stvarne DOCX-e sa slikama; broj zapisuje review (D-291).
- Čuvanje naziva datoteke: D-30 (PRIJEDLOG, Q-16).
