import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  assertS3SigningConfig,
  sha256Hex,
  signS3Request,
  sigV4Authorization,
} from "./s3-signature";

// The documented example credentials and requests of the Amazon S3 API
// reference, "Signature Calculations for the Authorization Header", for
// 2013-05-24 in us-east-1. Not real credentials.
const credentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const now = new Date("2013-05-24T00:00:00Z");
const scope = "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request";
const endpoint = new URL("https://examplebucket.s3.amazonaws.com");

function sign(overrides: Partial<Parameters<typeof signS3Request>[0]> = {}) {
  return signS3Request({
    method: "PUT",
    endpoint,
    path: ["bucket", "v2", "pkg", "a.json"],
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode("{}"),
    region: "us-east-1",
    credentials,
    now,
    ...overrides,
  });
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("signS3Request: fixed vectors", () => {
  it("matches the documented GET object example", () => {
    const { url, headers } = sign({
      method: "GET",
      path: ["test.txt"],
      headers: { range: "bytes=0-9" },
      body: new Uint8Array(),
    });
    expect(url.href).toBe("https://examplebucket.s3.amazonaws.com/test.txt");
    expect(headers.authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${scope}, ` +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(headers["x-amz-date"]).toBe("20130524T000000Z");
    expect(headers).not.toHaveProperty("host");
  });

  it("matches the documented PUT object example, escaped path included", () => {
    const body = "Welcome to Amazon S3.";
    expect(sha256Hex(body)).toBe(
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
    );
    expect(
      sigV4Authorization({
        method: "PUT",
        canonicalPath: "/test%24file.text",
        headers: {
          date: "Fri, 24 May 2013 00:00:00 GMT",
          host: "examplebucket.s3.amazonaws.com",
          "x-amz-content-sha256": sha256Hex(body),
          "x-amz-date": "20130524T000000Z",
          "x-amz-storage-class": "REDUCED_REDUNDANCY",
        },
        payloadSha256Hex: sha256Hex(body),
        region: "us-east-1",
        service: "s3",
        credentials,
        amzDate: "20130524T000000Z",
      }),
    ).toBe(
      `AWS4-HMAC-SHA256 Credential=${scope}, ` +
        "SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, " +
        "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  // The public SigV4 test suite (awslabs/aws-c-auth,
  // tests/aws-signing-test-suite/v4), the cases without a query: header
  // normalization, sort order and value case. Example credentials only.
  it.each([
    ["get-vanilla", "GET", "/", {}, "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"],
    ["get-header-value-trim", "GET", "/", { "My-Header1": " value1", "My-Header2": ' "a   b   c"' }, "acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736"],
    ["get-unreserved", "GET", "/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", {}, "07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f"],
    ["post-vanilla", "POST", "/", {}, "5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b"],
    ["post-header-key-case", "POST", "/", {}, "5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b"],
    ["post-header-key-sort", "POST", "/", { "My-Header1": "value1" }, "c5410059b04c1ee005303aed430f6e6645f61f4dc9e1461ec8f8916fdf18852c"],
    ["post-header-value-case", "POST", "/", { "My-Header1": "VALUE1" }, "cdbc9802e29d2942e5e10b5bccfdd67c5f22c7c4e8ae67b53629efa58b974b7d"],
  ] as const)("matches the SigV4 suite case %s", (_, method, canonicalPath, extra, signature) => {
    const authorization = sigV4Authorization({
      method,
      canonicalPath,
      headers: { Host: "example.amazonaws.com", "X-Amz-Date": "20150830T123600Z", ...extra },
      payloadSha256Hex: sha256Hex(""),
      region: "us-east-1",
      service: "service",
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
      amzDate: "20150830T123600Z",
    });
    expect(authorization.endsWith(`, Signature=${signature}`)).toBe(true);
  });
});

describe("signS3Request: input it refuses (plan S1 to S10)", () => {
  it.each([
    ["empty path", []],
    ["empty segment", ["bucket", ""]],
    ["dot segment", ["bucket", "."]],
    ["dot-dot segment", ["bucket", ".."]],
    ["slash", ["bucket", "a/b"]],
    ["backslash", ["bucket", "a\\b"]],
    ["percent-encoded slash", ["bucket", "a%2Fb"]],
    ["broken percent sequence", ["bucket", "a%zz"]],
    ["already encoded character", ["bucket", "a%20b"]],
    ["encoded dot segment", ["bucket", "%2e%2e"]],
    ["query", ["bucket", "a?uploads"]],
    ["fragment", ["bucket", "a#b"]],
    ["space", ["bucket", "a b"]],
    ["tilde", ["bucket", "a~b"]],
    ["reserved character", ["bucket", "a$b"]],
    ["non-ASCII letter", ["bucket", "pakét"]],
    ["fullwidth digit", ["bucket", "１"]],
    ["NUL", ["bucket", "a\u0000"]],
    ["trailing line break", ["bucket", "a\n"]],
  ])("refuses a path with %s before signing (S1)", (_, path) => {
    expect(() => sign({ path })).toThrow(TypeError);
  });

  it.each([
    "https://examplebucket.s3.amazonaws.com/?",
    "https://examplebucket.s3.amazonaws.com/?a=1",
    "https://examplebucket.s3.amazonaws.com/?a=1&a=2",
    "https://examplebucket.s3.amazonaws.com/#x",
    "https://examplebucket.s3.amazonaws.com/prefix",
    "https://user:pass@examplebucket.s3.amazonaws.com",
    "ftp://examplebucket.s3.amazonaws.com",
  ])("refuses the endpoint %s: no query, path or user info (S2, S14)", (value) => {
    expect(() => sign({ endpoint: new URL(value) })).toThrow(TypeError);
  });

  it.each([
    "host",
    "Host",
    "authorization",
    "Authorization",
    "x-amz-date",
    "X-Amz-Date",
    "x-amz-content-sha256",
    "if-none-match",
    "If-None-Match",
    "x-amz-checksum-sha256",
  ])("refuses the signer-only header %s from the caller (S3)", (name) => {
    expect(() => sign({ headers: { [name]: "x" } })).toThrow(TypeError);
  });

  it("refuses the same header name in two cases (S4)", () => {
    expect(() =>
      sign({ headers: { "Content-Type": "a", "content-type": "b" } }),
    ).toThrow(TypeError);
  });

  it.each([
    ["line feed", "a\nb"],
    ["carriage return", "a\rb"],
    ["tab", "a\tb"],
    ["NUL", "a\u0000b"],
    ["DEL", "a\u007fb"],
    ["non-ASCII", "čćž"],
  ])("refuses a header value with %s (S5)", (_, value) => {
    expect(() => sign({ headers: { "x-test": value } })).toThrow(TypeError);
  });

  it.each(["x test", "x:test", "x_test", "", "x\ntest"])(
    "refuses the header name %j (S5)",
    (name) => {
      expect(() => sign({ headers: { [name]: "v" } })).toThrow(TypeError);
    },
  );

  it("refuses an invalid or out-of-range date (S8)", () => {
    expect(() => sign({ now: new Date(Number.NaN) })).toThrow(TypeError);
    expect(() => sign({ now: new Date("+010000-01-01T00:00:00Z") })).toThrow(
      TypeError,
    );
  });

  it("refuses a GET with a body", () => {
    expect(() => sign({ method: "GET", body: new Uint8Array([1]) })).toThrow(
      TypeError,
    );
  });

  it.each(["", "eu/central-1", "eu central", "eu-central-1\n", "EU-CENTRAL-1"])(
    "refuses the region %j (S10)",
    (region) => {
      expect(() => assertS3SigningConfig(region, credentials)).toThrow(
        TypeError,
      );
      expect(() => sign({ region })).toThrow(TypeError);
    },
  );

  it.each(["", "AKIA,X", "AKIA/X", "AKIA X", "AKIA\nX"])(
    "refuses the access key id %j (S10)",
    (accessKeyId) => {
      const bad = { ...credentials, accessKeyId };
      expect(() => assertS3SigningConfig("us-east-1", bad)).toThrow(TypeError);
      expect(() => sign({ credentials: bad })).toThrow(TypeError);
    },
  );

  it("refuses an empty secret (S10)", () => {
    expect(() =>
      assertS3SigningConfig("us-east-1", { ...credentials, secretAccessKey: "" }),
    ).toThrow(TypeError);
  });
});

describe("signS3Request: what it signs", () => {
  it("signs the create-only condition and the checksum of the sent bytes on PUT (S6, S7)", () => {
    const body = new TextEncoder().encode('{"a":1}');
    const { headers } = sign({ body });
    expect(headers["if-none-match"]).toBe("*");
    expect(headers["x-amz-checksum-sha256"]).toBe(
      createHash("sha256").update(body).digest("base64"),
    );
    expect(headers["x-amz-content-sha256"]).toBe(sha256Hex(body));
    expect(headers.authorization).toContain(
      "SignedHeaders=content-type;host;if-none-match;x-amz-checksum-sha256;x-amz-content-sha256;x-amz-date,",
    );
  });

  it("changes the signature when one byte of the body changes (S7)", () => {
    const a = sign({ body: new Uint8Array([1, 2, 3]) });
    const b = sign({ body: new Uint8Array([1, 2, 4]) });
    expect(a.headers.authorization).not.toBe(b.headers.authorization);
  });

  it("takes the date and the scope day from the same instant (S8)", () => {
    const { headers } = sign({ now: new Date("2026-10-10T23:59:59.999Z") });
    expect(headers["x-amz-date"]).toBe("20261010T235959Z");
    expect(headers.authorization).toContain("/20261010/us-east-1/s3/aws4_request,");
  });

  it("signs the host with its port and returns exactly the signed URL (S15)", () => {
    const { url } = sign({
      endpoint: new URL("http://127.0.0.1:9100"),
      path: ["ductus-evidence", "v2", "pkg", "a.json"],
    });
    expect(url.host).toBe("127.0.0.1:9100");
    expect(url.href).toBe("http://127.0.0.1:9100/ductus-evidence/v2/pkg/a.json");
  });

  it("never puts the secret or the derived signing key in an error or a result (S12)", () => {
    const secretAccessKey = "Secret-Canary-0123456789abcdefABCDEF/+";
    const canary = { accessKeyId: "AKIACANARY", secretAccessKey };
    let signingKey = createHmac("sha256", `AWS4${secretAccessKey}`)
      .update("20130524")
      .digest();
    for (const part of ["us-east-1", "s3", "aws4_request"]) {
      signingKey = createHmac("sha256", signingKey).update(part).digest();
    }
    const failures = [
      () => sign({ credentials: canary, path: [".."] }),
      () => sign({ credentials: canary, headers: { authorization: secretAccessKey } }),
      () => sign({ credentials: canary, headers: { "x-a": `${secretAccessKey}\n` } }),
      () => sign({ credentials: canary, now: new Date(Number.NaN) }),
      () => sign({ credentials: { ...canary, accessKeyId: "a/b" } }),
      () => sign({ credentials: canary, region: secretAccessKey }),
      () => sign({ credentials: canary, endpoint: new URL(`https://h/?${secretAccessKey}`) }),
    ];
    const outputs: unknown[] = [sign({ credentials: canary })];
    for (const failure of failures) {
      const error = thrown(failure) as Error;
      outputs.push({ name: error.name, message: error.message, stack: error.stack, cause: error.cause });
    }
    const text = JSON.stringify(outputs);
    expect(text).not.toContain(secretAccessKey);
    expect(text).not.toContain(signingKey.toString("hex"));
    expect(text).not.toContain(signingKey.toString("base64"));
  });
});
