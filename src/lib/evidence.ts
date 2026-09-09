import { prisma } from "./db";
import { appendAudit, AUDIT_TYPES } from "./audit";
import { SIM_LABELS } from "./config";
import { nanoid } from "nanoid";

/**
 * EVIDENTIARY STREAMING (§13) — modular manager.
 * The MVP runs a clearly-labelled SIMULATED stream lifecycle (§23); a real
 * WebRTC recording module would implement the same interface and replace it
 * without touching callers.
 */

export interface EvidenceStatus {
  incidentId: string;
  status: "NOT_STARTED" | "ACTIVE" | "SIMULATED" | "STOPPED";
  type: string | null;
  reference: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  events: Array<{ type: string; status: string; at: string; reference: string | null }>;
  label: string;
}

export class EvidenceStreamManager {
  label = SIM_LABELS.evidence;

  async start(incidentId: string, type: "AUDIO" | "VIDEO"): Promise<EvidenceStatus> {
    const reference = `sim-${nanoid(12)}`;
    const ev = await prisma.evidenceEvent.create({
      data: {
        incidentId,
        type,
        status: "SIMULATED", // honest label: this MVP simulates the stream
        reference,
        startedAt: new Date(),
      },
    });
    await appendAudit(prisma, incidentId, {
      type: AUDIT_TYPES.EVIDENCE_EVENT,
      data: { action: "START", streamType: type, reference, simulated: true },
    });
    return this.status(incidentId);
  }

  async stop(incidentId: string): Promise<EvidenceStatus> {
    const active = await prisma.evidenceEvent.findFirst({
      where: { incidentId, status: "SIMULATED", stoppedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (active) {
      await prisma.evidenceEvent.update({
        where: { id: active.id },
        data: { status: "STOPPED", stoppedAt: new Date() },
      });
      await appendAudit(prisma, incidentId, {
        type: AUDIT_TYPES.EVIDENCE_EVENT,
        data: { action: "STOP", streamType: active.type, reference: active.reference, simulated: true },
      });
    }
    return this.status(incidentId);
  }

  async status(incidentId: string): Promise<EvidenceStatus> {
    const events = await prisma.evidenceEvent.findMany({
      where: { incidentId },
      orderBy: { createdAt: "asc" },
    });
    const active = events.find((e) => e.status === "SIMULATED" && !e.stoppedAt);
    const last = events[events.length - 1];
    return {
      incidentId,
      status: active ? "SIMULATED" : last ? "STOPPED" : "NOT_STARTED",
      type: active?.type ?? last?.type ?? null,
      reference: active?.reference ?? null,
      startedAt: active?.startedAt?.toISOString() ?? null,
      stoppedAt: active?.stoppedAt?.toISOString() ?? null,
      events: events.map((e) => ({ type: e.type, status: e.status, at: e.createdAt.toISOString(), reference: e.reference })),
      label: this.label,
    };
  }
}

export const evidenceManager = new EvidenceStreamManager();
