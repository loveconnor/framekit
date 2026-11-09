import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Hosted mode: Framekit runs inside a cloud sandbox next to one site's code, opened from that site's
 * admin dashboard instead of on a developer's own machine. Everything here is off unless
 * FRAMEKIT_HOSTED=1, so the local app behaves exactly as before.
 */
export type HostedConfig = {
  /** Public origin Framekit is served at, e.g. https://sb-abc.vercel.run */
  publicOrigin: string;
  /** The one project this instance edits. */
  projectRoot: string;
  /** Fixed port for the site's preview dev server, and the public URL it's reachable at. */
  previewPort: number;
  previewPublicUrl: string;
  /** Shared with the launcher (the site's backend): signs access links and authorizes control calls. */
  secret: string;
};

let cached: HostedConfig | null | undefined;

export function hostedConfig(): HostedConfig | null {
  if (cached !== undefined) return cached;
  if (process.env.FRAMEKIT_HOSTED !== "1") return (cached = null);
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Hosted Framekit needs ${name}.`);
    return value;
  };
  const secret = required("FRAMEKIT_ACCESS_SECRET");
  if (secret.length < 32) throw new Error("FRAMEKIT_ACCESS_SECRET must be at least 32 characters.");
  cached = {
    publicOrigin: new URL(required("FRAMEKIT_PUBLIC_URL")).origin,
    projectRoot: required("FRAMEKIT_PROJECT_ROOT"),
    previewPort: Number(required("FRAMEKIT_PREVIEW_PORT")),
    previewPublicUrl: required("FRAMEKIT_PREVIEW_PUBLIC_URL").replace(/\/$/, ""),
    secret,
  };
  return cached;
}

/* ------------------------------------------------------------------ */
/* Signed tokens                                                       */
/* ------------------------------------------------------------------ */

/**
 * `launch`: a short-lived link the launcher hands an admin (minutes). `session`: the cookie Framekit
 * issues after checking a launch link (hours). Both are `base64url(payload).base64url(hmac)`.
 */
export type AccessToken = { kind: "launch" | "session"; sub: string; exp: number };

export const SESSION_COOKIE = "fk_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const b64 = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export function signToken(token: AccessToken, secret: string): string {
  const body = b64(JSON.stringify(token));
  return `${body}.${b64(createHmac("sha256", secret).update(body).digest())}`;
}

export function verifyToken(value: string | null | undefined, kind: AccessToken["kind"], secret: string, now = Date.now()): AccessToken | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const token = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessToken;
    if (token.kind !== kind || typeof token.sub !== "string" || !token.sub || typeof token.exp !== "number") return null;
    if (token.exp * 1000 <= now) return null;
    return token;
  } catch {
    return null;
  }
}

/** Constant-time check of the launcher's control secret (`x-framekit-secret`). */
export function isControlRequest(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("x-framekit-secret") ?? "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

/** The signed-in admin for a hosted request, or null. */
export function hostedUser(request: Request, config: HostedConfig): string | null {
  return verifyToken(readCookie(request, SESSION_COOKIE), "session", config.secret)?.sub ?? null;
}

/* ------------------------------------------------------------------ */
/* Activity, so the launcher can stop an idle sandbox                  */
/* ------------------------------------------------------------------ */

type Activity = { last: number; openEditors: number };
const activityStore = globalThis as unknown as { __framekitActivity?: Activity };
activityStore.__framekitActivity ??= { last: Date.now(), openEditors: 0 };

export function touchActivity(): void {
  activityStore.__framekitActivity!.last = Date.now();
}

/** Track an open editor (its live event stream); returns the release function. */
export function editorOpened(): () => void {
  const a = activityStore.__framekitActivity!;
  a.openEditors++;
  a.last = Date.now();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    a.openEditors = Math.max(0, a.openEditors - 1);
    a.last = Date.now();
  };
}

export function activitySnapshot(): { idleMs: number; openEditors: number } {
  const a = activityStore.__framekitActivity!;
  return { idleMs: a.openEditors > 0 ? 0 : Date.now() - a.last, openEditors: a.openEditors };
}
