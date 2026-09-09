/**
 * Runs once when the Next.js server process boots (nodejs runtime only).
 * Starts the sweeper: auto-activation of expired countdowns and periodic
 * geofence re-evaluation — the §25 stale-state prevention layer.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureBootstrap } = await import("./lib/bootstrap");
    ensureBootstrap();
  }
}
