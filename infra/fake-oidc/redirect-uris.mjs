// The addresses the fake provider sends the browser back to. Local and CI only
// (D-09). The login E2E runs the app over https (the session cookie is Secure,
// and WebKit stores it only on a secure origin); every other local flow keeps
// http, so both are registered by default.

// The login E2E uses https://127.0.0.1:3000: browsers do not note an IP address
// as an HSTS host, so the redirect to this provider (http) is not upgraded.
export const DEFAULT_REDIRECT_URIS = [
  "http://localhost:3000/api/auth/callback",
  "https://localhost:3000/api/auth/callback",
  "https://127.0.0.1:3000/api/auth/callback",
];
export const DEFAULT_POST_LOGOUT_REDIRECT_URIS = ["http://localhost:3000/", "https://localhost:3000/", "https://127.0.0.1:3000/"];

// F-019: every address this provider names is on this machine.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True for an http(s) address whose host is this machine. */
export function isLoopbackHttpUrl(url) {
  return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname);
}

/** The issuer from the environment, or the local default; refuses any other host. */
export function loopbackIssuer(value, fallback) {
  const issuer = value ?? fallback;
  let url;
  try {
    url = new URL(issuer);
  } catch {
    throw new Error(`ISSUER is not an address: ${issuer}`);
  }
  if (!isLoopbackHttpUrl(url)) throw new Error(`ISSUER must be http(s) on localhost, 127.0.0.1 or [::1]: ${issuer}`);
  return issuer;
}

/**
 * A comma separated list from the environment. Unset, empty or blank gives the
 * fallback; anything that is not an http(s) address is refused, so a typo
 * stops the provider instead of registering nothing.
 */
export function redirectUriList(value, fallback) {
  if (value === undefined || value.trim() === "") return [...fallback];
  const entries = value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  if (entries.length === 0) throw new Error("redirect URI list has no address");
  for (const entry of entries) {
    let url;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`redirect URI is not an address: ${entry}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`redirect URI must be http or https: ${entry}`);
    if (!isLoopbackHttpUrl(url)) throw new Error(`redirect URI must be on localhost, 127.0.0.1 or [::1]: ${entry}`);
  }
  return [...new Set(entries)];
}
