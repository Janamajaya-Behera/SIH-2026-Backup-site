import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { sosCancelSchema } from "@/lib/validation";
import { appendAudit, AUDIT_TYPES } from "@/lib/audit";
import { bus, CHANNEL } from "@/lib/events";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req, ["VICTIM"]);
    const body = sosCancelSchema.parse(await req.json());

    const incident = await prisma.incident.findUnique({ where: { id: body.incidentId } });
    if (!incident) throw new ApiError("NOT_FOUND", "Incident not found.");
    if (incident.victimId !== user.id) throw new ApiError("FORBIDDEN_ROLE", "You can only cancel your own SOS.");

    // Cancellation is only meaningful during the countdown window (§3).
    if (incident.status !== "COUNTDOWN") {
      throw new ApiError("CONFLICT_STATE", `Cannot cancel — incident is already ${incident.status}.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.incident.update({
        where: { id: incident.id },
        data: { status: "CANCELLED", cancelReason: body.reason ?? "Cancelled during countdown" },
      });
      await appendAudit(tx, incident.id, {
        type: AUDIT_TYPES.INCIDENT_CANCELLED,
        data: { reason: body.reason ?? "Cancelled during countdown", loggedAsFalseAlarm: true },
      });
    });

    bus.publish(CHANNEL.incident(incident.id), "incident:cancelled", { incidentId: incident.id });
    bus.publish(CHANNEL.DASHBOARD, "incident:cancelled", { incidentId: incident.id });

    return ok({ incidentId: incident.id, status: "CANCELLED" });
  } catch (err) {
    return fail(err);
  }
}
