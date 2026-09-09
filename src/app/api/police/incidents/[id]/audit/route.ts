import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { verifyChain, ChainEvent } from "@/lib/hashchain";
import { SIM_LABELS } from "@/lib/config";

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    await requireUser(req, ["POLICE"]);
    const { id } = ctx.params;

    const events = await prisma.auditEvent.findMany({
      where: { incidentId: id },
      orderBy: { seq: "asc" },
    });

    const chain: ChainEvent[] = events.map((e) => ({
      seq: e.seq,
      type: e.type,
      createdAt: e.createdAt,
      data: e.data,
      prevHash: e.prevHash,
      hash: e.hash,
    }));

    const verification = verifyChain(chain);

    return ok({
      incidentId: id,
      label: SIM_LABELS.audit,
      verification,
      events: events.map((e) => ({
        seq: e.seq,
        type: e.type,
        data: JSON.parse(e.data),
        createdAt: e.createdAt.toISOString(),
        prevHash: e.prevHash.slice(0, 12),
        hash: e.hash.slice(0, 12),
        fullHash: e.hash,
      })),
    });
  } catch (err) {
    return fail(err);
  }
}
