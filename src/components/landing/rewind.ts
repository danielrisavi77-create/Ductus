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

/**
 * Reads the catalogue notation: "+text" appends, "from>>to" replaces. The
 * Croatian sample text lives in the i18n catalogue, not here.
 */
export function parseEdit(raw: string): ReplayEdit {
  if (raw.startsWith("+")) return { kind: "append", text: raw.slice(1) };
  const at = raw.indexOf(">>");
  if (at < 0) throw new Error(`Replay edit is neither append nor replace: "${raw}"`);
  return { kind: "replace", from: raw.slice(0, at), to: raw.slice(at + 2) };
}
