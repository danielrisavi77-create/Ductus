// Liveness (DAN-299): the process answers. It reads no database, no session
// and no environment, and says nothing about the build or the host, so it is
// safe without a login. Readiness is a separate route.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
