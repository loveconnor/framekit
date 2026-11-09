import { activitySnapshot, hostedConfig, isControlRequest } from "@/lib/hosted/config";
import { currentSession } from "@/lib/session/registry";

/** For the launcher's idle check: how long since anyone used the editor, and is anything unsaved. */
export async function GET(request: Request) {
  const hosted = hostedConfig();
  if (!hosted || !isControlRequest(request, hosted.secret)) return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const session = currentSession();
  return Response.json({ ...activitySnapshot(), unsaved: session?.isDirty ?? false, phase: session?.snapshot().phase ?? null }, { headers: { "Cache-Control": "no-store" } });
}
