// @vitest-environment node
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { Slice, type Node as PmNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { build, type Rollup } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

import { replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceEventV2, EvidenceSegmentV2, EvidenceStepV2 } from "@/domain/forensics/evidence-segment-v2";
import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import { createBrowserEditStepsV1Replayer, removedRangeSha256WebCrypto } from "./edit-steps-v1-browser-replayer";
import { createEditStepsV1Replayer, removedRangeSha256 } from "./edit-steps-v1-replayer";

/**
 * Granica 8 (#638): the browser replayer gives the server's results. Each
 * case runs through the Node replayer and through the browser entry bundled
 * by Vite for the browser and run in a `vm` context that has only browser
 * globals (Web Crypto and TextEncoder; no process, Buffer or require).
 */

// Synthetic only: invented ids and filler text, no real work or person.
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "aaaaaaaa-0000-4000-8000-000000000002";
const C = "aaaaaaaa-0000-4000-8000-000000000003";
const D = "aaaaaaaa-0000-4000-8000-000000000004";
const OTHER_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
/** BACKEND 4.1: removedSha256 of "Odlomak B", the whole heading text of `start`. */
const KNOWN_ANSWER = "90d4f8aa06a3d89df35caec6d423df7e3f221ba5d01e33ffc23ecaa232c815bf";

const text = (value: string) => ({ type: "text", text: value, marks: [] });
const paragraphs = (...values: string[]): JcsJsonValue => ({
  schemaVersion: 1,
  nodes: values.map((value, i) => ({ type: "paragraph", id: [A, B, C][i], children: value ? [text(value)] : [] })),
});
const start: JcsJsonValue = {
  schemaVersion: 1,
  nodes: [
    { type: "paragraph", id: A, children: [text("Odlomak A lorem.")] },
    { type: "heading", id: B, level: 2, children: [text("Odlomak B")] },
    { type: "paragraph", id: C, children: [text("Odlomak C ipsum.")] },
  ],
};

const server = createEditStepsV1Replayer();
const browser = createBrowserEditStepsV1Replayer();
const schema = server.load(start).type.schema;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const docHash = (document: PmNode) => {
  try {
    return sha(canonicalizeJcs(server.toCanonical(document)));
  } catch {
    return OTHER_HASH;
  }
};

/** What capture does: ProseMirror's steps, plus the hash of each removed range. */
function capture(document: PmNode, edit: (tr: Transform) => void): { steps: unknown[]; after: PmNode } {
  const tr = new Transform(document);
  edit(tr);
  const steps = tr.steps.map((step, i) => {
    const json = step.toJSON() as Record<string, unknown>;
    const [from, to] = [json.from as number, json.to as number];
    if (json.stepType === "replace" && to > from && !json.structure) {
      json.removedSha256 = removedRangeSha256(tr.docs[i], from, to);
    }
    return JSON.parse(JSON.stringify(json)) as unknown;
  });
  return { steps, after: tr.doc };
}

const event = (steps: unknown[], sequence: number, before: string, after: string): EvidenceEventV2 => ({
  sequence, source: "editor", steps: steps as EvidenceStepV2[], beforeDocumentHash: before, afterDocumentHash: after,
});

/** One segment of one event; the after hash is what the edit really produces. */
function segmentOf(initial: JcsJsonValue, steps: unknown[], after: PmNode | null, sequence = 1, format = "ductus-edit-steps-v1") {
  const initialHash = docHash(server.load(initial));
  const afterHash = after ? docHash(after) : OTHER_HASH;
  return {
    initialDocumentHash: initialHash,
    finalDocumentHash: afterHash,
    events: [event(steps, sequence, initialHash, afterHash)],
    captureContext: { editorModel: "prosemirror", transactionFormat: format },
  } as EvidenceSegmentV2;
}

type Case = { name: string; initial: JcsJsonValue; steps: unknown[]; after?: PmNode };
const doc = server.load(start);
const edit = (name: string, change: (tr: Transform) => void, initial: JcsJsonValue = start): Case => {
  const { steps, after } = capture(server.load(initial), change);
  return { name, initial, steps, after };
};
const forge = (base: Case, name: string, change: (step: Record<string, unknown>) => void): Case => {
  const steps = structuredClone(base.steps) as Record<string, unknown>[];
  change(steps[0]);
  return { name, initial: base.initial, steps, after: base.after };
};
const raw = (name: string, steps: unknown[], initial: JcsJsonValue = start): Case => ({ name, initial, steps });
const nfc = paragraphs("čž".normalize("NFC"));
const nfd = paragraphs("čž".normalize("NFD"));
const empty = paragraphs("x", "", "y");
const del = edit("deleting a range", (tr) => tr.delete(19, 28));
const setType = edit("changing a block type", (tr) => tr.setBlockType(1, 1, schema.nodes.heading, { level: 1, nodeId: A }));
const open = { content: [{ type: "heading", attrs: { level: 2, nodeId: B } }, { type: "paragraph", attrs: { nodeId: null } }],
  openStart: 1, openEnd: 1 };
const same = { stepType: "replaceAround", from: 18, to: 29, gapFrom: 19, gapTo: 28, insert: 1, structure: true,
  slice: { content: [{ type: "heading", attrs: { level: 2, nodeId: B } }] } };

const accepted: Case[] = [
  edit("deleting one character", (tr) => tr.delete(27, 28)),
  del,
  edit("cutting across blocks", (tr) => tr.delete(10, 33)),
  edit("replacing a range", (tr) => tr.replaceWith(19, 27, schema.text("Zamjena"))),
  edit("deleting a whole block", (tr) => tr.delete(18, 29)),
  edit("joining two blocks", (tr) => tr.join(18)),
  edit("splitting and naming the new block", (tr) =>
    tr.split(5, 1, [{ type: schema.nodes.paragraph, attrs: { nodeId: null } }]).setNodeAttribute(6, "nodeId", D)),
  setType,
  edit("a mark across a block boundary", (tr) => tr.addMark(16, 22, schema.marks.bold.create())),
  edit("typing", (tr) => tr.insert(19, schema.text("Novo "))),
  edit("deleting an empty block", (tr) => tr.delete(3, 5), empty),
];
const refused: [Case, string][] = [
  [forge(del, "a forged removed hash", (s) => (s.removedSha256 = OTHER_HASH)), "removed_range_hash"],
  [forge(del, "the hash of a shifted range", (s) => (s.removedSha256 = removedRangeSha256(doc, 20, 29))), "removed_range_hash"],
  [forge(del, "the hash after the step", (s) => (s.removedSha256 = removedRangeSha256(del.after!, 18, 19))), "removed_range_hash"],
  [raw("an NFD hash of NFC text", [{ stepType: "replace", from: 1, to: 3,
    removedSha256: removedRangeSha256(server.load(nfd), 1, 5) }], nfc), "removed_range_hash"],
  [raw("text removed under structure", [{ stepType: "replace", from: 2, to: 4, structure: true }]), "removed_range_record"],
  [raw("a hash on a join", [{ stepType: "replace", from: 17, to: 19, removedSha256: OTHER_HASH }]), "removed_range_record"],
  [raw("an empty block removed as structure", [{ stepType: "replace", from: 3, to: 5, structure: true }], empty),
    "removed_range_record"],
  [raw("a position outside the document", [{ stepType: "replace", from: 999, to: 999,
    slice: { content: [{ type: "text", text: "a" }] } }]), "position_outside_document"],
  [raw("a position inside a surrogate pair", [{ stepType: "replace", from: 3, to: 3, slice: { content: [{ type: "text", text: "x" }] } }],
    paragraphs("a😀b")), "position_splits_surrogate_pair"],
  [raw("attr on the document", [{ stepType: "attr", pos: 0, attr: "nodeId", value: D }]), "attr_identity"],
  [raw("attr on a block with an id", [{ stepType: "attr", pos: 3, attr: "nodeId", value: D }]), "attr_identity"],
  [forge(setType, "replaceAround that takes another id", (s) => {
    (s.slice as { content: { attrs: Record<string, unknown> }[] }).content[0].attrs.nodeId = C;
  }), "replace_around_identity"],
  [raw("replaceAround that changes nothing", [same]), "replace_around_unchanged"],
  [raw("replaceAround over a wrong range", [{ ...same, from: 0, gapFrom: 1 }]), "replace_around_range"],
  [edit("a pasted tail with an existing id", (tr) => tr.replace(5, 5, new Slice(doc.content.cut(0, 29), 1, 1))),
    "open_end_block"],
  [raw("an open start that does not repeat its block", [{ stepType: "replace", from: 5, to: 5, structure: true,
    slice: open }]), "open_start_block"],
  // A wrong hash and a wrong open start: the hash is checked first, on both sides.
  [raw("a wrong hash before a wrong open start", [{ stepType: "replace", from: 5, to: 7, removedSha256: OTHER_HASH,
    slice: open }]), "removed_range_hash"],
  [raw("a step that changes nothing", [{ stepType: "removeMark", from: 1, to: 5, mark: { type: "bold" } }]),
    "step_changes_nothing"],
  [raw("a step ProseMirror cannot apply", [{ stepType: "replace", from: 18, to: 18,
    slice: { content: [{ type: "text", text: "x" }] } }]), "step_does_not_apply"],
  [raw("an unknown field", [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "a" }] }, ts: 5 }]),
    "unknown_field"],
  [raw("no steps", []), "steps_empty"],
];

