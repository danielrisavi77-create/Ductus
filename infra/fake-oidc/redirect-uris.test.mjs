import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_POST_LOGOUT_REDIRECT_URIS, DEFAULT_REDIRECT_URIS, redirectUriList } from "./redirect-uris.mjs";

const FALLBACK = ["http://localhost:3000/x"];

// Input classes of the parser: unset, empty, blank, one address, several,
// padded, trailing separator, repeated, not an address, not http(s).
const ACCEPTED = [
  ["unset uses the fallback", undefined, FALLBACK],
  ["empty uses the fallback", "", FALLBACK],
  ["blank uses the fallback", "  \t ", FALLBACK],
  ["one address", "https://localhost:3000/a", ["https://localhost:3000/a"]],
  ["two addresses keep their order", "http://localhost:3000/a,https://localhost:3000/a", ["http://localhost:3000/a", "https://localhost:3000/a"]],
  ["padding is trimmed", " http://localhost:3000/a , https://localhost:3000/a ", ["http://localhost:3000/a", "https://localhost:3000/a"]],
  ["a trailing separator adds nothing", "https://localhost:3000/a,", ["https://localhost:3000/a"]],
  ["a repeated address is kept once", "https://localhost:3000/a,https://localhost:3000/a", ["https://localhost:3000/a"]],
];
for (const [name, value, expected] of ACCEPTED) {
  test(`redirect list: ${name}`, () => assert.deepEqual(redirectUriList(value, FALLBACK), expected));
}

const REFUSED = [
  ["not an address", "localhost:3000/a"],
  ["a script scheme", "javascript:alert(1)"],
  ["a file scheme", "file:///etc/passwd"],
  ["one bad entry among good ones", "https://localhost:3000/a,nonsense"],
  ["only separators", " , ,"],
];
for (const [name, value] of REFUSED) {
  test(`redirect list refuses ${name}`, () => assert.throws(() => redirectUriList(value, FALLBACK), /redirect/i));
}

test("the defaults register the callback and the way back for http and https, on the one app origin", () => {
  assert.deepEqual(DEFAULT_REDIRECT_URIS, [
    "http://localhost:3000/api/auth/callback",
    "https://localhost:3000/api/auth/callback",
    "https://127.0.0.1:3000/api/auth/callback",
  ]);
  assert.deepEqual(DEFAULT_POST_LOGOUT_REDIRECT_URIS, ["http://localhost:3000/", "https://localhost:3000/", "https://127.0.0.1:3000/"]);
});
