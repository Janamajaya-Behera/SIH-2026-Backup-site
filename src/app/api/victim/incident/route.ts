import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req, ["VICTIM"]);
    const incident = await prisma.incident.findFirst({
      where: { victimId: user.id, status: { in: ["COUNTDOWN", "ACTIVE"] } },
      include: {
        responses: { where: { flagged: false, status: { in: ["RESPONDED", "OBSERVING"] } }, select: { id: true } },
        intel: { orderBy: { createdAt: "asc" }, take: 50 },
      },
    });
    if (!incident) return ok({ incident: null });

    const displayedResponders = Math.max(1, incident.responses.length - 2);
    return ok({
      incident: {
        id: incident.id,
        type: incident.type,
        status: incident.status,
        lat: incident.lastLat,
        lng: incident.lastLng,
        countdownEndsAt: incident.countdownEndsAt,
        createdAt: incident.createdAt,
        activatedAt: incident.activatedAt,
        displayedResponders,
        intel: incident.intel,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
