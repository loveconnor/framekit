import { z } from "zod";
import { currentSession } from "@/lib/session/registry";
import { assertLocalRequest, errorResponse, json } from "@/lib/session/http";
import { SessionError } from "@/lib/session/session";

const Body = z.object({ texts: z.array(z.string().max(2000)).max(12) });

/** Which source string renders as this text (for text produced by code, not written on the element). */
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const session = currentSession();
    if (!session) throw new SessionError("No project is open.", "NO_PROJECT", 404);
    const { texts } = Body.parse(await request.json());
    return json({ matches: session.findTextSource(texts) });
  } catch (error) {
    return errorResponse(error);
  }
}
