// Fake OIDC provider for local development and CI only. Students sign in with
// AAI@EduHr alone (D-09); this server exists so the app can be built and
// tested without it, and its page says so ("demo prijava"). The accounts are
// invented and carry the attribute names AAI@EduHr releases.
import { createServer } from "node:http";

import Provider from "oidc-provider";
import { ACCOUNTS, demoAccountClaims, isDemoAccountId } from "./accounts.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const ISSUER = process.env.ISSUER ?? `http://localhost:${PORT}`;
const REDIRECT_URI = process.env.REDIRECT_URI ?? "http://localhost:3000/api/auth/callback";

const provider = new Provider(ISSUER, {
  clients: [
    {
      client_id: "ductus-local",
      client_secret: "ductus-local-only",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "client_secret_basic",
    },
  ],
  pkce: { required: () => true },
  cookies: { keys: ["ductus-fake-oidc-local-only"] },
  features: { devInteractions: { enabled: false } },
  interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
  claims: {
    openid: ["sub"],
    profile: ["name", "given_name", "family_name", "hrEduPersonUniqueID", "hrEduPersonHomeOrg", "hrEduPersonAffiliation"],
  },
  // First-party demo client: grant the requested scopes without a consent step.
  async loadExistingGrant(ctx) {
    const grant = new ctx.oidc.provider.Grant({
      clientId: ctx.oidc.client.clientId,
      accountId: ctx.oidc.session.accountId,
    });
    grant.addOIDCScope("openid profile");
    await grant.save();
    return grant;
  },
  async findAccount(_ctx, id) {
    const claims = demoAccountClaims(id);
    if (!claims) return undefined;
    return {
      accountId: id,
      async claims() {
        return claims;
      },
    };
  },
});

const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// The app's "D" mark on --ground and --accent (DAN-345 follow-up): without
// it the browser's request for /favicon.ico ended in the provider's 404.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\
<rect width="64" height="64" rx="10" fill="#2b1f38"/>\
<text x="32" y="50" text-anchor="middle" fill="#f0b573" font-family="Georgia,serif" font-size="52">D</text></svg>`;

// The tokens of app/globals.css as values (#732 item 2, palette DAN-344): this server is a
// separate process and cannot load the app's stylesheet, so the page repeats
// the few it needs to look like the sign-in screen it is reached from.
const PAGE_STYLE = `
:root { color-scheme: dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
  box-sizing: border-box; background: #2b1f38; color: #f8f1f4;
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: min(430px, 100%); box-sizing: border-box; padding: 30px 30px 24px;
  background: #392a44; border: 1px solid #86738c; border-radius: 6px;
  box-shadow: 0 1px 1px #0007, 0 12px 34px -10px #000a; text-align: center; }
.tag { display: inline-block; padding: 2px 10px; border-radius: 4px; background: #3c2a4a;
  color: #f0b573; font-size: 12px; font-weight: 600; }
h1 { margin: 12px 0 8px; font-size: 24px; font-weight: 400; }
p { margin: 0 0 20px; font-size: 13px; color: #e1d5e2; }
form { display: grid; gap: 10px; }
button { min-height: 48px; padding: 12px 18px; border: 0; border-radius: 4px;
  background: #f0b573; color: #21172c; font: inherit; font-weight: 600; cursor: pointer; }
button:hover { background: #ffd19c; }
button:focus-visible { outline: 3px solid #f8f1f4; outline-offset: 4px; }
`;

function loginPage(uid) {
  const buttons = Object.entries(ACCOUNTS)
    .map(
      ([id, account]) =>
        `<button type="submit" name="account" value="${escapeHtml(id)}">${escapeHtml(account.name)}</button>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="hr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo prijava</title><link rel="icon" href="/favicon.ico" type="image/svg+xml"><style>${PAGE_STYLE}</style></head>
<body>
<main>
<span class="tag">Samo lokalno i CI</span>
<h1>Demo prijava</h1>
<p>Ovo nije AAI@EduHr. Lažni pružatelj prijave za lokalni rad i CI; računi su izmišljeni.</p>
<form method="post" action="/interaction/${escapeHtml(uid)}/login">
${buttons}
</form>
</main>
</body>
</html>`;
}

async function readForm(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

async function handleInteraction(req, res) {
  const details = await provider.interactionDetails(req, res);
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(loginPage(details.uid));
    return;
  }
  const accountId = (await readForm(req)).get("account");
  if (req.method !== "POST" || !isDemoAccountId(accountId)) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Nepoznat demo račun.");
    return;
  }
  await provider.interactionFinished(req, res, { login: { accountId } }, { mergeWithLastSubmission: false });
}

const providerCallback = provider.callback();

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/favicon.ico") {
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=3600" });
    res.end(FAVICON_SVG);
    return;
  }
  if (req.url?.startsWith("/interaction/")) {
    handleInteraction(req, res).catch((error) => {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end(String(error?.message ?? error));
    });
    return;
  }
  providerCallback(req, res);
}).listen(PORT, () => {
  console.log(`fake OIDC (demo prijava) on ${ISSUER}`);
});
