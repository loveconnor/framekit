import { CommandRequestSchema } from "@/lib/commands/schema";
import { currentSession } from "@/lib/session/registry";
import { assertLocalRequest, errorResponse, json } from "@/lib/session/http";
import { SessionError } from "@/lib/session/session";

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const session = currentSession();
    if (!session) throw new SessionError("No project is open.", "NO_PROJECT", 404);
    const body = CommandRequestSchema.parse(await request.json());
    const result = await session.apply(body.command, body.expectedRevision, body.groupKey);
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
