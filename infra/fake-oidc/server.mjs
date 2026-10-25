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

// The v3 tokens of app/globals.css as values (#732 item 2): this server is a
// separate process and cannot load the app's stylesheet, so the page repeats
// the few it needs to look like the sign-in screen it is reached from.
const PAGE_STYLE = `
:root { color-scheme: dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
  box-sizing: border-box; background: #091310; color: #eef3e9;
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: min(430px, 100%); box-sizing: border-box; padding: 30px 30px 24px;
  background: #12211c; border: 1px solid #24372e; border-radius: 14px;
  box-shadow: 0 1px 1px #0007, 0 12px 34px -10px #000a; text-align: center; }
.tag { display: inline-block; padding: 2px 10px; border-radius: 8px; background: #173c2d;
  color: #8ee3be; font-size: 12px; font-weight: 600; }
h1 { margin: 12px 0 8px; font-size: 24px; font-weight: 400; }
p { margin: 0 0 20px; font-size: 13px; color: #a3b5aa; }
form { display: grid; gap: 10px; }
button { min-height: 48px; padding: 12px 18px; border: 0; border-radius: 8px;
  background: #8ee3be; color: #091310; font: inherit; font-weight: 600; cursor: pointer; }
button:hover { background: #99f5cd; }
button:focus-visible { outline: 2px solid #eef3e9; outline-offset: 2px; }
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
<title>Demo prijava</title><style>${PAGE_STYLE}</style></head>
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
