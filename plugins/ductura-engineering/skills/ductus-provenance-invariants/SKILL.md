---
name: ductus-provenance-invariants
description: Check Ductus evidence canonicalization, hashes, signatures, segment/request identity, ordering, receipts and replay against actual source at a full revision. Use for evidence chains, retries, changed payloads, tamper/gaps and reconstruction claims; do not infer authorship.
---

# Provjeri invarijante evidencije

1. Primijeniti [zajedničke operacije](../../references/project-operations.md). Odabrati puni source SHA i pročitati prihvaćene `docs/BACKEND.md` §4.1/4.2/4.6/§6, `docs/PRODUCT.md` §5 te stvarni ugovor i primjenjive testove iz [mape izvora](../../references/source-map.md). Kandidat i main označiti zasebno.
2. Imenovati sloj i identitet. `EvidenceEventV2` nema ID: slijed je unutar segmenta; `sessionId`/`segmentId` su na segmentu. U aplikacijskom ingestu imenovati `clientRequestId` i stvarni opseg iz repository adaptera, ne generički globalni event ID. `ForensicEvent` v1 za replay ima drukčiji oblik; ne zamjenjivati ga evidence-v2 događajem ili audit export-v1 omotnicom.
3. Pratiti wire payload → validirani segment → kanonski JCS UTF-8 bajtovi/hash → descriptor → immutable pohrana točnih bajtova → reserve/chain → receipt digest/signature → replay gdje je podržan. Potvrditi što stvarni validator odbija; ne prenositi politiku unknown fields iz jednog tipa na sve. Za sintetičke sažetke koristiti postojeće `digestEvidenceSegmentV2`, outbox builder i receipt/crypto utilities, bez novog kripto algoritma.
4. Provjeriti valjani lanac, ponovljeni isti request/sadržaj, isti request/promijenjeni sadržaj, kontrolirani tamper ili rupu u **poznatom očekivanom** slijedu i replay mismatch. Koristiti [sirove scenarije](assets/raw-scenarios.json); to su ulazi za odvojenu evaluaciju, ne izvedeni rezultati. Sačuvati originalne bajtove i svaki ishod. Primjenjive postojeće testove odabrati iz mape; SQL/HTTP/objektna pohrana/KMS ostaju zasebne granice čak kad in-memory gateway prođe.
5. Kod replaya usporediti stvarni rezultat s izričito zadanim checkpointom i odabranim događajima. Pročitati ograničenja `applyForensicEvent`/`replayUntil`; postojanje removed-range hash polja ne dokazuje da ga kod provjerava. Nepodržan event ili zahtjev iz BACKEND-a bez implementacijskog dokaza označiti otvorenim i uputiti u zaseban zadatak.
6. Vratiti tablicu **invarijanta → stvarna proba/izvor na SHA → originalni rezultat → granica zaključka**, uz task, vrijeme, testirani head i pending slojeve. Integritet nije autorstvo, istinitost sadržaja ni potpuna povijest. Nikad opaženi događaji nisu otkrivi bez poznatog očekivanog slijeda ili vanjskog sidra; ne proizvoditi takvo sidro iz fixturea.

Opcionalni `audit-writing-process` koristiti samo za autorizirani izvoz s izričitim mapiranjem polja, identiteta/opsega, vremena, slijeda, pokrivenosti i gubitaka. Odsutna polja ostaviti odsutnima; ne dodavati offline marker ili tvrdnju potpune povijesti. Ne kopirati B01 odgovore ni dijagnoze.
