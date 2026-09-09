import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { haversineMeters, classifyZone, isValidCoord, Zone } from "./geo";
import { CONFIG } from "./config";
import { appendAudit, AUDIT_TYPES } from "./audit";
import { bus, CHANNEL } from "./events";
import { notify } from "./notifications";
import { displayedResponderCount } from "./urgency";
import { clusterAlertSuppression } from "./triage";

/**
 * GEOFENCE ENGINE — the heart of SafeGuard SOS (§5, §6).
 *
 * Donut model with LOCKED boundaries:
 *   DANGER  <50m   → node flagged, never alerted, existing response revoked
 *   BUFFER  50–100m → never alerted (intermediate gap)
 *   HELPER  ≥100m  → alert-eligible volunteers
 *
 * The geofence is DYNAMIC: re-evaluated on every location update and on a
 * periodic sweep, so a moving victim re-centers the donut and previously
 * safe nodes can become flagged when they enter the danger zone.
 *
 * Idempotency & race safety (§25): the whole evaluation runs in one
 * transaction; Alert/Response uniqueness constraints make duplicate
 * alerts/responses impossible even under concurrent calls.
 */

interface EngineResult {
  incidentId: string;
  evaluated: number;
  newAlerts: number;
  newFlags: number;
  zones: Record<string, { zone: Zone; distanceM: number; eligible: boolean; flagged: boolean; alerted: boolean }>;
  trueResponderCount: number;
  displayedResponderCount: number;
}

