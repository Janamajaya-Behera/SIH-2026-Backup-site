import { createHash } from "crypto";

export const GENESIS_PREV = "GENESIS";

export interface ChainEvent {
  seq: number;
  type: string;
  createdAt: Date;
  data: string; // canonical JSON string
  prevHash: string;
  hash: string;
}

/**
 * Event hash = SHA-256(prevHash | seq | type | createdAtISO | data)
 * Tampering with any prior event invalidates every hash after it (§14).
 */
export function computeEventHash(e: Omit<ChainEvent, "hash">): string {
  const payload = [e.prevHash, e.seq, e.type, e.createdAt.toISOString(), e.data].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export interface ChainVerification {
  valid: boolean;
  length: number;
  brokenAtSeq: number | null;
  reason?: string;
}

/** Recomputes the full chain sequentially and reports the first broken event. */
export function verifyChain(events: ChainEvent[]): ChainVerification {
  let prevHash = GENESIS_PREV;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i) {
      return { valid: false, length: events.length, brokenAtSeq: e.seq, reason: "Sequence gap detected" };
    }
    if (e.prevHash !== prevHash) {
      return { valid: false, length: events.length, brokenAtSeq: e.seq, reason: "Previous-hash mismatch" };
    }
    const expected = computeEventHash(e);
    if (e.hash !== expected) {
      return { valid: false, length: events.length, brokenAtSeq: e.seq, reason: "Event hash mismatch (data tampered)" };
    }
    prevHash = e.hash;
  }
  return { valid: true, length: events.length, brokenAtSeq: null };
}