/** The outcome of `apply` on one side: the ProseMirror JSON, or the refusal code. */
const outcome = async (run: () => PmNode | Promise<PmNode>) => {
  try {
    return { doc: (await run()).toJSON() as unknown };
  } catch (error) {
    return { code: (error as { code?: string }).code ?? String(error) };
  }
};

type BrowserBundle = {
  apply(initial: string, event: string): Promise<string>;
  replay(initial: string, segments: string): Promise<string>;
  removedHash(initial: string, from: number, to: number): Promise<string>;
};

const ENTRY = "\0browser-entry";
const root = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The browser entry bundled for the browser. Every Node built-in it asks for,
 * even one Vite would drop or externalize "for browser compatibility", is
 * recorded, and so is every build warning; either fails the test.
 */
async function bundle(): Promise<{ code: string; warnings: string[]; nodeImports: string[] }> {
  const warnings: string[] = [];
  const nodeImports: string[] = [];
  const out = (await build({
    configFile: false,
    logLevel: "silent",
    root,
    resolve: { alias: [{ find: /^@\//, replacement: `${root.replaceAll("\\", "/")}src/` }] },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "node-built-ins",
      enforce: "pre",
      resolveId: (id) => void ((id.startsWith("node:") || builtinModules.includes(id)) && nodeImports.push(id)),
    }, {
      name: "browser-entry",
      // Vite makes the lib entry a path under `root`.
      resolveId: (id) => (id.endsWith("/browser-entry") || id.endsWith("\\browser-entry") ? ENTRY : null),
      // Inputs cross the vm boundary as JSON, so that every object is one of the bundle's own realm.
      load: (id) => id !== ENTRY ? null : `
        import { createBrowserEditStepsV1Replayer, removedRangeSha256WebCrypto } from "@/adapters/evidence/edit-steps-v1-browser-replayer";
        import { replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
        const replayer = createBrowserEditStepsV1Replayer();
        export async function apply(initial, event) {
          try {
            return JSON.stringify({ doc: (await replayer.apply(replayer.load(JSON.parse(initial)), JSON.parse(event))).toJSON() });
          } catch (error) {
            return JSON.stringify({ code: error.code ?? String(error) });
          }
        }
        export async function replay(initial, segments) {
          return JSON.stringify(await replayEvidenceSegmentsV2(JSON.parse(initial), JSON.parse(segments), replayer));
        }
        export function removedHash(initial, from, to) {
          return removedRangeSha256WebCrypto(replayer.load(JSON.parse(initial)), from, to);
        }`,
    }],
    build: {
      write: false,
      minify: false,
      lib: { entry: "browser-entry", formats: ["iife"], name: "ductusBrowser" },
      rollupOptions: { onwarn: (warning) => void warnings.push(String(warning.message ?? warning)) },
    },
  })) as Rollup.RollupOutput[];
  return { code: out[0].output[0].code, warnings, nodeImports };
}

/** Runs the bundle in a context with browser globals only. */
function load(code: string, crypto: unknown): BrowserBundle {
  const context = vm.createContext({ crypto, TextEncoder });
  vm.runInContext(`${code}\n;globalThis.ductusBrowser = ductusBrowser;`, context);
  return context.ductusBrowser as BrowserBundle;
}

let built: Awaited<ReturnType<typeof bundle>>;
let inBrowser: BrowserBundle;
beforeAll(async () => {
  built = await bundle();
  inBrowser = load(built.code, globalThis.crypto);
}, 60_000);

const serverReplay = (initial: JcsJsonValue, segments: EvidenceSegmentV2[]) =>
  replayEvidenceSegmentsV2(initial, segments, server);
const browserReplay = async (initial: JcsJsonValue, segments: EvidenceSegmentV2[]) =>
  JSON.parse(await inBrowser.replay(JSON.stringify(initial), JSON.stringify(segments))) as unknown;

describe("browser bundle of the edit steps v1 replayer (granica 8, #638)", () => {
  it("bundles for the browser with no Node module", () => {
    expect(built.nodeImports).toEqual([]);
    expect(built.warnings).toEqual([]);
    expect(built.code).not.toMatch(/from\s*["']node:|require\(\s*["']|__vite-browser-external/);
    for (const name of ["process", "Buffer", "require", "module"]) {
      expect(vm.runInContext(`typeof ${name}`, vm.createContext({ crypto: globalThis.crypto, TextEncoder }))).toBe("undefined");
    }
  });

  it("pins the removed range hash of BACKEND 4.1 in Node, in the browser module and in the bundle", async () => {
    expect(removedRangeSha256(doc, 19, 28)).toBe(KNOWN_ANSWER);
    expect(await removedRangeSha256WebCrypto(doc, 19, 28)).toBe(KNOWN_ANSWER);
    expect(await inBrowser.removedHash(JSON.stringify(start), 19, 28)).toBe(KNOWN_ANSWER);
    // Across a block boundary: blocks, attributes and open sides.
    const across = removedRangeSha256(doc, 13, 23);
    expect(await removedRangeSha256WebCrypto(doc, 13, 23)).toBe(across);
    expect(await inBrowser.removedHash(JSON.stringify(start), 13, 23)).toBe(across);
  });

  it("replays the golden chain of evidence-v2.json to its last document hash on both sides", async () => {
    const { chain } = loadGoldenVectors();
    const initial = chain.documentStates[0].value;
    const segments = chain.segments.map((vector) => vector.segment);
    const expected = { ok: true, documentSha256: chain.documentStates.at(-1)!.sha256 };
    const onServer = await serverReplay(initial, segments);
    expect(onServer).toMatchObject(expected);
    expect(await browserReplay(initial, segments)).toEqual(onServer);
    expect(await replayEvidenceSegmentsV2(initial, segments, browser)).toEqual(onServer);
  });

  it.each(accepted.map((c) => [c.name, c] as const))("accepts %s on both sides alike", async (_name, c) => {
    const onServer = await outcome(() => server.apply(server.load(c.initial), event(c.steps, 1, "", "")));
    expect(onServer).toEqual({ doc: c.after!.toJSON() });
    const ev = JSON.stringify(event(c.steps, 1, "", ""));
    expect(JSON.parse(await inBrowser.apply(JSON.stringify(c.initial), ev))).toEqual(onServer);
    const segment = segmentOf(c.initial, c.steps, c.after!);
    const replayed = await serverReplay(c.initial, [segment]);
    expect(await browserReplay(c.initial, [segment])).toEqual(replayed);
  });

  it.each(refused.map(([c, code]) => [c.name, c, code] as const))("refuses %s with the same code on both sides",
    async (_name, c, code) => {
      const onServer = await outcome(() => server.apply(server.load(c.initial), event(c.steps, 1, "", "")));
      expect(onServer).toEqual({ code });
      const ev = JSON.stringify(event(c.steps, 1, "", ""));
      expect(JSON.parse(await inBrowser.apply(JSON.stringify(c.initial), ev))).toEqual(onServer);
      expect(await outcome(() => browser.apply(browser.load(c.initial), event(c.steps, 1, "", "")))).toEqual(onServer);
      const segment = segmentOf(c.initial, c.steps, c.after ?? null);
      const replayed = await serverReplay(c.initial, [segment]);
      expect(replayed).toEqual({ ok: false, reason: "step_failed", segmentIndex: 0, sequence: 1 });
      expect(await browserReplay(c.initial, [segment])).toEqual(replayed);
    });

  it("gives the same result for chains, breaks and documents the replay refuses", async () => {
    const first = segmentOf(start, del.steps, del.after!);
    const typed = capture(del.after!, (tr) => tr.insert(19, schema.text("Odlomak D")));
    const second = { ...segmentOf(start, typed.steps, typed.after, 2), initialDocumentHash: first.finalDocumentHash };
    second.events[0].beforeDocumentHash = first.finalDocumentHash;
    const cases: [string, JcsJsonValue, EvidenceSegmentV2[], object][] = [
      ["two chained segments", start, [first, second], { ok: true, documentSha256: second.finalDocumentHash }],
      ["a second segment that does not continue", start, [first, { ...second, initialDocumentHash: OTHER_HASH }],
        { ok: false, reason: "document_hash_mismatch", segmentIndex: 1, sequence: null }],
      ["a wrong initial hash", start, [{ ...first, initialDocumentHash: OTHER_HASH }],
        { ok: false, reason: "document_hash_mismatch", segmentIndex: 0, sequence: null }],
      ["a wrong after hash", start, [{ ...first, events: [{ ...first.events[0], afterDocumentHash: OTHER_HASH }] }],
        { ok: false, reason: "document_hash_mismatch", segmentIndex: 0, sequence: 1 }],
      ["an unknown transaction format", start, [segmentOf(start, del.steps, del.after!, 1, "ductus-edit-steps-v9")],
        { ok: false, reason: "unsupported_format", segmentIndex: 0, sequence: null }],
      ["an invalid initial document", { schemaVersion: 1, nodes: [] }, [first],
        { ok: false, reason: "invalid_document", segmentIndex: null, sequence: null }],
      ["an event that leaves a block without an id", start,
        [segmentOf(start, capture(doc, (tr) => tr.split(5, 1, [{ type: schema.nodes.paragraph, attrs: { nodeId: null } }])).steps, null)],
        { ok: false, reason: "step_failed", segmentIndex: 0, sequence: 1 }],
    ];
    for (const [name, initial, segments, expected] of cases) {
      const onServer = await serverReplay(initial, segments);
      expect(onServer, name).toMatchObject(expected);
      expect(await browserReplay(initial, segments), name).toEqual(onServer);
    }
  });

  it("keeps two replays apart when they run at the same time", async () => {
    const good = segmentOf(start, del.steps, del.after!);
    const bad = segmentOf(start, refused[0][0].steps, null);
    const runs = await Promise.all([good, bad, good, bad].map((segment) => browserReplay(start, [segment])));
    expect(runs).toEqual([
      await serverReplay(start, [good]), await serverReplay(start, [bad]),
      await serverReplay(start, [good]), await serverReplay(start, [bad]),
    ]);
  });

  it("fails closed without Web Crypto or when a digest fails", async () => {
    const segment = segmentOf(start, del.steps, del.after!);
    expect(await serverReplay(start, [segment])).toMatchObject({ ok: true });
    const replayIn = async (crypto: unknown) =>
      JSON.parse(await load(built.code, crypto).replay(JSON.stringify(start), JSON.stringify([segment]))) as unknown;
    expect(await replayIn(undefined)).toEqual({ ok: false, reason: "invalid_document", segmentIndex: null, sequence: null });
    expect(await replayIn({})).toEqual({ ok: false, reason: "invalid_document", segmentIndex: null, sequence: null });
    // Documents hash, removed slices (JCS of a Slice: `{"content":…`) do not.
    const subtle = globalThis.crypto.subtle;
    const failing = { subtle: { digest: (algorithm: string, bytes: Uint8Array<ArrayBuffer>) =>
      new TextDecoder().decode(bytes).startsWith('{"content"') ? Promise.reject(new Error("digest failed"))
        : subtle.digest(algorithm, bytes) } };
    expect(await replayIn(failing)).toEqual({ ok: false, reason: "step_failed", segmentIndex: 0, sequence: 1 });
  });
});
