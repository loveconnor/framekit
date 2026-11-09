import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ProjectError } from "@/types/project";
import { SessionError } from "./session";

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

/** Requests must come from the editor itself on loopback; the API edits files on disk. */
export function assertLocalRequest(request: Request): void {
  const host = request.headers.get("host") ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
    throw new SessionError("Framekit only accepts requests from the local machine.", "FORBIDDEN", 403);
  }
  const origin = request.headers.get("origin");
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
    throw new SessionError("Cross-origin requests are not allowed.", "FORBIDDEN", 403);
  }
}

export function editorOriginFrom(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  return `${url.protocol}//${host}`;
}
