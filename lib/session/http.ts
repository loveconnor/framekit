import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ProjectError } from "@/types/project";
import { SessionError } from "./session";
import { hostedConfig, hostedUser, touchActivity } from "@/lib/hosted/config";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(error: unknown) {
  if (error instanceof ProjectError) {
    return NextResponse.json({ error: error.info }, { status: 400 });
  }
  if (error instanceof SessionError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: error.issues.map((i) => i.message).join("; ") } }, { status: 400 });
  }
  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: (error as Error)?.message ?? "Unexpected error" } },
    { status: 500 },
  );
}

/**
 * Requests must come from the editor itself: on loopback locally; in hosted mode, from a signed-in
 * admin (session cookie) on Framekit's own origin. The API edits files on disk.
 */
export function assertLocalRequest(request: Request): void {
  const hosted = hostedConfig();
  if (hosted) {
    if (!hostedUser(request, hosted)) throw new SessionError("Open the editor from your site's dashboard to sign in.", "UNAUTHORIZED", 401);
    // The session cookie is sent cross-site (the editor is embedded), so refuse mutations from other origins.
    const origin = request.headers.get("origin");
    if (request.method !== "GET" && request.method !== "HEAD" && origin !== hosted.publicOrigin) {
      throw new SessionError("Cross-origin requests are not allowed.", "FORBIDDEN", 403);
    }
    touchActivity();
    return;
  }
  const host = request.headers.get("host") ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
    throw new SessionError("Framekit only accepts requests from the local machine.", "FORBIDDEN", 403);
  }
  const origin = request.headers.get("origin");
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
    throw new SessionError("Cross-origin requests are not allowed.", "FORBIDDEN", 403);
  }
}

/** Machine-level actions (browse folders, open other projects) don't exist in hosted mode. */
export function assertNotHosted(): void {
  if (hostedConfig()) throw new SessionError("Not available in the hosted editor.", "FORBIDDEN", 403);
}

/** Email of the signed-in admin in hosted mode (null locally). */
export function requestUser(request: Request): string | null {
  const hosted = hostedConfig();
  return hosted ? hostedUser(request, hosted) : null;
}

export function editorOriginFrom(request: Request): string {
  // Behind the sandbox proxy the request's own host/protocol aren't the public ones.
  const hosted = hostedConfig();
  if (hosted) return hosted.publicOrigin;
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  return `${url.protocol}//${host}`;
}
