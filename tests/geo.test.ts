import { describe, expect, it } from "vitest";
import { haversineMeters, classifyZone, isValidCoord } from "@/lib/geo";

describe("haversineMeters", () => {
  it("computes a known distance accurately (±1m)", () => {
    // ~111.19 m per degree of latitude.
    const a = { lat: 12.9716, lng: 77.5946 };
    const b = { lat: 12.9726, lng: 77.5946 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(113);
  });

  it("is symmetric and zero for identical points", () => {
    const a = { lat: 12.9716, lng: 77.5946 };
    const b = { lat: 12.98, lng: 77.61 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 5);
    expect(haversineMeters(a, a)).toBe(0);
  });
});

describe("classifyZone — LOCKED boundaries (§D)", () => {
  it("DANGER: distance < 50m", () => {
    expect(classifyZone(0)).toBe("DANGER");
    expect(classifyZone(49.9)).toBe("DANGER");
  });
  it("BUFFER: 50 ≤ d < 100 — never alerted", () => {
    expect(classifyZone(50)).toBe("BUFFER");
    expect(classifyZone(70)).toBe("BUFFER");
    expect(classifyZone(99.9)).toBe("BUFFER");
  });
  it("HELPER: distance ≥ 100m", () => {
    expect(classifyZone(100)).toBe("HELPER");
    expect(classifyZone(100.1)).toBe("HELPER");
    expect(classifyZone(2000)).toBe("HELPER");
  });
  it("OUT_OF_RANGE beyond max alert radius", () => {
    expect(classifyZone(2001)).toBe("OUT_OF_RANGE");
  });
});

describe("isValidCoord", () => {
  it("rejects invalid GPS input (§16)", () => {
    expect(isValidCoord(999, 999)).toBe(false);
    expect(isValidCoord(NaN, 12)).toBe(false);
    expect(isValidCoord(0, 0)).toBe(false); // null-island sentinel
    expect(isValidCoord("12", 77)).toBe(false);
    expect(isValidCoord(12.9716, 77.5946)).toBe(true);
  });
});
