// DAN-489 review finding: without this route an unknown /api/* path rendered
// app/not-found.tsx as HTML. The middleware gives /api/* no nonce and
// next.config.ts puts `default-src 'none'` on it, so that page arrived
// unstyled and with its scripts refused. Specific routes under app/api win
// over this catch-all; it only answers paths no route handles.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
