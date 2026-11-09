/**
 * Hosted mode: open the one project this instance edits as soon as the server starts, so the editor
 * is ready (or already booting) by the time someone arrives from the site's dashboard.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.FRAMEKIT_HOSTED !== "1") return;
  const { hostedConfig } = await import("@/lib/hosted/config");
  const { openProject, currentSession } = await import("@/lib/session/registry");
  const hosted = hostedConfig()!;
  if (currentSession()) return;
  try {
    await openProject(hosted.projectRoot, hosted.publicOrigin);
  } catch (error) {
    console.error("[framekit] Could not open the hosted project:", error);
  }
}
