export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { locationUpdateSchema } from "@/lib/validation";
import { appendAudit, AUDIT_TYPES } from "@/lib/audit";
import { isValidCoord } from "@/lib/geo";
import { evaluateIncident } from "@/lib/geofence-engine";
import { recomputeClusterCenter } from "@/lib/triage";
import { bus, CHANNEL } from "@/lib/events";

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req, ["VICTIM"]);
    const { id } = ctx.params;
    const body = locationUpdateSchema.parse(await req.json());
    if (!isValidCoord(body.lat, body.lng)) throw new ApiError("GPS_INVALID");

    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new ApiError("NOT_FOUND");
    if (incident.victimId !== user.id) throw new ApiError("FORBIDDEN_ROLE", "Not your incident.");
    if (incident.status !== "ACTIVE") throw new ApiError("CONFLICT_STATE", "Incident is not active.");

    const prevLat = incident.lastLat;
    const prevLng = incident.lastLng;

    await prisma.$transaction(async (tx) => {
      await tx.incident.update({
        where: { id },
        data: { lastLat: body.lat, lastLng: body.lng, lastAccuracy: body.accuracy },
      });
      await tx.location.create({
        data: { userId: user.id, incidentId: id, lat: body.lat, lng: body.lng, accuracy: body.accuracy, source: "GPS" },
      });
      await appendAudit(tx, id, {
        type: AUDIT_TYPES.LOCATION_UPDATE,
        data: { who: "VICTIM", lat: body.lat, lng: body.lng, movedM: null },
      });
    });

    // Cluster center follows member movement.
    if (incident.clusterId) await recomputeClusterCenter(incident.clusterId);

    // DYNAMIC GEOFENCE (§5): victim moved → re-evaluate all nodes.
    const engine = await evaluateIncident(id);

    bus.publish(CHANNEL.incident(id), "location:victim", { lat: body.lat, lng: body.lng });
    bus.publish(CHANNEL.DASHBOARD, "location:victim", { incidentId: id, lat: body.lat, lng: body.lng });

    return ok({
      updated: true,
      movedM:
        engine?.zones ? Math.round(Math.hypot(body.lat - prevLat, body.lng - prevLng) * 111000) : 0,
      newAlerts: engine?.newAlerts ?? 0,
      newFlags: engine?.newFlags ?? 0,
    });
  } catch (err) {
    return fail(err);
  }
}
