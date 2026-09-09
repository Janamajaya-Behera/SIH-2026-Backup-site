import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { haversineMeters, classifyZone } from "@/lib/geo";
import { toVolunteerIncidentView } from "@/lib/serializers";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req, ["VOLUNTEER"]);

    // TEST_ATTACKER role never reaches here (role-gated above → 403). For
    // defense in depth, attackers also get an empty-but-valid payload shape.
    if (user.role === "TEST_ATTACKER") return ok({ alerts: [] });

    const vol = await prisma.user.findUnique({
      where: { id: user.id },
      include: { locations: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!vol) throw new ApiError("SESSION_EXPIRED");

    // Volunteer must have consented to volunteering (§7 opt-in).
    if (!vol.consentVolunteer || vol.volunteerStatus !== "ACTIVE") {
      return ok({ alerts: [], notice: "Volunteer participation is paused — enable it to receive alerts." });
    }

    // Incidents where this volunteer has an alert (they were notified).
    const myAlerts = await prisma.alert.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Also surface incidents where they responded but have no alert row
    // (e.g. accepted before consent was stored) — status consistency.
    const myResponses = await prisma.volunteerResponse.findMany({
      where: { volunteerId: user.id, incident: { status: "ACTIVE" } },
      include: { incident: true },
    });

    const incidentIds = new Set<string>([
      ...myAlerts.filter((a) => a.status !== "READ").map((a) => a.incidentId),
      ...myResponses.map((r) => r.incidentId),
    ]);

    const alerts = [];
    for (const incidentId of incidentIds) {
      const incident = await prisma.incident.findUnique({
        where: { id: incidentId },
        include: {
          responses: { select: { volunteerId: true, status: true, flagged: true } },
          _count: { select: { alerts: true } },
        },
      });
      if (!incident || incident.status !== "ACTIVE") continue;

      const lastLoc = vol.locations[0];
      const distanceM = lastLoc
        ? haversineMeters({ lat: incident.lastLat, lng: incident.lastLng }, { lat: lastLoc.lat, lng: lastLoc.lng })
        : null;
      const activeResponses = incident.responses.filter(
        (r) => !r.flagged && ["RESPONDED", "OBSERVING"].includes(r.status)
      ).length;

      const view = toVolunteerIncidentView(incident, {
        distanceM,
        zone: distanceM !== null ? classifyZone(distanceM) : null,
        myResponse: myResponses.find((r) => r.incidentId === incidentId),
        activeResponseCount: activeResponses,
        clusterSize: undefined,
      });
      alerts.push(view);
    }

    // Nearest-first (§10 triage: prioritize the nearest appropriate incident).
    alerts.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));

    return ok({ alerts });
  } catch (err) {
    return fail(err);
    }
}
