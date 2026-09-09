import { prisma } from "./db";
import { CONFIG } from "./config";
import { appendAudit, AUDIT_TYPES } from "./audit";
import { evaluateAllActive } from "./geofence-engine";
import { bus, CHANNEL } from "./events";

/**
 * Background sweeper (§25 — stale-state prevention):
 *  1. Fail-safe auto-activates COUNTDOWN incidents whose 10s expired
 *     (e.g. victim closed the tab before pressing Activate).
 *  2. Periodically re-runs the geofence engine for all ACTIVE incidents
 *     so zones stay fresh even if some clients stop streaming.
 */
export function startSweeper(): void {
  const g = globalThis as unknown as { __safeguardSweeper?: ReturnType<typeof setInterval> };
  if (g.__safeguardSweeper) return; // already running in this process

  g.__safeguardSweeper = setInterval(async () => {
    try {
      // 1. Countdown fail-safe.
      const expired = await prisma.incident.findMany({
        where: { status: "COUNTDOWN", countdownEndsAt: { lte: new Date() } },
        select: { id: true, victimId: true },
      });
      for (const inc of expired) {
        try {
          await prisma.$transaction(async (tx) => {
            const updated = await tx.incident.updateMany({
              where: { id: inc.id, status: "COUNTDOWN" },
              data: { status: "ACTIVE", activatedAt: new Date() },
            });
            if (updated.count > 0) {
              await appendAudit(tx, inc.id, {
                type: AUDIT_TYPES.INCIDENT_ACTIVATED,
                data: { auto: true, reason: "COUNTDOWN_EXPIRED" },
              });
            }
          });
          bus.publish(CHANNEL.incident(inc.id), "incident:activated", { incidentId: inc.id });
          bus.publish(CHANNEL.DASHBOARD, "incident:activated", { incidentId: inc.id, victimId: inc.victimId });
        } catch (err) {
          console.error(`[sweeper] auto-activate failed for ${inc.id}:`, err);
        }
      }

      // 2. Geofence re-evaluation for all ACTIVE incidents.
      await evaluateAllActive();
    } catch (err) {
      console.error("[sweeper] tick failed:", err);
    }
  }, CONFIG.SWEEP_INTERVAL_MS);

  // Don't keep the process alive just for the sweeper.
  g.__safeguardSweeper.unref?.();
}
