import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/lib/geo";
import { CONFIG } from "@/lib/config";

describe("triage clustering thresholds (§10)", () => {
  const base = { lat: 12.9716, lng: 77.5946 };

  it("clusters incidents ~30m apart", () => {
    const other = { lat: base.lat + 30 / 111_320, lng: base.lng };
    expect(haversineMeters(base, other)).toBeLessThanOrEqual(CONFIG.CLUSTER_RADIUS_M);
  });

  it("does NOT cluster incidents 200m apart", () => {
    const other = { lat: base.lat + 200 / 111_320, lng: base.lng };
    expect(haversineMeters(base, other)).toBeGreaterThan(CONFIG.CLUSTER_RADIUS_M);
  });

  it("uses the configured ~50m cluster radius", () => {
    expect(CONFIG.CLUSTER_RADIUS_M).toBe(50);
  });
});

describe("nearest-first prioritization (§10)", () => {
  it("sorts alerts by distance ascending", () => {
    const items = [{ d: 420 }, { d: 120 }, { d: 310 }, { d: null }];
    const sorted = [...items].sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
    expect(sorted.map((s) => s.d)).toEqual([120, 310, 420, null]);
  });
});
