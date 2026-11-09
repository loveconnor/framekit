import { NextResponse, type NextRequest } from "next/server";
import { hostedConfig, readCookie, SESSION_COOKIE, SESSION_TTL_SECONDS, signToken, verifyToken } from "@/lib/hosted/config";

/**
 * Only does anything in hosted mode (FRAMEKIT_HOSTED=1), where Framekit is reachable on a public URL:
 * a signed launch link from the site's dashboard becomes a session cookie, and everything else
 * needs that cookie. API routes check the session again themselves (assertLocalRequest).
 */
export function proxy(request: NextRequest) {
  const hosted = hostedConfig();
  if (!hosted) return NextResponse.next();
  const { pathname, searchParams } = request.nextUrl;

  // Launcher control calls authorize with the shared secret inside the route.
  if (pathname.startsWith("/api/hosted/")) return NextResponse.next();

  const launch = searchParams.get("access");
  if (launch) {
    const token = verifyToken(launch, "launch", hosted.secret);
    if (!token) return denied(pathname, "This editor link has expired. Open Edit Site from the dashboard again.");
    const target = new URL(pathname === "/" ? "/editor" : pathname, hosted.publicOrigin);
    searchParams.forEach((value, key) => {
      if (key !== "access") target.searchParams.set(key, value);
    });
    const response = NextResponse.redirect(target);
    const session = signToken({ kind: "session", sub: token.sub, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }, hosted.secret);
    // Partitioned + SameSite=None: the editor runs in the dashboard's iframe, where browsers that block
    // third-party cookies still keep a cookie partitioned to the embedding site.
    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${encodeURIComponent(session)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=None; Partitioned`,
    );
    return response;
  }

  if (!verifyToken(readCookie(request, SESSION_COOKIE), "session", hosted.secret)) {
    return denied(pathname, "Open Edit Site from your site's dashboard to sign in.");
  }
  if (pathname === "/") return NextResponse.redirect(new URL("/editor", hosted.publicOrigin));
  return NextResponse.next();
}

function denied(pathname: string, message: string) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message } }, { status: 401 });
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to edit</title><style>body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;font:14px/1.5 system-ui,sans-serif;color:#171717;background:#f7f7f7;padding:24px;text-align:center}</style></head><body><p>${message.replace(/</g, "&lt;")}</p></body></html>`;
  return new NextResponse(html, { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
