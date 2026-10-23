import {
  DOCUMENT_SCHEMA_VERSION,
  newNodeId,
  paragraphNode,
  type CanonicalDocument,
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
