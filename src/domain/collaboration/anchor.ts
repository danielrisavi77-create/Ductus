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

export function createTextAnchor(input: CreateTextAnchorInput): TextAnchor {
  const { nodeId, nodeText, start, end } = input;
  const contextLength = input.contextLength ?? DEFAULT_CONTEXT;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > nodeText.length) {
    throw new Error("createTextAnchor: invalid range");
  }
  if (!Number.isSafeInteger(contextLength) || contextLength < 0) {
    throw new Error("createTextAnchor: invalid context length");
  }
  return {
    nodeId,
    quote: nodeText.slice(start, end),
    prefix: nodeText.slice(Math.max(0, start - contextLength), start),
    suffix: nodeText.slice(end, Math.min(nodeText.length, end + contextLength)),
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

  const hinted = nodeText.slice(anchor.startHint, anchor.endHint);
  if (hinted === anchor.quote) {
    return { status: "exact", start: anchor.startHint, end: anchor.endHint };
  }

  const starts: number[] = [];
  let from = 0;
  while (from <= nodeText.length - anchor.quote.length) {
    const found = nodeText.indexOf(anchor.quote, from);
    if (found < 0) break;
    starts.push(found);
    from = found + 1;
  }
  if (starts.length === 0) return { status: "missing" };

  const scored = starts.map((start) => ({
    start,
    end: start + anchor.quote.length,
    score: contextScore(nodeText, start, start + anchor.quote.length, anchor),
  }));
  const best = Math.max(...scored.map((m) => m.score));
  const winners = scored.filter((m) => m.score === best);
  if (winners.length !== 1) return { status: "ambiguous", matches: winners.length };

  const match = winners[0];
  return { status: "moved", start: match.start, end: match.end };
}
