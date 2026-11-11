/**
 * Limits and the one error of the DOCX trace reader (DAN-242, M8.1). The
 * reader runs on untrusted uploads, so every size it accepts is bounded here,
 * and a caller may only tighten a bound, never loosen it.
 */

export interface DocxLimits {
  /** Bytes of the whole file. */
  maxInputBytes: number;
  /** Entries in the ZIP central directory, directories included. */
  maxEntries: number;
  /** Declared uncompressed bytes of one part. */
  maxPartBytes: number;
  /** Declared uncompressed bytes of all parts together. */
  maxTotalBytes: number;
  /** Declared uncompressed size over compressed size, per part. */
  maxRatio: number;
  /** Open elements at once in one XML part. */
  maxXmlDepth: number;
}

export const DEFAULT_DOCX_LIMITS: Readonly<DocxLimits> = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxEntries: 2000,
  maxPartBytes: 16 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxRatio: 200,
  maxXmlDepth: 128,
});

export type DocxRejectCode =
  | "LIMITS_INVALID"
  | "INPUT_INVALID"
  | "INPUT_TOO_LARGE"
  | "ZIP_INVALID"
  | "ZIP_UNSUPPORTED"
  | "ZIP_TOO_MANY_ENTRIES"
  | "ZIP_PATH"
  | "ZIP_DUPLICATE"
  | "ZIP_ENCRYPTED"
  | "ZIP_METHOD"
  | "ZIP_PART_TOO_LARGE"
  | "ZIP_TOTAL_TOO_LARGE"
  | "ZIP_RATIO"
  | "ZIP_SIZE_MISMATCH"
  | "ZIP_CRC"
  | "ZIP_NO_PART"
  | "XML_ENCODING"
  | "XML_INVALID"
  | "XML_DOCTYPE"
  | "XML_ENTITY"
  | "XML_PI"
  | "XML_DEPTH"
  | "XML_NAMESPACE";

/**
 * The only error the reader throws on bad input. It carries the code and
 * nothing of the input: no name, offset or text (D-198 t. 5).
 */
export class DocxRejected extends Error {
  constructor(readonly code: DocxRejectCode) {
    super(code);
    this.name = "DocxRejected";
  }
}

/** Defaults for missing keys; a looser value keeps the default; anything malformed is refused. */
export function resolveDocxLimits(limits: Partial<DocxLimits> | undefined): DocxLimits {
  if (limits === undefined) return { ...DEFAULT_DOCX_LIMITS };
  if (typeof limits !== "object" || limits === null || Array.isArray(limits)) throw new DocxRejected("LIMITS_INVALID");
  const out = { ...DEFAULT_DOCX_LIMITS };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_DOCX_LIMITS, key)) throw new DocxRejected("LIMITS_INVALID");
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new DocxRejected("LIMITS_INVALID");
    const k = key as keyof DocxLimits;
    out[k] = Math.min(value as number, DEFAULT_DOCX_LIMITS[k]);
  }
  return out;
}
