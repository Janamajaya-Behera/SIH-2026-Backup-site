export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { haversineMeters } from "@/lib/geo";
import { toVolunteerIncidentView, toPoliceIncidentView } from "@/lib/serializers";
import { CONFIG } from "@/lib/config";

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req);
    const { id } = ctx.params;

    const incident = await prisma.incident.findUnique({
      where: { id },
      include: {
        victim: { select: { id: true, anonId: true, name: true, phone: true, revealAuthorizedUntil: true } },
        responses: { select: { volunteerId: true, status: true, flagged: true } },
        _count: { select: { alerts: true, intel: true } },
      },
    });
    if (!incident) throw new ApiError("NOT_FOUND");

    // TEST_ATTACKER must never learn an incident exists (§2D).
    if (user.role === "TEST_ATTACKER") throw new ApiError("NOT_FOUND");

    const isVictim = incident.victimId === user.id;
    const myResponse = incident.responses.find((r) => r.volunteerId === user.id);

    if (!isVictim && !myResponse && user.role !== "POLICE") {
      // Volunteers who never responded see nothing (§2B privacy step).
      throw new ApiError("NOT_FOUND");
    }

    if (user.role === "POLICE") {
      const policeView = toPoliceIncidentView(incident, {});
      // Attach cluster size if clustered.
      if (incident.clusterId) {
        const size = await prisma.incident.count({ where: { clusterId: incident.clusterId } });
        policeView.clusterSize = size;
      }
      return ok({ role: "POLICE", incident: policeView });
    }

    if (isVictim) {
      const activeResponses = incident.responses.filter(
        (r) => !r.flagged && ["RESPONDED", "OBSERVING"].includes(r.status)
      ).length;
      return ok({
        role: "VICTIM",
        incident: {
          id: incident.id,
          type: incident.type,
          status: incident.status,
          lat: incident.lastLat,
          lng: incident.lastLng,
          countdownEndsAt: incident.countdownEndsAt,
          createdAt: incident.createdAt,
          activatedAt: incident.activatedAt,
          resolvedAt: incident.resolvedAt,
          displayedResponders: Math.max(1, activeResponses - 2) as number,
          // Victim sees the offset count too (§8 applies to their own screen).
          trueCountHidden: true,
          intel: await prisma.intelMessage.findMany({
            where: { incidentId: id },
            orderBy: { createdAt: "asc" },
            take: 50,
            select: { id: true, senderAnonId: true, category: true, message: true, createdAt: true, lat: true, lng: true },
          }),
          myEvidence: await prisma.evidenceEvent.findMany({
            where: { incidentId: id },
            orderBy: { createdAt: "asc" },
            select: { id: true, type: true, status: true, reference: true, startedAt: true, stoppedAt: true },
          }),
        },
      });
    }

    // Volunteer view (with response): privacy-filtered.
    const vol = await prisma.user.findUnique({ where: { id: user.id }, include: { locations: { orderBy: { createdAt: "desc" }, take: 1 } } });
    const volPos = vol?.locations[0];
    const distanceM = volPos ? haversineMeters({ lat: incident.lastLat, lng: incident.lastLng }, { lat: volPos.lat, lng: volPos.lng }) : null;

    const activeResponses = incident.responses.filter(
      (r) => !r.flagged && ["RESPONDED", "OBSERVING"].includes(r.status)
    ).length;
    const view = toVolunteerIncidentView(incident, {
      distanceM,
      zone: distanceM !== null ? (distanceM < CONFIG.DANGER_RADIUS_M ? "DANGER" : distanceM < CONFIG.BUFFER_END_M ? "BUFFER" : "HELPER") : null,
      myResponse,
      activeResponseCount: activeResponses,
    });

    return ok({ role: "VOLUNTEER", incident: view });
  } catch (err) {
    return fail(err);
  }
}
