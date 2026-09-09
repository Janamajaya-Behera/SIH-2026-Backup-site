import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getRouteProvider } from "@/lib/route-provider";
import { haversineMeters } from "@/lib/geo";
import { CONFIG } from "@/lib/config";

/**
 * Navigate-to-Victim (§1, §C):
 *  - Only for volunteers with an accepted, unflagged response (authorized).
 *  - Victim coordinates come from the server's incident record.
 *  - Google Directions when a server key exists; straight-line fallback
 *    clearly labelled SIMULATED ROUTING otherwise (app never breaks, §3).
 */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req, ["VOLUNTEER"]);
    const incidentId = req.nextUrl.searchParams.get("incidentId");
    if (!incidentId) throw new ApiError("VALIDATION", "incidentId required.");

    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new ApiError("NOT_FOUND");
    if (incident.status !== "ACTIVE") throw new ApiError("CONFLICT_STATE", `Incident is ${incident.status}.`);

    // AUTHORIZATION: must have an accepted, unflagged response (§2 privacy).
    const resp = await prisma.volunteerResponse.findUnique({
      where: { incidentId_volunteerId: { incidentId, volunteerId: user.id } },
    });
    if (!resp || resp.flagged || !["RESPONDED", "OBSERVING"].includes(resp.status)) {
      throw new ApiError("FORBIDDEN_ROLE", "Accept the incident before navigating.");
    }

    // Volunteer position: request params or last stored.
    const qLat = Number(req.nextUrl.searchParams.get("lat"));
    const qLng = Number(req.nextUrl.searchParams.get("lng"));
    let from = { lat: qLat, lng: qLng };
    if (!Number.isFinite(from.lat) || !Number.isFinite(from.lng)) {
      const last = await prisma.location.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      if (!last) throw new ApiError("MISSING_LOCATION", "Share your location to get routing.");
      from = { lat: last.lat, lng: last.lng };
    }

    const to = { lat: incident.lastLat, lng: incident.lastLng };
    const provider = getRouteProvider();

    // Multi-stop routing for medical-certified volunteers (§10): include
    // nearby accepted medical volunteers as pickup-style stops (prototype).
    let stops: Array<{ lat: number; lng: number; label: string }> | undefined;
    if (user.verificationStatus === "MEDICAL_CERTIFIED") {
      const others = await prisma.volunteerResponse.findMany({
        where: { incidentId, status: { in: ["RESPONDED", "OBSERVING"] }, flagged: false, volunteerId: { not: user.id } },
        include: { volunteer: { include: { locations: { orderBy: { createdAt: "desc" }, take: 1 } } } },
        take: 2,
      });
      stops = others
        .filter((o) => o.volunteer.locations[0])
        .map((o) => ({
          lat: o.volunteer.locations[0].lat,
          lng: o.volunteer.locations[0].lng,
          label: `Volunteer ${o.volunteer.anonId.slice(-4)}`,
        }));
    }

    const routeResult = await provider.route(from, to, { stops });

    // Straight-line distance always available as ground truth (§3 fallback).
    const straightLineM = Math.round(haversineMeters(from, to));

    return ok({
      route: {
        provider: routeResult.provider,
        label: routeResult.label,
        distanceM: routeResult.distanceM,
        etaSec: routeResult.etaSec,
        polyline: routeResult.polyline,
        stops: routeResult.stops,
        error: routeResult.error,
      },
      destination: to,
      straightLineM,
      recalcHintM: CONFIG.ROUTE_RECALC_VICTIM_M,
      simulated: routeResult.provider === "SIMULATED",
    });
  } catch (err) {
    return fail(err);
  }
}
