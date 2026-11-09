import { connection } from "next/server";
import { hostedConfig } from "@/lib/hosted/config";
import { currentSession } from "@/lib/session/registry";

/** Public readiness check for the launcher: is Framekit up, and is the site's preview ready? */
export async function GET() {
  await connection(); // live status: never prerender at build time
  if (!hostedConfig()) return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  const session = currentSession();
  const phase = session?.snapshot().phase ?? "opening";
  return Response.json({ ok: true, phase, ready: phase === "ready" }, { headers: { "Cache-Control": "no-store" } });
}
