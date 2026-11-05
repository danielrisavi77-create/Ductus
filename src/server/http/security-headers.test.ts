import { createServer, request, ServerResponse, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { FLOOR_HEADERS, installSecurityHeaderFloor, SECURITY_HEADERS } from "./security-headers";

// DAN-498: the floor on writeHead, on a real node:http server. The server uses
// its own ServerResponse subclass, so the global prototype stays untouched.

/** One way a handler can answer, and the header values it must arrive with. */
type Row = {
  name: string;
  answer: (res: ServerResponse) => void;
  /** Headers whose value the handler chose; everything else is the floor. */
  own?: Record<string, string>;
};

const ROUTE_CSP = "default-src 'self'";

const ROWS: Row[] = [
  { name: "implicit end()", answer: (res) => res.end("x") },
  { name: "writeHead(status)", answer: (res) => { res.writeHead(308); res.end(); } },
  {
    name: "writeHead(status, object) replaces the floor",
    answer: (res) => { res.writeHead(200, { "Content-Security-Policy": ROUTE_CSP, "x-frame-options": "SAMEORIGIN" }); res.end(); },
    own: { "content-security-policy": ROUTE_CSP, "x-frame-options": "SAMEORIGIN" },
  },
  {
    name: "writeHead(status, message, object)",
    answer: (res) => { res.writeHead(400, "Bad Request", { "Referrer-Policy": "no-referrer" }); res.end(); },
    own: { "referrer-policy": "no-referrer" },
  },
  {
    name: "writeHead(status, raw array)",
    answer: (res) => { res.writeHead(200, ["Content-Security-Policy", ROUTE_CSP]); res.end(); },
    own: { "content-security-policy": ROUTE_CSP },
  },
  {
    name: "a header set by the route stays",
    answer: (res) => { res.setHeader("referrer-policy", "no-referrer"); res.setHeader("Content-Security-Policy", ROUTE_CSP); res.end(); },
    own: { "referrer-policy": "no-referrer", "content-security-policy": ROUTE_CSP },
  },
  {
    name: "flushHeaders()",
    answer: (res) => { res.statusCode = 400; res.flushHeaders(); res.end(); },
  },
];

class FloorResponse extends ServerResponse {}
installSecurityHeaderFloor(FloorResponse.prototype);

type ResponseClass = new (req: IncomingMessage) => ServerResponse;

async function fetchHeaders(answer: (res: ServerResponse) => void, Response: ResponseClass = FloorResponse) {
  const server = createServer({ ServerResponse: Response as typeof ServerResponse }, (_req, res) => answer(res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise<{ status: number; headers: IncomingHttpHeaders; raw: string[] }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/prijava//x" }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, raw: res.rawHeaders }));
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("security header floor (DAN-498)", () => {
  it("carries the same values as next.config.ts and a policy that allows nothing", () => {
    expect(FLOOR_HEADERS.slice(0, SECURITY_HEADERS.length)).toEqual(SECURITY_HEADERS);
    expect(FLOOR_HEADERS.at(-1)).toEqual({
      key: "Content-Security-Policy",
      value: "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    });
  });

  for (const row of ROWS) {
    it(`${row.name}: every floor header arrives exactly once`, async () => {
      const { headers, raw } = await fetchHeaders(row.answer);
      for (const { key, value } of FLOOR_HEADERS) {
        const name = key.toLowerCase();
        expect(headers[name], name).toBe(row.own?.[name] ?? value);
        expect(raw.filter((_, i) => i % 2 === 0 && raw[i].toLowerCase() === name), name).toHaveLength(1);
      }
    });
  }

  it("does nothing once the headers are sent", async () => {
    let thrown: unknown = "not called";
    const { status, headers } = await fetchHeaders((res) => {
      res.writeHead(204, { "x-frame-options": "SAMEORIGIN" });
      try {
        res.writeHead(500);
        thrown = null;
      } catch (error) {
        thrown = error;
      }
      res.end();
    });
    expect(status).toBe(204);
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    // Node's own writeHead error, not the setHeader one from inside the floor.
    expect((thrown as Error).message).toBe("Cannot write headers after they are sent to the client");
  });

  it("wraps writeHead once when installed twice", () => {
    class Twice extends ServerResponse {}
    expect(installSecurityHeaderFloor(Twice.prototype)).toBe(true);
    const wrapped = Twice.prototype.writeHead;
    expect(installSecurityHeaderFloor(Twice.prototype)).toBe(false);
    expect(Twice.prototype.writeHead).toBe(wrapped);
  });

  it("a response without the floor has none of these headers (the test is not vacuous)", async () => {
    class Plain extends ServerResponse {}
    const { headers } = await fetchHeaders((res) => { res.writeHead(308); res.end(); }, Plain);
    for (const { key } of FLOOR_HEADERS) expect(headers[key.toLowerCase()], key).toBeUndefined();
  });
});
