// editor-core (DAN-927): the only entry into src/editor for the rest of Ductus.
// Test helpers (*.fixture.ts) and tests stay out. block-marker and text-block
// both define markerRemoval and markerToBlock; those stay internal.
export * from "./arrow-collapse";
export { blockMarkerRule } from "./block-marker";
export * from "./bullet-item";
export * from "./capture";
export * from "./capture-rewrite";
export * from "./chapter-numbers";
export * from "./citation";
export * from "./comment-anchor";
export * from "./find-replace";
export * from "./history";
export * from "./identity";
export * from "./interop";
export * from "./interop-v2";
export * from "./outline";
export * from "./quote";
export * from "./schema";
export * from "./source";
export * from "./storable-input";
export * from "./storable-text";
export { textBlockBackspace, textBlockEnter } from "./text-block";
