import {
  DOCUMENT_SCHEMA_VERSION,
  DOCUMENT_SCHEMA_VERSION_V2,
  newNodeId,
  paragraphNode,
  type CanonicalDocument,
  type CanonicalDocumentV2,
  type NodeId,
} from "./schema";

/**
 * Revision 0 of every work (docs/BACKEND.md 4.10 t. 3): the editor's empty
 * document, one empty paragraph. Its node id is fixed rather than random, so
 * every new work starts from the same bytes and the same hash, which
 * `app.open_student_work` stores and the reconstruction at submission (B-12)
 * starts from. Changing any of the three values below changes D-98 addendum
 * (b) and is a question for the owner.
 */
export const REVISION_ZERO_NODE_ID: NodeId = newNodeId(
  () => "00000000-0000-4000-8000-000000000000",
);

export function revisionZeroDocument(): CanonicalDocument {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    nodes: [paragraphNode(REVISION_ZERO_NODE_ID)],
  };
}

/** Exact JCS text (RFC 8785) of revision 0; its UTF-8 bytes are stored. */
export const REVISION_ZERO_JCS =
  '{"nodes":[{"children":[],"id":"00000000-0000-4000-8000-000000000000","type":"paragraph"}],"schemaVersion":1}';

/** SHA-256 of the UTF-8 bytes of `REVISION_ZERO_JCS`, lowercase hex. */
export const REVISION_ZERO_SHA256 =
  "a102ced8a59b446a86c135c8d87d3ddf9f889e4ac93bcbc1857cd7c2c73ad14b";

/**
 * Revision 0 of a work of document v2 (docs/contracts/document-schema-v2.md
 * §6): the same empty paragraph with the same fixed id, and no sources. The
 * v1 constants above stay as they are and keep serving every v1 work.
 */
export function revisionZeroDocumentV2(): CanonicalDocumentV2 {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION_V2,
    nodes: [paragraphNode(REVISION_ZERO_NODE_ID)],
    sources: [],
  };
}

/** Exact JCS text (RFC 8785) of the v2 revision 0; its UTF-8 bytes are stored. */
export const REVISION_ZERO_V2_JCS =
  '{"nodes":[{"children":[],"id":"00000000-0000-4000-8000-000000000000","type":"paragraph"}],"schemaVersion":2,"sources":[]}';

/**
 * SHA-256 of the UTF-8 bytes of `REVISION_ZERO_V2_JCS`, lowercase hex. Taken
 * from the golden vector, computed outside this code, never recomputed here.
 */
export const REVISION_ZERO_V2_SHA256 =
  "8f8aa5047daa07e8d68f4952aa70ab3c671eccdf6191bfaf6dcba591735f2618";
