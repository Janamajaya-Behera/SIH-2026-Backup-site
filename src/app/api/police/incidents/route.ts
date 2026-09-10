export const dynamic = "force-dynamic";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { toPoliceIncidentView } from "@/lib/serializers";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req, ["POLICE"]);

    const incidents = await prisma.incident.findMany({
      where: { status: { in: ["COUNTDOWN", "ACTIVE", "RESOLVED"] } },
      include: {
        victim: { select: { anonId: true, name: true, phone: true, revealAuthorizedUntil: true } },
        responses: { select: { volunteerId: true, status: true, flagged: true } },
        cluster: true,
        _count: { select: { alerts: true, intel: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const views = [];
    for (const inc of incidents) {
      const view = toPoliceIncidentView(inc, {});
      if (inc.clusterId) {
        const size = await prisma.incident.count({ where: { clusterId: inc.clusterId } });
        view.clusterSize = size;
      }
      views.push(view);
    }

    // Cluster summaries for the map (§10 visualization).
    const clusterIds = [...new Set(views.map((v) => v.clusterId).filter((x): x is string => !!x))];
    const clusters = await prisma.incidentCluster.findMany({
      where: { id: { in: clusterIds }, status: "OPEN" },
      include: { incidents: { select: { id: true, type: true, status: true } } },
    });

    return ok({ incidents: views, clusters });
  } catch (err) {
    return fail(err);
  }
}
