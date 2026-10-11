import { describe, expect, it } from "vitest";

import { sha256Hex, signS3Request } from "./s3-signature";

// The documented example credentials and requests of the Amazon S3 API
// reference, "Signature Calculations for the Authorization Header", for
// 2013-05-24 in us-east-1. Not real credentials.
const credentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const now = new Date("2013-05-24T00:00:00Z");
const scope = "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request";

describe("signS3Request", () => {
  it("matches the documented GET object example", () => {
    const headers = signS3Request({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadSha256Hex: sha256Hex(""),
      region: "us-east-1",
      credentials,
      now,
    });
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
    const headers = signS3Request({
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
      headers: {
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      payloadSha256Hex: sha256Hex(body),
      region: "us-east-1",
      credentials,
      now,
    });
    expect(headers.authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${scope}, ` +
        "SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, " +
        "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("refuses a URL with a query string", () => {
    expect(() =>
      signS3Request({
        method: "GET",
        url: new URL("https://examplebucket.s3.amazonaws.com/?uploads"),
        headers: {},
        payloadSha256Hex: sha256Hex(""),
        region: "us-east-1",
        credentials,
        now,
      }),
    ).toThrow(TypeError);
  });
});
