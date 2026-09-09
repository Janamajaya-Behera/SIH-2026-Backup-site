import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { evidenceSchema } from "@/lib/validation";
import { evidenceManager } from "@/lib/evidence";

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req, ["VICTIM"]);
    const { id } = ctx.params;
    const body = evidenceSchema.parse(await req.json());

    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new ApiError("NOT_FOUND");
    if (incident.victimId !== user.id) throw new ApiError("FORBIDDEN_ROLE", "Not your incident.");

    if (body.action === "START") {
      const status = await evidenceManager.start(id, body.type);
      return ok(status);
    }
    const status = await evidenceManager.stop(id);
    return ok(status);
  } catch (err) {
    return fail(err);
  }
}

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req);
    const { id } = ctx.params;

    if (user.role === "TEST_ATTACKER") throw new ApiError("NOT_FOUND");
    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new ApiError("NOT_FOUND");

    if (user.role === "POLICE") {
      return ok(await evidenceManager.status(id));
    }
    if (incident.victimId === user.id) {
      return ok(await evidenceManager.status(id));
    }
    // Responding volunteers may see stream status only (not content).
    const resp = await prisma.volunteerResponse.findUnique({
      where: { incidentId_volunteerId: { incidentId: id, volunteerId: user.id } },
    });
    if (resp && !resp.flagged) return ok(await evidenceManager.status(id));
    throw new ApiError("FORBIDDEN_ROLE");
  } catch (err) {
    return fail(err);
  }
}
