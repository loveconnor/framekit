import { z } from "zod";
import { currentSession, openProject } from "@/lib/session/registry";
import { assertLocalRequest, editorOriginFrom, errorResponse, json, requestUser } from "@/lib/session/http";
import { hostedConfig } from "@/lib/hosted/config";
import { SessionError } from "@/lib/session/session";
import { defaultMessage, publish, publishStatus } from "@/lib/project/publish";

function requireSession() {
  const session = currentSession();
  if (!session) throw new SessionError("No project is open.", "NO_PROJECT", 404);
  return session;
}

/** What Publish would commit and push, after fetching the upstream. */
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const session = requireSession();
    const status = await publishStatus(session.project.root);
    return json({
      status,
      defaultMessage: status.available && status.files.length ? defaultMessage(status.files) : "",
      unsavedEdits: session.isDirty,
      // Hosted: Publish saves pending edits and brings in newer upstream commits by itself.
      hosted: hostedConfig() !== null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

const Body = z.object({ message: z.string().max(500).default("") });

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const session = requireSession();
    const { message } = Body.parse(await request.json().catch(() => ({})));
    if (!hostedConfig()) return json(await publish(session.project.root, message));
    // Nobody in the hosted editor can save by hand or run git, so Publish does both.
    await session.flush();
    const result = await publish(session.project.root, message, { publisher: requestUser(request), sync: true });
    // The site's files changed under the open session: start over from what's on disk now.
    if (result.synced) await openProject(session.project.root, editorOriginFrom(request));
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
