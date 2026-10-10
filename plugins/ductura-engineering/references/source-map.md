# Mapa izvora i primjenjivih provjera

Opaženo 2026-10-06. Ovo je datirani locator, ne zamjena za čitanje aktualnog ciljnog repoa. Main odabran za fixtures: `ac65c71d797e29417d3d0f07aa9bd7ad63f2ff06`. Izvore projekta čitati iz target repoa ili dolje navedenih SHA URL-ova; nisu bundlani escaping putanjama. Svaki SKILL izravno povezuje ovu mapu i sirove ulaze. Ne kopirati cijeli kod/test suite.

## Prihvaćeni main: provenance

Repo root: https://github.com/danielrisavi77-create/Ductus/tree/ac65c71d797e29417d3d0f07aa9bd7ad63f2ff06

| Stvarni entrypoint/putanja | Postojeća proba i granica |
| --- | --- |
| `src/domain/forensics/evidence-segment-v2.ts`: is/assert/canonical/digestEvidenceSegmentV2 | `evidence-segment-v2.test.ts`, `jcs.test.ts`, `canonicalization.property.test.ts`, `crypto.test.ts`; native evidence-v2 shape, JCS/hash i slijed unutar segmenta. |
| `src/application/evidence/evidence-outbox.ts`: buildEvidenceIngestCommandV2; `evidence-gateway.ts`: EvidenceGateway.ingest | `evidence-outbox.test.ts`, `evidence-gateway.test.ts`, `src/application/ports/evidence-ingest.test.ts`; descriptor, exact canonical payload, receipt i retry u application/in-memory granici. |
| `src/adapters/evidence/in-memory-evidence-acceptance-repository.ts`: lookup/reserve | Ključ `[principalId, evidencePackageId, clientRequestId]`; descriptor equality određuje retry/conflict ovoga adaptera. Ne izjednačiti s CommitRequest ključem. |
| `src/domain/forensics/evidence-receipt.ts`, `signature.ts` | `signature.test.ts` i gateway testovi; shape check sam ne verificira potpis. Development signer nije stvarni KMS. |
| `src/domain/forensics/ledger.ts`: ForensicEvent v1; `replay.ts`: applyForensicEvent/replayUntil | `replay.test.ts`, `forensics.test.ts`; druga shema od evidence-v2, podržani replay subset; provjeriti actual code za removed-range hash obvezu. |
| `src/adapters/crypto/aws-kms-ed25519-signer.ts` | Pripadajući `.test.ts` nije dokaz poziva stvarnom AWS KMS-u. SQL/HTTP/immutable object store ostaju zasebni. |

Iz root-a ciljnog repoa postoje `pnpm lint`, `pnpm typecheck`, `pnpm test`; za usku unit probu postoji `pnpm exec vitest run --project unit <stvarna .test.ts putanja>`. Pročitati package.json/config prije uporabe; ne tvrditi da je naredba izvedena iz samog locatora.

## Sync: main i kandidat odvojeno

Na mainu postoje `src/domain/sync/journal-types.ts`, `states.ts`, `restore.ts`, `labels.ts`; probe `states.test.ts`/`labels.test.ts`. `src/domain/document/validate.ts` i `transaction.ts` imaju pripadajuće testove; `src/domain/serverSync/contract.ts` ima `contract.test.ts`, bootstrap/checkpoints zasebne probe. Journal tip nije implementirani storage adapter.

DAN-25 grana `frontend/dan-25-hardening` opažena na `b11ed8392dde2f722866d116b5a5bf0ea1f5da6a` je **kandidat**, ne prihvaćeni main: https://github.com/danielrisavi77-create/Ductus/tree/b11ed8392dde2f722866d116b5a5bf0ea1f5da6a/src/domain/sync

Potvrđene putanje: `drain.ts` (planDrain/outcomeToEvents/ackedRevision/fastForwardBase), `drain.test.ts`, `drain.hardening.test.ts`, `recovery.ts` (planRecovery), `recovery.test.ts`, `recovery.hardening.test.ts`, `conflict.ts`/`conflict.test.ts`. Pure planeri ne pišu journal. Komentari o `src/lib/journal/`/`src/lib/sync/drainRunner.ts` nisu dokaz prisutnog/izvedenog adaptera: potvrditi actual tree prije storage/browser tvrdnje. Sendability barijere i puna replacement semantika vrijede samo za provjereni kandidat.

## Identity: prihvaćena pravila, candidate SQL

Na mainu `src/application/ports/authorization.ts` definira AuthorizationCheck/Port i consistency, ne implementira cjelokupni can()/RLS model. Autoritet su `docs/BACKEND.md` §4.3/4.4 i `docs/PRODUCT.md`, ne R2 model.

| Kandidat (oba opažena open draft, merged=false) | Potvrđene putanje; opseg |
| --- | --- |
| [#39 P-4](https://github.com/danielrisavi77-create/Ductus/pull/39), head `aac95bd5f87f81d410d0b502898658ef20710bec` | `db/migrations/20261003200000_baseline.sql`, `db/tests/000-harness.sql`; harness nije matrica content ovlasti. |
| [#46 B-5a](https://github.com/danielrisavi77-create/Ductus/pull/46), head `6700605bf035b626984ee7b173b0dcbc53bc0fe7` | `db/migrations/20261003210000_roles.sql`, `db/migrations/20261003210100_identity_session.sql`, `db/tests/010-roles-and-privileges.sql`, `db/tests/020-identity-session.sql`; roles/current_actor/session grant/RLS testovi, ne document can() ni pool wrapper. |

#46 PR base je opažena grana `claude/ductus-platform-session-39ak8b`, metadata base SHA `0980f2f5d619b41397c32dc3221d157fbe2e1ea1`, dok je aktualni #39 head drukčiji. Prije evaluacije osvježiti stack/head i ne proglasiti stale bazu aktualnom. Canonical main base nije izveden iz tog podatka. RLS probe zahtijevaju stvarni Postgres; prihvat i merge provjerava koordinator.
