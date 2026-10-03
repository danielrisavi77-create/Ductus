// Fake OIDC provider for local development and CI only. Students sign in with
// AAI@EduHr alone (D-09); this server exists so the app can be built and
// tested without it, and its page says so ("demo prijava"). The accounts are
// invented and carry the attribute names AAI@EduHr releases.
import { createServer } from "node:http";

import Provider from "oidc-provider";

const PORT = Number(process.env.PORT ?? 8080);
const ISSUER = process.env.ISSUER ?? `http://localhost:${PORT}`;
const REDIRECT_URI = process.env.REDIRECT_URI ?? "http://localhost:3000/api/auth/callback";

const DEMO_HOME_ORG = "demo.ductus.test";
const ACCOUNTS = {
  "demo-student": { name: "Demo studentica", affiliation: "student" },
  "demo-teacher": { name: "Demo nastavnik", affiliation: "employee" },
};

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
    profile: ["name", "hrEduPersonUniqueID", "hrEduPersonHomeOrg", "hrEduPersonAffiliation"],
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
    const account = ACCOUNTS[id];
    if (!account) return undefined;
    return {
      accountId: id,
      async claims() {
        return {
          sub: id,
          name: account.name,
          hrEduPersonUniqueID: `${id}@${DEMO_HOME_ORG}`,
          hrEduPersonHomeOrg: DEMO_HOME_ORG,
          hrEduPersonAffiliation: account.affiliation,
        };
      },
    };
  },
});

const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function loginPage(uid) {
  const buttons = Object.entries(ACCOUNTS)
    .map(
      ([id, account]) =>
        `<button type="submit" name="account" value="${escapeHtml(id)}">${escapeHtml(account.name)}</button>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="hr">
<head><meta charset="utf-8"><title>Demo prijava</title></head>
<body>
<h1>Demo prijava</h1>
<p>Ovo nije AAI@EduHr. Lažni pružatelj prijave za lokalni rad i CI; računi su izmišljeni.</p>
<form method="post" action="/interaction/${escapeHtml(uid)}/login">
${buttons}
</form>
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
  if (req.method !== "POST" || !accountId || !(accountId in ACCOUNTS)) {
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
