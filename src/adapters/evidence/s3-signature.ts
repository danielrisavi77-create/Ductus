import { createHash, createHmac } from "node:crypto";
import { inspect } from "node:util";

export type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export type SignedS3Request = {
  /** The exact URL that was signed; send this one and no other. */
  url: URL;
  /** Every header to send except host, which fetch derives from `url`. */
  headers: Record<string, string>;
};

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Only the signer sets these; a caller that passes one is refused.
const SIGNER_HEADERS = new Set([
  "host",
  "authorization",
  "x-amz-date",
  "x-amz-content-sha256",
  "if-none-match",
  "x-amz-checksum-sha256",
]);
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
// Printable ASCII only: no line break, tab or control character can reshape
// the canonical request.
const HEADER_VALUE = /^[\x20-\x7e]{0,1024}$/;
// RFC 3986 unreserved characters without "~": the segment is its own
// encoding, so the signed path and the sent path cannot differ.
const PATH_SEGMENT = /^[A-Za-z0-9._-]{1,255}$/;
const REGION = /^[a-z0-9-]{1,32}$/;
const ACCESS_KEY_ID = /^[A-Za-z0-9_-]{1,128}$/;
// Visible ASCII only: a blank value or a line break kept from a file or an
// environment variable stops startup instead of failing every signature.
const SECRET_ACCESS_KEY = /^[\x21-\x7e]{1,128}$/;
const AMZ_DATE = /^\d{8}T\d{6}Z$/;

/**
 * Configuration lock for the signing scope: an adapter calls this when it is
 * built so a bad value stops startup instead of the first request. Messages
 * never carry the values.
 */
export function assertS3SigningConfig(
  region: unknown,
  credentials: unknown,
): asserts credentials is S3Credentials {
  if (typeof region !== "string" || !REGION.test(region)) {
    throw new TypeError("S3 region is not valid");
  }
  assertS3Credentials(credentials);
}

function assertS3Credentials(
  credentials: unknown,
): asserts credentials is S3Credentials {
  const { accessKeyId, secretAccessKey } = (credentials ?? {}) as Record<
    string,
    unknown
  >;
  if (
    typeof accessKeyId !== "string" ||
    !ACCESS_KEY_ID.test(accessKeyId) ||
    typeof secretAccessKey !== "string" ||
    !SECRET_ACCESS_KEY.test(secretAccessKey)
  ) {
    throw new TypeError("S3 credentials are not valid");
  }
}

const REDACTED = "[S3 credentials redacted]";

/**
 * S3 keys sealed for configuration. The values live only in native private
 * fields, so enumeration, spreading, `JSON.stringify`, `String` and
 * `util.inspect` (hidden properties and getters included) of the keys or of a
 * configuration that holds them show a redaction mark. Each key is read once
 * when sealed, and that same value is validated and stored, so a getter
 * cannot pass one value and seal another; the error never names a value.
 */
export class S3SecretCredentials {
  readonly #accessKeyId: string;
  readonly #secretAccessKey: string;

  constructor(credentials: S3Credentials) {
    const { accessKeyId, secretAccessKey } = (credentials ?? {}) as Record<
      string,
      unknown
    >;
    const keys = { accessKeyId, secretAccessKey };
    assertS3Credentials(keys);
    this.#accessKeyId = keys.accessKeyId;
    this.#secretAccessKey = keys.secretAccessKey;
    Object.freeze(this);
  }

