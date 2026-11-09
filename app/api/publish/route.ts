import { z } from "zod";
import { currentSession } from "@/lib/session/registry";
import { assertLocalRequest, errorResponse, json, requestUser } from "@/lib/session/http";
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
    return json(await publish(session.project.root, message, requestUser(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
