import { createHash, createHmac, type Hash, type Hmac } from "node:crypto";

import { fc, test } from "@fast-check/vitest";
import { SignatureV4 } from "@smithy/signature-v4";
import { expect } from "vitest";

import { signS3Request } from "./s3-signature";

// Differential proof for the signer (issue #155, signer supplement): every
// accepted request is signed exactly as the AWS reference implementation
// signs it. The reference is a devDependency and is never loaded at runtime.

type SourceData = string | ArrayBuffer | ArrayBufferView;

function bytes(data: SourceData): string | Uint8Array {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

class NodeSha256 {
  private readonly hash: Hash | Hmac;

  constructor(secret?: SourceData) {
    this.hash = secret === undefined ? createHash("sha256") : createHmac("sha256", bytes(secret));
  }

  update(data: SourceData): void {
    this.hash.update(bytes(data));
  }

  digest(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(this.hash.digest()));
  }
}

const SEGMENT_CHARS = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"];
const segment = fc
  .string({ unit: fc.constantFrom(...SEGMENT_CHARS), minLength: 1, maxLength: 40 })
  .filter((value) => value !== "." && value !== "..");
const NAME_CHARS = [..."abcdefghijklmnopqrstuvwxyz0123456789-"];
// "x-" names plus content-type: the reference leaves some well-known headers
// (user-agent, expect, ...) unsigned, which this signer never receives.
const headerName = fc.oneof(
  fc
    .string({ unit: fc.constantFrom(...NAME_CHARS), minLength: 1, maxLength: 20 })
    .map((rest) => `x-meta-${rest}`),
  fc.constant("content-type"),
);
const headerValue = fc.string({
  unit: fc.integer({ min: 0x20, max: 0x7e }).map((code) => String.fromCharCode(code)),
  maxLength: 60,
});
const headers = fc.dictionary(headerName, headerValue, { maxKeys: 5 });
const hostname = fc.oneof(
  fc.constantFrom("127.0.0.1", "localhost", "s3.eu-central-1.amazonaws.com"),
  fc
    .array(fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), minLength: 1, maxLength: 12 }), {
      minLength: 1,
      maxLength: 3,
    })
    .map((labels) => `${labels.join(".")}.example`),
);
const region = fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-"), minLength: 1, maxLength: 20 });
const accessKeyId = fc.string({
  unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz_-"),
  minLength: 1,
  maxLength: 40,
});
// Every secret the configuration lock accepts: visible ASCII, no space.
const secretAccessKey = fc.string({
  unit: fc.integer({ min: 0x21, max: 0x7e }).map((code) => String.fromCharCode(code)),
  minLength: 1,
  maxLength: 60,
});
const now = fc.date({ min: new Date("1970-01-01T00:00:00Z"), max: new Date("9999-12-31T23:59:59Z"), noInvalidDate: true });

test.prop([
  fc.constantFrom("GET", "PUT"),
  fc.constantFrom("http", "https"),
  hostname,
  fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
  fc.array(segment, { minLength: 1, maxLength: 6 }),
  headers,
  fc.uint8Array({ maxLength: 512 }),
  region,
  accessKeyId,
  secretAccessKey,
  now,
])(
  "signs every accepted request exactly as @smithy/signature-v4",
  async (method, scheme, host, port, path, given, body, signingRegion, keyId, secret, date) => {
    const endpoint = new URL(`${scheme}://${host}${port === undefined ? "" : `:${port}`}`);
    const credentials = { accessKeyId: keyId, secretAccessKey: secret };
    const signed = signS3Request({
      method,
      endpoint,
      path,
      headers: given,
      body: method === "GET" ? new Uint8Array() : body,
      region: signingRegion,
      credentials,
      now: date,
    });

    // Host as the client sends it (default ports dropped), computed here and
    // not taken from the signer, so a port mismatch would show.
    const defaultPort = scheme === "https" ? 443 : 80;
    const expectedHost = port === undefined || port === defaultPort ? host : `${host}:${port}`;
    expect(signed.url.href).toBe(`${scheme}://${expectedHost}/${path.join("/")}`);
    expect(signed.headers).not.toHaveProperty("host");

    const reference = new SignatureV4({
      credentials,
      region: signingRegion,
      service: "s3",
      sha256: NodeSha256,
      uriEscapePath: false,
      applyChecksum: false,
    });
    const sent = Object.fromEntries(
      Object.entries(signed.headers).filter(([name]) => name !== "authorization"),
    );
    const result = await reference.sign(
      {
        method,
        protocol: `${scheme}:`,
        hostname: host,
        port,
        path: `/${path.join("/")}`,
        query: {},
        headers: { ...sent, host: expectedHost },
      },
      { signingDate: date },
    );
    expect(signed.headers.authorization).toBe(result.headers.authorization);
  },
);
