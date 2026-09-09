import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { haversineMeters, classifyZone } from "@/lib/geo";
import { CONFIG } from "@/lib/config";

/**
 * Anonymous-node view (§7): police see anonId + position + zone; personal
 * identity appears only while revealAuthorizedUntil is in the future —
 * which is granted exclusively by the audited /reveal endpoint.
 */
export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    await requireUser(req, ["POLICE"]);
    const { id } = ctx.params;

    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new ApiError("NOT_FOUND");

    // Everyone located near this incident: alerted volunteers, responders,
    // and flagged nodes (including TEST_ATTACKER sim nodes).
    const alerted = await prisma.alert.findMany({
      where: { incidentId: id },
      select: { userId: true, distanceM: true, zone: true, createdAt: true },
    });
    const responses = await prisma.volunteerResponse.findMany({
      where: { incidentId: id },
      include: { volunteer: true },
    });
    const flags = await prisma.nodeFlag.findMany({ where: { incidentId: id } });

    const userIds = new Set<string>([
      ...alerted.map((a) => a.userId),
      ...responses.map((r) => r.volunteerId),
      ...flags.map((f) => f.userId),
    ]);

    const nodes = [];
    const now = new Date();
    for (const uid of userIds) {
      const u = await prisma.user.findUnique({
        where: { id: uid },
        include: { locations: { orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (!u) continue;
      const last = u.locations[0];
      const flag = flags.find((f) => f.userId === uid);
      const resp = responses.find((r) => r.volunteerId === uid);
      const alert = alerted.find((a) => a.userId === uid);

      let distanceM: number | null = null;
      let zone: string | null = null;
      if (last && Number.isFinite(last.lat)) {
        distanceM = Math.round(haversineMeters({ lat: incident.lastLat, lng: incident.lastLng }, { lat: last.lat, lng: last.lng }));
        zone = classifyZone(distanceM);
      }

      nodes.push({
        anonId: u.anonId,
        role: u.role,
        identityRevealed: u.revealAuthorizedUntil && u.revealAuthorizedUntil > now
          ? { name: u.name, phone: u.phone, until: u.revealAuthorizedUntil.toISOString() }
          : null,
        distanceM,
        zone,
        alerted: !!alert,
        accepted: resp ? ["RESPONDED", "OBSERVING"].includes(resp.status) : false,
        responseStatus: resp?.status ?? null,
        flagged: !!flag || !!resp?.flagged,
        flagReason: flag?.reason ?? resp?.flagReason ?? null,
        lastSeenSec: last ? Math.round((now.getTime() - last.createdAt.getTime()) / 1000) : null,
        lastLat: last?.lat ?? null,
        lastLng: last?.lng ?? null,
      });
    }

    // Nearest first.
    nodes.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));

    return ok({
      incidentId: id,
      nodes,
      zones: {
        dangerRadiusM: CONFIG.DANGER_RADIUS_M,
        bufferEndM: CONFIG.BUFFER_END_M,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
