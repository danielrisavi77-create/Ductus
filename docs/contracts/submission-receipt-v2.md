# Potvrda predaje v2 — format sa zasebnim vremenom potpisa

DAN-87, korak #592. Izvedba ovog koraka: payload, digest i provjera forme.
Izvor vlasnikove odluke i tehničke ovlasti: [#385/6369678892](https://github.com/danielrisavi77-create/Ductus/issues/385#issuecomment-6369678892) i [#385/6369963862](https://github.com/danielrisavi77-create/Ductus/issues/385#issuecomment-6369963862).
V1 iz BACKEND §4.1 ostaje neizmijenjen. Produkcijski issuer i browser još nisu prebačeni na v2.

## Payload i vrijeme

receiptSchema je `ductus-submission-receipt-v2`. Payload ima točno 16 vlastitih, enumerabilnih podatkovnih polja: svih 15 polja potvrde predaje v1, uz novi obvezni signedAt i novu vrijednost receiptSchema. Nepoznata i nedostajuća polja, simboli, neenumerabilna polja i getteri odbijaju se. Pravila za zajednička polja ostaju jednaka v1.

| Polje | Značenje |
| --- | --- |
| requestedAt | Izvorni DB trenutak zahtjeva; određuje rok i čuva se kroz ponovne pokušaje. |
| dueAt | Rok verzije zadatka koju zahtjev imenuje. |
| afterDeadline | Isključivo requestedAt > dueAt; točno u roku je na vrijeme. |
| signedAt | Zasebni DB trenutak zamrzavanja payload-a pokušaja izdavanja potpisa, nakon uspješne rekonstrukcije i usporedbe. |

signedAt je kanonski UTC `YYYY-MM-DDTHH:mm:ss.ffffffZ`, stvarni datum sa šest decimala. Mora biti signedAt >= requestedAt. Usporedba čuva mikrosekunde. Potpis izdan nakon dueAt ne mijenja afterDeadline ako je zahtjev bio na vrijeme.

DB sat za signedAt mora dati poslužitelj, nikad klijent. Vrijeme označuje početak izdavanja zamrznutog potpisa; ne tvrdi neovisno dokazani fizički trenutak dovršetka KMS poziva ili TSA žig. POST predaje ostaje `{documentId, revision}`.

## Digest i potpis

`D = SHA-256(JCS(payload))`; Ed25519 RAW ulaz: `UTF-8("ductus-submission-receipt-v2") || 0x0A || D`, točno 61 bajt, digest kao 32 sirova bajta.
signedAt je dio potpisanog payload-a. V1/v2 potvrde predaje i potvrde odsječaka evidencije imaju različite prefikse; ne mogu se međusobno prihvaćati.
Omotnica ima točno payload, payloadDigestSha256 i postojeću Ed25519 signature omotnicu.

`isSignedSubmissionReceiptV2` je samo provjera forme. Ne provjerava potpis, izvor signedAt, očekivanu predaju, registar ključeva ili valjanost ključa. `digestSubmissionReceiptPayloadV2` računa točne bajtove, bez dokaza prihvata predaje.

## Obvezni zasebni implementacijski koraci

Prije aktivacije v2 poslužiteljski tok mora nakon rekonstrukcije zamrznuti signedAt, payload/digest i ključ kroz uski RPC; mrežni potpisnik poziva se izvan kratke DB transakcije. Završni RPC mora ponovno provjeriti isti ključ i svježi DB sat te atomarno vezati potvrdu. Prelazak validTo tijekom potpisa ne izdaje prihvaćenu potvrdu.

Budući verifier provjerava pouzdani registry i očekivani tuple iz autoriziranog serverskog konteksta, Ed25519, domenu, namjenu receipt, keyId/keyVersion i neopozvanost. Za ovaj format pravilo je validFrom <= signedAt i signedAt < validTo kad validTo postoji; validTo je isključiv. Opozvan ključ odbija se bez obzira na vrijeme. To ne mijenja acceptedAt pravilo potvrde odsječka evidencije.

Uspješna potvrda pohranjuje se i vraća bajt-identično na ponovni HTTP pokušaj; izvorni requestedAt/revizija ostaju. Neuspjeli pokušaj potpisa može dobiti novi signedAt i aktivni ključ, uz isti zahtjev. Mismatch/tamper i nedostajuća obvezna potvrda blokiraju po postojećem ugovoru. Stari v1 zapisi zahtijevaju inventar i izričit prijelaz; nema dopisivanja vremena ili novog prefiksa postojećem potpisu.

Ovaj modul još nema produkcijskog pozivatelja. Navedeni issuer/RPC, pohrana, registry/expected provjera i browser prihvat zahtijevaju zasebnu implementaciju i critical review/QA. Novi format sam ne daje SYNCED ili uspješnu predaju.

## Sintetički kontrolni vektor

Javni RFC 8032 testni ključ 1, kao u postojećem v1 testu; nema stvarnog ključa ili osobnih podataka. Vektor je izračunan izvan modula i provjeren Node crypto i OpenSSL-om. Repo test uspoređuje sve sljedeće vrijednosti.

Payload JCS: `{"afterDeadline":false,"artifactSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","assignmentId":"3b7e2f4a-9c1d-4e8b-a5f6-0d2c4b6a8e91","assignmentVersion":1,"documentId":"doc-1","dueAt":"2026-11-02T11:00:00.000000Z","evidenceDomainId":"d21fe0a3-103c-42e5-a29e-c102f9030af5","evidenceHeadSegmentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","evidencePackageId":"evidence-1","evidenceRecord":"continuous","principalId":"72cd1705-85fc-4754-a382-c2500d038368","receiptSchema":"ductus-submission-receipt-v2","requestedAt":"2026-11-02T10:58:00.123456Z","revision":7,"signedAt":"2026-11-02T10:59:00.654321Z","submissionId":"c4a1e9d2-7b3f-4a65-8e0c-1f2d3b4c5a69"}`

SHA-256: `b8bed7b0129d597cbdd9903b020e2bdcff4c7b46cba8a4ac673b4126a6188408`

RAW ulaz (61B): `6475637475732d7375626d697373696f6e2d726563656970742d76320ab8bed7b0129d597cbdd9903b020e2bdcff4c7b46cba8a4ac673b4126a6188408`

Ed25519 potpis: `99e40777eea0f9208d735442a1f72231f9b678d22f20842b2a91f956f0c1ee7776ce9d5eddc1c2d28041461b9d4c4115eb701172b9d4d782489215095a1a5009`

Javni ključ SPKI DER: `302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`

