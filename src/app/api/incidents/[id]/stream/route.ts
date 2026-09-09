import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { sseStream } from "@/lib/sse";
import { CHANNEL } from "@/lib/events";
import { evaluateIncident } from "@/lib/geofence-engine";

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req);
    const { id } = ctx.params;

    if (user.role === "TEST_ATTACKER") return new Response("Not found", { status: 404 });
    const incident = await prisma.incident.findUnique({ where: { id }, select: { victimId: true } });
    if (!incident) return new Response("Not found", { status: 404 });

    const isVictim = incident.victimId === user.id;
    const isPolice = user.role === "POLICE";
    let attached = isVictim || isPolice;
    if (!attached && user.role === "VOLUNTEER") {
      const resp = await prisma.volunteerResponse.findUnique({
        where: { incidentId_volunteerId: { incidentId: id, volunteerId: user.id } },
      });
      attached = !!resp;
    }
    if (!attached) return new Response("Not found", { status: 404 });

    return sseStream(req, [CHANNEL.incident(id), ...(isPolice ? [CHANNEL.DASHBOARD] : [])], async () => {
      // Initial snapshot on connect: fresh engine evaluation for live state.
      const snap = isPolice ? await evaluateIncident(id) : null;
      return snap ? { engine: snap } : { connected: true, incidentId: id };
    });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}
