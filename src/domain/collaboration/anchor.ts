import type { NodeId } from "../document";

export type TextAnchor = {
  nodeId: NodeId;
  quote: string;
  prefix: string;
  suffix: string;
  startHint: number;
  endHint: number;
};

export type AnchorResolution =
  | { status: "exact"; start: number; end: number }
  | { status: "moved"; start: number; end: number }
  | { status: "ambiguous"; matches: number }
  | { status: "missing" };

export type CreateTextAnchorInput = {
  nodeId: NodeId;
  nodeText: string;
  start: number;
  end: number;
  contextLength?: number;
};

const DEFAULT_CONTEXT = 24;

/** More occurrences of the quote than this in one paragraph give no place. */
export const MAX_MATCHES = 1000;

const isHighSurrogate = (text: string, i: number) => { const c = text.charCodeAt(i); return c >= 0xd800 && c <= 0xdbff; };
const isLowSurrogate = (text: string, i: number) => { const c = text.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff; };

export function createTextAnchor(input: CreateTextAnchorInput): TextAnchor {
  const { nodeId, nodeText, start, end } = input;
  const contextLength = input.contextLength ?? DEFAULT_CONTEXT;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > nodeText.length) {
    throw new Error("createTextAnchor: invalid range");
  }
  if (!Number.isSafeInteger(contextLength) || contextLength < 0) {
    throw new Error("createTextAnchor: invalid context length");
  }
  // The context is measured in UTF-16 units, but a cut must never fall inside
  // a surrogate pair: a lone half is not valid text and the server refuses it.
  // The cut moves inward, so the context is one unit shorter, never longer.
  let prefixStart = Math.max(0, start - contextLength);
  if (prefixStart > 0 && prefixStart < start && isLowSurrogate(nodeText, prefixStart)) prefixStart += 1;
  let suffixEnd = Math.min(nodeText.length, end + contextLength);
  if (suffixEnd < nodeText.length && suffixEnd > end && isHighSurrogate(nodeText, suffixEnd - 1)) suffixEnd -= 1;
  return {
    nodeId,
    quote: nodeText.slice(start, end),
    prefix: nodeText.slice(prefixStart, start),
    suffix: nodeText.slice(end, suffixEnd),
    startHint: start,
    endHint: end,
  };
}

function contextScore(text: string, start: number, end: number, anchor: TextAnchor): number {
  let score = 0;
  if (anchor.prefix && text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix) score += 1;
  if (anchor.suffix && text.slice(end, end + anchor.suffix.length) === anchor.suffix) score += 1;
  return score;
}

export function resolveTextAnchor(anchor: TextAnchor, nodeId: NodeId, nodeText: string): AnchorResolution {
  if (nodeId !== anchor.nodeId || anchor.quote.length === 0) return { status: "missing" };

  // A short quote can occur many times in a long paragraph. Past the limit no
  // single place is reliable, so the search stops there and gives none: the
  // cost of a resolution stays bounded however long the paragraph is.
  const starts: number[] = [];
  let from = 0;
  while (from <= nodeText.length - anchor.quote.length) {
    const found = nodeText.indexOf(anchor.quote, from);
    if (found < 0) break;
    if (starts.length === MAX_MATCHES) return { status: "ambiguous", matches: MAX_MATCHES + 1 };
    starts.push(found);
    from = found + 1;
  }
  if (starts.length === 0) return { status: "missing" };

  const scored = starts.map((start) => ({
    start,
    end: start + anchor.quote.length,
    score: contextScore(nodeText, start, start + anchor.quote.length, anchor),
  }));

  // The old position is exact only when the quote there keeps all of its
  // recorded context and no other occurrence does: an edit can move another
  // occurrence of the same quote onto the old position (#418).
  const fullScore = (anchor.prefix ? 1 : 0) + (anchor.suffix ? 1 : 0);
  const complete = scored.filter((m) => m.score === fullScore);
  if (complete.length === 1 && complete[0].start === anchor.startHint && complete[0].end === anchor.endHint) {
    return { status: "exact", start: anchor.startHint, end: anchor.endHint };
  }

  // A loop, not a spread: an argument list has a size limit of its own.
  let best = 0;
  for (const m of scored) if (m.score > best) best = m.score;
  const winners = scored.filter((m) => m.score === best);
  if (winners.length !== 1) return { status: "ambiguous", matches: winners.length };

  const match = winners[0];
  return { status: "moved", start: match.start, end: match.end };
}
