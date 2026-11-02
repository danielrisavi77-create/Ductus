// The addresses the fake provider sends the browser back to. Local and CI only
// (D-09). The login E2E runs the app over https (the session cookie is Secure,
// and WebKit stores it only on a secure origin); every other local flow keeps
// http, so both are registered by default.

export const DEFAULT_REDIRECT_URIS = ["http://localhost:3000/api/auth/callback", "https://localhost:3000/api/auth/callback"];
export const DEFAULT_POST_LOGOUT_REDIRECT_URIS = ["http://localhost:3000/", "https://localhost:3000/"];

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
  }
  return [...new Set(entries)];
}
