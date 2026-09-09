import { describe, expect, it } from "vitest";
import { computeEventHash, verifyChain, GENESIS_PREV } from "@/lib/hashchain";

function buildChain(n: number) {
  const events = [];
  let prevHash = GENESIS_PREV;
  for (let i = 0; i < n; i++) {
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, i));
    const data = JSON.stringify({ step: i, note: `event-${i}` });
    const type = i % 2 === 0 ? "LOCATION_UPDATE" : "INTEL_MESSAGE";
    const base = { seq: i, type, createdAt, data, prevHash };
    const hash = computeEventHash(base);
    events.push({ ...base, hash });
    prevHash = hash;
  }
  return events;
}

describe("audit hash chain (§14)", () => {
  it("validates an unmodified chain", () => {
    const chain = buildChain(10);
    const v = verifyChain(chain);
    expect(v.valid).toBe(true);
    expect(v.brokenAtSeq).toBeNull();
  });

  it("detects tampered event data", () => {
    const chain = buildChain(10);
    chain[4].data = JSON.stringify({ step: 4, note: "TAMPERED" });
    const v = verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.brokenAtSeq).toBe(4);
    expect(v.reason).toMatch(/tamper|mismatch/i);
  });

  it("detects a sequence gap", () => {
    const chain = buildChain(10);
    chain[6].seq = 99;
    const v = verifyChain(chain);
    expect(v.valid).toBe(false);
  });

  it("detects a re-computed hash that breaks linkage", () => {
    const chain = buildChain(5);
    // Tamper event 2 AND recompute only its own hash: next event's prevHash mismatch must trip.
    chain[2].data = JSON.stringify({ hacked: true });
    chain[2].hash = computeEventHash(chain[2]);
    const v = verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.brokenAtSeq).toBe(3);
  });
});
