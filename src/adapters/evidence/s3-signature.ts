import { createHash, createHmac } from "node:crypto";

export type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

// RFC 3986 unreserved characters stay; everything else is percent-encoded.
function encodeSegment(segment: string): string {
  return encodeURIComponent(decodeURIComponent(segment)).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * AWS Signature Version 4 for one path-style S3 request without a query
 * string. `payloadSha256Hex` is the SHA-256 of the exact body (of the empty
 * body for a GET); it is signed, so storage refuses any other bytes. Returns
 * the headers to send: the given ones plus the date, the payload hash and the
 * authorization. Host is signed but left to fetch, which derives it from the
 * same URL.
 */
export function signS3Request(input: {
  method: "GET" | "PUT";
  url: URL;
  headers: Readonly<Record<string, string>>;
  payloadSha256Hex: string;
  region: string;
  credentials: S3Credentials;
  now: Date;
}): Record<string, string> {
  if (input.url.search !== "" || input.url.hash !== "") {
    throw new TypeError("S3 request URL must not have a query or fragment");
  }
  const amzDate = input.now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = input.payloadSha256Hex;

  const signed: Record<string, string> = { ...headers, host: input.url.host };
  const names = Object.keys(signed).sort();
  const canonicalRequest = [
    input.method,
    input.url.pathname.split("/").map(encodeSegment).join("/"),
    "",
    names.map((name) => `${name}:${signed[name]}\n`).join(""),
    names.join(";"),
    input.payloadSha256Hex,
  ].join("\n");
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  let key = hmac(`AWS4${input.credentials.secretAccessKey}`, day);
  for (const part of [input.region, "s3", "aws4_request"])
    key = hmac(key, part);
  const signature = createHmac("sha256", key)
    .update(stringToSign, "utf8")
    .digest("hex");

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return headers;
}
