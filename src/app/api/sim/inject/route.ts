import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { simInjectSchema } from "@/lib/validation";
import { isValidCoord } from "@/lib/geo";
import { evaluateIncident, evaluateAllActive } from "@/lib/geofence-engine";
import { recomputeClusterCenter } from "@/lib/triage";

const SIM_GUARD = "x-safeguard-sim";

/**
 * Injects a simulated location for a device and feeds the REAL geofence
 * engine — simulation exercises the same safety logic as real phones.
 */
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get(SIM_GUARD) !== "1") throw new ApiError("FORBIDDEN_ROLE", "Simulation guard header missing.");
    const body = simInjectSchema.parse(await req.json());

    const device = await prisma.user.findUnique({ where: { id: body.deviceId } });
    if (!device || !device.isSimulated) throw new ApiError("NOT_FOUND", "Simulated device not found.");
    if (!isValidCoord(body.lat, body.lng)) throw new ApiError("GPS_INVALID");

    await prisma.location.create({
      data: { userId: device.id, lat: body.lat, lng: body.lng, source: "SIMULATED" },
    });

    let engineResult = null;

    if (device.role === "VICTIM") {
      // Move the victim's ACTIVE incident → donut re-centers (§5 dynamic).
      const active = await prisma.incident.findFirst({
        where: { victimId: device.id, status: "ACTIVE" },
      });
      if (active) {
        await prisma.incident.update({
          where: { id: active.id },
          data: { lastLat: body.lat, lastLng: body.lng },
        });
        if (active.clusterId) await recomputeClusterCenter(active.clusterId);
        engineResult = await evaluateIncident(active.id);
      }
    } else {
      // Volunteer/attacker moved → zones may change for all active incidents
      // (entering the danger zone triggers dynamic flagging, §6).
      const actives = await prisma.incident.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
      for (const inc of actives) {
        engineResult = await evaluateIncident(inc.id);
      }
    }

    return ok({
      injected: true,
      deviceId: device.id,
      engine: engineResult
        ? {
            newAlerts: engineResult.newAlerts,
            newFlags: engineResult.newFlags,
            zones: engineResult.zones,
            trueResponderCount: engineResult.trueResponderCount,
            displayedResponderCount: engineResult.displayedResponderCount,
          }
        : null,
    });
  } catch (err) {
    return fail(err);
  }
}
