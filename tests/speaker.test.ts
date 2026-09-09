import { describe, expect, it } from "vitest";
import { SimulatedSpeakerVerifier } from "@/lib/speaker-verification";

describe("SimulatedSpeakerVerifier (§15 Prototype / Simulated)", () => {
  const v = new SimulatedSpeakerVerifier();

  it("passes for the enrolled user with phrase + token", async () => {
    const profile = await v.enroll("user-1", "safeguard sentinel");
    const r = await v.verify("user-1", "Safeguard Sentinel ", profile.enrollmentToken, profile);
    expect(r.pass).toBe(true);
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it("BLOCKS a random user who says the phrase without the token", async () => {
    const profile = await v.enroll("user-1", "safeguard sentinel");
    const r = await v.verify("attacker-9", "safeguard sentinel", "", profile);
    expect(r.pass).toBe(false);
  });

  it("BLOCKS a wrong phrase even with a valid token", async () => {
    const profile = await v.enroll("user-1", "safeguard sentinel");
    const r = await v.verify("user-1", "open sesame", profile.enrollmentToken, profile);
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("PHRASE_MISMATCH");
  });

  it("BLOCKS when no enrollment exists", async () => {
    const r = await v.verify("ghost", "anything", "any-token", null);
    expect(r.pass).toBe(false);
  });
});
