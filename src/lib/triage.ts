import { prisma } from "./db";
import { haversineMeters } from "./geo";
import { CONFIG } from "./config";
import { appendAudit, AUDIT_TYPES } from "./audit";
import { bus, CHANNEL } from "./events";

/**
 * AUTOMATED INCIDENT TRIAGE (§10): SOS incidents within ~50 m are grouped
 * into an Incident Zone (cluster) so volunteers are not spammed with
 * duplicate alerts, and police see related incidents as one zone.
 *
 * Alert-suppression rule: a volunteer already alerted by ANY member of a
 * cluster is NOT re-alerted for other members — one alert per cluster.
 */

export async function assignCluster(incidentId: string): Promise<string | null> {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident || incident.status === "CANCELLED") return null;

  const others = await prisma.incident.findMany({
    where: { status: { in: ["COUNTDOWN", "ACTIVE"] }, id: { not: incidentId }, clusterId: null },
    take: 100,
  });

  for (const other of others) {
    const d = haversineMeters(
      { lat: incident.lastLat, lng: incident.lastLng },
      { lat: other.lastLat, lng: other.lastLng }
    );
    if (d <= CONFIG.CLUSTER_RADIUS_M) {
      if (other.clusterId) {
        await prisma.incident.update({ where: { id: incidentId }, data: { clusterId: other.clusterId } });
        await recomputeClusterCenter(other.clusterId);
        return other.clusterId;
      }
      // Neither clustered → create one containing both.
      const cluster = await prisma.incidentCluster.create({
        data: {
          centerLat: (incident.lastLat + other.lastLat) / 2,
          centerLng: (incident.lastLng + other.lastLng) / 2,
          radiusM: CONFIG.CLUSTER_RADIUS_M,
        },
      });
      await prisma.incident.updateMany({
        where: { id: { in: [incidentId, other.id] } },
        data: { clusterId: cluster.id },
      });
      await appendAudit(prisma, incidentId, {
        type: AUDIT_TYPES.CLUSTER_CREATED,
        data: { clusterId: cluster.id, withIncident: other.id, distanceM: Math.round(d) },
      });
      bus.publish(CHANNEL.DASHBOARD, "cluster:new", { clusterId: cluster.id, members: [incidentId, other.id] });
      return cluster.id;
    }
  }
  return null;
}

/** Recenters the cluster as members move. */
export async function recomputeClusterCenter(clusterId: string): Promise<void> {
  const members = await prisma.incident.findMany({
    where: { clusterId },
    select: { lastLat: true, lastLng: true, status: true },
  });
  const active = members.filter((m) => m.status === "ACTIVE" || m.status === "COUNTDOWN");
  if (active.length === 0) return;
  const centerLat = active.reduce((s, m) => s + m.lastLat, 0) / active.length;
  const centerLng = active.reduce((s, m) => s + m.lastLng, 0) / active.length;
  let radiusM = 0;
  for (const m of active) {
    radiusM = Math.max(radiusM, haversineMeters({ lat: centerLat, lng: centerLng }, { lat: m.lastLat, lng: m.lastLng }));
  }
  await prisma.incidentCluster.update({
    where: { id: clusterId },
    data: { centerLat, centerLng, radiusM: Math.round(radiusM + CONFIG.CLUSTER_RADIUS_M) },
  });
}

/**
 * Volunteers already alerted by any cluster sibling — the engine skips these
 * when alerting for a new cluster member (§10 anti-spam).
 */
export async function clusterAlertSuppression(incidentId: string): Promise<Set<string>> {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident?.clusterId) return new Set();
  const siblings = await prisma.incident.findMany({
    where: { clusterId: incident.clusterId, id: { not: incidentId } },
    select: { id: true },
  });
  if (siblings.length === 0) return new Set();
  const alerts = await prisma.alert.findMany({
    where: { incidentId: { in: siblings.map((s) => s.id) } },
    select: { userId: true },
  });
  return new Set(alerts.map((a) => a.userId));
}
