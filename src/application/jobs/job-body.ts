// DAN-517 (D-74; docs/backend/poslovi-i-predaja.md 4.5): the body of a queued
// job is identifiers only. One guard settles that, before a job is enqueued
// and again before it runs, so text never reaches the queue by either path.

/** One kind of job: its queue, the exact fields of its body, and the field that names its subject. */
export type JobDefinition = {
  readonly name: string;
  readonly fields: readonly string[];
  readonly subject: string;
};

export type JobBody = Readonly<Record<string, string>>;

/** Why a body was refused. A closed list: a result never carries a value of the refused input. */
export type JobBodyProblem =
  | "not_object"
  | "not_plain"
  | "symbol_key"
  | "accessor"
  | "unknown_field"
  | "missing_field"
  | "not_uuid";

export type JobBodyResult =
  | { readonly ok: true; readonly body: JobBody }
  | { readonly ok: false; readonly problem: JobBodyProblem };

const QUEUE_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const FIELD_NAME = /^[a-z][A-Za-z0-9]{0,39}$/;
// The one spelling the database prints for a UUID. Another form is refused,
// not normalized, so one subject never has two keys in the queue.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isJobDefinition(value: JobDefinition): boolean {
  return (
    QUEUE_NAME.test(value.name) &&
    value.fields.length > 0 &&
    value.fields.every((field) => FIELD_NAME.test(field)) &&
    new Set(value.fields).size === value.fields.length &&
    value.fields.includes(value.subject)
  );
}

/**
 * Accepts a plain record whose own keys are exactly `fields` and whose values
 * are UUIDs in lower case, and returns a new frozen record of them. Every
 * value is read once, from its property descriptor, so no getter runs and the
 * value that was checked is the value that is returned.
 */
export function parseJobBody(input: unknown, fields: readonly string[]): JobBodyResult {
  if (typeof input !== "object" || input === null) return refuse("not_object");
  let keys: ReadonlyArray<string | symbol>;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    const prototype: unknown = Object.getPrototypeOf(input);
    if (Array.isArray(input) || (prototype !== Object.prototype && prototype !== null)) return refuse("not_plain");
    keys = Reflect.ownKeys(input);
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    // Only a proxy throws here; it is not a plain record.
    return refuse("not_plain");
  }
  if (keys.some((key) => typeof key === "symbol")) return refuse("symbol_key");
  if (keys.some((key) => !fields.includes(key as string))) return refuse("unknown_field");
  const body: Record<string, string> = {};
  for (const field of fields) {
    if (!keys.includes(field)) return refuse("missing_field");
    const descriptor = descriptors[field];
    if (!("value" in descriptor) || descriptor.enumerable !== true) return refuse("accessor");
    const value: unknown = descriptor.value;
    if (typeof value !== "string" || !UUID.test(value)) return refuse("not_uuid");
    body[field] = value;
  }
  return { ok: true, body: Object.freeze(body) };
}

function refuse(problem: JobBodyProblem): JobBodyResult {
  return { ok: false, problem };
}
