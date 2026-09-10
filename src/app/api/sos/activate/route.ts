export const dynamic = "force-dynamic";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { sosActivateSchema } from "@/lib/validation";
import { appendAudit, AUDIT_TYPES } from "@/lib/audit";
import { evaluateIncident } from "@/lib/geofence-engine";
import { assignCluster } from "@/lib/triage";
import { bus, CHANNEL } from "@/lib/events";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req, ["VICTIM"]);
    const body = sosActivateSchema.parse(await req.json());

    const incident = await prisma.incident.findUnique({ where: { id: body.incidentId } });
    if (!incident) throw new ApiError("NOT_FOUND", "Incident not found.");
    if (incident.victimId !== user.id) throw new ApiError("FORBIDDEN_ROLE", "You can only activate your own SOS.");
    if (incident.status !== "COUNTDOWN") {
      throw new ApiError("CONFLICT_STATE", `Cannot activate — incident is ${incident.status}.`);
    }

    await prisma.incident.update({
      where: { id: incident.id },
      data: { status: "ACTIVE", activatedAt: new Date() },
    });
    await appendAudit(prisma, incident.id, {
      type: AUDIT_TYPES.INCIDENT_ACTIVATED,
      data: { auto: false, by: "VICTIM" },
    });

    // Triage: join/create a cluster if another active incident is within ~50m.
    await assignCluster(incident.id);

    // First geofence evaluation → volunteer alerts go out now.
    const engine = await evaluateIncident(incident.id);

    bus.publish(CHANNEL.incident(incident.id), "incident:activated", { incidentId: incident.id });
    bus.publish(CHANNEL.DASHBOARD, "incident:activated", { incidentId: incident.id, victimId: user.id });

    return ok({
      incidentId: incident.id,
      status: "ACTIVE",
      engine: engine
        ? { newAlerts: engine.newAlerts, newFlags: engine.newFlags, trueResponderCount: engine.trueResponderCount }
        : null,
    });
  } catch (err) {
    return fail(err);
  }
}
