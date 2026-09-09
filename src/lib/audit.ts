import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { GENESIS_PREV } from "./hashchain";
import { bus, CHANNEL } from "./events";

/**
 * Immutable audit trail (§14): every entry chains SHA-256 hashes.
 * `appendAudit` must be called INSIDE the same Prisma transaction as the
 * state change it records, so events and state stay consistent.
 */

export const AUDIT_TYPES = {
  INCIDENT_CREATED: "INCIDENT_CREATED",
  GPS_CAPTURED: "GPS_CAPTURED",
  COUNTDOWN_STARTED: "COUNTDOWN_STARTED",
  INCIDENT_CANCELLED: "INCIDENT_CANCELLED",
  INCIDENT_ACTIVATED: "INCIDENT_ACTIVATED",
  VOLUNTEER_ALERTED: "VOLUNTEER_ALERTED",
  VOLUNTEER_ACCEPTED: "VOLUNTEER_ACCEPTED",
  VOLUNTEER_FLAGGED: "VOLUNTEER_FLAGGED",
  LOCATION_UPDATE: "LOCATION_UPDATE",
  INTEL_MESSAGE: "INTEL_MESSAGE",
  EVIDENCE_EVENT: "EVIDENCE_EVENT",
  POLICE_STATUS_CHANGE: "POLICE_STATUS_CHANGE",
  INCIDENT_RESOLVED: "INCIDENT_RESOLVED",
  IDENTITY_REVEALED: "IDENTITY_REVEALED",
  ALERT_FAILED: "ALERT_FAILED",
  VOICE_TRIGGERED: "VOICE_TRIGGERED",
  SPEAKER_VERIFIED: "SPEAKER_VERIFIED",
  CLUSTER_CREATED: "CLUSTER_CREATED",
} as const;

function hashRow(input: { prevHash: string; seq: number; type: string; createdAt: Date; data: string }): string {
  return createHash("sha256")
    .update([input.prevHash, input.seq, input.type, input.createdAt.toISOString(), input.data].join("|"))
    .digest("hex");
}

export interface AuditInput {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Appends a chained audit event inside the given transaction client.
 * Pass `tx = prisma` when not in an explicit transaction.
 */
export async function appendAudit(
  tx: Prisma.TransactionClient | PrismaClient,
  incidentId: string,
  input: AuditInput
): Promise<{ seq: number; hash: string }> {
  const last = await tx.auditEvent.findFirst({
    where: { incidentId },
    orderBy: { seq: "desc" },
    select: { seq: true, hash: true },
  });
  const seq = (last?.seq ?? -1) + 1;
  const prevHash = last?.hash ?? GENESIS_PREV;
  const data = JSON.stringify(input.data);
  const createdAt = new Date();
  const hash = hashRow({ prevHash, seq, type: input.type, createdAt, data });
  await tx.auditEvent.create({
    data: { incidentId, seq, type: input.type, data, createdAt, prevHash, hash },
  });
  bus.publish(CHANNEL.incident(incidentId), "audit:appended", { seq, type: input.type, createdAt: createdAt.toISOString() });
  bus.publish(CHANNEL.DASHBOARD, "audit:appended", { incidentId, seq, type: input.type });
  return { seq, hash };
}

/** Standalone helper for callers already holding a transaction. */
export function auditInTx(tx: Prisma.TransactionClient) {
  return (incidentId: string, input: AuditInput) => appendAudit(tx, incidentId, input);
}
