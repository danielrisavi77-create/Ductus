// @vitest-environment node
import { Editor, getSchema } from "@tiptap/core";
import { Node as PmNode, type NodeSpec, type Schema } from "@tiptap/pm/model";
import { Step } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";

import { createEditorExtensionsV2 } from "../../editor/schema";

import { editStepsV2Schema } from "./edit-steps-v2-rules";

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

/** What decides a node's JSON: content, group, inline, atom, marks and attributes. */
function shape(spec: NodeSpec, dropSources = false) {
  const attrs = Object.entries(spec.attrs ?? {})
    .filter(([name]) => !(dropSources && name === "sources"))
    .map(([name, attr]) => [name, Object.hasOwn(attr, "default") ? { default: attr.default } : {}]);
  return {
    content: spec.content ?? "",
    group: spec.group ?? "",
    inline: spec.inline === true,
    atom: spec.atom === true,
    marks: spec.marks,
    attrs: Object.fromEntries(attrs),
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

  it("have the same marks in the same order", () => {
    expect(Object.keys(editorSchema().marks)).toEqual(Object.keys(editStepsV2Schema().marks));
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
