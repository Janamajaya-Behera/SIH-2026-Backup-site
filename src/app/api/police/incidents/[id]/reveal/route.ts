import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { revealSchema } from "@/lib/validation";
import { appendAudit, AUDIT_TYPES } from "@/lib/audit";
import { CONFIG } from "@/lib/config";

/**
 * Identity reveal (§7): the authorization condition is that the node has an
 * accepted (RESPONDED/OBSERVING) response for this incident — i.e. the
 * volunteer is an active participant. The reveal is time-boxed and audited.
 */
export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const { user } = await requireUser(req, ["POLICE"]);
    const { id } = ctx.params;
    const body = revealSchema.parse(await req.json());

    const target = await prisma.user.findUnique({ where: { anonId: body.anonId } });
    if (!target) throw new ApiError("NOT_FOUND", "Node not found.");

    const condition = await prisma.volunteerResponse.findFirst({
      where: {
        incidentId: id,
        volunteerId: target.id,
        status: { in: ["RESPONDED", "OBSERVING"] },
        flagged: false,
      },
    });

    if (!condition) {
      throw new ApiError(
        "FORBIDDEN_ROLE",
        "Reveal requires the node to have an accepted response for this incident (authorization condition not met)."
      );
    }

    const until = new Date(Date.now() + CONFIG.REVEAL_WINDOW_MINUTES * 60_000);
    await prisma.user.update({
      where: { id: target.id },
      data: { revealAuthorizedUntil: until },
    });
    await appendAudit(prisma, id, {
      type: AUDIT_TYPES.IDENTITY_REVEALED,
      data: { anonId: target.anonId, byOfficer: user.anonId, until: until.toISOString(), condition: "ACCEPTED_RESPONSE" },
    });

    return ok({ anonId: target.anonId, identity: { name: target.name, phone: target.phone }, until: until.toISOString() });
  } catch (err) {
    return fail(err);
  }
}
