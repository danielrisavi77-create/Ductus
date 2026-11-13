// Public system status (DAN-429, F-10, J-05): the closed shape the /api/status
// route sends and the /stanje page reads. Only three parts of the service and
// three state words: never a host, message, code or anything about a person.

export const COMPONENT_STATES = ["radi", "ne_radi", "nije_ukljuceno"] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];

export const COMPONENTS = ["writing", "submission", "mentorView"] as const;
export type ComponentName = (typeof COMPONENTS)[number];

export type PublicStatus = {
  /** When the server ran the checks, an ISO instant in UTC. */
  checkedAt: string;
  components: Record<ComponentName, ComponentState>;
};

/** How often the page asks again. */
export const POLL_MS = 30_000;

/** Results older than this, by the page's own clock, are marked stale. */
export const STALE_AFTER_MS = 120_000;

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;

function isInstant(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 24) return false;
  const match = INSTANT.exec(value);
  if (!match) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  // Date.parse rolls 30 February over to March; the parts must come back as written.
  const back = new Date(time).toISOString();
  return back.slice(0, 19) === value.slice(0, 19);
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isState = (value: unknown): value is ComponentState =>
  typeof value === "string" && (COMPONENT_STATES as readonly string[]).includes(value);

/**
 * The response body as a checked value, or null for anything else: a missing,
 * extra or mistyped field, an unknown state word or a time that is not a real
 * UTC instant. Never throws; the result is a fresh object of checked fields.
 */
export function parsePublicStatus(input: unknown): PublicStatus | null {
  if (!isPlainObject(input) || !hasExactKeys(input, ["checkedAt", "components"])) return null;
  const { checkedAt, components } = input;
  if (!isInstant(checkedAt) || !isPlainObject(components) || !hasExactKeys(components, COMPONENTS)) return null;
  const { writing, submission, mentorView } = components;
  if (!isState(writing) || !isState(submission) || !isState(mentorView)) return null;
  return { checkedAt, components: { writing, submission, mentorView } };
}

/**
 * Stale when nothing was received yet, when the last answer is older than
 * STALE_AFTER_MS, or when the clock reads earlier than the answer (a clock
 * that went back proves nothing fresh). Both times come from the page's own
 * monotonic clock, so a server clock that differs does not matter.
 */
export function isStale(lastOkAt: number | null, now: number): boolean {
  if (lastOkAt === null) return true;
  const age = now - lastOkAt;
  return !(age >= 0 && age <= STALE_AFTER_MS);
}
