import { messagesHr } from "@/lib/i18n/messages.hr";

type FlowStepKey = keyof typeof messagesHr.landing.flow.steps;

/**
 * The ten announced steps of the full flow (FE-H2a, owner order on #476), in
 * order. `soon` marks a step the app does not have yet: it is shown with the
 * "Uskoro" label and its text stays neutral, never a promise. The others are
 * in the demo (F-6, F-7, F-8, F-9 with D-142, F-10).
 */
export const FLOW_STEPS: readonly { key: FlowStepKey; soon: boolean }[] = [
  { key: "assignment", soon: false },
  { key: "writing", soon: false },
  { key: "sources", soon: true },
  { key: "mentoring", soon: false },
  { key: "reply", soon: false },
  { key: "versionReview", soon: true },
  { key: "laterChange", soon: true },
  { key: "submission", soon: false },
  { key: "defence", soon: true },
  { key: "institution", soon: true },
];
