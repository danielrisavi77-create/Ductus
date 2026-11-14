// @vitest-environment node
import { Editor, getSchema } from "@tiptap/core";
import { Node as PmNode, type MarkSpec, type NodeSpec, type Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";

import type { DocumentSource } from "../../domain/document/schema";
import type { EvidenceEventV3 } from "../../domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "../../domain/forensics/jcs";
import { CITATION_UNMARK_META } from "../../editor/citation";
import { canonicalToTiptapV2, tiptapToCanonicalV2 } from "../../editor/interop-v2";
import { createEditorExtensionsV2 } from "../../editor/schema";

import { createEditStepsV2Replayer } from "./edit-steps-v2-replayer";
import { editStepJsonV2, editStepsV2Schema } from "./edit-steps-v2-rules";

/**
 * DAN-620 a: the v2 editor's schema and the replayer's v2 schema give the same
 * JSON, so a step the editor makes replays on the server. The one difference
 * is the editor's `sources` attribute on the document node, which the
 * replayer keeps outside the ProseMirror document. Invented ids and filler
 * text only.
 */

const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const SRC_1 = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const editorSchema = (): Schema => getSchema(createEditorExtensionsV2());

type AttrSpec = NonNullable<NodeSpec["attrs"]>[string];

/**
 * What decides an attribute: its default, and what `validate` admits. A
 * string rule is compared as it stands; a function only by being there, as
 * two modules never share one.
 */
function attrShape(attr: AttrSpec) {
  const validate = typeof attr.validate === "function" ? "function" : attr.validate;
  return {
    ...(Object.hasOwn(attr, "default") ? { default: attr.default } : {}),
    ...(validate === undefined ? {} : { validate }),
  };
}

/** What decides a node's JSON: content, group, inline, atom, marks and attributes. */
function shape(spec: NodeSpec, dropSources = false) {
  const attrs = Object.entries(spec.attrs ?? {})
    .filter(([name]) => !(dropSources && name === "sources"))
    .map(([name, attr]) => [name, attrShape(attr)]);
  return {
    content: spec.content ?? "",
    group: spec.group ?? "",
    inline: spec.inline === true,
    atom: spec.atom === true,
    marks: spec.marks,
    attrs: Object.fromEntries(attrs),
  };
}

/** What decides a mark's JSON and where it may go: attributes, exclusion, inclusivity and spanning. */
function markShape(spec: MarkSpec) {
  const attrs = Object.entries(spec.attrs ?? {}).map(([name, attr]) => [name, attrShape(attr)]);
  return {
    attrs: Object.fromEntries(attrs),
    excludes: spec.excludes,
    inclusive: spec.inclusive,
    spanning: spec.spanning,
  };
}

const CONTENT = [
  {
    type: "paragraph",
    attrs: { nodeId: ID_A },
    content: [
      { type: "text", text: "Ab" },
      { type: "citation", attrs: { sourceId: SRC_1, locator: "str. 4" } },
      { type: "text", text: "Cd" },
    ],
  },
];

describe("v2 editor schema and replayer schema", () => {
  it("have the same nodes in the same order, with the same shape", () => {
    const editor = editorSchema();
    const replayer = editStepsV2Schema();
    expect(Object.keys(editor.nodes)).toEqual(Object.keys(replayer.nodes));
    for (const name of Object.keys(replayer.nodes)) {
      expect([name, shape(editor.nodes[name]!.spec, name === "doc")]).toEqual([name, shape(replayer.nodes[name]!.spec)]);
    }
  });

  it("differ only by the document's sources attribute, empty by default", () => {
    expect(Object.keys(editorSchema().nodes.doc!.spec.attrs ?? {})).toEqual(["sources"]);
    expect(editorSchema().nodes.doc!.spec.attrs!.sources!.default).toEqual([]);
    expect(editStepsV2Schema().nodes.doc!.spec.attrs ?? {}).toEqual({});
  });

  it("have the same marks in the same order, with the same shape", () => {
    const editor = editorSchema();
    const replayer = editStepsV2Schema();
    expect(Object.keys(editor.marks)).toEqual(Object.keys(replayer.marks));
    for (const name of Object.keys(replayer.marks)) {
      expect([name, markShape(editor.marks[name]!.spec)]).toEqual([name, markShape(replayer.marks[name]!.spec)]);
    }
  });

  it("read each other's JSON back to the same JSON", () => {
    const fromEditor = PmNode.fromJSON(editorSchema(), { type: "doc", content: CONTENT });
    const fromReplayer = PmNode.fromJSON(editStepsV2Schema(), { type: "doc", content: CONTENT });
    expect(fromEditor.toJSON().content).toEqual(fromReplayer.toJSON().content);
    const withoutSources = { type: "doc", content: fromEditor.toJSON().content };
    expect(PmNode.fromJSON(editStepsV2Schema(), withoutSources).toJSON()).toEqual(fromReplayer.toJSON());
  });

  it("replay the editor's steps to the editor's document", () => {
    const editor = new Editor({ element: null, extensions: createEditorExtensionsV2(), content: { type: "doc", content: CONTENT } });
    try {
      let replayed = PmNode.fromJSON(editStepsV2Schema(), { type: "doc", content: CONTENT });
      const tr = editor.state.tr
        .insert(6, editor.schema.nodes.citation!.create({ sourceId: SRC_1 }))
        .addMark(1, 3, editor.schema.marks.bold!.create())
        .delete(3, 4)
        .insertText("ef", 4);
      for (const step of tr.steps) {
        const result = Step.fromJSON(editStepsV2Schema(), JSON.parse(JSON.stringify(step.toJSON()))).apply(replayed);
        expect(result.failed).toBeNull();
        replayed = result.doc!;
      }
      expect(replayed.toJSON().content).toEqual(tr.doc.toJSON().content);
    } finally {
      editor.destroy();
    }
  });
});

describe("v2 editor and replayer, a mark over a citation", () => {
  const BOOK = {
    id: SRC_1, type: "book", authors: [{ kind: "person", family: "Izmišljena", given: "Ana" }],
    year: 2020, title: "Naslov knjige", place: "Zagreb", publisher: "Nakladnik",
  } as unknown as DocumentSource;
  // "Ab" 1..3, the citation 3..4, "Cd" 4..6.
  const START = {
    schemaVersion: 2,
    nodes: [{
      type: "paragraph", id: ID_A,
      children: [{ type: "text", text: "Ab", marks: [] }, { type: "citation", sourceId: SRC_1 }, { type: "text", text: "Cd", marks: [] }],
    }],
    sources: [BOOK],
  };

  /** Bare or marked, each inline child of the first block, as `type:mark,mark`. */
  const inline = (doc: PmNode) => {
    const out: string[] = [];
    doc.firstChild!.forEach((child) =>
      out.push(`${child.isText ? child.text : child.type.name}:${child.marks.map((m) => m.type.name).join(",")}`));
    return out;
  };

  it("replays the editor's mark steps to the document the guard leaves, the citation bare in both", () => {
    const editor = new Editor({
      element: null,
      extensions: createEditorExtensionsV2(),
      content: canonicalToTiptapV2(START as never),
    });
    try {
      // A headless editor is never mounted, so its plugins are put on the state here.
      editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
      const seen: Transaction[] = [];
      editor.on("transaction", ({ transaction, appendedTransactions }) => seen.push(transaction, ...appendedTransactions));
      editor.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();
      editor.chain().setTextSelection({ from: 2, to: 5 }).toggleItalic().run();
      editor.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();
      expect(inline(editor.state.doc)).toEqual(["A:", "b:italic", "citation:", "C:italic", "d:"]);

      // What capture records: the user's steps, never the guard's own transaction.
      const own = seen.filter((tr) => tr.getMeta(CITATION_UNMARK_META) === true);
      expect(own.length).toBeGreaterThan(0);
      const steps = seen
        .filter((tr) => tr.getMeta(CITATION_UNMARK_META) !== true)
        .flatMap((tr) => tr.steps.map((step) => JSON.parse(JSON.stringify(editStepJsonV2(step.toJSON()))) as unknown));
      // A step of the editor's own does mark the citation: the replayer has to take the mark off.
      expect(steps).toContainEqual({ stepType: "addMark", from: 1, to: 6, mark: { type: "bold" } });

      const replayer = createEditStepsV2Replayer();
      const event = {
        sequence: 1, source: "editor", steps,
        beforeDocumentHash: "0".repeat(64), afterDocumentHash: "0".repeat(64),
      } as unknown as EvidenceEventV3;
      const replayed = replayer.apply(replayer.load(START as unknown as JcsJsonValue), event);
      expect(inline(replayed.doc)).toEqual(inline(editor.state.doc));
      const projected = tiptapToCanonicalV2(editor.getJSON());
      expect(projected.ok && projected.doc).toEqual(replayer.toCanonical(replayed));
    } finally {
      editor.destroy();
    }
  });
});
