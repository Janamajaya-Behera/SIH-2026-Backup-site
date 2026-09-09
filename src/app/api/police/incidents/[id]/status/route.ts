import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { statusChangeSchema } from "@/lib/validation";
import { appendAudit, AUDIT_TYPES } from "@/lib/audit";
import { bus, CHANNEL } from "@/lib/events";

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req, ["POLICE"]);
    const { id } = ctx.params;
    const body = statusChangeSchema.parse(await req.json());

    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new ApiError("NOT_FOUND");

    const now = new Date();
    let newStatus: string;
    if (body.action === "RESOLVE") newStatus = "RESOLVED";
    else if (body.action === "CLOSE") newStatus = "CLOSED";
    else newStatus = "ACTIVE"; // REOPEN

    await prisma.$transaction(async (tx) => {
      await tx.incident.update({
        where: { id },
        data: {
          status: newStatus,
          resolvedAt: body.action === "RESOLVE" ? now : incident.resolvedAt,
          closedAt: body.action === "CLOSE" ? now : null,
        },
      });
      await appendAudit(tx, id, {
        type: AUDIT_TYPES.POLICE_STATUS_CHANGE,
        data: { action: body.action, newStatus, by: user.anonId },
      });
      if (body.action === "RESOLVE") {
        await appendAudit(tx, id, { type: AUDIT_TYPES.INCIDENT_RESOLVED, data: { by: user.anonId } });
      }
    });

    bus.publish(CHANNEL.incident(id), "incident:status", { incidentId: id, status: newStatus });
    bus.publish(CHANNEL.DASHBOARD, "incident:status", { incidentId: id, status: newStatus });

    return ok({ incidentId: id, status: newStatus });
  } catch (err) {
    return fail(err);
  }
}
