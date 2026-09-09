import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";

const SIM_GUARD = "x-safeguard-sim";

/** Wipes ONLY simulated data (real users' data is untouched, §18 isolation). */
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get(SIM_GUARD) !== "1") throw new ApiError("FORBIDDEN_ROLE", "Simulation guard header missing.");

    const simUsers = await prisma.user.findMany({ where: { isSimulated: true }, select: { id: true } });
    const simIds = simUsers.map((u) => u.id);

    // Cascade deletes remove responses, alerts, intel, audits, evidence, flags.
    const deletedIncidents = await prisma.incident.deleteMany({
      where: { victimId: { in: simIds } },
    });

    // Restore default device positions.
    const defaults: Record<string, { lat: number; lng: number }> = {
      "Sim Victim": { lat: 12.9716, lng: 77.5946 },
      "Sim Attacker": { lat: 12.97156, lng: 77.59463 }, // ~30 m from victim
      "Sim Helper 1": { lat: 12.9724, lng: 77.5946 }, // ~90 m... set 150 m below
      "Sim Helper 2": { lat: 12.9724, lng: 77.5946 },
    };
    for (const [name, pos] of Object.entries(defaults)) {
      const d = await prisma.user.findFirst({ where: { isSimulated: true, name } });
      if (d) await prisma.location.create({ data: { userId: d.id, lat: pos.lat, lng: pos.lng, source: "SIMULATED" } });
    }

    return ok({ reset: true, deletedIncidents: deletedIncidents.count });
  } catch (err) {
    return fail(err);
  }
}