  /** The plain keys, for the adapter that signs; refuses anything unsealed. */
  static reveal(sealed: unknown): S3Credentials {
    if (!(typeof sealed === "object" && sealed !== null && #accessKeyId in sealed)) {
      throw new TypeError("S3 credentials must be sealed");
    }
    const keys = sealed as S3SecretCredentials;
    return { accessKeyId: keys.#accessKeyId, secretAccessKey: keys.#secretAccessKey };
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/**
 * The AWS Signature Version 4 algorithm over an already encoded path without
 * a query. Header names are lowercased and values trimmed with inner spaces
 * collapsed; every given header is signed. Exported for the published test
 * vectors only: requests are signed through `signS3Request`, which validates
 * its input first.
 */
export function sigV4Authorization(input: {
  method: string;
  canonicalPath: string;
  headers: Readonly<Record<string, string>>;
  payloadSha256Hex: string;
  region: string;
  service: string;
  credentials: S3Credentials;
  amzDate: string;
}): string {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = value.trim().replace(/ +/g, " ");
  }
  const names = Object.keys(headers).sort();
  const canonicalRequest = [
    input.method,
    input.canonicalPath,
    "",
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    names.join(";"),
    input.payloadSha256Hex,
  ].join("\n");
  const day = input.amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  let key = hmac(`AWS4${input.credentials.secretAccessKey}`, day);
  for (const part of [input.region, input.service, "aws4_request"]) {
    key = hmac(key, part);
  }
  const signature = createHmac("sha256", key)
    .update(stringToSign, "utf8")
    .digest("hex");
  return (
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${names.join(";")}, Signature=${signature}`
  );
}

/**
 * Signs one path-style S3 request (SigV4, service `s3`). The URL is built
 * here from validated path segments and returned, so nothing outside the
 * configured origin and no query can be signed or sent. The payload hash is
 * computed from `body`, the bytes that are sent. A PUT is always a
 * create-only write: the signer adds `If-None-Match: *` and the SHA-256
 * checksum of the same bytes and signs both, so a proxy that strips either
 * breaks the signature instead of turning the write into an overwrite.
 * Errors never carry credentials or header values.
 */
export function signS3Request(input: {
  method: "GET" | "PUT";
  endpoint: URL;
  path: readonly string[];
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
  region: string;
  credentials: S3Credentials;
  now: Date;
}): SignedS3Request {
  const { endpoint } = input;
  if (
    (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") ||
    endpoint.href !== `${endpoint.origin}/`
  ) {
    throw new TypeError(
      "S3 endpoint must be an http(s) origin without path, query or credentials",
    );
  }
  if (
    input.path.length === 0 ||
    !input.path.every(
      (segment) =>
        PATH_SEGMENT.test(segment) && segment !== "." && segment !== "..",
    )
  ) {
    throw new TypeError("S3 path segment is not allowed");
  }
  const canonicalPath = `/${input.path.join("/")}`;
  const url = new URL(canonicalPath, endpoint);
  if (url.pathname !== canonicalPath || url.href !== endpoint.origin + canonicalPath) {
    throw new TypeError("S3 path segment is not allowed");
  }
  if (input.method === "GET" && input.body.byteLength !== 0) {
    throw new TypeError("S3 GET must not have a body");
  }
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new TypeError("S3 signing time is not a valid date");
  }
  const amzDate = input.now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  if (!AMZ_DATE.test(amzDate)) {
    throw new TypeError("S3 signing time is out of range");
  }
  assertS3SigningConfig(input.region, input.credentials);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(name) || SIGNER_HEADERS.has(lower)) {
      throw new TypeError("S3 header name is not allowed");
    }
    if (Object.hasOwn(headers, lower)) {
      throw new TypeError("S3 header is given twice");
    }
    if (typeof value !== "string" || !HEADER_VALUE.test(value)) {
      throw new TypeError("S3 header value is not allowed");
    }
    headers[lower] = value;
  }
  const digest = createHash("sha256").update(input.body).digest();
  if (input.method === "PUT") {
    headers["if-none-match"] = "*";
    headers["x-amz-checksum-sha256"] = digest.toString("base64");
  }
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = digest.toString("hex");

  const authorization = sigV4Authorization({
    method: input.method,
    canonicalPath,
    headers: { ...headers, host: url.host },
    payloadSha256Hex: digest.toString("hex"),
    region: input.region,
    service: "s3",
    credentials: input.credentials,
    amzDate,
  });
  const sent: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    sent[name] = value.trim().replace(/ +/g, " ");
  }
  sent.authorization = authorization;
  return { url, headers: sent };
}
