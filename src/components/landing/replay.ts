/**
 * Pure model of the landing replay: an invented sequence of edits turned into
 * the successive texts of one paragraph. A step is a position in the sequence,
 * never a time (PRODUCT §5 rule 4): there is no clock, speed or pause here.
 */
export type ReplayEdit =
  | { readonly kind: "append"; readonly text: string }
  | { readonly kind: "replace"; readonly from: string; readonly to: string };

/** Applies one edit; a replace whose `from` is absent is a model error. */
export function applyEdit(text: string, edit: ReplayEdit): string {
  if (edit.kind === "append") return text + edit.text;
  const at = text.indexOf(edit.from);
  if (at < 0) throw new Error(`Replay edit does not apply: "${edit.from}"`);
  return text.slice(0, at) + edit.to + text.slice(at + edit.from.length);
}

/** Frame 0 is the empty paragraph, frame i the text after the first i edits. */
export function buildFrames(edits: readonly ReplayEdit[]): string[] {
  const frames = [""];
  for (const edit of edits) {
    frames.push(applyEdit(frames[frames.length - 1] ?? "", edit));
  }
  return frames;
}

export function clampStep(step: number, frameCount: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.max(0, Math.min(frameCount - 1, Math.trunc(step)));
}

/** Invented text only (synthetic data rule); no real work is involved. */
export const SAMPLE_EDITS: readonly ReplayEdit[] = [
  { kind: "append", text: "Gradovi" },
  { kind: "append", text: " sve" },
  { kind: "append", text: " češće" },
  { kind: "append", text: " mijenjaju" },
  { kind: "append", text: " pravila" },
  { kind: "append", text: " prometa." },
  { kind: "replace", from: "sve češće", to: "sve češće, ali neujednačeno," },
  { kind: "append", text: " Najviše" },
  { kind: "append", text: " se" },
  { kind: "append", text: " mijenja" },
  { kind: "append", text: " parkiranje." },
  { kind: "replace", from: "Najviše se mijenja parkiranje.", to: "Najčešće se mijenja parkiranje u središtu." },
  { kind: "replace", from: "Gradovi", to: "Europski gradovi" },
];
