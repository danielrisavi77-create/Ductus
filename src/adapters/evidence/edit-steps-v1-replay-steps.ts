import type { Node as PmNode } from "@tiptap/pm/model";

import type { EvidenceEventV2 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";
import type { ReplayStepReplayer } from "@/domain/projection/replay-timeline";

import { createBrowserEditStepsV1Replayer } from "./edit-steps-v1-browser-replayer";

/**
 * The replay timeline's view of `ductus-edit-steps-v1` (DAN-344, contract on
 * #923 §4): every step of an event applied on its own, by the same rules and
 * in the same order as the browser replayer, so the document after each step
 * can be shown (D-143). Each step runs as an event of one step through
 * `createBrowserEditStepsV1Replayer().apply`; nothing here applies a step
 * itself. Browser-safe: no Node module.
 */

/** Ids of the top-level blocks of `document` that overlap `from..to`, or that contain `from` when the range is empty. */
function blocksBetween(document: PmNode, from: number, to: number): string[] {
  const ids: string[] = [];
  let pos = 0;
  document.forEach((block) => {
    const end = pos + block.nodeSize;
    const id: unknown = block.attrs.nodeId;
    if (typeof id === "string" && end > from && pos < Math.max(to, from)) ids.push(id);
    pos = end;
  });
  return ids;
}

function stepRange(step: unknown): { from: number; to: number } | null {
  if (typeof step !== "object" || step === null) return null;
  const { from, to, pos } = step as { from?: unknown; to?: unknown; pos?: unknown };
  // An attr step names the block that starts at `pos`.
  if (typeof pos === "number") return { from: pos, to: pos + 1 };
  if (typeof from === "number" && typeof to === "number") return { from, to };
  return null;
}

export function createBrowserReplayStepsV1(): ReplayStepReplayer<PmNode> {
  const replayer = createBrowserEditStepsV1Replayer();
  return {
    transactionFormat: replayer.transactionFormat,
    load: replayer.load,
    toCanonical: replayer.toCanonical,
    toView: (document: PmNode) => document.toJSON() as JcsJsonValue,
    async *steps(document: PmNode, event: EvidenceEventV2) {
      let current = document;
      for (const step of event.steps) {
        const after = await replayer.apply(current, { ...event, steps: [step] });
        const range = stepRange(step);
        // The blocks the step touched before it, and where that range lies after it.
        const blockIds = new Set<string>();
        if (range !== null) {
          for (const id of blocksBetween(current, range.from, range.to)) blockIds.add(id);
          const end = Math.max(range.from, range.to + after.content.size - current.content.size);
          for (const id of blocksBetween(after, range.from, end)) blockIds.add(id);
        }
        current = after;
        yield { document: after, blockIds: [...blockIds].sort() };
      }
    },
    blockText(document: PmNode, blockId: string): string | null {
      let text: string | null = null;
      document.forEach((block) => {
        if (block.attrs.nodeId === blockId) text = block.textContent;
      });
      return text;
    },
  };
}
