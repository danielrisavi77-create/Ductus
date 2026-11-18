import { describe, expect, it } from "vitest";

import * as entry from "./index";

// DAN-927 (927-b1): the public names of the editor-core entry @/editor.
// A change here is a change of the package surface and needs review.
const PUBLIC_NAMES = [
    "ArrowCollapse", "BULLET_ITEM", "BULLET_ITEM_HTML_ATTRIBUTE", "BULLET_ITEM_HTML_VALUE", "BULLET_MARKER",
    "BulletItem", "CITATION", "CITATION_FORM_META", "CITATION_HTML_ATTRIBUTE",
    "CITATION_LOCATOR_HTML_ATTRIBUTE", "CITATION_SOURCE_HTML_ATTRIBUTE", "CITATION_UNMARK_META",
    "CaptureError", "ChapterNumbers", "Citation", "DEFAULT_PLACEHOLDER", "DocumentV2", "EVENT_QUIET_MS",
    "EvidenceRecorder", "F1_EXTENSION_NAMES", "F1_HEADING_LEVELS", "FIND_REPLACE_META", "FindReplaceHistory",
    "ID_CARRYING_TYPES", "INTEROP_ERROR_CODES", "MAX_REPLACE_ALL", "MAX_SEGMENT_EVENTS",
    "MAX_SEGMENT_SPAN_MS", "NODE_ID_ATTRIBUTE", "NODE_ID_HTML_ATTRIBUTE", "NO_OBSERVATION", "NodeIdentity",
    "QUOTE", "QUOTE_HTML_ATTRIBUTE", "QUOTE_HTML_VALUE", "QUOTE_MARKER", "Quote", "REMOVAL_MEMORY",
    "RepairRuns", "STANDALONE_SOURCES", "SourceObserver", "StorableInput", "V2_EXTENSION_NAMES",
    "anchorRange", "blockMarkerRule", "blockPosition", "bulletItemBackspace", "bulletItemEnter",
    "canonicalToTiptap", "canonicalToTiptapV2", "changeOf", "chapterNumbersOf", "collapsedByArrow",
    "commentHighlightKey", "commentHighlightPlugin", "countNodes", "countWords", "createAnchorPlacer",
    "createCitationGuard", "createEditorExtensions", "createEditorExtensionsV2", "createNodeIdentityPlugin",
    "createStorableInputPlugin", "currentHeading", "defaultIdFactory", "emptyHeadingBackspace",
    "headingOutline", "inlineToTiptap", "markerToBulletItem", "markerToQuote", "mintMissingIds",
    "nodeIdFixesOf", "numberedHeadings", "projectInline", "projectTiptapBlocks", "quoteBackspace",
    "quoteEnter", "recordWithSource", "removedSliceSha256", "repeatedNodeIds", "replaceAllTransaction",
    "replaceMatchTransaction", "replaceWithStoredDocument", "searchDocument", "sourceOfChange",
    "startFreshHistory", "storableDocument", "storableSlice", "storableText", "textBlockBackspace",
    "textBlockEnter", "tiptapToCanonical", "tiptapToCanonicalV2", "unmarkCitations", "withoutNodeIds",
    "writtenSteps",
];

describe("editor-core entry @/editor", () => {
  it("exposes exactly the agreed public names", () => {
    expect(Object.keys(entry).sort()).toEqual([...PUBLIC_NAMES].sort());
  });

  it("defines every public name", () => {
    for (const name of PUBLIC_NAMES) expect(entry[name as keyof typeof entry], name).toBeDefined();
  });

  it("keeps the shared marker helpers and the test fixture internal", () => {
    for (const name of ["markerRemoval", "markerToBlock", "recordedEditor", "typeChar", "replays"]) expect(name in entry, name).toBe(false);
  });
});
