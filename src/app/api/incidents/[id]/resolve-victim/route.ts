export const dynamic = "force-dynamic";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { appendAudit, AUDIT_TYPES } from "@/lib/audit";
import { bus, CHANNEL } from "@/lib/events";

/** Victim marks themselves safe → incident RESOLVED (audited). */
export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req, ["VICTIM"]);
    const { id } = ctx.params;

    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new ApiError("NOT_FOUND");
    if (incident.victimId !== user.id) throw new ApiError("FORBIDDEN_ROLE", "Not your incident.");
    if (!["ACTIVE", "COUNTDOWN"].includes(incident.status)) {
      throw new ApiError("CONFLICT_STATE", `Incident is already ${incident.status}.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.incident.update({
        where: { id },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      await appendAudit(tx, id, {
        type: AUDIT_TYPES.INCIDENT_RESOLVED,
        data: { by: "VICTIM_SELF_SAFE" },
      });
    });

    bus.publish(CHANNEL.incident(id), "incident:status", { incidentId: id, status: "RESOLVED" });
    bus.publish(CHANNEL.DASHBOARD, "incident:status", { incidentId: id, status: "RESOLVED" });

    return ok({ incidentId: id, status: "RESOLVED" });
  } catch (err) {
    return fail(err);
  }
}