/** Evaluates one ACTIVE incident. Safe to call repeatedly (idempotent). */
export async function evaluateIncident(incidentId: string): Promise<EngineResult | null> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      victim: true,
      responses: true,
      alerts: { select: { userId: true } },
      nodeFlags: { select: { userId: true } },
    },
  });
  if (!incident || incident.status !== "ACTIVE") return null;

  const victimPos = { lat: incident.lastLat, lng: incident.lastLng };

  // All located nodes relevant to this incident: volunteers + test-attacker
  // sim users (for police visibility). Consent-gated (§7).
  const nodes = await prisma.user.findMany({
    where: {
      id: { not: incident.victimId },
      OR: [
        { role: "VOLUNTEER" },
        { role: "TEST_ATTACKER" },
      ],
    },
    include: {
      locations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const alertedSet = new Set(incident.alerts.map((a) => a.userId));
  const flaggedSet = new Set(incident.nodeFlags.map((f) => f.userId));

  // CLUSTER ALERT SUPPRESSION (§10): volunteers already alerted by any
  // sibling incident in the same cluster are not re-alerted here.
  const suppressed = await clusterAlertSuppression(incidentId);

  const zoneMap: EngineResult["zones"] = {};
  const toAlert: Array<{ user: (typeof nodes)[number]; distanceM: number }> = [];
  const toFlag: Array<{ user: (typeof nodes)[number]; distanceM: number }> = [];
  let evaluated = 0;
  let newAlerts = 0;
  let newFlags = 0;

  for (const node of nodes) {
    const last = node.locations[0];
    const entry = { zone: "OUT_OF_RANGE" as Zone, distanceM: 0, eligible: false, flagged: flaggedSet.has(node.id), alerted: alertedSet.has(node.id) };

    if (!last || !isValidCoord(last.lat, last.lng)) {
      // Missing volunteer location (§16): tracked, not eligible, no crash.
      zoneMap[node.anonId] = entry;
      continue;
    }
    evaluated++;

    const distanceM = haversineMeters(victimPos, { lat: last.lat, lng: last.lng });
    const zone = classifyZone(distanceM);
    entry.zone = zone;
    entry.distanceM = Math.round(distanceM);
    entry.eligible = zone === "HELPER" && node.role === "VOLUNTEER";
    zoneMap[node.anonId] = entry;

    // DYNAMIC FLAGGING (§6): a node inside the danger zone is flagged for
    // this incident — sticky, and revokes any existing response.
    if (zone === "DANGER" && !flaggedSet.has(node.id)) {
      toFlag.push({ user: node, distanceM });
      continue;
    }

    // Alert-eligibility: HELPER zone + volunteer + consent + active + not flagged + not already alerted.
    if (
      zone === "HELPER" &&
      node.role === "VOLUNTEER" &&
      node.consentVolunteer &&
      node.volunteerStatus === "ACTIVE" &&
      !flaggedSet.has(node.id) &&
      !alertedSet.has(node.id) &&
      !suppressed.has(node.id)
    ) {
      toAlert.push({ user: node, distanceM });
    }
  }

  // ── Apply changes in a single transaction ──
  if (toFlag.length > 0 || toAlert.length > 0) {
    // Collect post-commit fan-out work so the transaction stays short
    // (Prisma interactive transactions default to a 5s timeout).
    const postCommit: Array<{ userId: string; kind: "alert" | "flag"; distanceM: number }> = [];
    await prisma.$transaction(
      async (tx) => {
      // Flags first: a flagged node must not be alerted in the same pass.
      for (const { user, distanceM } of toFlag) {
        await tx.nodeFlag.create({
          data: {
            incidentId,
            userId: user.id,
            reason: "ENTERED_DANGER_ZONE",
            lat: user.locations[0]?.lat,
            lng: user.locations[0]?.lng,
          },
        });
        await tx.volunteerResponse.updateMany({
          where: { incidentId, volunteerId: user.id, flagged: false },
          data: { flagged: true, flagReason: "ENTERED_DANGER_ZONE", status: "WITHDRAWN" },
        });
        await appendAudit(tx, incidentId, {
          type: AUDIT_TYPES.VOLUNTEER_FLAGGED,
          data: { anonId: user.anonId, distanceM: Math.round(distanceM), reason: "ENTERED_DANGER_ZONE" },
        });
        flaggedSet.add(user.id);
        newFlags++;
        postCommit.push({ userId: user.id, kind: "flag", distanceM });
        bus.publish(CHANNEL.incident(incidentId), "node:flagged", { anonId: user.anonId });
        bus.publish(CHANNEL.DASHBOARD, "node:flagged", { incidentId, anonId: user.anonId });
      }

      // Alerts (deduped by unique constraint as a second guard).
      for (const { user, distanceM } of toAlert) {
        try {
          await tx.alert.create({
            data: {
              incidentId,
              userId: user.id,
              distanceM: Math.round(distanceM),
              zone: "HELPER",
              channel: "IN_APP",
              status: "DELIVERED",
            },
          });
        } catch (err) {
          // Unique-constraint race lost → another caller already alerted.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
          continue;
        }
        await appendAudit(tx, incidentId, {
          type: AUDIT_TYPES.VOLUNTEER_ALERTED,
          data: { anonId: user.anonId, distanceM: Math.round(distanceM) },
        });
        alertedSet.add(user.id);
        newAlerts++;
        postCommit.push({ userId: user.id, kind: "alert", distanceM });
        bus.publish(CHANNEL.user(user.id), "alert:new", { incidentId, type: incident.type, distanceM: Math.round(distanceM) });
        bus.publish(CHANNEL.DASHBOARD, "alert:new", { incidentId, anonId: user.anonId });
      }
    },
      { timeout: 20000, maxWait: 10000 }
    );

    // Post-commit notification fan-out (§16): must never block or fail the
    // already-committed alert transaction.
    for (const item of postCommit) {
      if (item.kind !== "alert") continue;
      await notify({
        userId: item.userId,
        incidentId,
        kind: "ALERT",
        title: "Emergency nearby — you can help safely",
        body: `${incident.type} emergency ~${Math.round(item.distanceM)}m away. Open SafeGuard to observe safely.`,
      });
    }
  }

  // Fresh counts after changes.
  const trueCount = await prisma.volunteerResponse.count({
    where: { incidentId, status: { in: ["RESPONDED", "OBSERVING"] }, flagged: false },
  });

  const result: EngineResult = {
    incidentId,
    evaluated,
    newAlerts,
    newFlags,
    zones: zoneMap,
    trueResponderCount: trueCount,
    displayedResponderCount: displayedResponderCount(trueCount),
  };

  // Live snapshots to incident watchers + police dashboard.
  bus.publish(CHANNEL.incident(incidentId), "snapshot", result);
  bus.publish(CHANNEL.DASHBOARD, "incident:update", {
    incidentId,
    trueResponderCount: result.trueResponderCount,
    displayedResponderCount: result.displayedResponderCount,
    newAlerts,
    newFlags,
  });

  return result;
}

/** Evaluate all ACTIVE incidents (used by the sweeper). */
export async function evaluateAllActive(): Promise<void> {
  const actives = await prisma.incident.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });
  for (const inc of actives) {
    try {
      await evaluateIncident(inc.id);
    } catch (err) {
      console.error(`[geofence] evaluation failed for ${inc.id}:`, err);
    }
  }
}
