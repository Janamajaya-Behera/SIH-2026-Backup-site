import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { intelSchema } from "@/lib/validation";
import { appendAudit, AUDIT_TYPES } from "@/lib/audit";
import { bus, CHANNEL } from "@/lib/events";

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req, ["VOLUNTEER"]);
    const { id } = ctx.params;
    const body = intelSchema.parse(await req.json());

    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new ApiError("NOT_FOUND");
    if (incident.status !== "ACTIVE") throw new ApiError("CONFLICT_STATE", "Incident is not active.");

    // Volunteers must have a response (or at least an alert) to post intel.
    const resp = await prisma.volunteerResponse.findUnique({
      where: { incidentId_volunteerId: { incidentId: id, volunteerId: user.id } },
    });
    if (!resp) throw new ApiError("FORBIDDEN_ROLE", "Respond to the incident before sending intel.");

    const intel = await prisma.$transaction(async (tx) => {
      const msg = await tx.intelMessage.create({
        data: {
          incidentId: id,
          senderId: user.id,
          senderAnonId: user.anonId,
          category: body.category,
          message: body.message,
          lat: body.lat,
          lng: body.lng,
        },
      });
      await appendAudit(tx, id, {
        type: AUDIT_TYPES.INTEL_MESSAGE,
        data: { anonId: user.anonId, category: body.category, messageId: msg.id },
      });
      return msg;
    });

    bus.publish(CHANNEL.incident(id), "intel:new", { anonId: user.anonId, category: body.category });
    bus.publish(CHANNEL.DASHBOARD, "intel:new", { incidentId: id, anonId: user.anonId, category: body.category });

    return ok({ intel: { id: intel.id, createdAt: intel.createdAt } });
  } catch (err) {
    return fail(err);
  }
}

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req);
    const { id } = ctx.params;

    // Access: victim (own), police, or a responding volunteer. Attackers: 404.
    if (user.role === "TEST_ATTACKER") throw new ApiError("NOT_FOUND");
    const incident = await prisma.incident.findUnique({ where: { id }, select: { victimId: true } });
    if (!incident) throw new ApiError("NOT_FOUND");
    const isVictim = incident.victimId === user.id;
    let allowed = isVictim || user.role === "POLICE";
    if (!allowed && user.role === "VOLUNTEER") {
      const resp = await prisma.volunteerResponse.findUnique({
        where: { incidentId_volunteerId: { incidentId: id, volunteerId: user.id } },
      });
      allowed = !!resp;
    }
    if (!allowed) throw new ApiError("FORBIDDEN_ROLE", "Not authorized for this incident's intel feed.");

    const intel = await prisma.intelMessage.findMany({
      where: { incidentId: id },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true,
        senderAnonId: true,
        category: true,
        message: true,
        lat: true,
        lng: true,
        createdAt: true,
      },
    });
    return ok({ intel });
  } catch (err) {
    return fail(err);
  }
}
