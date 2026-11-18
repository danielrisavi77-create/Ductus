import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { createEditStepsV2Replayer } from "@/adapters/evidence/edit-steps-v2-replayer";
import type { CanonicalDocumentV2, DocumentSource } from "@/domain/document";
import type { EvidenceEventV3 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import type { CapturedChange } from "./capture";
import { changeOfV2, changeStepsV2 } from "./capture-v2";
import { canonicalToTiptapV2, tiptapToCanonicalV2 } from "./interop-v2";
import { createEditorExtensionsV2 } from "./schema";

/**
 * Test harness of DAN-620 b: the real v2 editor, every change it applies as
 * `changeOfV2` records it, and the replayer of `ductus-edit-steps-v2` fed the
 * steps `changeStepsV2` writes. Invented ids, sources and filler text only.
 */

export const IDS = ["a", "b", "c"].map((x) => `${x.repeat(8)}-0000-4000-8000-${x.repeat(12)}`);
export const SRC_1 = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const SRC_2 = "22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const book = (id: string, title: string) =>
  ({
    id, type: "book", authors: [{ kind: "person", family: "Izmisljena", given: "Ana" }],
    year: 2020, title, place: "Zagreb", publisher: "Nakladnik",
  }) as unknown as DocumentSource;

/**
 * A heading "Naslov" (0–8), a paragraph "Ab" + citation + "Cd" (8–15: text
 * 9–11, citation 11, text 12–14), a paragraph citation with a locator + " Ef"
 * (15–21: citation 16, text 17–20).
 */
export const START = {
  schemaVersion: 2,
  nodes: [
    { type: "heading", id: IDS[0], level: 1, children: [{ type: "text", text: "Naslov", marks: [] }] },
    {
      type: "paragraph", id: IDS[1],
      children: [
        { type: "text", text: "Ab", marks: [] },
        { type: "citation", sourceId: SRC_1 },
        { type: "text", text: "Cd", marks: [] },
      ],
    },
    {
      type: "paragraph", id: IDS[2],
      children: [{ type: "citation", sourceId: SRC_2, locator: "str. 4" }, { type: "text", text: " Ef", marks: [] }],
    },
  ],
  sources: [book(SRC_1, "Prva knjiga"), book(SRC_2, "Druga knjiga")],
} as unknown as CanonicalDocumentV2;

export type V2Harness = { editor: Editor; changes: CapturedChange[] };

/** A headless v2 editor on `START` whose every change is recorded. */
export function v2Harness(start: CanonicalDocumentV2 = START): V2Harness {
  const editor = new Editor({ element: null, extensions: createEditorExtensionsV2(), content: canonicalToTiptapV2(start) });
  // A headless editor is never mounted, so its plugins are put on the state here.
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const changes: CapturedChange[] = [];
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    if (all.some((tr) => tr.docChanged)) changes.push(changeOfV2(all, "editor", 0));
  });
  return { editor, changes };
}

/** The canonical form of a document of the v2 editor; a block without an id is an error, never minted. */
export function canonicalOf(json: unknown): JcsJsonValue {
  const candidate = tiptapToCanonicalV2(json, () => {
    throw new Error("a block without an id");
  });
  if (!candidate.ok) throw new Error(`not canonical: ${JSON.stringify(candidate.errors)}`);
  return candidate.doc as unknown as JcsJsonValue;
}

export type Replayed = {
  /** The steps written for each change, in order. */
  written: JcsJsonValue[][];
  /** After each change: the replayer's document and the editor's, both canonical. */
  after: { replayed: JcsJsonValue; editor: JcsJsonValue }[];
};

/**
 * Writes every change and replays it as an event of its own on the document
 * the replayer loaded from `start`. Throws what capture or the replayer throws.
 */
export async function replayChanges(changes: readonly CapturedChange[], start: CanonicalDocumentV2 = START): Promise<Replayed> {
  const replayer = createEditStepsV2Replayer();
  let state = replayer.load(start as unknown as JcsJsonValue);
  const written: JcsJsonValue[][] = [];
  const after: Replayed["after"] = [];
  for (const change of changes) {
    const steps = await changeStepsV2(change);
    written.push(steps);
    if (steps.length > 0) {
      const event = {
        sequence: written.length, source: change.source, steps,
        beforeDocumentHash: "0".repeat(64), afterDocumentHash: "0".repeat(64),
      } as unknown as EvidenceEventV3;
      state = replayer.apply(state, event);
    }
    after.push({ replayed: replayer.toCanonical(state) as unknown as JcsJsonValue, editor: canonicalOf(change.after.toJSON()) });
  }
  return { written, after };
}
