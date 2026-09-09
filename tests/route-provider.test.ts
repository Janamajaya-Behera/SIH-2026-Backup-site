import { describe, expect, it } from "vitest";
import { FallbackRouteProvider } from "@/lib/route-provider";
import { SIM_LABELS } from "@/lib/config";

describe("FallbackRouteProvider (§3 honest fallback)", () => {
  it("returns straight-line distance with SIMULATED label", async () => {
    const p = new FallbackRouteProvider();
    const from = { lat: 12.9716, lng: 77.5946 };
    const to = { lat: 12.9726, lng: 77.5946 }; // ~111m north
    const r = await p.route(from, to);
    expect(r.provider).toBe("SIMULATED");
    expect(r.label).toBe(SIM_LABELS.routingSimulated);
    expect(r.distanceM).toBeGreaterThan(100);
    expect(r.distanceM).toBeLessThan(125);
    expect(r.etaSec).toBeGreaterThan(0);
  });

  it("chains multi-stop legs for medical volunteers (§10)", async () => {
    const p = new FallbackRouteProvider();
    const from = { lat: 12.9716, lng: 77.5946 };
    const to = { lat: 12.9716, lng: 77.5974 }; // ~260m east
    const stops = [{ lat: 12.9726, lng: 77.596, label: "Volunteer X" }]; // ~111m off-axis → detour
    const r = await p.route(from, to, { stops });
    const direct = await p.route(from, to);
    expect(r.distanceM).toBeGreaterThan(direct.distanceM);
  });
});
