import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "s".repeat(40);
const ORIGIN = "https://sb-editor.vercel.run";

function hostedEnv() {
  vi.stubEnv("FRAMEKIT_HOSTED", "1");
  vi.stubEnv("FRAMEKIT_ACCESS_SECRET", SECRET);
  vi.stubEnv("FRAMEKIT_PUBLIC_URL", ORIGIN + "/");
  vi.stubEnv("FRAMEKIT_PROJECT_ROOT", "/vercel/sandbox/site/swipz-landing");
  vi.stubEnv("FRAMEKIT_PREVIEW_PORT", "3100");
  vi.stubEnv("FRAMEKIT_PREVIEW_PUBLIC_URL", "https://sb-preview.vercel.run/");
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

describe("hosted tokens", () => {
  it("signs, verifies and rejects tampered, expired or wrong-kind tokens", async () => {
    const { signToken, verifyToken } = await import("@/lib/hosted/config");
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signToken({ kind: "launch", sub: "connor@example.com", exp }, SECRET);
    expect(verifyToken(token, "launch", SECRET)).toMatchObject({ sub: "connor@example.com" });
    expect(verifyToken(token, "session", SECRET)).toBeNull(); // a launch link isn't a session
    expect(verifyToken(token, "launch", "x".repeat(40))).toBeNull();
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ kind: "launch", sub: "attacker@example.com", exp })).toString("base64url");
    expect(verifyToken(`${forged}.${mac}`, "launch", SECRET)).toBeNull();
    expect(verifyToken(`${body}.`, "launch", SECRET)).toBeNull();
    expect(verifyToken(signToken({ kind: "launch", sub: "a", exp: Math.floor(Date.now() / 1000) - 1 }, SECRET), "launch", SECRET)).toBeNull();
  });

  it("checks the launcher's control secret", async () => {
    const { isControlRequest } = await import("@/lib/hosted/config");
    expect(isControlRequest(new Request(ORIGIN, { headers: { "x-framekit-secret": SECRET } }), SECRET)).toBe(true);
    expect(isControlRequest(new Request(ORIGIN, { headers: { "x-framekit-secret": "nope" } }), SECRET)).toBe(false);
    expect(isControlRequest(new Request(ORIGIN), SECRET)).toBe(false);
  });
});

describe("hosted proxy", () => {
  it("turns a launch link into a session cookie, then requires it", async () => {
    hostedEnv();
    const { signToken } = await import("@/lib/hosted/config");
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    const launch = signToken({ kind: "launch", sub: "connor@example.com", exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);

    const first = proxy(new NextRequest(`${ORIGIN}/?access=${launch}&project=x`));
    expect(first.status).toBe(307);
    expect(first.headers.get("location")).toBe(`${ORIGIN}/editor?project=x`);
    const cookie = first.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^fk_session=[^;]+; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=None; Partitioned$/);

    const session = cookie.split(";")[0];
    expect(proxy(new NextRequest(`${ORIGIN}/editor`, { headers: { cookie: session } })).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(new NextRequest(`${ORIGIN}/editor`)).status).toBe(401);
    expect((await proxy(new NextRequest(`${ORIGIN}/api/projects/current`)).json()).error.code).toBe("UNAUTHORIZED");
    expect(proxy(new NextRequest(`${ORIGIN}/?access=garbage`)).status).toBe(401);
    // Control endpoints authorize themselves with the shared secret.
    expect(proxy(new NextRequest(`${ORIGIN}/api/hosted/health`)).headers.get("x-middleware-next")).toBe("1");
  });

  it("does nothing outside hosted mode", async () => {
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    expect(proxy(new NextRequest("http://127.0.0.1:3000/editor")).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("hosted API guard", () => {
  it("needs a session and refuses cross-origin mutations", async () => {
    hostedEnv();
    const { signToken } = await import("@/lib/hosted/config");
    const { assertLocalRequest, editorOriginFrom, requestUser, assertNotHosted } = await import("@/lib/session/http");
    const session = signToken({ kind: "session", sub: "connor@example.com", exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
    const cookie = `fk_session=${session}`;

    expect(() => assertLocalRequest(new Request(`${ORIGIN}/api/save`, { method: "POST", headers: { origin: ORIGIN } }))).toThrow(/sign in/);
    expect(() => assertLocalRequest(new Request(`${ORIGIN}/api/save`, { method: "POST", headers: { origin: ORIGIN, cookie } }))).not.toThrow();
    expect(() => assertLocalRequest(new Request(`${ORIGIN}/api/save`, { method: "POST", headers: { origin: "https://evil.example", cookie } }))).toThrow(/Cross-origin/);
    expect(() => assertLocalRequest(new Request(`${ORIGIN}/api/projects/current`, { headers: { cookie } }))).not.toThrow();
    expect(requestUser(new Request(ORIGIN, { headers: { cookie } }))).toBe("connor@example.com");
    expect(editorOriginFrom(new Request("http://10.0.0.5:3000/api/projects/open"))).toBe(ORIGIN);
    expect(() => assertNotHosted()).toThrow(/Not available/);
  });

  it("only opens the hosted project", async () => {
    hostedEnv();
    const { signToken } = await import("@/lib/hosted/config");
    const { POST } = await import("@/app/api/projects/open/route");
    const cookie = `fk_session=${signToken({ kind: "session", sub: "a@b.c", exp: Math.floor(Date.now() / 1000) + 60 }, SECRET)}`;
    const res = await POST(new Request(`${ORIGIN}/api/projects/open`, { method: "POST", headers: { origin: ORIGIN, cookie, "content-type": "application/json" }, body: JSON.stringify({ path: "/etc" }) }));
    expect(res.status).toBe(403);
  });
});
