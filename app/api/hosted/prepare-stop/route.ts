import { activitySnapshot, hostedConfig, isControlRequest } from "@/lib/hosted/config";
import { currentSession } from "@/lib/session/registry";

/**
 * Called by the launcher right before it stops an idle sandbox: save pending edits to disk (only the
 * filesystem survives a stop). Refuses if an editor is open, so a stop never pulls the rug from
 * under someone.
 */
export async function POST(request: Request) {
  const hosted = hostedConfig();
  if (!hosted || !isControlRequest(request, hosted.secret)) return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  const activity = activitySnapshot();
  if (activity.openEditors > 0) return Response.json({ ok: false, reason: "in-use", ...activity }, { status: 409 });
  const session = currentSession();
  try {
    const saved = session ? await session.flush() : false;
    return Response.json({ ok: true, saved });
  } catch (error) {
    return Response.json({ ok: false, reason: "save-failed", message: (error as Error).message }, { status: 500 });
  }
}
