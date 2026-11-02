import type { ServerResponse } from "node:http";

import { STATIC_CONTENT_SECURITY_POLICY } from "./content-security-policy";

/**
 * The security headers of every response (DAN-296, DAN-489). next.config.ts
 * sets them on `/:path*`; the floor below puts the same values on the
 * responses Next.js sends before it applies the config (DAN-498).
 */
export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Ignored over plain http (RFC 6797 §8.1); it acts behind TLS on staging.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), clipboard-write=(self)",
  },
] as const;

/**
 * What the floor adds when a response has none of its own: the config headers
 * and a Content-Security-Policy that lets nothing load or run. Pages, API
 * routes and static files already carry their own policy (middleware.ts,
 * next.config.ts); the floor only reaches answers that skip both.
 */
export const FLOOR_HEADERS: readonly { key: string; value: string }[] = [
  ...SECURITY_HEADERS,
  { key: "Content-Security-Policy", value: STATIC_CONTENT_SECURITY_POLICY },
];

const INSTALLED = Symbol.for("ductus.securityHeaderFloor");

type Prototype = typeof ServerResponse.prototype & { [INSTALLED]?: true };

/**
 * DAN-498: the Next.js router answers some requests before `headers()` and
 * the middleware run, e.g. a 308 for `//` or `\` in the path or for a
 * trailing slash, and an HTML 400 for a path it cannot decode. Wrapping
 * `writeHead`, which `end()` also calls, gives those answers the floor.
 *
 * Only a header the response does not have is set, so a value from a route,
 * the middleware or the config stays. Headers passed to `writeHead` itself
 * replace earlier `setHeader` values in Node, so they win over the floor too.
 * Installing twice wraps once. Returns whether this call installed it.
 */
export function installSecurityHeaderFloor(prototype: Prototype): boolean {
  if (prototype[INSTALLED]) return false;
  const writeHead = prototype.writeHead;
  prototype.writeHead = function writeHeadWithFloor(this: ServerResponse, ...args: unknown[]) {
    if (!this.headersSent) {
      for (const { key, value } of FLOOR_HEADERS) {
        if (!this.hasHeader(key)) this.setHeader(key, value);
      }
    }
    return (writeHead as (...a: unknown[]) => ServerResponse).apply(this, args);
  } as typeof writeHead;
  prototype[INSTALLED] = true;
  return true;
}
