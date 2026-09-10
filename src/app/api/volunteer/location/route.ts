export const dynamic = "force-dynamic";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { locationUpdateSchema } from "@/lib/validation";
import { isValidCoord } from "@/lib/geo";
import { evaluateAllActive } from "@/lib/geofence-engine";
import { CONFIG } from "@/lib/config";
import { bus, CHANNEL } from "@/lib/events";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req, ["VOLUNTEER"]);
    const body = locationUpdateSchema.parse(await req.json());
    if (!isValidCoord(body.lat, body.lng)) throw new ApiError("GPS_INVALID");

    // Consent gate (§7): no location storage without explicit opt-in.
    if (!user.consentLocation) {
      return ok({ stored: false, reason: "NO_CONSENT", note: "Location sharing consent is off." });
    }

    // Battery-conscious (§11): volunteer position is stored only while there
    // are ACTIVE incidents (the client also stops streaming when none exist).
    const activeCount = await prisma.incident.count({ where: { status: "ACTIVE" } });
    if (activeCount === 0) {
      return ok({ stored: false, reason: "NO_ACTIVE_INCIDENT" });
    }

    await prisma.location.create({
      data: { userId: user.id, lat: body.lat, lng: body.lng, accuracy: body.accuracy, source: "GPS" },
    });

    // Volunteer moved → zones may have changed for every active incident.
    await evaluateAllActive();

    bus.publish(CHANNEL.DASHBOARD, "location:node", { anonId: user.anonId, lat: body.lat, lng: body.lng });

    return ok({ stored: true, intervalMs: CONFIG.LOCATION_INTERVAL_MS });
  } catch (err) {
    return fail(err);
  }
}
