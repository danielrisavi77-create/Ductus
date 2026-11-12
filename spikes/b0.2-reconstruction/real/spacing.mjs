// Checkpoint spacing for the B0.2 workload (DAN-388). The distance is a
// parameter, in segments (K, as the contract asks) or in steps; a checkpoint
// is only ever taken between segments, since the record asks for one by a
// segment's initialDocumentHash.

export const CHECKPOINT_UNITS = ['segments', 'steps'];

/** Checks a distance from the command line or the environment. */
export function checkpointSpacing(unit, every) {
  if (!CHECKPOINT_UNITS.includes(unit)) throw new Error(`checkpoint unit ${unit}: expected ${CHECKPOINT_UNITS.join(' or ')}`);
  const distance = Number(every);
  if (!Number.isSafeInteger(distance) || distance < 1) throw new Error(`checkpoint distance ${every}: expected a positive integer`);
  return { unit, every: distance };
}

/** How far one segment moves the distance: one segment, or its steps. */
export const distanceOf = (unit, steps) => (unit === 'segments' ? 1 : steps);

/**
 * Indices of the segments that start from a checkpoint, given each segment's
 * step count: one in front of segment i as soon as at least `every` units
 * passed since the previous one (or the start). Never in front of segment 0,
 * which starts from the initial document.
 */
export function checkpointIndices(segmentSteps, { unit, every }) {
  const indices = [];
  let sinceLast = 0;
  for (let index = 0; index < segmentSteps.length; index++) {
    if (index > 0 && sinceLast >= every) {
      indices.push(index);
      sinceLast = 0;
    }
    sinceLast += distanceOf(unit, segmentSteps[index]);
  }
  return indices;
}
