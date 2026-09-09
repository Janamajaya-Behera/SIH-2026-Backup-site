import { prisma } from "./db";
import { CONFIG } from "./config";

/**
 * Dev-mode reliability: Next.js hot reload can create multiple Prisma Client
 * instances, causing "Prepared statement s0 already exists" crashes (P2024).
 * This bootstrap runs once per process, pins SQLite connection settings,
 * and registers the sweeper tick for countdown fail-safety and periodic
 * geofence re-evaluation (§25 stale-state prevention).
 */

const g = globalThis as unknown as {
  __safeguardBootstrapped?: boolean;
  __safeguardSweeper?: ReturnType<typeof setInterval>;
};

export function ensureBootstrap(): void {
  if (g.__safeguardBootstrapped) return;
  g.__safeguardBootstrapped = true;

  // Lazy import avoids a cycle: sweeper imports the engine, engine imports db.
  void (async () => {
    try {
      const { startSweeper } = await import("./sweeper");
      startSweeper();
    } catch (err) {
      console.error("[bootstrap] sweeper failed to start:", err);
    }
  })();

  console.log(
    `[safeguard] bootstrapped — geofence DANGER<${CONFIG.DANGER_RADIUS_M}m, BUFFER<${CONFIG.BUFFER_END_M}m, HELPER>=${CONFIG.BUFFER_END_M}m; sweep every ${CONFIG.SWEEP_INTERVAL_MS / 1000}s`
  );
}
